const { parseTriggerComment } = require('./parse-trigger-comment');

// Builds everything the privileged stage acts on from the bridge's verified
// values (consume's `verify: true`), never from the artifact itself. The
// trigger workflow runs from the PR's merge commit, so for a fork PR its
// author controls the whole artifact. Verification re-fetches the review
// comment by id and the PR it belongs to, and checks that the comment was
// written by the user whose event started the trigger run. The base
// repository is the one this workflow runs in, and the trigger grammar is
// parsed from the verified (current) comment body with current code.
//
// Returns:
// - { status: 'none' } when there is nothing to act on (no artifact was found);
// - { status: 'no-trigger', outputs } when the comment no longer has a trigger line;
// - { status: 'ok', outputs, parsed } when the split flow can proceed, once
//   bindToCommentCommit has picked the commit to split;
// - { status: 'error', error, outputs } when a required value is missing or
//   unsafe. The outputs then carry whatever identifies the PR and comment, so
//   the comment-back step can still report the failure there.
function resolveTriggerContext({ verified, baseRepo, baseRefInput = '' }) {
  const trigger = verified?.trigger;
  const pr = verified?.pr;
  if (!trigger && !pr) {
    return { status: 'none' };
  }

  if (trigger?.kind !== 'review_comment' || !isPositiveInteger(trigger.id) || !isPositiveInteger(pr?.number)) {
    return {
      status: 'error',
      error: 'The verified bridge values do not describe a review comment on a pull request.',
      outputs: {},
    };
  }

  // The path is interpolated into the bot's comments and the split PR, which
  // should only ever carry single-line paths. Git allows control and
  // line-break characters in names, so refuse them before the path reaches
  // any output.
  const rawPath = trigger.path || '';
  const pathIsSafe = !UNSAFE_PATH_CHARS.test(rawPath);
  const outputs = {
    pr_number: String(pr.number),
    review_comment_id: String(trigger.id),
    base_repo: baseRepo,
    file_path: pathIsSafe ? rawPath : '',
  };

  const parsed = parseTriggerComment(trigger.body);
  Object.assign(outputs, {
    trigger_found: parsed.found ? 'true' : 'false',
    trigger_keyword: parsed.keyword,
    trigger_args: parsed.args,
    trigger_extra_text: parsed.extraText,
  });
  if (!parsed.found) {
    return { status: 'no-trigger', outputs, parsed };
  }

  const headRepo = pr.head_repo || '';
  const headRef = pr.head_ref || '';
  Object.assign(outputs, {
    commenter_login: trigger.author || '',
    pr_author_login: pr.author || '',
    base_ref: baseRefInput || pr.base_ref || '',
    head_repo: headRepo,
    pr_head_sha: pr.head_sha || '',
    head_ref: headRef,
    head_label: headRepo && headRef ? `${headRepo.split('/')[0]}:${headRef}` : '',
  });

  const problems = [];
  if (!/^[^/\s]+\/[^/\s]+$/.test(baseRepo || '')) problems.push(`base repository '${baseRepo || ''}' is not owner/repo`);
  if (!pathIsSafe) problems.push('the file path contains control or line-break characters, which splice-bot does not support');
  else if (!outputs.file_path) problems.push('the review comment has no file path');
  if (!outputs.commenter_login) problems.push('the review comment has no author');
  if (!outputs.pr_author_login) problems.push('the pull request has no author');
  if (!outputs.base_ref) problems.push('the pull request has no base branch');
  if (!headRepo) problems.push('the pull request head repository no longer exists');
  if (!outputs.pr_head_sha || !headRef) problems.push('the pull request has no head commit or branch');
  if (problems.length > 0) {
    return {
      status: 'error',
      error: `Cannot split PR #${outputs.pr_number}: ${problems.join('; ')}.`,
      outputs,
      parsed,
    };
  }

  return { status: 'ok', outputs, parsed };
}

// Picks the commit to split: the one the review comment was made on
// (verified.trigger.original_commit_id), which a PR author cannot change after
// the fact. Splitting the PR's head instead would let them push different
// content between the comment and this run; verified.trigger.commit_id is no
// better, since GitHub moves it forward as the PR is pushed to.
// A reply's original_commit_id is the commit its thread was started on, which
// may predate changes the replier saw, so the comment's commit must also still
// be the PR's head: the comment (or its thread) was then made on exactly the
// content being split. This refuses replies in threads started before the
// latest push; in mathlib4 it almost never refuses a top-level comment.
function bindToCommentCommit({ outputs, commentCommit }) {
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(commentCommit || '')) {
    return {
      status: 'error',
      error: `Cannot split PR #${outputs.pr_number}: could not determine the commit review comment ${outputs.review_comment_id} was made on.`,
      outputs,
    };
  }
  if (commentCommit !== outputs.pr_head_sha) {
    return {
      status: 'error',
      error:
        `PR #${outputs.pr_number} has changed since the commit this comment is attached to ` +
        `(\`${commentCommit.slice(0, 7)}\`; the PR is now at \`${outputs.pr_head_sha.slice(0, 7)}\`). ` +
        'splice-bot only splits the version a comment was made on, and a reply is attached to the commit its thread was started on. ' +
        'Post `splice-bot` as a new review comment on the latest changes.',
      outputs,
    };
  }
  return { status: 'ok', outputs: { ...outputs, head_sha: commentCommit } };
}

// Test-only: maps a bridge_override_json payload (raw meta/event values, which
// the act harness supplies without any API access) onto the verified shape, so
// the harness exercises the same code path as verified runs.
function verifiedFromOverride({ meta, event }) {
  const comment = event?.comment;
  const pr = event?.pull_request;
  if (!comment) {
    return { verified: {}, baseRepo: '' };
  }
  return {
    verified: {
      trigger: {
        kind: 'review_comment',
        id: comment.id,
        author: comment.user?.login ?? '',
        body: comment.body,
        path: comment.path,
        original_commit_id: comment.original_commit_id,
      },
      pr: {
        number: meta?.pr_number,
        author: pr?.user?.login ?? '',
        head_sha: pr?.head?.sha,
        head_ref: pr?.head?.ref,
        head_repo: pr?.head?.repo?.full_name ?? null,
        base_ref: pr?.base?.ref,
      },
    },
    baseRepo: pr?.base?.repo?.full_name || '',
  };
}

// C0 and C1 controls (including CR, LF and NEL), DEL, and the Unicode line
// and paragraph separators.
const UNSAFE_PATH_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

module.exports = { bindToCommentCommit, resolveTriggerContext, verifiedFromOverride };
