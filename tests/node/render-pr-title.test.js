const test = require('node:test');
const assert = require('node:assert/strict');

const { renderPrTitle } = require('../../.github/actions/splice-wf-run/lib/render-pr-title');

test('renderPrTitle renders the default template with the full file path', () => {
  const title = renderPrTitle({
    template: 'chore({file_path}): automated extraction',
    filePath: 'Mathlib/Algebra/Group/Defs.lean',
    prNumber: 123,
  });

  assert.equal(title, 'chore(Mathlib/Algebra/Group/Defs.lean): automated extraction');
});

test('renderPrTitle strips the extension for {file_scope}', () => {
  const title = renderPrTitle({
    template: 'chore({file_scope}): automated extraction',
    filePath: 'Mathlib/Algebra/Group/Defs.lean',
    prNumber: 123,
  });

  assert.equal(title, 'chore(Mathlib/Algebra/Group/Defs): automated extraction');
});

test('renderPrTitle strips a matching scope prefix for {file_scope}', () => {
  const title = renderPrTitle({
    template: 'chore({file_scope}): split from #{pr_number}',
    filePath: 'Mathlib/Algebra/Group/Defs.lean',
    prNumber: 123,
    scopeStripPrefix: 'Mathlib/',
  });

  assert.equal(title, 'chore(Algebra/Group/Defs): split from #123');
});

test('renderPrTitle leaves {file_scope} intact when the prefix does not match', () => {
  const title = renderPrTitle({
    template: '{file_scope}',
    filePath: 'docs/guide.md',
    prNumber: 1,
    scopeStripPrefix: 'Mathlib/',
  });

  assert.equal(title, 'docs/guide');
});

test('renderPrTitle supports {file_name} and files without an extension', () => {
  assert.equal(
    renderPrTitle({ template: '{file_name}', filePath: 'Mathlib/Algebra/Group/Defs.lean', prNumber: 1 }),
    'Defs.lean',
  );
  assert.equal(
    renderPrTitle({ template: '{file_scope}', filePath: 'scripts/noext', prNumber: 1 }),
    'scripts/noext',
  );
  assert.equal(
    renderPrTitle({ template: '{file_scope}', filePath: '.gitignore', prNumber: 1 }),
    '.gitignore',
  );
});

test('renderPrTitle rejects unknown placeholders', () => {
  assert.throws(
    () =>
      renderPrTitle({
        template: 'chore({file_stem}): automated extraction',
        filePath: 'Mathlib/Algebra/Group/Defs.lean',
        prNumber: 1,
      }),
    /Unknown placeholder\(s\) in pr_title template: \{file_stem\}/,
  );
});

test('renderPrTitle rejects empty templates and empty rendered titles', () => {
  assert.throws(() => renderPrTitle({ template: '', filePath: 'a.lean', prNumber: 1 }), /template is empty/);
  assert.throws(() => renderPrTitle({ template: '   ', filePath: 'a.lean', prNumber: 1 }), /template is empty/);
});

test('renderPrTitle collapses whitespace and newlines into single spaces', () => {
  const title = renderPrTitle({
    template: 'chore({file_scope}):\n  automated   extraction ',
    filePath: 'src/Foo.lean',
    prNumber: 1,
  });

  assert.equal(title, 'chore(src/Foo): automated extraction');
});
