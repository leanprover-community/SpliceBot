const { bindToCommentCommit, resolveTriggerContext, verifiedFromOverride } = require('./trigger-context');

function parseJson(raw, what) {
  try {
    return { value: JSON.parse(raw || '{}') };
  } catch (error) {
    return { error: `Could not parse ${what}: ${error.message}` };
  }
}

// The bridge's verified trigger does not include the commit a review comment
// was made on, so re-fetch the (verified) comment for it. The checks are
// belt-and-braces: the id is verified, so this is the same comment.
async function fetchCommentCommit({ github, outputs, author }) {
  const [owner, repo] = outputs.base_repo.split('/');
  const commentId = Number(outputs.review_comment_id);
  let data;
  try {
    ({ data } = await github.rest.pulls.getReviewComment({ owner, repo, comment_id: commentId }));
  } catch (error) {
    throw new Error(`Could not fetch review comment ${commentId} to find the commit it was made on: ${error.message}`);
  }
  if (data.user?.login !== author || !String(data.pull_request_url || '').endsWith(`/pulls/${outputs.pr_number}`)) {
    throw new Error(`Review comment ${commentId} no longer matches the verified comment.`);
  }
  return data.original_commit_id;
}

async function runTriggerContextStep({ core, github, env = process.env }) {
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
    const { parsed } = result;
    let commentCommit;
    try {
      commentCommit = (env.BRIDGE_OVERRIDE_MODE || '') === 'true'
        ? verified.trigger.original_commit_id
        : await fetchCommentCommit({ github, outputs: result.outputs, author: result.outputs.commenter_login });
    } catch (error) {
      result = { status: 'error', error: error.message, outputs: result.outputs };
    }
    if (result.status === 'ok') {
      result = { ...bindToCommentCommit({ outputs: result.outputs, commentCommit }), parsed };
    }
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
