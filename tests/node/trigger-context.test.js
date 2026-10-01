const test = require('node:test');
const assert = require('node:assert/strict');

const {
  bindToCommentCommit,
  resolveTriggerContext,
  verifiedFromOverride,
} = require('../../.github/actions/splice-wf-run/lib/trigger-context');

function makeVerified({ trigger = {}, pr = {} } = {}) {
  return {
    trigger: {
      kind: 'review_comment',
      id: 102,
      author: 'reviewer',
      author_type: 'User',
      body: 'Please split this out.\n\nsplice-bot maintainer merge?\nHappy to merge.',
      url: 'https://github.com/leanprover-community/mathlib4/pull/43#discussion_r102',
      created_at: '2026-09-30T00:00:00Z',
      updated_at: '2026-09-30T00:00:00Z',
      path: 'Mathlib/Foo.lean',
      ...trigger,
    },
    pr: {
      number: 43,
      title: 'feat: things',
      url: 'https://github.com/leanprover-community/mathlib4/pull/43',
      author: 'author',
      state: 'open',
      merged: false,
      head_sha: '4444444444444444444444444444444444444444',
      head_ref: 'feature-branch',
      head_repo: 'author/mathlib4',
      is_fork: true,
      base_ref: 'master',
      ...pr,
    },
  };
}

test('resolveTriggerContext builds the context from verified values and the current repository', () => {
  const result = resolveTriggerContext({
    verified: makeVerified(),
    baseRepo: 'leanprover-community/mathlib4',
  });

  assert.equal(result.status, 'ok');
  assert.deepEqual(result.outputs, {
    pr_number: '43',
    review_comment_id: '102',
    base_repo: 'leanprover-community/mathlib4',
    file_path: 'Mathlib/Foo.lean',
    trigger_found: 'true',
    trigger_keyword: 'maintainer',
    trigger_args: 'merge?',
    trigger_extra_text: 'Happy to merge.',
    commenter_login: 'reviewer',
    pr_author_login: 'author',
    base_ref: 'master',
    head_repo: 'author/mathlib4',
    pr_head_sha: '4444444444444444444444444444444444444444',
    head_ref: 'feature-branch',
    head_label: 'author:feature-branch',
  });
});

test('resolveTriggerContext lets the base_ref input override the PR base branch', () => {
  const result = resolveTriggerContext({
    verified: makeVerified({ pr: { base_ref: 'some-feature' } }),
    baseRepo: 'leanprover-community/mathlib4',
    baseRefInput: 'master',
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.outputs.base_ref, 'master');
});

test('resolveTriggerContext reports nothing to do without verified values', () => {
  for (const verified of [{}, undefined, null]) {
    assert.deepEqual(resolveTriggerContext({ verified, baseRepo: 'o/r' }), { status: 'none' });
  }
});

test('resolveTriggerContext is a no-op when the trigger line is gone', () => {
  const result = resolveTriggerContext({
    verified: makeVerified({ trigger: { body: 'edited away' } }),
    baseRepo: 'leanprover-community/mathlib4',
  });

  assert.equal(result.status, 'no-trigger');
  assert.equal(result.outputs.trigger_found, 'false');
  assert.equal(result.outputs.pr_number, '43');
  assert.equal(result.outputs.commenter_login, undefined);
});

test('resolveTriggerContext fails closed on values that do not describe a review comment', () => {
  for (const verified of [
    makeVerified({ trigger: { kind: 'issue_comment' } }),
    makeVerified({ trigger: { id: 0 } }),
    makeVerified({ trigger: { id: '102' } }),
    makeVerified({ pr: { number: undefined } }),
    { trigger: makeVerified().trigger },
  ]) {
    const result = resolveTriggerContext({ verified, baseRepo: 'leanprover-community/mathlib4' });
    assert.equal(result.status, 'error');
    assert.match(result.error, /do not describe a review comment on a pull request/);
    assert.deepEqual(result.outputs, {});
  }
});

test('resolveTriggerContext fails closed when the head repository was deleted, keeping ids for comment-back', () => {
  const result = resolveTriggerContext({
    verified: makeVerified({ pr: { head_repo: null } }),
    baseRepo: 'leanprover-community/mathlib4',
  });

  assert.equal(result.status, 'error');
  assert.match(result.error, /Cannot split PR #43: the pull request head repository no longer exists\./);
  assert.equal(result.outputs.pr_number, '43');
  assert.equal(result.outputs.review_comment_id, '102');
  assert.equal(result.outputs.base_repo, 'leanprover-community/mathlib4');
  assert.equal(result.outputs.head_label, '');
});

test('resolveTriggerContext fails closed on other missing values', () => {
  const cases = [
    [{ trigger: { path: undefined } }, 'o/r', /the review comment has no file path/],
    [{ trigger: { author: '' } }, 'o/r', /the review comment has no author/],
    [{ pr: { author: '' } }, 'o/r', /the pull request has no author/],
    [{ pr: { base_ref: '' } }, 'o/r', /the pull request has no base branch/],
    [{ pr: { head_sha: '' } }, 'o/r', /the pull request has no head commit or branch/],
    [{ pr: { head_ref: '' } }, 'o/r', /the pull request has no head commit or branch/],
    [{}, '', /base repository '' is not owner\/repo/],
    [{}, 'a/b/c', /base repository 'a\/b\/c' is not owner\/repo/],
  ];
  for (const [overrides, baseRepo, pattern] of cases) {
    const result = resolveTriggerContext({ verified: makeVerified(overrides), baseRepo });
    assert.equal(result.status, 'error');
    assert.match(result.error, pattern);
  }
});

test('verifiedFromOverride maps the raw override event onto the verified shape', () => {
  const { verified, baseRepo } = verifiedFromOverride({
    meta: { pr_number: 1 },
    event: {
      comment: { id: 1, body: 'splice-bot', path: 'src/Foo.lean', user: { login: 'author' }, original_commit_id: 'abc' },
      pull_request: {
        user: { login: 'author' },
        base: { repo: { full_name: 'example/base' }, ref: 'master' },
        head: { repo: { full_name: 'example/head' }, sha: '1111111111111111111111111111111111111111', ref: 'feature' },
      },
    },
  });

  assert.equal(baseRepo, 'example/base');
  assert.equal(verified.trigger.original_commit_id, 'abc');
  const result = resolveTriggerContext({ verified, baseRepo });
  assert.equal(result.status, 'ok');
  assert.equal(result.outputs.head_label, 'example:feature');
  assert.equal(result.outputs.commenter_login, 'author');
});

test('verifiedFromOverride returns nothing without a comment', () => {
  assert.deepEqual(verifiedFromOverride({ meta: {}, event: {} }), { verified: {}, baseRepo: '' });
});

test('resolveTriggerContext refuses file paths with control or line-break characters without exposing them', () => {
  for (const path of ['x\nmaintainer merge\ny', 'x\r\ny', 'x\u0085y', 'x y', 'x y', 'x\u0000y', 'x\u007fy', 'x\ty']) {
    const result = resolveTriggerContext({
      verified: makeVerified({ trigger: { path } }),
      baseRepo: 'leanprover-community/mathlib4',
    });
    assert.equal(result.status, 'error');
    assert.match(result.error, /file path contains control or line-break characters/);
    assert.equal(result.outputs.file_path, '');
    assert.ok(!result.error.includes(path));
    assert.ok(!Object.values(result.outputs).some((value) => value.includes(path)));
  }
});

test('resolveTriggerContext accepts ordinary unicode file paths', () => {
  const result = resolveTriggerContext({
    verified: makeVerified({ trigger: { path: 'Mathlib/Topology/Ünïcode spaces/Foo.lean' } }),
    baseRepo: 'leanprover-community/mathlib4',
  });
  assert.equal(result.status, 'ok');
});

const HEAD = '4444444444444444444444444444444444444444';
const OLDER = '3333333333333333333333333333333333333333';

function okOutputs() {
  return resolveTriggerContext({ verified: makeVerified(), baseRepo: 'leanprover-community/mathlib4' }).outputs;
}

test('bindToCommentCommit splits the commit the comment was made on when it is still the PR head', () => {
  const result = bindToCommentCommit({ outputs: okOutputs(), commentCommit: HEAD });
  assert.equal(result.status, 'ok');
  assert.equal(result.outputs.head_sha, HEAD);
});

test('bindToCommentCommit refuses when the PR has moved past the comment commit', () => {
  const result = bindToCommentCommit({ outputs: okOutputs(), commentCommit: OLDER });
  assert.equal(result.status, 'error');
  assert.match(result.error, /PR #43 has changed since the commit this comment is attached to \(`3333333`; the PR is now at `4444444`\)/);
  assert.match(result.error, /a reply is attached to the commit its thread was started on/);
  assert.equal(result.outputs.head_sha, undefined);
  assert.equal(result.outputs.pr_number, '43');
});

test('bindToCommentCommit fails closed without a well-formed comment commit', () => {
  for (const commentCommit of [undefined, '', 'abc', 'A'.repeat(40), `${HEAD}\n`]) {
    const result = bindToCommentCommit({ outputs: okOutputs(), commentCommit });
    assert.equal(result.status, 'error');
    assert.match(result.error, /could not determine the commit review comment 102 was made on/);
  }
});
