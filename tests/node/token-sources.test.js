const test = require('node:test');
const assert = require('node:assert/strict');

const { deriveTokenSources } = require('../../.github/actions/splice-wf-run/lib/token-sources');

test('deriveTokenSources returns explicit token sources when all overrides are provided', () => {
  const sources = deriveTokenSources({
    INPUT_TOKEN: 'token',
    AUTHZ_TOKEN: 'authz',
    PUSH_TO_FORK: 'owner/repo',
    BRANCH_TOKEN: 'branch',
  });

  assert.deepEqual(sources, {
    tokenSource: 'inputs.token',
    authzTokenSource: 'inputs.authz_token',
    branchTokenSource: 'inputs.branch_token',
  });
});

test('deriveTokenSources falls back to github.token defaults', () => {
  const sources = deriveTokenSources({});

  assert.deepEqual(sources, {
    tokenSource: 'github.token',
    authzTokenSource: 'github.token',
    branchTokenSource: 'not-applicable',
  });
});

test('deriveTokenSources uses token as branch fallback in fork mode', () => {
  const sources = deriveTokenSources({
    INPUT_TOKEN: 'token',
    PUSH_TO_FORK: 'owner/repo',
  });

  assert.deepEqual(sources, {
    tokenSource: 'inputs.token',
    authzTokenSource: 'inputs.token',
    branchTokenSource: 'inputs.token',
  });
});
