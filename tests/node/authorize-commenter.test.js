const test = require('node:test');
const assert = require('node:assert/strict');

const { authorizeCommenter } = require('../../.github/actions/splice-wf-run/lib/authorize-commenter');

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

test('authorizes PR author before permission checks', async () => {
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
  const github = createGithubStub({
    repos: {
      get: async () => ({ data: { owner: { type: 'User' } } }),
    },
    teams: {
      getMembershipForUserInOrg: async () => {
        throw new Error('should not be called');
      },
    },
  });

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

test('returns an error for invalid min repo permission', async () => {
  const result = await authorizeCommenter({
    allowPrAuthor: false,
    minRepoPermission: 'bogus',
    commenterLogin: 'reviewer',
    prAuthorLogin: 'author',
    baseRepo: 'owner/repo',
    rawAllowedTeams: '',
    rawAllowedUsers: '',
    authzTokenSource: 'github.token',
    github: createGithubStub(),
  });

  assert.equal(result.decision, 'error');
  assert.match(result.reason, /Invalid min_repo_permission 'bogus'/);
});

test('returns an error when bridge fields are missing', async () => {
  const result = await authorizeCommenter({
    allowPrAuthor: false,
    minRepoPermission: 'write',
    commenterLogin: 'reviewer',
    prAuthorLogin: '',
    baseRepo: 'owner/repo',
    rawAllowedTeams: '',
    rawAllowedUsers: '',
    authzTokenSource: 'github.token',
    github: createGithubStub(),
  });

  assert.equal(result.decision, 'error');
  assert.match(result.reason, /Missing bridge data required for authorization/);
  assert.match(result.details, /pr_author_login: \(missing\)/);
});

test('disabled permission mode only allows explicit allow rules', async () => {
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
    allowPrAuthor: false,
    minRepoPermission: 'disabled',
    commenterLogin: 'reviewer',
    prAuthorLogin: 'author',
    baseRepo: 'leanprover-community/SpliceBot',
    rawAllowedTeams: '',
    rawAllowedUsers: '',
    authzTokenSource: 'github.token',
    github,
  });

  assert.equal(result.decision, 'deny');
  assert.match(result.reason, /not authorized/);
});

test('treats collaborator permission 404 as none and denies when threshold is unmet', async () => {
  const github = createGithubStub({
    repos: {
      getCollaboratorPermissionLevel: async () => {
        const error = new Error('not found');
        error.status = 404;
        throw error;
      },
    },
  });

  const result = await authorizeCommenter({
    allowPrAuthor: false,
    minRepoPermission: 'write',
    commenterLogin: 'reviewer',
    prAuthorLogin: 'author',
    baseRepo: 'owner/repo',
    rawAllowedTeams: '',
    rawAllowedUsers: '',
    authzTokenSource: 'github.token',
    github,
  });

  assert.equal(result.decision, 'deny');
  assert.match(result.reason, /not authorized to trigger splice-bot/);
  assert.match(result.details, /observed_repo_permission: none/);
});

test('returns an error when collaborator permission lookup fails unexpectedly', async () => {
  const github = createGithubStub({
    repos: {
      getCollaboratorPermissionLevel: async () => {
        const error = new Error('api unavailable');
        error.status = 500;
        throw error;
      },
    },
  });

  const result = await authorizeCommenter({
    allowPrAuthor: false,
    minRepoPermission: 'triage',
    commenterLogin: 'reviewer',
    prAuthorLogin: 'author',
    baseRepo: 'owner/repo',
    rawAllowedTeams: '',
    rawAllowedUsers: '',
    authzTokenSource: 'inputs.authz_token',
    github,
  });

  assert.equal(result.decision, 'error');
  assert.match(result.reason, /Unable to resolve collaborator permission/);
  assert.match(result.details, /Provide authz_token with sufficient read access if needed/);
});

test('authorizes an active team member', async () => {
  const infoMessages = [];
  const github = createGithubStub({
    repos: {
      getCollaboratorPermissionLevel: async () => ({ data: { permission: 'read' } }),
    },
    teams: {
      getMembershipForUserInOrg: async () => ({ data: { state: 'active' } }),
    },
  });

  const result = await authorizeCommenter({
    allowPrAuthor: false,
    minRepoPermission: 'write',
    commenterLogin: 'reviewer',
    prAuthorLogin: 'author',
    baseRepo: 'leanprover-community/SpliceBot',
    rawAllowedTeams: 'reviewers',
    rawAllowedUsers: '',
    authzTokenSource: 'inputs.authz_token',
    github,
    onInfo: (message) => infoMessages.push(message),
  });

  assert.equal(result.decision, 'allow');
  assert.match(result.reason, /team:leanprover-community\/reviewers/);
  assert.deepEqual(infoMessages, []);
});

test('returns an error when team membership lookup fails unexpectedly', async () => {
  const github = createGithubStub({
    repos: {
      getCollaboratorPermissionLevel: async () => ({ data: { permission: 'read' } }),
    },
    teams: {
      getMembershipForUserInOrg: async () => {
        const error = new Error('forbidden');
        error.status = 403;
        throw error;
      },
    },
  });

  const result = await authorizeCommenter({
    allowPrAuthor: false,
    minRepoPermission: 'write',
    commenterLogin: 'reviewer',
    prAuthorLogin: 'author',
    baseRepo: 'leanprover-community/SpliceBot',
    rawAllowedTeams: 'reviewers',
    rawAllowedUsers: '',
    authzTokenSource: 'inputs.authz_token',
    github,
  });

  assert.equal(result.decision, 'error');
  assert.match(result.reason, /Unable to verify team membership/);
  assert.match(result.details, /organization team\/membership read permissions/);
});
