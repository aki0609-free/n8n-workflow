#!/usr/bin/env node
/**
 * PostToolUse フック: ワークフロー JSON / Code ノード / Python ロジックが編集されたら、
 * 仕様書（doc/specifications/）の更新が必要であることを Claude にコンテキストとして伝える。
 * 編集はブロックしない（常に exit 0）。
 */
const fs = require('node:fs');
const path = require('node:path');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

let input = {};
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
} catch {
  process.exit(0);
}

const filePath = input.tool_input && input.tool_input.file_path;
if (!filePath) process.exit(0);

const rel = path.relative(projectDir, filePath).split(path.sep).join('/');
const watched =
  /^workflows\/[^/]+\.json$/.test(rel) ||
  /^src\/javascript\/code-nodes\/.+\.(js|ts)$/.test(rel) ||
  /^src\/python\/.+\.py$/.test(rel);

if (!watched) process.exit(0);

const message =
  `[spec-reminder] ${rel} が変更されました。作業の区切りで n8n-spec-writer サブエージェントを呼び出し、` +
  `doc/specifications/ の該当仕様書を更新してください（対象ファイル: ${rel}）。`;

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: message },
  }),
);
process.exit(0);
