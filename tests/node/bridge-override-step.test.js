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
    'pr_number=12',
    'file_path=src/Foo.lean',
    'base_repo=leanprover-community/SpliceBot',
  ]);
});
