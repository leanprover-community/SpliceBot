const { authorizeCommenter } = require('./authorize-commenter');

module.exports = async function runAuthorizeCommenterStep({ core, github, env = process.env }) {
  const result = await authorizeCommenter({
    allowPrAuthor: (env.ALLOW_PR_AUTHOR || 'true') === 'true',
    minRepoPermission: (env.MIN_REPO_PERMISSION || 'anyone').trim().toLowerCase(),
    commenterLogin: (env.COMMENTER_LOGIN || '').trim(),
    prAuthorLogin: (env.PR_AUTHOR_LOGIN || '').trim(),
    baseRepo: (env.BASE_REPO || '').trim(),
    rawAllowedTeams: env.RAW_ALLOWED_TEAMS || '',
    rawAllowedUsers: env.RAW_ALLOWED_USERS || '',
    authzTokenSource: env.AUTHZ_TOKEN_SOURCE || 'unknown',
    github,
    onInfo: (message) => core.info(message),
  });

  core.setOutput('authz_decision', result.decision);
  core.setOutput('authz_reason', result.reason);
  core.setOutput('authz_details', result.details);
  core.setOutput('authz_token_source', env.AUTHZ_TOKEN_SOURCE || 'unknown');

  if (result.decision === 'allow') {
    core.info(result.reason);
    core.info(result.details);
    return;
  }

  if (result.decision === 'deny') {
    core.warning(`Authorization denied: ${result.reason}`);
    core.info(result.details);
    core.setFailed(`Authorization denied: ${result.reason}`);
    return;
  }

  core.error(`Authorization check error: ${result.reason}`);
  core.info(result.details);
  core.setFailed(`Authorization check error: ${result.reason}`);
};
