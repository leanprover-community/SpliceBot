const { bindToCommentCommit, resolveTriggerContext, verifiedFromOverride } = require('./trigger-context');

function parseJson(raw, what) {
  try {
    return { value: JSON.parse(raw || '{}') };
  } catch (error) {
    return { error: `Could not parse ${what}: ${error.message}` };
  }
}

async function runTriggerContextStep({ core, env = process.env }) {
  let verified;
  let baseRepo = (env.BASE_REPO || '').trim();

  if ((env.BRIDGE_OVERRIDE_MODE || '') === 'true') {
    // Test-only path, active only when the internal bridge_override_json
    // input is set: consume then skips verification and exposes the raw
    // override payload instead.
    const meta = parseJson(env.BRIDGE_META_JSON, 'bridge meta JSON');
    const event = parseJson(env.BRIDGE_EVENT_JSON, 'bridge event JSON');
    if (meta.error || event.error) {
      core.setFailed(meta.error || event.error);
      return;
    }
    const override = verifiedFromOverride({ meta: meta.value, event: event.value });
    verified = override.verified;
    baseRepo = override.baseRepo || baseRepo;
  } else {
    const parsed = parseJson(env.VERIFIED_JSON, 'verified bridge JSON');
    if (parsed.error) {
      core.setFailed(parsed.error);
      return;
    }
    verified = parsed.value;
  }

  let result = resolveTriggerContext({
    verified,
    baseRepo,
    baseRefInput: (env.BASE_REF_INPUT || '').trim(),
  });

  if (result.status === 'none') {
    core.info('No bridge artifact to act on; nothing to do.');
    return;
  }

  if (result.status === 'ok') {
    result = {
      ...bindToCommentCommit({ outputs: result.outputs, commentCommit: verified.trigger.original_commit_id }),
      parsed: result.parsed,
    };
  }

  for (const [key, value] of Object.entries(result.outputs)) {
    core.setOutput(key, value);
  }

  if (result.status === 'error') {
    // Shown verbatim in the comment back, so it must never include raw values
    // such as an unsafe file path.
    core.setOutput('context_error', result.error);
    core.setFailed(result.error);
    return;
  }

  core.info(`Review comment ${result.outputs.review_comment_id} on PR #${result.outputs.pr_number}:\n---\n${verified.trigger.body ?? ''}\n---`);

  if (result.status === 'no-trigger') {
    core.info('No `splice-bot` found at the start of a line (the comment may have been edited); nothing to do.');
    return;
  }

  const { parsed, outputs } = result;
  core.info(`Commenter: ${outputs.commenter_login} | PR author: ${outputs.pr_author_login}`);
  core.info(`File path: ${outputs.file_path}`);
  core.info(`Base: ${outputs.base_repo}@${outputs.base_ref} | head: ${outputs.head_repo}@${outputs.head_sha} (${outputs.head_ref}), the commit the comment was made on`);
  core.info(`Trigger keyword: ${parsed.keyword || '(none)'}`);
  core.info(`Trigger args: ${parsed.args || '(none)'}`);
  core.info(`Trigger extra text: ${parsed.extraText ? `${parsed.extraText.split('\n').length} line(s)` : '(none)'}`);
}

module.exports = { runTriggerContextStep };
