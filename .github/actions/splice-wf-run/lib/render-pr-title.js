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

function renderPrTitle({ template, filePath, prNumber, scopeStripPrefix = '' }) {
  if (!template || !template.trim()) {
    throw new Error('pr_title template is empty.');
  }

  const values = {
    file_path: filePath,
    file_name: filePath.slice(filePath.lastIndexOf('/') + 1),
    file_scope: deriveFileScope(filePath, scopeStripPrefix),
    pr_number: String(prNumber ?? ''),
  };

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
      `Unknown placeholder(s) in pr_title template: ${unknown.join(', ')}. ` +
        `Supported placeholders: ${Object.keys(values).map((name) => `{${name}}`).join(', ')}.`,
    );
  }

  const title = rendered.replace(/\s+/g, ' ').trim();
  if (!title) {
    throw new Error('pr_title template rendered to an empty title.');
  }
  return title;
}

module.exports = {
  renderPrTitle,
};
