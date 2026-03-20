const BRIDGE_FIELDS = [
  'pr_number',
  'review_comment_id',
  'file_path',
  'commenter_login',
  'pr_author_login',
  'base_ref',
  'base_repo',
  'head_repo',
  'head_sha',
  'head_ref',
  'head_label',
  'committer',
  'author',
];

function writeOutput(key, value, outputPath) {
  const fs = require('fs');
  fs.appendFileSync(outputPath, `${key}<<__SPLICEBOT_OUTPUT__\n${value}\n__SPLICEBOT_OUTPUT__\n`);
}

function selectBridgeValue(env, field) {
  return env[`BRIDGE_OVERRIDE_${field.toUpperCase()}`] || env[`BRIDGE_CONSUME_${field.toUpperCase()}`] || '';
}

function buildContext(env = process.env) {
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

  const bridge = Object.fromEntries(BRIDGE_FIELDS.map((field) => [field, selectBridgeValue(env, field)]));
  return {
    token_source: tokenSource,
    authz_token_source: authzTokenSource,
    branch_token_source: branchTokenSource,
    ...bridge,
  };
}

function runFromEnvironment(env = process.env) {
  const context = buildContext(env);
  const outputPath = env.GITHUB_OUTPUT;

  console.log(`token source: ${context.token_source}`);
  console.log(`authz-token source: ${context.authz_token_source}`);
  console.log(`branch-token source: ${context.branch_token_source}`);

  for (const [key, value] of Object.entries(context)) {
    writeOutput(key, value, outputPath);
  }
}

if (require.main === module) {
  runFromEnvironment();
}

module.exports = {
  BRIDGE_FIELDS,
  buildContext,
};
