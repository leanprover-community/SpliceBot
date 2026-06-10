module.exports = async function runApplyLabelStep({ core, github, env = process.env }) {
  const repoFull = (env.REPO_FULL || '').trim();
  const labelName = (env.LABEL_NAME || '').trim();
  const prNumber = Number(env.SPLIT_PR_NUMBER || '');

  const [owner, repo] = repoFull.split('/');
  if (!owner || !repo || !labelName || !Number.isFinite(prNumber) || prNumber <= 0) {
    const message = `Missing label context (repo: '${repoFull}', label: '${labelName}', PR: '${env.SPLIT_PR_NUMBER || ''}').`;
    core.setOutput('label_apply_failed', 'true');
    core.setOutput('label_apply_error', message);
    core.setFailed(`Failed to apply label: ${message}`);
    return;
  }

  try {
    await github.rest.issues.addLabels({
      owner,
      repo,
      issue_number: prNumber,
      labels: [labelName],
    });
    core.info(`Applied label '${labelName}' to PR #${prNumber}.`);
  } catch (error) {
    core.setOutput('label_apply_failed', 'true');
    core.setOutput('label_apply_error', error.message);
    core.setFailed(`Failed to apply label '${labelName}' to PR #${prNumber}: ${error.message}`);
  }
};
