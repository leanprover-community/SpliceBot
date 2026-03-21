const test = require('node:test');
const assert = require('node:assert/strict');

const runCommentBackStep = require('../../.github/actions/splice-wf-run/lib/comment-back-step');
const { collectStepOutcomes } = require('../../.github/actions/splice-wf-run/lib/comment-back-step');

test('comment-back step replies to the review comment when one is available', async () => {
  const replyCalls = [];
  const issueCalls = [];
  const github = {
    rest: {
      pulls: {
        createReplyForReviewComment: async (payload) => {
          replyCalls.push(payload);
        },
      },
      issues: {
        createComment: async (payload) => {
          issueCalls.push(payload);
        },
      },
    },
  };

  await runCommentBackStep({
    core: {
      info: () => {},
      warning: () => {},
    },
    github,
    env: {
      ORIGINAL_PR_NUMBER: '42',
      REVIEW_COMMENT_ID: '7',
      REPO_FULL: 'leanprover-community/SpliceBot',
      FILE_PATH: 'src/Foo.lean',
      APPLY_FAILED: 'false',
      NO_CHANGES: 'false',
      AUTOMATED_PR_NUMBER: '99',
      BASE_REF: 'master',
      HEAD_REF: 'feature',
      HEAD_LABEL: 'author:feature',
      RUN_URL: 'https://example.test/run',
      TOKEN_SOURCE: 'inputs.token',
      BRANCH_TOKEN_SOURCE: 'inputs.branch_token',
      AUTHZ_OUTCOME: 'success',
      AUTHZ_DECISION: 'allow',
      AUTHZ_REASON: 'Authorized reviewer via allowed-users.',
      AUTHZ_DETAILS: '',
      AUTHZ_TOKEN_SOURCE: 'inputs.authz_token',
      FORK_OWNER: '',
      FORK_OWNER_TYPE: '',
      CPR_OUTCOME: 'success',
    },
  });

  assert.equal(replyCalls.length, 1);
  assert.equal(issueCalls.length, 0);
  assert.equal(replyCalls[0].owner, 'leanprover-community');
  assert.match(replyCalls[0].body, /\*\*Split PR created\*\*/);
});

test('comment-back step falls back to issue comments when replying fails', async () => {
  const warnings = [];
  const issueCalls = [];
  const github = {
    rest: {
      pulls: {
        createReplyForReviewComment: async () => {
          throw new Error('reply failed');
        },
      },
      issues: {
        createComment: async (payload) => {
          issueCalls.push(payload);
        },
      },
    },
  };

  await runCommentBackStep({
    core: {
      info: () => {},
      warning: (message) => warnings.push(message),
    },
    github,
    env: {
      ORIGINAL_PR_NUMBER: '42',
      REVIEW_COMMENT_ID: '7',
      REPO_FULL: 'leanprover-community/SpliceBot',
      FILE_PATH: '',
      APPLY_FAILED: 'false',
      NO_CHANGES: 'false',
      AUTOMATED_PR_NUMBER: '',
      BASE_REF: 'master',
      HEAD_REF: 'feature',
      HEAD_LABEL: '',
      RUN_URL: 'https://example.test/run',
      TOKEN_SOURCE: 'inputs.token',
      BRANCH_TOKEN_SOURCE: 'not-applicable',
      AUTHZ_OUTCOME: 'failure',
      AUTHZ_DECISION: 'deny',
      AUTHZ_REASON: 'Denied.',
      AUTHZ_DETAILS: '',
      AUTHZ_TOKEN_SOURCE: 'github.token',
      FORK_OWNER: '',
      FORK_OWNER_TYPE: '',
      BRIDGE_OUTCOME: 'failure',
    },
  });

  assert.equal(issueCalls.length, 1);
  assert.match(warnings[0], /Unable to reply to review comment 7: reply failed/);
  assert.match(issueCalls[0].body, /\*\*Could not determine target file\*\*/);
});

test('comment-back step skips cleanly when the PR number is invalid', async () => {
  const infoMessages = [];
  const github = {
    rest: {
      pulls: {
        createReplyForReviewComment: async () => {
          throw new Error('should not be called');
        },
      },
      issues: {
        createComment: async () => {
          throw new Error('should not be called');
        },
      },
    },
  };

  await runCommentBackStep({
    core: {
      info: (message) => infoMessages.push(message),
      warning: () => {},
    },
    github,
    env: {
      ORIGINAL_PR_NUMBER: '',
    },
  });

  assert.deepEqual(infoMessages, [
    'Missing or invalid original PR number; cannot post a callback comment.',
  ]);
});

test('collectStepOutcomes builds labeled outcomes from env vars', () => {
  assert.deepEqual(collectStepOutcomes({
    BRIDGE_OUTCOME: 'success',
    CHECKOUT_BASE_OUTCOME: 'failure',
    CPR_OUTCOME: 'cancelled',
  }), [
    ['Consume bridge artifact', 'success'],
    ['Resolve configured trigger command', ''],
    ['Authorize commenter', ''],
    ['Check out BASE', 'failure'],
    ['Check out HEAD', ''],
    ['Stage file changes', ''],
    ['Validate create-pull-request inputs', ''],
    ['Create Pull Request', 'cancelled'],
  ]);
});
