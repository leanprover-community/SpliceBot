const fs = require('fs');
const { authorizeCommandActor } = require('./command-authorization');
const { validateCommandCommentTemplate } = require('./render-template');

function normalizeList(value) {
  if (value == null) return [];
  const rawItems = Array.isArray(value) ? value : String(value).split(/[\n,]/);
  return rawItems.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
}

// Args may contain internal spaces (e.g. "in progress"), so they are compared
// with whitespace collapsed rather than tokenized.
function normalizeArgsValue(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeAllowedArgs(value) {
  if (value == null) return [];
  const rawItems = Array.isArray(value) ? value : String(value).split(/[\n,]/);
  return rawItems.map(normalizeArgsValue).filter(Boolean);
}

// Trigger workflows run from the PR's merge commit, so open PRs can keep
// running a splice.yaml version that predates argument support even after the
// caller repo updates its pin. Those artifacts lack the trigger_args key
// entirely; distinguishing "missing key" from "present but empty" lets
// arg-requiring commands report the version skew instead of a misleading
// missing-argument error. Returns true/false, or null when the bridge outputs
// JSON is unavailable or malformed (unknown — keep the generic message).
function bridgeForwardsTriggerArgs(rawOutputsJson) {
  const trimmed = String(rawOutputsJson || '').trim();
  if (!trimmed) return null;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return Object.prototype.hasOwnProperty.call(parsed, 'trigger_args');
}

function parseLabelCommands(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);

  if (!Array.isArray(parsed)) {
    throw new Error('label_commands must parse to an array.');
  }

  const validMinRepoPermissions = new Set(['disabled', 'anyone', 'triage', 'write', 'maintain', 'admin']);

  return parsed.map((entry, index) => {
    if (!entry || Array.isArray(entry) || typeof entry !== 'object') {
      throw new Error(`label_commands[${index}] must be an object.`);
    }

    const keyword = String(entry.command ?? entry.keyword ?? '').trim().toLowerCase();
    const label = String(entry.label ?? '').trim();
    const comment = entry.comment == null ? '' : String(entry.comment);
    const minRepoPermission = String(entry.min_repo_permission ?? 'write').trim().toLowerCase();
    const allowedUsers = normalizeList(entry.allowed_users);
    const allowedTeams = normalizeList(entry.allowed_teams);
    const type = String(entry.type ?? 'add-label').trim().toLowerCase();

    if (entry.allowed_args != null && !Array.isArray(entry.allowed_args) && typeof entry.allowed_args !== 'string') {
      throw new Error(`label_commands[${index}] has invalid allowed_args; expected an array or comma/newline-separated string.`);
    }
    const allowedArgs = normalizeAllowedArgs(entry.allowed_args);
    if (entry.allowed_args != null && allowedArgs.length === 0) {
      throw new Error(`label_commands[${index}] has allowed_args with no usable entries.`);
    }

    if (!keyword) throw new Error(`label_commands[${index}] is missing command/keyword.`);
    if (!label && !comment.trim()) throw new Error(`label_commands[${index}] is missing label and/or comment.`);
    if (entry.comment != null) {
      try {
        validateCommandCommentTemplate(comment);
      } catch (error) {
        throw new Error(`label_commands[${index}] has an invalid comment template: ${error.message}`);
      }
    }
    if (type !== 'add-label') throw new Error(`label_commands[${index}] has unsupported type '${type}'.`);
    if (!validMinRepoPermissions.has(minRepoPermission)) {
      throw new Error(`label_commands[${index}] has invalid min_repo_permission '${minRepoPermission}'.`);
    }

    return {
      command: keyword,
      label,
      comment,
      min_repo_permission: minRepoPermission,
      allowed_users: allowedUsers,
      allowed_teams: allowedTeams,
      allowed_args: allowedArgs,
    };
  });
}

function resolveTriggerCommand({ rawCommands, triggerKeyword, triggerArgs, triggerArgsForwarded = null }) {
  const normalizedTriggerKeyword = String(triggerKeyword || '').trim().toLowerCase();
  const normalizedTriggerArgs = normalizeArgsValue(triggerArgs);
  if (!normalizedTriggerKeyword) {
    return { trigger_mode: 'splice' };
  }

  if (!String(rawCommands || '').trim()) {
    return {
      trigger_mode: 'unknown',
      resolve_error: `No label_commands configured for keyword '${normalizedTriggerKeyword}'.`,
      shouldFail: true,
    };
  }

  let commands;
  try {
    commands = parseLabelCommands(rawCommands);
  } catch (error) {
    return {
      trigger_mode: 'invalid',
      resolve_error: error.message.startsWith('label_commands')
        ? error.message
        : `Could not parse label_commands: ${error.message}`,
      shouldFail: true,
    };
  }

  const match = commands.find((entry) => entry.command === normalizedTriggerKeyword);
  if (!match) {
    return {
      trigger_mode: 'unknown',
      resolve_error: `No label command matched keyword '${normalizedTriggerKeyword}'.`,
      shouldFail: true,
    };
  }

  // Fail closed on arguments: a command only accepts the args it explicitly
  // allowlists, and commands without allowed_args accept none.
  if (match.allowed_args.length === 0) {
    if (normalizedTriggerArgs) {
      return {
        trigger_mode: 'invalid_args',
        resolve_error: `Command '${match.command}' does not accept arguments (got '${normalizedTriggerArgs}').`,
        shouldFail: true,
      };
    }
  } else if (!match.allowed_args.includes(normalizedTriggerArgs)) {
    const allowedList = match.allowed_args.map((arg) => `'${arg}'`).join(', ');
    let resolveError;
    if (normalizedTriggerArgs) {
      resolveError = `Argument '${normalizedTriggerArgs}' is not allowed for command '${match.command}'. Allowed: ${allowedList}.`;
    } else if (triggerArgsForwarded === false) {
      resolveError =
        `Command '${match.command}' requires an argument, but the trigger workflow run predates argument support ` +
        'and did not forward any. Update the PR branch (e.g. merge the latest base branch) so the trigger workflow ' +
        `runs its current version, then retry. Allowed: ${allowedList}.`;
    } else {
      resolveError = `Command '${match.command}' requires an argument. Allowed: ${allowedList}.`;
    }
    return {
      trigger_mode: 'invalid_args',
      resolve_error: resolveError,
      shouldFail: true,
    };
  }

  return {
    trigger_mode: 'label',
    label_command: match.command,
    label_name: match.label,
    comment_template: match.comment,
    command_args: normalizedTriggerArgs,
    label_min_repo_permission: match.min_repo_permission,
    label_allowed_users_json: JSON.stringify(match.allowed_users),
    label_allowed_teams_json: JSON.stringify(match.allowed_teams),
  };
}

function writeOutputs(outputs, outputPath) {
  const lines = Object.entries(outputs)
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([key, value]) => {
      const text = String(value);
      if (text.includes('\n')) {
        return `${key}<<SPLICE_BOT_OUTPUT_EOF\n${text}\nSPLICE_BOT_OUTPUT_EOF`;
      }
      return `${key}=${text}`;
    });

  if (lines.length > 0) {
    fs.appendFileSync(outputPath, `${lines.join('\n')}\n`);
  }
}

function runFromEnvironment(env = process.env) {
  const result = resolveTriggerCommand({
    rawCommands: env.RAW_LABEL_COMMANDS || '',
    triggerKeyword: env.TRIGGER_KEYWORD || '',
    triggerArgs: env.TRIGGER_ARGS || '',
    triggerArgsForwarded: bridgeForwardsTriggerArgs(env.BRIDGE_OUTPUTS_JSON),
  });

  writeOutputs(result, env.GITHUB_OUTPUT);

  if (result.shouldFail) {
    console.error(result.resolve_error);
    process.exit(1);
  }
}

async function runResolveAndAuthorizeCommandStep({ core, github, env = process.env }) {
  const result = resolveTriggerCommand({
    rawCommands: env.RAW_LABEL_COMMANDS || '',
    triggerKeyword: env.TRIGGER_KEYWORD || '',
    triggerArgs: env.TRIGGER_ARGS || '',
    triggerArgsForwarded: bridgeForwardsTriggerArgs(env.BRIDGE_OUTPUTS_JSON),
  });

  for (const [key, value] of Object.entries(result)) {
    if (value !== undefined && value !== null && value !== false && key !== 'shouldFail') {
      core.setOutput(key, value);
    }
  }

  if (result.shouldFail) {
    core.setFailed(result.resolve_error);
    return;
  }

  if (result.trigger_mode !== 'label') {
    return;
  }

  const authzTokenSource = env.AUTHZ_TOKEN
    ? 'inputs.authz_token'
    : env.INPUT_TOKEN
      ? 'inputs.token'
      : 'github.token';

  const authz = await authorizeCommandActor({
    commenterLogin: (env.COMMENTER_LOGIN || '').trim(),
    baseRepo: (env.BASE_REPO || '').trim(),
    commandName: result.label_command || '',
    labelName: result.label_name || '',
    minRepoPermission: (result.label_min_repo_permission || 'write').trim().toLowerCase(),
    rawAllowedUsersJson: result.label_allowed_users_json || '[]',
    rawAllowedTeamsJson: result.label_allowed_teams_json || '[]',
    authzTokenSource,
    github,
    onInfo: (message) => core.info(message),
  });

  core.setOutput('label_authz_decision', authz.decision);
  core.setOutput('label_authz_reason', authz.reason);
  core.setOutput('label_authz_details', authz.details);
  core.setOutput('label_authz_token_source', authzTokenSource);

  if (authz.decision === 'allow') {
    core.info(authz.reason);
    core.info(authz.details);
    return;
  }

  if (authz.decision === 'deny') {
    core.warning(authz.reason);
    core.info(authz.details);
    core.setFailed(authz.reason);
    return;
  }

  core.error(authz.reason);
  core.info(authz.details);
  core.setFailed(authz.reason);
}

if (require.main === module) {
  try {
    runFromEnvironment();
  } catch (error) {
    console.error(`Could not parse label_commands: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  normalizeList,
  bridgeForwardsTriggerArgs,
  parseLabelCommands,
  resolveTriggerCommand,
  runFromEnvironment,
  runResolveAndAuthorizeCommandStep,
};
