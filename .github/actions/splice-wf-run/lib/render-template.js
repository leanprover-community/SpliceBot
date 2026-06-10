const PLACEHOLDER_RE = /\{([A-Za-z0-9_]+)\}/g;

function stripExtension(filePath) {
  const slashIndex = filePath.lastIndexOf('/');
  const baseName = filePath.slice(slashIndex + 1);
  const dotIndex = baseName.lastIndexOf('.');
  if (dotIndex <= 0) {
    return filePath;
  }
  return filePath.slice(0, slashIndex + 1) + baseName.slice(0, dotIndex);
}

function deriveFileScope(filePath, scopeStripPrefix) {
  let scope = filePath;
  if (scopeStripPrefix && scope.startsWith(scopeStripPrefix)) {
    scope = scope.slice(scopeStripPrefix.length);
  }
  return stripExtension(scope);
}

function substitutePlaceholders({ template, values, templateName }) {
  const unknown = [];
  const rendered = template.replace(PLACEHOLDER_RE, (match, name) => {
    if (Object.prototype.hasOwnProperty.call(values, name)) {
      return values[name];
    }
    unknown.push(match);
    return match;
  });

  if (unknown.length > 0) {
    throw new Error(
      `Unknown placeholder(s) in ${templateName} template: ${unknown.join(', ')}. ` +
        `Supported placeholders: ${Object.keys(values).map((name) => `{${name}}`).join(', ')}.`,
    );
  }

  return rendered;
}

function buildFileValues({ filePath, prNumber, scopeStripPrefix = '' }) {
  return {
    file_path: filePath,
    file_name: filePath.slice(filePath.lastIndexOf('/') + 1),
    file_scope: deriveFileScope(filePath, scopeStripPrefix),
    pr_number: String(prNumber ?? ''),
  };
}

function renderPrTitle({ template, filePath, prNumber, scopeStripPrefix = '' }) {
  if (!template || !template.trim()) {
    throw new Error('pr_title template is empty.');
  }

  const rendered = substitutePlaceholders({
    template,
    values: buildFileValues({ filePath, prNumber, scopeStripPrefix }),
    templateName: 'pr_title',
  });

  const title = rendered.replace(/\s+/g, ' ').trim();
  if (!title) {
    throw new Error('pr_title template rendered to an empty title.');
  }
  return title;
}

function buildCommandCommentValues({ filePath, prNumber, splitPrNumber, commenter, scopeStripPrefix = '' }) {
  return {
    ...buildFileValues({ filePath, prNumber, scopeStripPrefix }),
    split_pr_number: String(splitPrNumber ?? ''),
    commenter: String(commenter ?? ''),
  };
}

function validateCommandCommentTemplate(template) {
  if (!template || !template.trim()) {
    throw new Error('comment template is empty.');
  }
  substitutePlaceholders({
    template,
    values: buildCommandCommentValues({ filePath: '', prNumber: '', splitPrNumber: '', commenter: '' }),
    templateName: 'comment',
  });
}

// Unlike renderPrTitle, this preserves newlines so templates can produce
// multi-line comment bodies (e.g. a trigger line plus an attribution line).
function renderCommandComment({ template, filePath, prNumber, splitPrNumber, commenter, scopeStripPrefix = '' }) {
  if (!template || !template.trim()) {
    throw new Error('comment template is empty.');
  }

  const rendered = substitutePlaceholders({
    template,
    values: buildCommandCommentValues({ filePath, prNumber, splitPrNumber, commenter, scopeStripPrefix }),
    templateName: 'comment',
  });

  const body = rendered.trim();
  if (!body) {
    throw new Error('comment template rendered to an empty comment.');
  }
  return body;
}

module.exports = {
  renderPrTitle,
  renderCommandComment,
  validateCommandCommentTemplate,
};
