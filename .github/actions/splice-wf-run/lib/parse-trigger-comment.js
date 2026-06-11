// Trigger grammar: a line starting with `splice-bot` (case-insensitive, no
// leading whitespace), then `splice-bot <keyword> [args...]`; lines after the
// trigger line are free text passed along as extra comment.
//
// This module is the source of truth for everything after the prefix. The
// unprivileged trigger workflow (splice.yaml) applies the same prefix match,
// but only to decide whether to emit a bridge artifact; the privileged stage
// re-fetches the comment body and parses it here, so grammar changes take
// effect for all open PRs without waiting for their merge commits to pick up
// a newer trigger workflow.
function parseTriggerComment(body) {
  const bodyLines = String(body ?? '').split(/\r?\n/);
  const triggerLineIndex = bodyLines.findIndex((line) => /^splice-bot\b/i.test(line));
  if (triggerLineIndex < 0) {
    return { found: false, keyword: '', args: '', extraText: '' };
  }

  const triggerTokens = bodyLines[triggerLineIndex]
    .replace(/^splice-bot\b/i, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return {
    found: true,
    keyword: (triggerTokens[0] || '').toLowerCase(),
    args: triggerTokens.slice(1).join(' ').toLowerCase(),
    extraText: bodyLines.slice(triggerLineIndex + 1).join('\n').trim(),
  };
}

module.exports = { parseTriggerComment };
