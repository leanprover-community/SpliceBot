const test = require('node:test');
const assert = require('node:assert/strict');

const {
  renderPrTitle,
  renderCommandComment,
  validateCommandCommentTemplate,
} = require('../../.github/actions/splice-wf-run/lib/render-template');

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

test('renderCommandComment substitutes all supported placeholders and preserves newlines', () => {
  const body = renderCommandComment({
    template: 'maintainer merge\n\nRequested by @{commenter} via splice-bot on #{pr_number} ({file_path}); split PR is #{split_pr_number}.',
    filePath: 'Mathlib/Algebra/Group/Defs.lean',
    prNumber: 123,
    splitPrNumber: 456,
    commenter: 'reviewer',
  });

  assert.equal(
    body,
    'maintainer merge\n\nRequested by @reviewer via splice-bot on #123 (Mathlib/Algebra/Group/Defs.lean); split PR is #456.',
  );
});

test('renderCommandComment supports {file_scope} with a strip prefix', () => {
  const body = renderCommandComment({
    template: 'Spliced {file_scope} ({file_name})',
    filePath: 'Mathlib/Algebra/Group/Defs.lean',
    prNumber: 1,
    splitPrNumber: 2,
    commenter: 'reviewer',
    scopeStripPrefix: 'Mathlib/',
  });

  assert.equal(body, 'Spliced Algebra/Group/Defs (Defs.lean)');
});

test('renderCommandComment rejects unknown placeholders and empty templates', () => {
  assert.throws(
    () =>
      renderCommandComment({
        template: 'hello {who}',
        filePath: 'a.lean',
        prNumber: 1,
        splitPrNumber: 2,
        commenter: 'reviewer',
      }),
    /Unknown placeholder\(s\) in comment template: \{who\}/,
  );
  assert.throws(
    () => renderCommandComment({ template: '  ', filePath: 'a.lean', prNumber: 1, splitPrNumber: 2, commenter: 'r' }),
    /comment template is empty/,
  );
});

test('renderCommandComment substitutes {command_args} and blockquotes {extra_comment}', () => {
  const body = renderCommandComment({
    template: 'maintainer {command_args}\n\n{extra_comment}\n\n(requested by @{commenter})',
    filePath: 'a.lean',
    prNumber: 1,
    splitPrNumber: 2,
    commenter: 'reviewer',
    commandArgs: 'merge?',
    extraComment: 'First line\n\nmaintainer merge',
  });

  assert.equal(
    body,
    'maintainer merge?\n\n> First line\n>\n> maintainer merge\n\n(requested by @reviewer)',
  );
});

test('renderCommandComment renders an empty {extra_comment} as nothing', () => {
  const body = renderCommandComment({
    template: 'maintainer {command_args}\n\n{extra_comment}',
    filePath: 'a.lean',
    prNumber: 1,
    splitPrNumber: 2,
    commenter: 'reviewer',
    commandArgs: 'merge',
    extraComment: '   ',
  });

  assert.equal(body, 'maintainer merge');
});

test('validateCommandCommentTemplate accepts supported placeholders and rejects unknown ones', () => {
  validateCommandCommentTemplate('maintainer merge\n\nby @{commenter} from #{pr_number} as #{split_pr_number}');
  validateCommandCommentTemplate('maintainer {command_args}\n\n{extra_comment}');
  assert.throws(() => validateCommandCommentTemplate('hello {who}'), /Unknown placeholder\(s\) in comment template/);
  assert.throws(() => validateCommandCommentTemplate(''), /comment template is empty/);
});
