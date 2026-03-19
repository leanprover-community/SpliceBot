const test = require('node:test');
const assert = require('node:assert/strict');

const { buildCallbackCommentPayload } = require('../../.github/actions/splice-wf-run/lib/comment-back');

test('buildCallbackCommentPayload returns a success body for created split PRs', () => {
  const payload = buildCallbackCommentPayload({
    originalPrNumber: 42,
    reviewCommentId: 7,
    repoFull: 'leanprover-community/SpliceBot',
    filePath: 'src/Foo.lean',
    applyFailed: false,
    noChanges: false,
    automatedPrNumber: '99',
    baseRef: 'master',
    headRef: 'feature',
    headLabel: 'author:feature',
    runUrl: 'https://example.test/run',
    tokenSource: 'inputs.token',
    branchTokenSource: 'inputs.branch_token',
    authzOutcome: 'success',
    authzDecision: 'allow',
    authzReason: 'Authorized reviewer via allowed-users.',
    authzDetails: '',
    authzTokenSource: 'inputs.authz_token',
    forkOwner: '',
    forkOwnerType: '',
    outcomes: [['Create Pull Request', 'success']],
  });

  assert.equal(payload.owner, 'leanprover-community');
  assert.equal(payload.repo, 'SpliceBot');
  assert.match(payload.body, /\*\*Split PR created\*\*/);
  assert.match(payload.body, /Split off the changes to \*\*src\/Foo\.lean\*\* in #99\./);
});

test('buildCallbackCommentPayload reports missing file path clearly', () => {
  const payload = buildCallbackCommentPayload({
    originalPrNumber: 42,
    reviewCommentId: 7,
    repoFull: 'leanprover-community/SpliceBot',
    filePath: '',
    applyFailed: false,
    noChanges: false,
    automatedPrNumber: '',
    baseRef: 'master',
    headRef: 'feature',
    headLabel: '',
    runUrl: 'https://example.test/run',
    tokenSource: 'inputs.token',
    branchTokenSource: 'not-applicable',
    authzOutcome: '',
    authzDecision: '',
    authzReason: '',
    authzDetails: '',
    authzTokenSource: 'github.token',
    forkOwner: '',
    forkOwnerType: '',
    outcomes: [['Consume bridge artifact', 'failure']],
  });

  assert.match(payload.body, /\*\*Could not determine target file\*\*/);
  assert.match(payload.body, /Run logs: https:\/\/example\.test\/run/);
});
