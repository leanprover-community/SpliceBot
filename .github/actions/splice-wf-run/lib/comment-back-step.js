const { buildCallbackCommentPayload } = require('./comment-back');

module.exports = async function runCommentBackStep({ core, github, env = process.env }) {
  const payload = buildCallbackCommentPayload({
    originalPrNumber: Number(env.ORIGINAL_PR_NUMBER || ''),
    reviewCommentId: Number(env.REVIEW_COMMENT_ID || ''),
    repoFull: env.REPO_FULL || '',
    filePath: env.FILE_PATH || '',
    applyFailed: env.APPLY_FAILED === 'true',
    noChanges: env.NO_CHANGES === 'true',
    automatedPrNumber: env.AUTOMATED_PR_NUMBER || '',
    baseRef: env.BASE_REF || '',
    headRef: env.HEAD_REF || '',
    headLabel: env.HEAD_LABEL || '',
    runUrl: env.RUN_URL || '',
    tokenSource: env.TOKEN_SOURCE || '',
    branchTokenSource: env.BRANCH_TOKEN_SOURCE || '',
    authzOutcome: env.AUTHZ_OUTCOME || '',
    authzDecision: env.AUTHZ_DECISION || '',
    authzReason: env.AUTHZ_REASON || '',
    authzDetails: env.AUTHZ_DETAILS || '',
    authzTokenSource: env.AUTHZ_TOKEN_SOURCE || 'unknown',
    forkOwner: env.FORK_OWNER || '',
    forkOwnerType: env.FORK_OWNER_TYPE || '',
    outcomes: JSON.parse(env.STEP_OUTCOMES_JSON || '[]'),
  });

  if (payload.skipReason) {
    core.info(payload.skipReason);
    return;
  }

  try {
    if (Number.isFinite(payload.reviewCommentId) && payload.reviewCommentId > 0) {
      await github.rest.pulls.createReplyForReviewComment({
        owner: payload.owner,
        repo: payload.repo,
        pull_number: payload.originalPrNumber,
        comment_id: payload.reviewCommentId,
        body: payload.body,
      });
      return;
    }
  } catch (error) {
    core.warning(`Unable to reply to review comment ${payload.reviewCommentId}: ${error.message}`);
  }

  await github.rest.issues.createComment({
    owner: payload.owner,
    repo: payload.repo,
    issue_number: payload.originalPrNumber,
    body: payload.body,
  });
};
