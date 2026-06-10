const test = require('node:test');
const assert = require('node:assert/strict');

const runPostSplitPrCommentStep = require('../../.github/actions/splice-wf-run/lib/post-split-pr-comment-step');

function makeCore() {
  return {
    outputs: {},
    infoMessages: [],
    failures: [],
    setOutput(key, value) {
      this.outputs[key] = value;
    },
    info(message) {
      this.infoMessages.push(message);
    },
    setFailed(message) {
      this.failures.push(message);
    },
  };
}

test('post-split-pr-comment step renders the template and comments on the split PR', async () => {
  const core = makeCore();
  const createCommentCalls = [];
  const github = {
    rest: {
      issues: {
        createComment: async (payload) => {
          createCommentCalls.push(payload);
        },
      },
    },
  };

  await runPostSplitPrCommentStep({
    core,
    github,
    env: {
      REPO_FULL: 'leanprover-community/SpliceBot',
      COMMENT_TEMPLATE: 'maintainer merge\n\nRequested by @{commenter} via splice-bot on #{pr_number} ({file_path}).',
      SPLIT_PR_NUMBER: '99',
      FILE_PATH: 'Mathlib/Algebra/Group/Defs.lean',
      PR_NUMBER: '42',
      COMMENTER_LOGIN: 'reviewer',
    },
  });

  assert.deepEqual(createCommentCalls, [
    {
      owner: 'leanprover-community',
      repo: 'SpliceBot',
      issue_number: 99,
      body: 'maintainer merge\n\nRequested by @reviewer via splice-bot on #42 (Mathlib/Algebra/Group/Defs.lean).',
    },
  ]);
  assert.deepEqual(core.failures, []);
  assert.deepEqual(core.outputs, {});
});

test('post-split-pr-comment step reports failure outputs when the API call fails', async () => {
  const core = makeCore();
  const github = {
    rest: {
      issues: {
        createComment: async () => {
          throw new Error('Resource not accessible by integration');
        },
      },
    },
  };

  await runPostSplitPrCommentStep({
    core,
    github,
    env: {
      REPO_FULL: 'leanprover-community/SpliceBot',
      COMMENT_TEMPLATE: 'maintainer merge',
      SPLIT_PR_NUMBER: '99',
      PR_NUMBER: '42',
      COMMENTER_LOGIN: 'reviewer',
    },
  });

  assert.equal(core.outputs.comment_post_failed, 'true');
  assert.equal(core.outputs.comment_post_error, 'Resource not accessible by integration');
  assert.match(core.failures[0], /Failed to post command comment/);
});

test('post-split-pr-comment step fails closed on missing comment context', async () => {
  const core = makeCore();
  const github = {
    rest: {
      issues: {
        createComment: async () => {
          throw new Error('should not be called');
        },
      },
    },
  };

  await runPostSplitPrCommentStep({
    core,
    github,
    env: {
      REPO_FULL: 'not-a-full-repo',
      COMMENT_TEMPLATE: 'maintainer merge',
      SPLIT_PR_NUMBER: '99',
    },
  });

  assert.equal(core.outputs.comment_post_failed, 'true');
  assert.match(core.failures[0], /Failed to post command comment: Missing comment context/);
});

test('post-split-pr-comment step fails closed when rendering fails', async () => {
  const core = makeCore();
  const github = {
    rest: {
      issues: {
        createComment: async () => {
          throw new Error('should not be called');
        },
      },
    },
  };

  await runPostSplitPrCommentStep({
    core,
    github,
    env: {
      REPO_FULL: 'leanprover-community/SpliceBot',
      COMMENT_TEMPLATE: 'hello {who}',
      SPLIT_PR_NUMBER: '99',
      PR_NUMBER: '42',
      COMMENTER_LOGIN: 'reviewer',
    },
  });

  assert.equal(core.outputs.comment_post_failed, 'true');
  assert.match(core.outputs.comment_post_error, /Unknown placeholder\(s\) in comment template/);
});
