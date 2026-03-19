const fs = require('fs');

const BRIDGE_OVERRIDE_KEYS = [
  'pr_number',
  'review_comment_id',
  'file_path',
  'commenter_login',
  'pr_author_login',
  'base_ref',
  'base_repo',
  'head_repo',
  'head_sha',
  'head_ref',
  'head_label',
  'committer',
  'author',
];

function parseBridgeOverride(raw) {
  let data;
  try {
    data = JSON.parse(raw || '');
  } catch (error) {
    throw new Error(`Could not parse bridge_override_json: ${error.message}`);
  }

  if (!data || Array.isArray(data) || typeof data !== 'object') {
    throw new Error('bridge_override_json must be a JSON object.');
  }

  return data;
}

function buildBridgeOverrideOutputLines(data) {
  const lines = [];
  for (const key of BRIDGE_OVERRIDE_KEYS) {
    const value = data[key];
    if (value === undefined || value === null) continue;
    lines.push(`${key}=${String(value)}`);
  }
  return lines;
}

function runFromEnvironment(env = process.env) {
  const data = parseBridgeOverride(env.BRIDGE_OVERRIDE_JSON || '');
  const outputPath = env.GITHUB_OUTPUT;
  const lines = buildBridgeOverrideOutputLines(data);

  if (lines.length > 0) {
    fs.appendFileSync(outputPath, `${lines.join('\n')}\n`);
  }
}

if (require.main === module) {
  try {
    runFromEnvironment();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  BRIDGE_OVERRIDE_KEYS,
  buildBridgeOverrideOutputLines,
  parseBridgeOverride,
  runFromEnvironment,
};
