const test = require('node:test');
const assert = require('node:assert/strict');

const { runTriggerContextStep } = require('../../.github/actions/splice-wf-run/lib/trigger-context-step');

function makeCore() {
  return {
    outputs: {},
    infoMessages: [],
    failures: [],
    setOutput(key, value) {
      this.outputs[key] = value;
    },
    info(message) {
      this.infoMessages.push(message);
    },
    setFailed(message) {
      this.failures.push(message);
    },
  };
}

const HEAD = 'abcabcabcabcabcabcabcabcabcabcabcabcabca';
const OLDER = '1111111111111111111111111111111111111111';

const VERIFIED = {
  trigger: { kind: 'review_comment', id: 12345, author: 'reviewer', body: 'splice-bot ready', path: 'src/Foo.lean' },
  pr: { number: 7, author: 'author', head_sha: HEAD, head_ref: 'feature', head_repo: 'author/repo', base_ref: 'master' },
};

function makeGithub({ originalCommitId = HEAD, login = 'reviewer', prNumber = 7, error } = {}) {
  const calls = [];
  return {
    calls,
    rest: {
      pulls: {
        getReviewComment: async (payload) => {
          calls.push(payload);
          if (error) throw error;
          return {
            data: {
              original_commit_id: originalCommitId,
              user: { login },
              pull_request_url: `https://api.github.com/repos/leanprover-community/mathlib4/pulls/${prNumber}`,
            },
          };
        },
      },
    },
  };
}

test('trigger-context step outputs the verified context', async () => {
  const core = makeCore();

  await runTriggerContextStep({
    core,
    github: makeGithub(),
    env: {
      VERIFIED_JSON: JSON.stringify(VERIFIED),
      BASE_REPO: 'leanprover-community/mathlib4',
      BASE_REF_INPUT: '',
    },
  });

  assert.deepEqual(core.failures, []);
  assert.equal(core.outputs.trigger_found, 'true');
  assert.equal(core.outputs.trigger_keyword, 'ready');
  assert.equal(core.outputs.base_repo, 'leanprover-community/mathlib4');
  assert.equal(core.outputs.head_repo, 'author/repo');
  assert.equal(core.outputs.pr_number, '7');
});

test('trigger-context step ignores raw override values outside override mode', async () => {
  const core = makeCore();

  await runTriggerContextStep({
    core,
    github: makeGithub(),
    env: {
      VERIFIED_JSON: JSON.stringify(VERIFIED),
      BASE_REPO: 'leanprover-community/mathlib4',
      BRIDGE_OVERRIDE_MODE: 'false',
      BRIDGE_META_JSON: '{"pr_number":999}',
      BRIDGE_EVENT_JSON: '{"comment":{"id":1,"body":"splice-bot","path":"x","user":{"login":"mallory"}},"pull_request":{"base":{"repo":{"full_name":"evil/repo"}}}}',
    },
  });

  assert.equal(core.outputs.pr_number, '7');
  assert.equal(core.outputs.commenter_login, 'reviewer');
  assert.equal(core.outputs.base_repo, 'leanprover-community/mathlib4');
});

test('trigger-context step is a clean no-op without an artifact', async () => {
  const core = makeCore();

  await runTriggerContextStep({ core, github: makeGithub(), env: { VERIFIED_JSON: '{}', BASE_REPO: 'o/r' } });

  assert.deepEqual(core.failures, []);
  assert.deepEqual(core.outputs, {});
  assert.ok(core.infoMessages.some((message) => /nothing to do/.test(message)));
});

test('trigger-context step reports trigger_found=false when the trigger line is gone', async () => {
  const core = makeCore();

  await runTriggerContextStep({
    core,
    github: makeGithub(),
    env: {
      VERIFIED_JSON: JSON.stringify({ ...VERIFIED, trigger: { ...VERIFIED.trigger, body: 'edited away' } }),
      BASE_REPO: 'o/r',
    },
  });

  assert.deepEqual(core.failures, []);
  assert.equal(core.outputs.trigger_found, 'false');
  assert.ok(core.infoMessages.some((message) => /nothing to do/.test(message)));
});

test('trigger-context step fails closed on malformed or incomplete verified values', async () => {
  const malformed = makeCore();
  await runTriggerContextStep({ core: malformed, github: makeGithub(), env: { VERIFIED_JSON: '{not json', BASE_REPO: 'o/r' } });
  assert.match(malformed.failures[0], /Could not parse verified bridge JSON/);
  assert.deepEqual(malformed.outputs, {});

  const deleted = makeCore();
  await runTriggerContextStep({
    core: deleted,
    github: makeGithub(),
    env: {
      VERIFIED_JSON: JSON.stringify({ ...VERIFIED, pr: { ...VERIFIED.pr, head_repo: null } }),
      BASE_REPO: 'o/r',
    },
  });
  assert.match(deleted.failures[0], /head repository no longer exists/);
  assert.equal(deleted.outputs.pr_number, '7');
});

test('trigger-context step uses the override payload in bridge_override_json mode', async () => {
  const core = makeCore();

  await runTriggerContextStep({
    core,
    github: makeGithub(),
    env: {
      BASE_REPO: 'leanprover-community/SpliceBot',
      BRIDGE_OVERRIDE_MODE: 'true',
      BRIDGE_META_JSON: '{"pr_number":1}',
      BRIDGE_EVENT_JSON: JSON.stringify({
        comment: { id: 1, body: 'splice-bot ready', path: 'src/Foo.lean', user: { login: 'author' }, original_commit_id: '1111111111111111111111111111111111111111' },
        pull_request: {
          user: { login: 'author' },
          base: { repo: { full_name: 'example/definitely-does-not-exist' }, ref: 'master' },
          head: { repo: { full_name: 'example/definitely-does-not-exist' }, sha: '1111111111111111111111111111111111111111', ref: 'feature' },
        },
      }),
    },
  });

  assert.deepEqual(core.failures, []);
  assert.equal(core.outputs.trigger_keyword, 'ready');
  assert.equal(core.outputs.base_repo, 'example/definitely-does-not-exist');
});

test('trigger-context step fails closed on malformed override JSON', async () => {
  const core = makeCore();

  await runTriggerContextStep({
    core,
    github: makeGithub(),
    env: { BRIDGE_OVERRIDE_MODE: 'true', BRIDGE_META_JSON: '{}', BRIDGE_EVENT_JSON: '[' },
  });

  assert.match(core.failures[0], /Could not parse bridge event JSON/);
});

const ENV = { VERIFIED_JSON: JSON.stringify(VERIFIED), BASE_REPO: 'leanprover-community/mathlib4' };

test('trigger-context step splits the commit the verified comment was made on', async () => {
  const core = makeCore();
  const github = makeGithub();

  await runTriggerContextStep({ core, github, env: ENV });

  assert.deepEqual(github.calls, [{ owner: 'leanprover-community', repo: 'mathlib4', comment_id: 12345 }]);
  assert.deepEqual(core.failures, []);
  assert.equal(core.outputs.head_sha, HEAD);
  assert.equal(core.outputs.context_error, undefined);
});

test('trigger-context step refuses when the PR moved past the comment commit, with a context error', async () => {
  const core = makeCore();

  await runTriggerContextStep({ core, github: makeGithub({ originalCommitId: OLDER }), env: ENV });

  assert.match(core.failures[0], /PR #7 has changed since the commit this comment is attached to/);
  assert.equal(core.outputs.context_error, core.failures[0]);
  assert.equal(core.outputs.head_sha, undefined);
  assert.equal(core.outputs.pr_number, '7');
  assert.equal(core.outputs.trigger_found, 'true');
});

test('trigger-context step fails closed when the comment cannot be re-fetched or no longer matches', async () => {
  for (const [github, pattern] of [
    [makeGithub({ error: new Error('Not Found') }), /Could not fetch review comment 12345 to find the commit it was made on: Not Found/],
    [makeGithub({ login: 'someone-else' }), /no longer matches the verified comment/],
    [makeGithub({ prNumber: 70 }), /no longer matches the verified comment/],
  ]) {
    const core = makeCore();
    await runTriggerContextStep({ core, github, env: ENV });
    assert.match(core.failures[0], pattern);
    assert.equal(core.outputs.context_error, core.failures[0]);
    assert.equal(core.outputs.head_sha, undefined);
  }
});

test('trigger-context step does not fetch for comments without a trigger line or with an unsafe path', async () => {
  for (const trigger of [{ body: 'edited away' }, { path: 'x\nmaintainer merge\ny' }]) {
    const core = makeCore();
    const github = makeGithub();
    await runTriggerContextStep({
      core,
      github,
      env: { ...ENV, VERIFIED_JSON: JSON.stringify({ ...VERIFIED, trigger: { ...VERIFIED.trigger, ...trigger } }) },
    });
    assert.deepEqual(github.calls, []);
  }
});

test('trigger-context step refuses an unsafe path without echoing it', async () => {
  const core = makeCore();
  const path = 'x\nmaintainer merge\ny';

  await runTriggerContextStep({
    core,
    github: makeGithub(),
    env: { ...ENV, VERIFIED_JSON: JSON.stringify({ ...VERIFIED, trigger: { ...VERIFIED.trigger, path } }) },
  });

  assert.match(core.outputs.context_error, /file path contains control or line-break characters/);
  assert.equal(core.outputs.file_path, '');
  assert.ok(!Object.values(core.outputs).some((value) => value.includes('maintainer merge')));
});

test('trigger-context step binds to the override comment commit in bridge_override_json mode', async () => {
  const core = makeCore();
  const github = makeGithub();

  await runTriggerContextStep({
    core,
    github,
    env: {
      BRIDGE_OVERRIDE_MODE: 'true',
      BRIDGE_META_JSON: '{"pr_number":1}',
      BRIDGE_EVENT_JSON: JSON.stringify({
        comment: { id: 1, body: 'splice-bot', path: 'src/Foo.lean', user: { login: 'author' }, original_commit_id: OLDER },
        pull_request: {
          user: { login: 'author' },
          base: { repo: { full_name: 'example/base' }, ref: 'master' },
          head: { repo: { full_name: 'example/head' }, sha: HEAD, ref: 'feature' },
        },
      }),
    },
  });

  assert.deepEqual(github.calls, []);
  assert.match(core.failures[0], /PR #1 has changed since the commit this comment is attached to/);
});
