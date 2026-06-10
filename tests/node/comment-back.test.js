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

test('buildCallbackCommentPayload reports split PR creation and label application for label commands', () => {
  const payload = buildCallbackCommentPayload({
    originalPrNumber: 42,
    reviewCommentId: 7,
    repoFull: 'leanprover-community/SpliceBot',
    triggerMode: 'label',
    labelCommand: 'ready',
    labelName: 'ready-to-merge',
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
    authzReason: '',
    authzDetails: '',
    authzTokenSource: 'inputs.authz_token',
    labelAuthzOutcome: 'success',
    labelAuthzDecision: 'allow',
    labelAuthzReason: '',
    labelAuthzDetails: '',
    labelAuthzTokenSource: 'inputs.authz_token',
    forkOwner: '',
    forkOwnerType: '',
    outcomes: [['Create Pull Request', 'success']],
  });

  assert.match(payload.body, /\*\*Split PR created and labeled\*\*/);
  assert.match(payload.body, /#99/);
  assert.match(payload.body, /ready-to-merge/);
});

test('buildCallbackCommentPayload reports a label application failure after PR creation', () => {
  const payload = buildCallbackCommentPayload({
    originalPrNumber: 42,
    reviewCommentId: 7,
    repoFull: 'leanprover-community/SpliceBot',
    triggerMode: 'label',
    labelCommand: 'ready',
    labelName: 'ready-to-merge',
    labelApplyFailed: true,
    labelApplyError: 'Resource not accessible by integration',
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
    authzReason: '',
    authzDetails: '',
    authzTokenSource: 'inputs.authz_token',
    labelAuthzOutcome: 'success',
    labelAuthzDecision: 'allow',
    labelAuthzReason: '',
    labelAuthzDetails: '',
    labelAuthzTokenSource: 'inputs.authz_token',
    forkOwner: '',
    forkOwnerType: '',
    outcomes: [
      ['Create Pull Request', 'success'],
      ['Apply label to split PR', 'failure'],
    ],
  });

  assert.match(payload.body, /\*\*Failed to apply label\*\*/);
  assert.match(payload.body, /in #99, but I couldn't apply label \*\*ready-to-merge\*\*/);
  assert.match(payload.body, /Resource not accessible by integration/);
  assert.match(payload.body, /`issues: write`/);
  assert.match(payload.body, /Run logs: https:\/\/example\.test\/run/);
});

function makeLabelCommandPayloadInput(overrides = {}) {
  return {
    originalPrNumber: 42,
    reviewCommentId: 7,
    repoFull: 'leanprover-community/SpliceBot',
    triggerMode: 'label',
    labelCommand: 'maintainer-merge',
    labelName: '',
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
    authzReason: '',
    authzDetails: '',
    authzTokenSource: 'inputs.authz_token',
    labelAuthzOutcome: 'success',
    labelAuthzDecision: 'allow',
    labelAuthzReason: '',
    labelAuthzDetails: '',
    labelAuthzTokenSource: 'inputs.authz_token',
    forkOwner: '',
    forkOwnerType: '',
    outcomes: [['Create Pull Request', 'success']],
    ...overrides,
  };
}

test('buildCallbackCommentPayload reports comment-only command success', () => {
  const payload = buildCallbackCommentPayload(
    makeLabelCommandPayloadInput({ commandCommentConfigured: true }),
  );

  assert.match(payload.body, /\*\*Split PR created and commented\*\*/);
  assert.match(payload.body, /in #99 and posted a comment via splice-bot command `maintainer-merge`/);
});

test('buildCallbackCommentPayload reports label-and-comment command success', () => {
  const payload = buildCallbackCommentPayload(
    makeLabelCommandPayloadInput({ labelName: 'maintainer-merge', commandCommentConfigured: true }),
  );

  assert.match(payload.body, /\*\*Split PR created, labeled, and commented\*\*/);
  assert.match(
    payload.body,
    /applied label \*\*maintainer-merge\*\* and posted a comment via splice-bot command `maintainer-merge`/,
  );
});

test('buildCallbackCommentPayload reports a comment posting failure after PR creation', () => {
  const payload = buildCallbackCommentPayload(
    makeLabelCommandPayloadInput({
      commandCommentConfigured: true,
      commentPostFailed: true,
      commentPostError: 'Resource not accessible by integration',
      outcomes: [
        ['Create Pull Request', 'success'],
        ['Post comment on split PR', 'failure'],
      ],
    }),
  );

  assert.match(payload.body, /\*\*Failed to post comment on split PR\*\*/);
  assert.match(payload.body, /Resource not accessible by integration/);
  assert.match(payload.body, /Run logs: https:\/\/example\.test\/run/);
});

test('buildCallbackCommentPayload reports combined label and comment failures', () => {
  const payload = buildCallbackCommentPayload(
    makeLabelCommandPayloadInput({
      labelName: 'maintainer-merge',
      labelApplyFailed: true,
      labelApplyError: 'label boom',
      commandCommentConfigured: true,
      commentPostFailed: true,
      commentPostError: 'comment boom',
    }),
  );

  assert.match(payload.body, /\*\*Failed to apply label and post comment\*\*/);
  assert.match(payload.body, /label boom/);
  assert.match(payload.body, /comment boom/);
});
