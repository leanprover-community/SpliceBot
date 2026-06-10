const test = require('node:test');
const assert = require('node:assert/strict');

const runApplyLabelStep = require('../../.github/actions/splice-wf-run/lib/apply-label-step');

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

test('apply-label step adds the configured label to the split PR', async () => {
  const core = makeCore();
  const addLabelsCalls = [];
  const github = {
    rest: {
      issues: {
        addLabels: async (payload) => {
          addLabelsCalls.push(payload);
        },
      },
    },
  };

  await runApplyLabelStep({
    core,
    github,
    env: {
      REPO_FULL: 'leanprover-community/SpliceBot',
      LABEL_NAME: 'ready-to-merge',
      SPLIT_PR_NUMBER: '99',
    },
  });

  assert.deepEqual(addLabelsCalls, [
    {
      owner: 'leanprover-community',
      repo: 'SpliceBot',
      issue_number: 99,
      labels: ['ready-to-merge'],
    },
  ]);
  assert.deepEqual(core.failures, []);
  assert.deepEqual(core.outputs, {});
});

test('apply-label step reports failure outputs when the API call fails', async () => {
  const core = makeCore();
  const github = {
    rest: {
      issues: {
        addLabels: async () => {
          throw new Error('Resource not accessible by integration');
        },
      },
    },
  };

  await runApplyLabelStep({
    core,
    github,
    env: {
      REPO_FULL: 'leanprover-community/SpliceBot',
      LABEL_NAME: 'ready-to-merge',
      SPLIT_PR_NUMBER: '99',
    },
  });

  assert.equal(core.outputs.label_apply_failed, 'true');
  assert.equal(core.outputs.label_apply_error, 'Resource not accessible by integration');
  assert.match(core.failures[0], /Failed to apply label 'ready-to-merge' to PR #99/);
});

test('apply-label step fails closed on missing label context', async () => {
  const core = makeCore();
  const github = {
    rest: {
      issues: {
        addLabels: async () => {
          throw new Error('should not be called');
        },
      },
    },
  };

  await runApplyLabelStep({
    core,
    github,
    env: {
      REPO_FULL: 'not-a-full-repo',
      LABEL_NAME: 'ready-to-merge',
      SPLIT_PR_NUMBER: '99',
    },
  });

  assert.equal(core.outputs.label_apply_failed, 'true');
  assert.match(core.failures[0], /Failed to apply label: Missing label context/);
});
