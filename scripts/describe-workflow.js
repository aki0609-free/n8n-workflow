#!/usr/bin/env node
/**
 * ワークフロー JSON の構造情報（ノード・接続・Mermaid 図・Credential 参照など）を出力する。
 * 仕様書生成（n8n-spec-writer エージェント）の一次情報として使う。
 *
 *   node scripts/describe-workflow.js workflows/foo.json            # Markdown
 *   node scripts/describe-workflow.js workflows/foo.json --json     # JSON
 */
const fs = require('node:fs');
const path = require('node:path');
const { describeWorkflow, toMarkdown } = require('./lib/workflow-describer');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const files = args.filter((a) => !a.startsWith('--'));

if (files.length === 0) {
  console.error('usage: node scripts/describe-workflow.js <workflow.json> [...] [--json]');
  process.exit(1);
}

const ROOT = path.resolve(__dirname, '..');
const outputs = files.map((file) => {
  const abs = path.resolve(file);
  const description = describeWorkflow(JSON.parse(fs.readFileSync(abs, 'utf8')));
  return { file: path.relative(ROOT, abs), description };
});

if (asJson) {
  console.log(JSON.stringify(outputs.length === 1 ? outputs[0] : outputs, null, 2));
} else {
  console.log(outputs.map((o) => toMarkdown(o.description, o.file)).join('\n\n---\n\n'));
}
