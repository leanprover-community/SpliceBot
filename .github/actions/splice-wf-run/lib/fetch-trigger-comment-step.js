const { parseTriggerComment } = require('./parse-trigger-comment');

// Fetches the triggering review comment and parses the trigger grammar from
// its current body, instead of trusting the keyword/args the bridge artifact
// carried: trigger workflows run from the PR's merge commit, so stale PRs can
// emit artifacts produced by an old grammar. Authorization stays bound to the
// event-time commenter from the bridge; only the text is re-read. The body is
// fetched as it exists now, not as it was when the event fired — only the
// commenter or a repo maintainer can have edited it in that window, and either
// could trigger the bot directly anyway.
//
// Fail-closed: a failed fetch stops the run. Falling back to the bridge's
// parsed values would silently reintroduce the stale-grammar behavior this
// step exists to prevent.
async function runFetchTriggerCommentStep({ core, github, env = process.env }) {
  const baseRepo = (env.BASE_REPO || '').trim();
  const commentId = Number(env.REVIEW_COMMENT_ID || '');

  let body;
  if ((env.BRIDGE_OVERRIDE_MODE || '') === 'true') {
    // Test-only path, active only when the internal bridge_override_json
    // input is set: take the body from the override event instead of the API.
    let event;
    try {
      event = JSON.parse(env.BRIDGE_EVENT_JSON || '{}');
    } catch (error) {
      core.setFailed(`Could not parse bridge event JSON: ${error.message}`);
      return;
    }
    body = event?.comment?.body;
    if (typeof body !== 'string') {
      core.setFailed('bridge_override_json mode requires event.comment.body to be a string.');
      return;
    }
  } else {
    const [owner, repo, ...rest] = baseRepo.split('/');
    if (!owner || !repo || rest.length > 0 || !Number.isInteger(commentId) || commentId <= 0) {
      core.setFailed(`Missing review comment context (base repo '${baseRepo}', comment id '${env.REVIEW_COMMENT_ID || ''}').`);
      return;
    }
    try {
      const response = await github.rest.pulls.getReviewComment({ owner, repo, comment_id: commentId });
      body = response.data?.body ?? '';
    } catch (error) {
      core.setFailed(`Could not fetch review comment ${commentId} from ${baseRepo}: ${error.message}`);
      return;
    }
  }

  core.info(`Review comment body:\n---\n${body}\n---`);

  const parsed = parseTriggerComment(body);
  core.setOutput('trigger_found', parsed.found ? 'true' : 'false');
  core.setOutput('trigger_keyword', parsed.keyword);
  core.setOutput('trigger_args', parsed.args);
  core.setOutput('trigger_extra_text', parsed.extraText);

  if (!parsed.found) {
    core.info('No `splice-bot` found at the start of a line (the comment may have been edited); nothing to do.');
    return;
  }

  core.info(`Trigger keyword: ${parsed.keyword || '(none)'}`);
  core.info(`Trigger args: ${parsed.args || '(none)'}`);
  core.info(`Trigger extra text: ${parsed.extraText ? `${parsed.extraText.split('\n').length} line(s)` : '(none)'}`);
}

module.exports = { runFetchTriggerCommentStep };
