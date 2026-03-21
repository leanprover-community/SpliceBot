const test = require('node:test');
const assert = require('node:assert/strict');

const {
  runResolveAndAuthorizeCommandStep,
} = require('../../.github/actions/splice-wf-run/lib/resolve-trigger-command-step');

function createCoreStub() {
  const outputs = new Map();
  const messages = { info: [], warning: [], error: [], failed: [] };
  return {
    core: {
      setOutput: (key, value) => outputs.set(key, value),
      info: (message) => messages.info.push(message),
      warning: (message) => messages.warning.push(message),
      error: (message) => messages.error.push(message),
      setFailed: (message) => messages.failed.push(message),
    },
    outputs,
    messages,
  };
}

function createGithubStub(overrides = {}) {
  return {
    rest: {
      repos: {
        getCollaboratorPermissionLevel: async () => ({ data: { permission: 'write' } }),
        get: async () => ({ data: { owner: { type: 'Organization' } } }),
        ...overrides.repos,
      },
      teams: {
        getMembershipForUserInOrg: async () => {
          const error = new Error('not found');
          error.status = 404;
          throw error;
        },
        ...overrides.teams,
      },
    },
  };
}

test('runResolveAndAuthorizeCommandStep leaves splice mode untouched when no keyword is present', async () => {
  const { core, outputs, messages } = createCoreStub();

  await runResolveAndAuthorizeCommandStep({
    core,
    github: createGithubStub(),
    env: {
      RAW_LABEL_COMMANDS: '[{"command":"ready","label":"ready-to-merge"}]',
      TRIGGER_KEYWORD: '',
      COMMENTER_LOGIN: 'reviewer',
      BASE_REPO: 'leanprover-community/SpliceBot',
    },
  });

  assert.equal(outputs.get('trigger_mode'), 'splice');
  assert.equal(messages.failed.length, 0);
});

test('runResolveAndAuthorizeCommandStep authorizes a matching label command and emits auth outputs', async () => {
  const { core, outputs, messages } = createCoreStub();

  await runResolveAndAuthorizeCommandStep({
    core,
    github: createGithubStub(),
    env: {
      RAW_LABEL_COMMANDS: '[{"command":"ready","label":"ready-to-merge","min_repo_permission":"triage"}]',
      TRIGGER_KEYWORD: 'ready',
      COMMENTER_LOGIN: 'reviewer',
      BASE_REPO: 'leanprover-community/SpliceBot',
      INPUT_TOKEN: 'token',
    },
  });

  assert.equal(outputs.get('trigger_mode'), 'label');
  assert.equal(outputs.get('label_command'), 'ready');
  assert.equal(outputs.get('label_authz_decision'), 'allow');
  assert.equal(outputs.get('label_authz_token_source'), 'inputs.token');
  assert.equal(messages.failed.length, 0);
});

test('runResolveAndAuthorizeCommandStep fails when command-specific authorization denies', async () => {
  const { core, outputs, messages } = createCoreStub();

  await runResolveAndAuthorizeCommandStep({
    core,
    github: createGithubStub({
      repos: {
        getCollaboratorPermissionLevel: async () => ({ data: { permission: 'read' } }),
      },
    }),
    env: {
      RAW_LABEL_COMMANDS: '[{"command":"ready","label":"ready-to-merge","min_repo_permission":"disabled"}]',
      TRIGGER_KEYWORD: 'ready',
      COMMENTER_LOGIN: 'reviewer',
      BASE_REPO: 'leanprover-community/SpliceBot',
    },
  });

  assert.equal(outputs.get('trigger_mode'), 'label');
  assert.equal(outputs.get('label_authz_decision'), 'deny');
  assert.match(messages.failed[0], /not authorized to run label command/);
});
