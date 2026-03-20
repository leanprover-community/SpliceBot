const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildBridgeOverrideOutputLines,
  parseBridgeOverride,
} = require('../../.github/actions/splice-wf-run/lib/bridge-override-step');

test('parseBridgeOverride rejects non-object JSON', () => {
  assert.throws(() => parseBridgeOverride('["not","an","object"]'), /must be a JSON object/);
});

test('buildBridgeOverrideOutputLines emits only populated bridge keys', () => {
  const lines = buildBridgeOverrideOutputLines({
    pr_number: 12,
    file_path: 'src/Foo.lean',
    base_repo: 'leanprover-community/SpliceBot',
    ignored: 'value',
  });

  assert.deepEqual(lines, [
    'pr_number<<__SPLICEBOT_OUTPUT__',
    '12',
    '__SPLICEBOT_OUTPUT__',
    'file_path<<__SPLICEBOT_OUTPUT__',
    'src/Foo.lean',
    '__SPLICEBOT_OUTPUT__',
    'base_repo<<__SPLICEBOT_OUTPUT__',
    'leanprover-community/SpliceBot',
    '__SPLICEBOT_OUTPUT__',
  ]);
});

test('buildBridgeOverrideOutputLines preserves embedded newlines safely', () => {
  const lines = buildBridgeOverrideOutputLines({
    author: 'Bot Name <bot@example.com>\nSecond Line',
  });

  assert.deepEqual(lines, [
    'author<<__SPLICEBOT_OUTPUT__',
    'Bot Name <bot@example.com>\nSecond Line',
    '__SPLICEBOT_OUTPUT__',
  ]);
});
