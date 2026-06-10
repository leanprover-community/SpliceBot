const { renderCommandComment } = require('./render-template');

module.exports = async function runPostSplitPrCommentStep({ core, github, env = process.env }) {
  const repoFull = (env.REPO_FULL || '').trim();
  const template = env.COMMENT_TEMPLATE || '';
  const prNumber = Number(env.SPLIT_PR_NUMBER || '');

  const reportFailure = (message) => {
    core.setOutput('comment_post_failed', 'true');
    core.setOutput('comment_post_error', message);
    core.setFailed(`Failed to post command comment: ${message}`);
  };

  const [owner, repo] = repoFull.split('/');
  if (!owner || !repo || !template.trim() || !Number.isFinite(prNumber) || prNumber <= 0) {
    reportFailure(
      `Missing comment context (repo: '${repoFull}', template: ${template.trim() ? 'present' : 'missing'}, PR: '${env.SPLIT_PR_NUMBER || ''}').`,
    );
    return;
  }

  let body;
  try {
    body = renderCommandComment({
      template,
      filePath: env.FILE_PATH || '',
      prNumber: env.PR_NUMBER || '',
      splitPrNumber: prNumber,
      commenter: env.COMMENTER_LOGIN || '',
      commandArgs: env.COMMAND_ARGS || '',
      extraComment: env.EXTRA_COMMENT || '',
      scopeStripPrefix: env.SCOPE_STRIP_PREFIX || '',
    });
  } catch (error) {
    reportFailure(error.message);
    return;
  }

  try {
    await github.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    });
    core.info(`Posted command comment on PR #${prNumber}.`);
  } catch (error) {
    reportFailure(error.message);
  }
};
