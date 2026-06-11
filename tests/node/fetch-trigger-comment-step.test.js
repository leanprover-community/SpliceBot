const test = require('node:test');
const assert = require('node:assert/strict');

const { runFetchTriggerCommentStep } = require('../../.github/actions/splice-wf-run/lib/fetch-trigger-comment-step');

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

function makeGithub(handler) {
  return {
    rest: {
      pulls: {
        getReviewComment: handler,
      },
    },
  };
}

test('fetch-trigger-comment step fetches the comment and parses the trigger', async () => {
  const core = makeCore();
  const calls = [];
  const github = makeGithub(async (payload) => {
    calls.push(payload);
    return { data: { body: 'splice-bot maintainer merge?\n\nHappy to merge.' } };
  });

  await runFetchTriggerCommentStep({
    core,
    github,
    env: {
      BASE_REPO: 'leanprover-community/mathlib4',
      REVIEW_COMMENT_ID: '12345',
    },
  });

  assert.deepEqual(calls, [{ owner: 'leanprover-community', repo: 'mathlib4', comment_id: 12345 }]);
  assert.deepEqual(core.failures, []);
  assert.equal(core.outputs.trigger_found, 'true');
  assert.equal(core.outputs.trigger_keyword, 'maintainer');
  assert.equal(core.outputs.trigger_args, 'merge?');
  assert.equal(core.outputs.trigger_extra_text, 'Happy to merge.');
});

test('fetch-trigger-comment step reports trigger_found=false when the trigger line is gone', async () => {
  const core = makeCore();
  const github = makeGithub(async () => ({ data: { body: 'edited away' } }));

  await runFetchTriggerCommentStep({
    core,
    github,
    env: {
      BASE_REPO: 'leanprover-community/mathlib4',
      REVIEW_COMMENT_ID: '12345',
    },
  });

  assert.deepEqual(core.failures, []);
  assert.equal(core.outputs.trigger_found, 'false');
  assert.equal(core.outputs.trigger_keyword, '');
  assert.ok(core.infoMessages.some((message) => /nothing to do/.test(message)));
});

test('fetch-trigger-comment step fails closed when the fetch fails', async () => {
  const core = makeCore();
  const github = makeGithub(async () => {
    throw new Error('Not Found');
  });

  await runFetchTriggerCommentStep({
    core,
    github,
    env: {
      BASE_REPO: 'leanprover-community/mathlib4',
      REVIEW_COMMENT_ID: '12345',
    },
  });

  assert.match(core.failures[0], /Could not fetch review comment 12345 from leanprover-community\/mathlib4: Not Found/);
  assert.deepEqual(core.outputs, {});
});

test('fetch-trigger-comment step fails closed on missing or malformed context', async () => {
  for (const env of [
    { BASE_REPO: '', REVIEW_COMMENT_ID: '12345' },
    { BASE_REPO: 'not-a-full-repo', REVIEW_COMMENT_ID: '12345' },
    { BASE_REPO: 'a/b/c', REVIEW_COMMENT_ID: '12345' },
    { BASE_REPO: 'leanprover-community/mathlib4', REVIEW_COMMENT_ID: '' },
    { BASE_REPO: 'leanprover-community/mathlib4', REVIEW_COMMENT_ID: 'abc' },
  ]) {
    const core = makeCore();
    const github = makeGithub(async () => {
      throw new Error('should not be called');
    });

    await runFetchTriggerCommentStep({ core, github, env });

    assert.match(core.failures[0], /Missing review comment context/);
    assert.deepEqual(core.outputs, {});
  }
});

test('fetch-trigger-comment step uses the override event body in bridge_override_json mode', async () => {
  const core = makeCore();
  const github = makeGithub(async () => {
    throw new Error('should not be called');
  });

  await runFetchTriggerCommentStep({
    core,
    github,
    env: {
      BRIDGE_OVERRIDE_MODE: 'true',
      BRIDGE_EVENT_JSON: '{"comment":{"body":"splice-bot ready"}}',
    },
  });

  assert.deepEqual(core.failures, []);
  assert.equal(core.outputs.trigger_found, 'true');
  assert.equal(core.outputs.trigger_keyword, 'ready');
});

test('fetch-trigger-comment step fails closed in override mode without a comment body', async () => {
  const core = makeCore();
  const github = makeGithub(async () => {
    throw new Error('should not be called');
  });

  await runFetchTriggerCommentStep({
    core,
    github,
    env: {
      BRIDGE_OVERRIDE_MODE: 'true',
      BRIDGE_EVENT_JSON: '{"comment":{"id":1}}',
    },
  });

  assert.match(core.failures[0], /requires event\.comment\.body/);
});
