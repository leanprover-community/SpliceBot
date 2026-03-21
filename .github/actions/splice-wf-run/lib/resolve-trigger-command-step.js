const fs = require('fs');
const { authorizeCommandActor } = require('./command-authorization');

function normalizeList(value) {
  if (value == null) return [];
  const rawItems = Array.isArray(value) ? value : String(value).split(/[\n,]/);
  return rawItems.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
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
    const minRepoPermission = String(entry.min_repo_permission ?? 'write').trim().toLowerCase();
    const allowedUsers = normalizeList(entry.allowed_users);
    const allowedTeams = normalizeList(entry.allowed_teams);
    const type = String(entry.type ?? 'add-label').trim().toLowerCase();

    if (!keyword) throw new Error(`label_commands[${index}] is missing command/keyword.`);
    if (!label) throw new Error(`label_commands[${index}] is missing label.`);
    if (type !== 'add-label') throw new Error(`label_commands[${index}] has unsupported type '${type}'.`);
    if (!validMinRepoPermissions.has(minRepoPermission)) {
      throw new Error(`label_commands[${index}] has invalid min_repo_permission '${minRepoPermission}'.`);
    }

    return {
      command: keyword,
      label,
      min_repo_permission: minRepoPermission,
      allowed_users: allowedUsers,
      allowed_teams: allowedTeams,
    };
  });
}

function resolveTriggerCommand({ rawCommands, triggerKeyword }) {
  const normalizedTriggerKeyword = String(triggerKeyword || '').trim().toLowerCase();
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
      trigger_mode: error.message === 'label_commands must parse to an array.' ? 'invalid' : 'invalid',
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

  return {
    trigger_mode: 'label',
    label_command: match.command,
    label_name: match.label,
    label_min_repo_permission: match.min_repo_permission,
    label_allowed_users_json: JSON.stringify(match.allowed_users),
    label_allowed_teams_json: JSON.stringify(match.allowed_teams),
  };
}

function writeOutputs(outputs, outputPath) {
  const lines = Object.entries(outputs)
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([key, value]) => `${key}=${value}`);

  if (lines.length > 0) {
    fs.appendFileSync(outputPath, `${lines.join('\n')}\n`);
  }
}

function runFromEnvironment(env = process.env) {
  const result = resolveTriggerCommand({
    rawCommands: env.RAW_LABEL_COMMANDS || '',
    triggerKeyword: env.TRIGGER_KEYWORD || '',
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
  parseLabelCommands,
  resolveTriggerCommand,
  runFromEnvironment,
  runResolveAndAuthorizeCommandStep,
};
