const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveTriggerCommand } = require('../../.github/actions/splice-wf-run/lib/resolve-trigger-command-step');

test('resolveTriggerCommand matches configured label commands case-insensitively', () => {
  const result = resolveTriggerCommand({
    rawCommands: '[{"command":"ready","label":"ready-to-merge","min_repo_permission":"maintain"}]',
    triggerKeyword: 'READY',
  });

  assert.equal(result.trigger_mode, 'label');
  assert.equal(result.label_command, 'ready');
  assert.equal(result.label_name, 'ready-to-merge');
  assert.equal(result.label_min_repo_permission, 'maintain');
});

test('resolveTriggerCommand fails on unknown keywords', () => {
  const result = resolveTriggerCommand({
    rawCommands: '[{"command":"ready","label":"ready-to-merge"}]',
    triggerKeyword: 'unknown',
  });

  assert.equal(result.trigger_mode, 'unknown');
  assert.equal(result.shouldFail, true);
  assert.match(result.resolve_error, /No label command matched/);
});

test('resolveTriggerCommand returns splice mode when no keyword is present', () => {
  const result = resolveTriggerCommand({
    rawCommands: '[{"command":"ready","label":"ready-to-merge"}]',
    triggerKeyword: '',
  });

  assert.deepEqual(result, { trigger_mode: 'splice' });
});

test('resolveTriggerCommand fails on invalid label command config', () => {
  const result = resolveTriggerCommand({
    rawCommands: '[{"command":"ready"}]',
    triggerKeyword: 'ready',
  });

  assert.equal(result.trigger_mode, 'invalid');
  assert.equal(result.shouldFail, true);
  assert.match(result.resolve_error, /missing label/i);
});
