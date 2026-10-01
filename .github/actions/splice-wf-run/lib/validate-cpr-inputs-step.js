const { execFileSync } = require('node:child_process');
const { renderPrTitle } = require('./render-template');

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

// The split PR's commit is attributed to the original PR's author unless the
// author input overrides it, using the same noreply address GitHub assigns.
async function resolveAuthor({ github, author, prAuthorLogin }) {
  if (author) {
    return author;
  }
  if (!prAuthorLogin) {
    throw new Error('Cannot derive the default commit author because the PR author is unknown. Set the author input.');
  }
  let data;
  try {
    ({ data } = await github.rest.users.getByUsername({ username: prAuthorLogin }));
  } catch (error) {
    throw new Error(`Could not look up PR author ${prAuthorLogin} to derive the default commit author: ${error.message}. Set the author input to skip this lookup.`);
  }
  return `${data.login} <${data.id}+${data.login}@users.noreply.github.com>`;
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
    author: (env.AUTHOR || '').trim(),
    forkOwnerType,
  });

  const prTitle = renderPrTitle({
    template: env.PR_TITLE_TEMPLATE || '',
    filePath: env.FILE_PATH || '',
    prNumber: env.PR_NUMBER || '',
    scopeStripPrefix: env.SCOPE_STRIP_PREFIX || '',
  });
  core.info(`Rendered split PR title: ${prTitle}`);

  // Last, so the configuration errors above are reported without this lookup.
  const author = await resolveAuthor({
    github,
    author: (env.AUTHOR || '').trim(),
    prAuthorLogin: (env.PR_AUTHOR_LOGIN || '').trim(),
  });
  core.info(`Commit author: ${author}`);

  core.setOutput('fork_owner', forkOwner);
  core.setOutput('fork_owner_type', forkOwnerType);
  core.setOutput('pr_title', prTitle);
  core.setOutput('author', author);

  for (const warning of warnings) {
    core.warning(warning);
  }
}

if (require.main === module) {
  console.error('This module is intended to be run via actions/github-script.');
  process.exit(1);
}

module.exports = {
  resolveAuthor,
  resolveForkOwner,
  runValidateCprInputsStep,
  validateCprInputs,
};
