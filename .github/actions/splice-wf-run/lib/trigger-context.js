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
// - { status: 'ok', outputs, parsed } when the split flow can proceed;
// - { status: 'error', error, outputs } when a required value is missing. The
//   outputs then carry whatever identifies the PR and comment, so the
//   comment-back step can still report the failure there.
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

  const outputs = {
    pr_number: String(pr.number),
    review_comment_id: String(trigger.id),
    base_repo: baseRepo,
    file_path: trigger.path || '',
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
    head_sha: pr.head_sha || '',
    head_ref: headRef,
    head_label: headRepo && headRef ? `${headRepo.split('/')[0]}:${headRef}` : '',
  });

  const problems = [];
  if (!/^[^/\s]+\/[^/\s]+$/.test(baseRepo || '')) problems.push(`base repository '${baseRepo || ''}' is not owner/repo`);
  if (!outputs.file_path) problems.push('the review comment has no file path');
  if (!outputs.commenter_login) problems.push('the review comment has no author');
  if (!outputs.pr_author_login) problems.push('the pull request has no author');
  if (!outputs.base_ref) problems.push('the pull request has no base branch');
  if (!headRepo) problems.push('the pull request head repository no longer exists');
  if (!outputs.head_sha || !headRef) problems.push('the pull request has no head commit or branch');
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

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

module.exports = { resolveTriggerContext, verifiedFromOverride };
