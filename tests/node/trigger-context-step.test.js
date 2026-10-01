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

const VERIFIED = {
  trigger: { kind: 'review_comment', id: 12345, author: 'reviewer', body: 'splice-bot ready', path: 'src/Foo.lean' },
  pr: { number: 7, author: 'author', head_sha: 'abc', head_ref: 'feature', head_repo: 'author/repo', base_ref: 'master' },
};

test('trigger-context step outputs the verified context', async () => {
  const core = makeCore();

  await runTriggerContextStep({
    core,
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

  await runTriggerContextStep({ core, env: { VERIFIED_JSON: '{}', BASE_REPO: 'o/r' } });

  assert.deepEqual(core.failures, []);
  assert.deepEqual(core.outputs, {});
  assert.ok(core.infoMessages.some((message) => /nothing to do/.test(message)));
});

test('trigger-context step reports trigger_found=false when the trigger line is gone', async () => {
  const core = makeCore();

  await runTriggerContextStep({
    core,
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
  await runTriggerContextStep({ core: malformed, env: { VERIFIED_JSON: '{not json', BASE_REPO: 'o/r' } });
  assert.match(malformed.failures[0], /Could not parse verified bridge JSON/);
  assert.deepEqual(malformed.outputs, {});

  const deleted = makeCore();
  await runTriggerContextStep({
    core: deleted,
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
    env: {
      BASE_REPO: 'leanprover-community/SpliceBot',
      BRIDGE_OVERRIDE_MODE: 'true',
      BRIDGE_META_JSON: '{"pr_number":1}',
      BRIDGE_EVENT_JSON: JSON.stringify({
        comment: { id: 1, body: 'splice-bot ready', path: 'src/Foo.lean', user: { login: 'author' } },
        pull_request: {
          user: { login: 'author' },
          base: { repo: { full_name: 'example/definitely-does-not-exist' }, ref: 'master' },
          head: { repo: { full_name: 'example/definitely-does-not-exist' }, sha: '1111', ref: 'feature' },
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
    env: { BRIDGE_OVERRIDE_MODE: 'true', BRIDGE_META_JSON: '{}', BRIDGE_EVENT_JSON: '[' },
  });

  assert.match(core.failures[0], /Could not parse bridge event JSON/);
});
