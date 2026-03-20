const { authorizeCommandActor } = require('./command-authorization');

module.exports = async function runAuthorizeLabelCommandStep({ core, github, env = process.env }) {
  const authzTokenSource = env.AUTHZ_TOKEN
    ? 'inputs.authz_token'
    : env.INPUT_TOKEN
      ? 'inputs.token'
      : 'github.token';

  const result = await authorizeCommandActor({
    commenterLogin: (env.COMMENTER_LOGIN || '').trim(),
    baseRepo: (env.BASE_REPO || '').trim(),
    commandName: (env.LABEL_COMMAND || '').trim(),
    labelName: (env.LABEL_NAME || '').trim(),
    minRepoPermission: (env.MIN_REPO_PERMISSION || 'write').trim().toLowerCase(),
    rawAllowedUsersJson: env.RAW_ALLOWED_USERS_JSON || '[]',
    rawAllowedTeamsJson: env.RAW_ALLOWED_TEAMS_JSON || '[]',
    authzTokenSource,
    github,
    onInfo: (message) => core.info(message),
  });

  core.setOutput('authz_decision', result.decision);
  core.setOutput('authz_reason', result.reason);
  core.setOutput('authz_details', result.details);
  core.setOutput('authz_token_source', authzTokenSource);

  if (result.decision === 'allow') {
    core.info(result.reason);
    core.info(result.details);
    return;
  }

  if (result.decision === 'deny') {
    core.warning(result.reason);
    core.info(result.details);
    core.setFailed(result.reason);
    return;
  }

  core.error(result.reason);
  core.info(result.details);
  core.setFailed(result.reason);
};
