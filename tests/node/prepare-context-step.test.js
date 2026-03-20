const test = require('node:test');
const assert = require('node:assert/strict');

const { buildContext } = require('../../.github/actions/splice-wf-run/lib/prepare-context-step');

test('buildContext derives token sources', () => {
  const context = buildContext({
    INPUT_TOKEN: 'token',
    AUTHZ_TOKEN: 'authz',
    BRANCH_TOKEN: 'branch',
    PUSH_TO_FORK: 'owner/repo',
  });

  assert.equal(context.token_source, 'inputs.token');
  assert.equal(context.authz_token_source, 'inputs.authz_token');
  assert.equal(context.branch_token_source, 'inputs.branch_token');
});

test('buildContext uses default token sources when optional tokens are absent', () => {
  const context = buildContext({});

  assert.equal(context.token_source, 'github.token');
  assert.equal(context.authz_token_source, 'github.token');
  assert.equal(context.branch_token_source, 'not-applicable');
});
