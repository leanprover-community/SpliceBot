module.exports = async function runDetectForkOwnerStep({ core, github, env = process.env }) {
  const pushToFork = env.PUSH_TO_FORK || '';
  const [forkOwner] = pushToFork.split('/');

  core.setOutput('fork_owner', forkOwner || '');
  if (!forkOwner) {
    core.setOutput('fork_owner_type', 'Unknown');
    return;
  }

  try {
    const { data } = await github.rest.users.getByUsername({ username: forkOwner });
    core.setOutput('fork_owner_type', data.type || 'Unknown');
    core.info(`push_to_fork owner ${forkOwner} type: ${data.type || 'Unknown'}`);
  } catch (error) {
    core.warning(`Unable to resolve push_to_fork owner type for ${forkOwner}: ${error.message}`);
    core.setOutput('fork_owner_type', 'Unknown');
  }
};
