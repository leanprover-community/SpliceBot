const test = require('node:test');
const assert = require('node:assert/strict');

const { parseTriggerComment } = require('../../.github/actions/splice-wf-run/lib/parse-trigger-comment');

test('parseTriggerComment parses keyword, args, and extra text', () => {
  const result = parseTriggerComment('splice-bot maintainer merge?\n\nHappy to merge once CI is green.');

  assert.deepEqual(result, {
    found: true,
    keyword: 'maintainer',
    args: 'merge?',
    extraText: 'Happy to merge once CI is green.',
  });
});

test('parseTriggerComment matches the trigger case-insensitively and lowercases tokens', () => {
  const result = parseTriggerComment('SPLICE-BOT Maintainer MERGE');

  assert.equal(result.found, true);
  assert.equal(result.keyword, 'maintainer');
  assert.equal(result.args, 'merge');
});

test('parseTriggerComment handles a bare trigger with no keyword', () => {
  assert.deepEqual(parseTriggerComment('splice-bot'), {
    found: true,
    keyword: '',
    args: '',
    extraText: '',
  });
});

test('parseTriggerComment joins multi-token args with single spaces', () => {
  const result = parseTriggerComment('splice-bot status In   Progress');

  assert.equal(result.keyword, 'status');
  assert.equal(result.args, 'in progress');
});

test('parseTriggerComment finds the trigger on a later line and keeps only following lines as extra text', () => {
  const result = parseTriggerComment('Looks good!\nsplice-bot merge\nThanks for the fix.\nSecond line.');

  assert.equal(result.found, true);
  assert.equal(result.keyword, 'merge');
  assert.equal(result.extraText, 'Thanks for the fix.\nSecond line.');
});

test('parseTriggerComment handles CRLF line endings', () => {
  const result = parseTriggerComment('splice-bot maintainer merge?\r\n\r\nExtra text.\r\n');

  assert.equal(result.keyword, 'maintainer');
  assert.equal(result.args, 'merge?');
  assert.equal(result.extraText, 'Extra text.');
});

test('parseTriggerComment requires the trigger at the start of a line', () => {
  assert.equal(parseTriggerComment('  splice-bot merge').found, false);
  assert.equal(parseTriggerComment('please splice-bot merge').found, false);
  assert.equal(parseTriggerComment('splice-bots merge').found, false);
});

test('parseTriggerComment reports not found for empty or trigger-free bodies', () => {
  assert.equal(parseTriggerComment('').found, false);
  assert.equal(parseTriggerComment(null).found, false);
  assert.equal(parseTriggerComment(undefined).found, false);
  assert.equal(parseTriggerComment('just a regular review comment').found, false);
});
