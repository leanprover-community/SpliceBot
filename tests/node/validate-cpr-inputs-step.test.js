const test = require('node:test');
const assert = require('node:assert/strict');

const { validateCprInputs } = require('../../.github/actions/splice-wf-run/lib/validate-cpr-inputs-step');

test('validateCprInputs accepts valid inputs and returns warnings when owner type is unknown', () => {
  const result = validateCprInputs({
    pushToFork: 'owner/repo',
    maintainerCanModify: 'true',
    branchName: 'splice-bot/pr-1-src-Foo-1234567890',
    committer: 'Bot <bot@example.com>',
    author: 'Author <author@example.com>',
    forkOwnerType: 'Unknown',
  });

  assert.deepEqual(result.warnings, [
    'Could not determine push_to_fork owner type. If this is an organization-owned fork, maintainer_can_modify=true may fail.',
  ]);
});

test('validateCprInputs rejects invalid push_to_fork', () => {
  assert.throws(
    () =>
      validateCprInputs({
        pushToFork: 'not-a-repo',
        maintainerCanModify: '',
        branchName: 'splice-bot/pr-1-src-Foo-1234567890',
        committer: '',
        author: '',
        forkOwnerType: 'Unknown',
      }),
    /Invalid push_to_fork/,
  );
});

test('validateCprInputs rejects invalid author format', () => {
  assert.throws(
    () =>
      validateCprInputs({
        pushToFork: '',
        maintainerCanModify: '',
        branchName: 'splice-bot/pr-1-src-Foo-1234567890',
        committer: '',
        author: 'invalid',
        forkOwnerType: '',
      }),
    /Invalid author format/,
  );
});
