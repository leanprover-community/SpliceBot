const test = require('node:test');
const assert = require('node:assert/strict');

const { authorizeCommenter } = require('../../.github/actions/splice-wf-run/lib/authorize-commenter');

test('authorizes PR author before permission checks', async () => {
  const github = {
    rest: {
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
    },
  };

  const result = await authorizeCommenter({
    allowPrAuthor: true,
    minRepoPermission: 'write',
    commenterLogin: 'author',
    prAuthorLogin: 'author',
    baseRepo: 'leanprover-community/SpliceBot',
    rawAllowedTeams: '',
    rawAllowedUsers: '',
    authzTokenSource: 'inputs.authz_token',
    github,
  });

  assert.equal(result.decision, 'allow');
  assert.match(result.reason, /Authorized author via pr-author/);
});

test('denies when team allowlist is configured on a non-org repository', async () => {
  const github = {
    rest: {
      repos: {
        getCollaboratorPermissionLevel: async () => ({ data: { permission: 'read' } }),
        get: async () => ({ data: { owner: { type: 'User' } } }),
      },
      teams: {
        getMembershipForUserInOrg: async () => {
          throw new Error('should not be called');
        },
      },
    },
  };

  const result = await authorizeCommenter({
    allowPrAuthor: false,
    minRepoPermission: 'write',
    commenterLogin: 'reviewer',
    prAuthorLogin: 'author',
    baseRepo: 'owner/repo',
    rawAllowedTeams: 'reviewers',
    rawAllowedUsers: '',
    authzTokenSource: 'github.token',
    github,
  });

  assert.equal(result.decision, 'deny');
  assert.match(result.reason, /not organization-owned/);
});
