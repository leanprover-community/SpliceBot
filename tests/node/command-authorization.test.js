const test = require('node:test');
const assert = require('node:assert/strict');

const { authorizeCommandActor } = require('../../.github/actions/splice-wf-run/lib/command-authorization');

function createGithubStub(overrides = {}) {
  return {
    rest: {
      repos: {
        getCollaboratorPermissionLevel: async () => ({ data: { permission: 'read' } }),
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

test('returns an error for invalid label allowed_users json', async () => {
  const result = await authorizeCommandActor({
    commenterLogin: 'reviewer',
    baseRepo: 'leanprover-community/SpliceBot',
    commandName: 'ready',
    labelName: 'ready-to-merge',
    minRepoPermission: 'write',
    rawAllowedUsersJson: '{"nope":true}',
    rawAllowedTeamsJson: '[]',
    authzTokenSource: 'github.token',
    github: createGithubStub(),
  });

  assert.equal(result.decision, 'error');
  assert.match(result.reason, /Could not parse label allowed_users/);
});

test('allows a label command through its explicit allowed_users rule', async () => {
  const github = createGithubStub({
    repos: {
      getCollaboratorPermissionLevel: async () => {
        throw new Error('should not be called');
      },
    },
    teams: {
      getMembershipForUserInOrg: async () => {
        throw new Error('should not be called');
      },
    },
  });

  const result = await authorizeCommandActor({
    commenterLogin: 'reviewer',
    baseRepo: 'leanprover-community/SpliceBot',
    commandName: 'ready',
    labelName: 'ready-to-merge',
    minRepoPermission: 'disabled',
    rawAllowedUsersJson: '["reviewer"]',
    rawAllowedTeamsJson: '[]',
    authzTokenSource: 'inputs.authz_token',
    github,
  });

  assert.equal(result.decision, 'allow');
  assert.match(result.reason, /allowed-users/);
});

test('disabled permission mode denies label commands without an explicit allow rule', async () => {
  const infoMessages = [];
  const github = createGithubStub({
    repos: {
      getCollaboratorPermissionLevel: async () => {
        throw new Error('should not be called');
      },
    },
  });

  const result = await authorizeCommandActor({
    commenterLogin: 'reviewer',
    baseRepo: 'leanprover-community/SpliceBot',
    commandName: 'ready',
    labelName: 'ready-to-merge',
    minRepoPermission: 'disabled',
    rawAllowedUsersJson: '[]',
    rawAllowedTeamsJson: '[]',
    authzTokenSource: 'github.token',
    github,
    onInfo: (message) => infoMessages.push(message),
  });

  assert.equal(result.decision, 'deny');
  assert.match(result.reason, /not authorized to run label command/);
  assert.deepEqual(infoMessages, [
    "Repository permission authorization is disabled for label command 'ready'.",
  ]);
});

test('allows label commands when min_repo_permission is anyone', async () => {
  const result = await authorizeCommandActor({
    commenterLogin: 'reviewer',
    baseRepo: 'leanprover-community/SpliceBot',
    commandName: 'ready',
    labelName: 'ready-to-merge',
    minRepoPermission: 'anyone',
    rawAllowedUsersJson: '[]',
    rawAllowedTeamsJson: '[]',
    authzTokenSource: 'github.token',
    github: createGithubStub(),
  });

  assert.equal(result.decision, 'allow');
  assert.match(result.reason, /repo-permission>=anyone/);
});

test('denies team-based label command auth on non-org repositories', async () => {
  const result = await authorizeCommandActor({
    commenterLogin: 'reviewer',
    baseRepo: 'owner/repo',
    commandName: 'ready',
    labelName: 'ready-to-merge',
    minRepoPermission: 'disabled',
    rawAllowedUsersJson: '[]',
    rawAllowedTeamsJson: '["reviewers"]',
    authzTokenSource: 'inputs.authz_token',
    github: createGithubStub({
      repos: {
        get: async () => ({ data: { owner: { type: 'User' } } }),
      },
    }),
  });

  assert.equal(result.decision, 'deny');
  assert.match(result.reason, /not organization-owned/);
});
