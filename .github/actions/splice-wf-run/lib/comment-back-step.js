const { buildCallbackCommentPayload } = require('./comment-back');
const { deriveTokenSources } = require('./token-sources');

function collectStepOutcomes(env = process.env) {
  return [
    ['Consume bridge artifact', env.BRIDGE_OUTCOME || ''],
    ['Check out BASE', env.CHECKOUT_BASE_OUTCOME || ''],
    ['Check out HEAD', env.CHECKOUT_HEAD_OUTCOME || ''],
    ['Authorize commenter', env.AUTHORIZE_COMMENTER_OUTCOME || ''],
    ['Stage file changes', env.BRANCH_AND_COPY_OUTCOME || ''],
    ['Validate create-pull-request inputs', env.VALIDATE_CPR_INPUTS_OUTCOME || ''],
    ['Create Pull Request', env.CPR_OUTCOME || ''],
  ];
}

module.exports = async function runCommentBackStep({ core, github, env = process.env }) {
  const { tokenSource, authzTokenSource, branchTokenSource } = deriveTokenSources(env);
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
    tokenSource,
    branchTokenSource,
    authzOutcome: env.AUTHZ_OUTCOME || '',
    authzDecision: env.AUTHZ_DECISION || '',
    authzReason: env.AUTHZ_REASON || '',
    authzDetails: env.AUTHZ_DETAILS || '',
    authzTokenSource,
    forkOwner: env.FORK_OWNER || '',
    forkOwnerType: env.FORK_OWNER_TYPE || '',
    outcomes: collectStepOutcomes(env),
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

module.exports.collectStepOutcomes = collectStepOutcomes;
