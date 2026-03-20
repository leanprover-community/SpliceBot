const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveForkOwner,
  runValidateCprInputsStep,
  validateCprInputs,
} = require('../../.github/actions/splice-wf-run/lib/validate-cpr-inputs-step');

test('validateCprInputs accepts valid inputs and returns warnings when owner type is unknown', () => {
  const result = validateCprInputs({
    pushToFork: 'owner/repo',
    maintainerCanModify: 'true',
    branchName: 'splice-bot/pr-1-src-Foo-1234567890',
    committer: 'Bot <bot@example.com>',
    author: 'Author <author@example.com>',
    forkOwnerType: 'Unknown',
  });

  assert.deepEqual(result.warnings, [
    'Could not determine push_to_fork owner type. If this is an organization-owned fork, maintainer_can_modify=true may fail.',
  ]);
});

test('validateCprInputs rejects invalid push_to_fork', () => {
  assert.throws(
    () =>
      validateCprInputs({
        pushToFork: 'not-a-repo',
        maintainerCanModify: '',
        branchName: 'splice-bot/pr-1-src-Foo-1234567890',
        committer: '',
        author: '',
        forkOwnerType: 'Unknown',
      }),
    /Invalid push_to_fork/,
  );
});

test('validateCprInputs rejects invalid author format', () => {
  assert.throws(
    () =>
      validateCprInputs({
        pushToFork: '',
        maintainerCanModify: '',
        branchName: 'splice-bot/pr-1-src-Foo-1234567890',
        committer: '',
        author: 'invalid',
        forkOwnerType: '',
      }),
    /Invalid author format/,
  );
});

test('resolveForkOwner returns unknown when push_to_fork is empty', async () => {
  const result = await resolveForkOwner({
    github: {
      rest: {
        users: {
          getByUsername: async () => {
            throw new Error('should not be called');
          },
        },
      },
    },
    pushToFork: '',
  });

  assert.deepEqual(result, { forkOwner: '', forkOwnerType: 'Unknown' });
});

test('resolveForkOwner resolves owner type when lookup succeeds', async () => {
  const infoMessages = [];
  const result = await resolveForkOwner({
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
    pushToFork: 'octocat/SpliceBot',
    onInfo: (message) => infoMessages.push(message),
  });

  assert.deepEqual(result, { forkOwner: 'octocat', forkOwnerType: 'User' });
  assert.deepEqual(infoMessages, ['push_to_fork owner octocat type: User']);
});

test('runValidateCprInputsStep emits outputs and warnings', async () => {
  const outputs = [];
  const warnings = [];

  await runValidateCprInputsStep({
    core: {
      info: () => {},
      warning: (message) => warnings.push(message),
      setOutput: (name, value) => outputs.push([name, value]),
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
      MAINTAINER_CAN_MODIFY: 'true',
      BRANCH_NAME: 'splice-bot/pr-1-src-Foo-1234567890',
      COMMITTER: 'Bot <bot@example.com>',
      AUTHOR: 'Author <author@example.com>',
    },
  });

  assert.deepEqual(outputs, [
    ['fork_owner', 'org'],
    ['fork_owner_type', 'Unknown'],
  ]);
  assert.match(warnings[0], /Unable to resolve push_to_fork owner type for org: lookup failed/);
  assert.match(warnings[1], /Could not determine push_to_fork owner type/);
});
