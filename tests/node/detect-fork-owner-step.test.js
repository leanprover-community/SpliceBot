const test = require('node:test');
const assert = require('node:assert/strict');

const runDetectForkOwnerStep = require('../../.github/actions/splice-wf-run/lib/detect-fork-owner-step');

test('detect-fork-owner step sets unknown when push_to_fork is empty', async () => {
  const outputs = [];

  await runDetectForkOwnerStep({
    core: {
      setOutput: (name, value) => outputs.push([name, value]),
      info: () => {},
      warning: () => {},
    },
    github: {
      rest: {
        users: {
          getByUsername: async () => {
            throw new Error('should not be called');
          },
        },
      },
    },
    env: {
      PUSH_TO_FORK: '',
    },
  });

  assert.deepEqual(outputs, [
    ['fork_owner', ''],
    ['fork_owner_type', 'Unknown'],
  ]);
});

test('detect-fork-owner step reports the resolved owner type', async () => {
  const outputs = [];
  const infoMessages = [];

  await runDetectForkOwnerStep({
    core: {
      setOutput: (name, value) => outputs.push([name, value]),
      info: (message) => infoMessages.push(message),
      warning: () => {},
    },
    github: {
      rest: {
        users: {
          getByUsername: async ({ username }) => {
            assert.equal(username, 'octocat');
            return { data: { type: 'User' } };
          },
        },
      },
    },
    env: {
      PUSH_TO_FORK: 'octocat/SpliceBot',
    },
  });

  assert.deepEqual(outputs, [
    ['fork_owner', 'octocat'],
    ['fork_owner_type', 'User'],
  ]);
  assert.deepEqual(infoMessages, ['push_to_fork owner octocat type: User']);
});

test('detect-fork-owner step warns and falls back to unknown on lookup failure', async () => {
  const outputs = [];
  const warnings = [];

  await runDetectForkOwnerStep({
    core: {
      setOutput: (name, value) => outputs.push([name, value]),
      info: () => {},
      warning: (message) => warnings.push(message),
    },
    github: {
      rest: {
        users: {
          getByUsername: async () => {
            throw new Error('lookup failed');
          },
        },
      },
    },
    env: {
      PUSH_TO_FORK: 'org/SpliceBot',
    },
  });

  assert.deepEqual(outputs, [
    ['fork_owner', 'org'],
    ['fork_owner_type', 'Unknown'],
  ]);
  assert.match(warnings[0], /Unable to resolve push_to_fork owner type for org: lookup failed/);
});
