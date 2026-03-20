function deriveTokenSources(env = process.env) {
  let tokenSource = 'github.token';
  let authzTokenSource = 'github.token';
  let branchTokenSource = 'not-applicable';

  if (env.INPUT_TOKEN) {
    tokenSource = 'inputs.token';
    authzTokenSource = 'inputs.token';
  }

  if (env.AUTHZ_TOKEN) {
    authzTokenSource = 'inputs.authz_token';
  }

  if (env.PUSH_TO_FORK) {
    if (env.BRANCH_TOKEN) {
      branchTokenSource = 'inputs.branch_token';
    } else if (env.INPUT_TOKEN) {
      branchTokenSource = 'inputs.token';
    } else {
      branchTokenSource = 'github.token';
    }
  }

  return {
    tokenSource,
    authzTokenSource,
    branchTokenSource,
  };
}

module.exports = {
  deriveTokenSources,
};
