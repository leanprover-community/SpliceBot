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
  assert.match(result.resolve_error, /missing label and\/or comment/i);
});

test('resolveTriggerCommand resolves comment-only commands', () => {
  const result = resolveTriggerCommand({
    rawCommands:
      '[{"command":"maintainer-merge","comment":"maintainer merge\\n\\nRequested by @{commenter} via splice-bot from #{pr_number}."}]',
    triggerKeyword: 'maintainer-merge',
  });

  assert.equal(result.trigger_mode, 'label');
  assert.equal(result.label_command, 'maintainer-merge');
  assert.equal(result.label_name, '');
  assert.equal(
    result.comment_template,
    'maintainer merge\n\nRequested by @{commenter} via splice-bot from #{pr_number}.',
  );
});

test('resolveTriggerCommand resolves commands with both label and comment', () => {
  const result = resolveTriggerCommand({
    rawCommands: '[{"command":"ready","label":"ready-to-merge","comment":"queued from #{pr_number}"}]',
    triggerKeyword: 'ready',
  });

  assert.equal(result.trigger_mode, 'label');
  assert.equal(result.label_name, 'ready-to-merge');
  assert.equal(result.comment_template, 'queued from #{pr_number}');
});

test('resolveTriggerCommand fails on comment templates with unknown placeholders', () => {
  const result = resolveTriggerCommand({
    rawCommands: '[{"command":"ready","comment":"hello {who}"}]',
    triggerKeyword: 'ready',
  });

  assert.equal(result.trigger_mode, 'invalid');
  assert.equal(result.shouldFail, true);
  assert.match(result.resolve_error, /invalid comment template.*\{who\}/);
});

test('resolveTriggerCommand accepts allowlisted args and normalizes them', () => {
  const result = resolveTriggerCommand({
    rawCommands:
      '[{"command":"maintainer","comment":"maintainer {command_args}","allowed_args":["merge","merge?","delegate","delegate?"]}]',
    triggerKeyword: 'maintainer',
    triggerArgs: '  MERGE?  ',
  });

  assert.equal(result.trigger_mode, 'label');
  assert.equal(result.label_command, 'maintainer');
  assert.equal(result.command_args, 'merge?');
});

test('resolveTriggerCommand collapses internal whitespace when matching args', () => {
  const result = resolveTriggerCommand({
    rawCommands: '[{"command":"status","comment":"status: {command_args}","allowed_args":["in progress"]}]',
    triggerKeyword: 'status',
    triggerArgs: 'In   Progress',
  });

  assert.equal(result.trigger_mode, 'label');
  assert.equal(result.command_args, 'in progress');
});

test('resolveTriggerCommand rejects args not in allowed_args', () => {
  const result = resolveTriggerCommand({
    rawCommands: '[{"command":"maintainer","comment":"maintainer {command_args}","allowed_args":["merge","merge?"]}]',
    triggerKeyword: 'maintainer',
    triggerArgs: 'rebase',
  });

  assert.equal(result.trigger_mode, 'invalid_args');
  assert.equal(result.shouldFail, true);
  assert.match(result.resolve_error, /Argument 'rebase' is not allowed for command 'maintainer'/);
  assert.match(result.resolve_error, /'merge', 'merge\?'/);
});

test('resolveTriggerCommand requires an argument when allowed_args is configured', () => {
  const result = resolveTriggerCommand({
    rawCommands: '[{"command":"maintainer","comment":"maintainer {command_args}","allowed_args":["merge"]}]',
    triggerKeyword: 'maintainer',
    triggerArgs: '',
  });

  assert.equal(result.trigger_mode, 'invalid_args');
  assert.equal(result.shouldFail, true);
  assert.match(result.resolve_error, /Command 'maintainer' requires an argument/);
});

test('resolveTriggerCommand rejects args for commands without allowed_args', () => {
  const result = resolveTriggerCommand({
    rawCommands: '[{"command":"ready","label":"ready-to-merge"}]',
    triggerKeyword: 'ready',
    triggerArgs: 'now',
  });

  assert.equal(result.trigger_mode, 'invalid_args');
  assert.equal(result.shouldFail, true);
  assert.match(result.resolve_error, /Command 'ready' does not accept arguments \(got 'now'\)/);
});

test('resolveTriggerCommand allows empty args for commands without allowed_args', () => {
  const result = resolveTriggerCommand({
    rawCommands: '[{"command":"ready","label":"ready-to-merge"}]',
    triggerKeyword: 'ready',
    triggerArgs: '',
  });

  assert.equal(result.trigger_mode, 'label');
  assert.equal(result.command_args, '');
});

test('resolveTriggerCommand accepts allowed_args as a comma-separated string', () => {
  const result = resolveTriggerCommand({
    rawCommands: '[{"command":"maintainer","comment":"maintainer {command_args}","allowed_args":"merge, delegate"}]',
    triggerKeyword: 'maintainer',
    triggerArgs: 'delegate',
  });

  assert.equal(result.trigger_mode, 'label');
  assert.equal(result.command_args, 'delegate');
});

test('resolveTriggerCommand fails on invalid allowed_args config', () => {
  const wrongType = resolveTriggerCommand({
    rawCommands: '[{"command":"maintainer","comment":"x","allowed_args":{"merge":true}}]',
    triggerKeyword: 'maintainer',
    triggerArgs: 'merge',
  });

  assert.equal(wrongType.trigger_mode, 'invalid');
  assert.equal(wrongType.shouldFail, true);
  assert.match(wrongType.resolve_error, /invalid allowed_args/);

  const emptyList = resolveTriggerCommand({
    rawCommands: '[{"command":"maintainer","comment":"x","allowed_args":["  "]}]',
    triggerKeyword: 'maintainer',
    triggerArgs: '',
  });

  assert.equal(emptyList.trigger_mode, 'invalid');
  assert.equal(emptyList.shouldFail, true);
  assert.match(emptyList.resolve_error, /allowed_args with no usable entries/);
});

test('resolveTriggerCommand fails on blank comment templates', () => {
  const result = resolveTriggerCommand({
    rawCommands: '[{"command":"ready","label":"ready-to-merge","comment":"   "}]',
    triggerKeyword: 'ready',
  });

  assert.equal(result.trigger_mode, 'invalid');
  assert.equal(result.shouldFail, true);
  assert.match(result.resolve_error, /comment template is empty/);
});
