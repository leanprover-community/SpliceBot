module.exports = async function runApplyLabelStep({ core, github, env = process.env }) {
  const baseRepo = (env.BASE_REPO || '').trim();
  const prNumber = Number(env.PR_NUMBER || '');
  const labelName = (env.LABEL_NAME || '').trim();
  const [owner, repo] = baseRepo.split('/');

  if (!owner || !repo || !Number.isFinite(prNumber) || prNumber <= 0 || !labelName) {
    core.setFailed('Missing label application inputs.');
    return;
  }

  await github.rest.issues.addLabels({
    owner,
    repo,
    issue_number: prNumber,
    labels: [labelName],
  });
  core.info(`Applied label '${labelName}' to PR #${prNumber}.`);
};
