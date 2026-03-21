const { execFileSync } = require('node:child_process');

async function resolveForkOwner({ github, pushToFork, onInfo = () => {}, onWarning = () => {} }) {
  const [forkOwner] = String(pushToFork || '').split('/');
  if (!forkOwner) {
    return { forkOwner: '', forkOwnerType: 'Unknown' };
  }

  try {
    const { data } = await github.rest.users.getByUsername({ username: forkOwner });
    const forkOwnerType = data.type || 'Unknown';
    onInfo(`push_to_fork owner ${forkOwner} type: ${forkOwnerType}`);
    return { forkOwner, forkOwnerType };
  } catch (error) {
    onWarning(`Unable to resolve push_to_fork owner type for ${forkOwner}: ${error.message}`);
    return { forkOwner, forkOwnerType: 'Unknown' };
  }
}

function validateCprInputs({
  pushToFork,
  maintainerCanModify,
  branchName,
  committer,
  author,
  forkOwnerType,
}) {
  const warnings = [];
  const ownerRepoRe = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
  const nameEmailRe = /^.+ <[^<>\s]+@[^<>\s]+>$/u;

  if (pushToFork && !ownerRepoRe.test(pushToFork)) {
    throw new Error(`Invalid push_to_fork '${pushToFork}'. Expected owner/repo.`);
  }

  if (maintainerCanModify && maintainerCanModify !== 'true' && maintainerCanModify !== 'false') {
    throw new Error(`Invalid maintainer_can_modify '${maintainerCanModify}'. Expected 'true', 'false', or empty.`);
  }

  if (maintainerCanModify === 'true' && forkOwnerType === 'Organization') {
    throw new Error("maintainer_can_modify=true is not supported for organization-owned forks. Use a user-owned fork or set maintainer_can_modify to 'false'.");
  }

  if (maintainerCanModify === 'true' && pushToFork && forkOwnerType === 'Unknown') {
    warnings.push('Could not determine push_to_fork owner type. If this is an organization-owned fork, maintainer_can_modify=true may fail.');
  }

  try {
    execFileSync('git', ['check-ref-format', '--branch', branchName], { stdio: 'ignore' });
  } catch {
    throw new Error(`Generated branch name is invalid: '${branchName}'.`);
  }

  if (branchName.length > 220) {
    throw new Error(`Generated branch name is too long (${branchName.length} chars). This indicates a branch generation bug.`);
  }

  if (committer && !nameEmailRe.test(committer)) {
    throw new Error(`Invalid committer format '${committer}'. Expected 'Name <email@address>'.`);
  }

  if (author && !nameEmailRe.test(author)) {
    throw new Error(`Invalid author format '${author}'. Expected 'Name <email@address>'.`);
  }

  return { warnings };
}

async function runValidateCprInputsStep({ core, github, env = process.env }) {
  const { forkOwner, forkOwnerType } = await resolveForkOwner({
    github,
    pushToFork: env.PUSH_TO_FORK || '',
    onInfo: (message) => core.info(message),
    onWarning: (message) => core.warning(message),
  });

  const { warnings } = validateCprInputs({
    pushToFork: env.PUSH_TO_FORK || '',
    maintainerCanModify: env.MAINTAINER_CAN_MODIFY || '',
    branchName: env.BRANCH_NAME || '',
    committer: env.COMMITTER || '',
    author: env.AUTHOR || '',
    forkOwnerType,
  });

  core.setOutput('fork_owner', forkOwner);
  core.setOutput('fork_owner_type', forkOwnerType);

  for (const warning of warnings) {
    core.warning(warning);
  }
}

if (require.main === module) {
  console.error('This module is intended to be run via actions/github-script.');
  process.exit(1);
}

module.exports = {
  resolveForkOwner,
  runValidateCprInputsStep,
  validateCprInputs,
};
