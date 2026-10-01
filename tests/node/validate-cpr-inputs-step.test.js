const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveAuthor,
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
      PR_TITLE_TEMPLATE: 'chore({file_scope}): split from #{pr_number}',
      SCOPE_STRIP_PREFIX: 'Mathlib/',
      FILE_PATH: 'Mathlib/Algebra/Group/Defs.lean',
      PR_NUMBER: '42',
    },
  });

  assert.deepEqual(outputs, [
    ['fork_owner', 'org'],
    ['fork_owner_type', 'Unknown'],
    ['pr_title', 'chore(Algebra/Group/Defs): split from #42'],
    ['author', 'Author <author@example.com>'],
  ]);
  assert.match(warnings[0], /Unable to resolve push_to_fork owner type for org: lookup failed/);
  assert.match(warnings[1], /Could not determine push_to_fork owner type/);
});

test('runValidateCprInputsStep fails on an invalid pr_title template', async () => {
  await assert.rejects(
    runValidateCprInputsStep({
      core: {
        info: () => {},
        warning: () => {},
        setOutput: () => {},
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
        MAINTAINER_CAN_MODIFY: '',
        BRANCH_NAME: 'splice-bot/pr-1-src-Foo-1234567890',
        COMMITTER: '',
        AUTHOR: '',
        PR_TITLE_TEMPLATE: 'chore({file_stem}): automated extraction',
        FILE_PATH: 'src/Foo.lean',
        PR_NUMBER: '1',
      },
    }),
    /Unknown placeholder\(s\) in pr_title template/,
  );
});

test('resolveAuthor keeps an explicit author without a lookup', async () => {
  const author = await resolveAuthor({
    github: {
      rest: {
        users: {
          getByUsername: async () => {
            throw new Error('should not be called');
          },
        },
      },
    },
    author: 'Someone <someone@example.com>',
    prAuthorLogin: 'author',
  });

  assert.equal(author, 'Someone <someone@example.com>');
});

test('resolveAuthor derives the PR author noreply identity by default', async () => {
  const calls = [];
  const author = await resolveAuthor({
    github: {
      rest: {
        users: {
          getByUsername: async (payload) => {
            calls.push(payload);
            return { data: { login: 'Author', id: 12345 } };
          },
        },
      },
    },
    author: '',
    prAuthorLogin: 'author',
  });

  assert.deepEqual(calls, [{ username: 'author' }]);
  assert.equal(author, 'Author <12345+Author@users.noreply.github.com>');
});

test('resolveAuthor fails when the default author cannot be derived', async () => {
  const github = {
    rest: {
      users: {
        getByUsername: async () => {
          throw new Error('Not Found');
        },
      },
    },
  };

  await assert.rejects(
    resolveAuthor({ github, author: '', prAuthorLogin: '' }),
    /PR author is unknown/,
  );
  await assert.rejects(
    resolveAuthor({ github, author: '', prAuthorLogin: 'ghost' }),
    /Could not look up PR author ghost to derive the default commit author: Not Found/,
  );
});

test('runValidateCprInputsStep outputs the derived default author', async () => {
  const outputs = {};

  await runValidateCprInputsStep({
    core: {
      info: () => {},
      warning: () => {},
      setOutput: (name, value) => {
        outputs[name] = value;
      },
    },
    github: {
      rest: {
        users: {
          getByUsername: async ({ username }) => ({ data: { login: username, id: 7 } }),
        },
      },
    },
    env: {
      BRANCH_NAME: 'splice-bot/pr-1-src-Foo-1234567890',
      COMMITTER: 'Bot <bot@example.com>',
      AUTHOR: '',
      PR_AUTHOR_LOGIN: 'author',
      PR_TITLE_TEMPLATE: 'chore({file_path}): automated extraction',
      FILE_PATH: 'src/Foo.lean',
      PR_NUMBER: '1',
    },
  });

  assert.equal(outputs.author, 'author <7+author@users.noreply.github.com>');
});
