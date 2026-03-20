const test = require('node:test');
const assert = require('node:assert/strict');

const { buildContext } = require('../../.github/actions/splice-wf-run/lib/prepare-context-step');

test('buildContext derives token sources and prefers bridge override values', () => {
  const context = buildContext({
    INPUT_TOKEN: 'token',
    AUTHZ_TOKEN: 'authz',
    BRANCH_TOKEN: 'branch',
    PUSH_TO_FORK: 'owner/repo',
    BRIDGE_OVERRIDE_FILE_PATH: 'override/Foo.lean',
    BRIDGE_CONSUME_FILE_PATH: 'consume/Foo.lean',
    BRIDGE_CONSUME_BASE_REPO: 'leanprover-community/SpliceBot',
  });

  assert.equal(context.token_source, 'inputs.token');
  assert.equal(context.authz_token_source, 'inputs.authz_token');
  assert.equal(context.branch_token_source, 'inputs.branch_token');
  assert.equal(context.file_path, 'override/Foo.lean');
  assert.equal(context.base_repo, 'leanprover-community/SpliceBot');
});

test('buildContext falls back to consume outputs and default token sources', () => {
  const context = buildContext({
    BRIDGE_CONSUME_PR_NUMBER: '42',
    BRIDGE_CONSUME_FILE_PATH: 'src/Foo.lean',
  });

  assert.equal(context.token_source, 'github.token');
  assert.equal(context.authz_token_source, 'github.token');
  assert.equal(context.branch_token_source, 'not-applicable');
  assert.equal(context.pr_number, '42');
  assert.equal(context.file_path, 'src/Foo.lean');
});
