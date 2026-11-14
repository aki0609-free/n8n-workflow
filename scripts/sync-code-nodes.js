#!/usr/bin/env node
/**
 * src/javascript/code-nodes/ のソースを workflows/*.json の Code ノードへ埋め込む。
 *   npm run sync:code         … 埋め込みを更新して保存
 *   npm run sync:code:check   … 差分があれば exit 1（CI 用）
 */
const fs = require('node:fs');
const path = require('node:path');
const { syncWorkflow } = require('./lib/code-node-sync');

const ROOT = path.resolve(__dirname, '..');
const WORKFLOW_DIR = path.join(ROOT, 'workflows');
const checkOnly = process.argv.includes('--check');

function readSource(relPath) {
  const abs = path.resolve(ROOT, relPath);
  if (!abs.startsWith(ROOT + path.sep)) {
    throw new Error(`@source path escapes repository: ${relPath}`);
  }
  return fs.readFileSync(abs, 'utf8');
}

const files = fs.existsSync(WORKFLOW_DIR)
  ? fs.readdirSync(WORKFLOW_DIR).filter((f) => f.endsWith('.json'))
  : [];

let outdated = 0;
for (const file of files.sort()) {
  const abs = path.join(WORKFLOW_DIR, file);
  const workflow = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const changed = syncWorkflow(workflow, readSource);
  if (changed.length === 0) continue;

  outdated += changed.length;
  for (const c of changed) {
    console.log(
      `${checkOnly ? '✗ outdated' : '↻ synced'}: workflows/${file} › "${c.name}" ← ${c.source}`,
    );
  }
  if (!checkOnly) {
    fs.writeFileSync(abs, `${JSON.stringify(workflow, null, 2)}\n`);
  }
}

if (checkOnly && outdated > 0) {
  console.error('\nCode nodes are out of date. Run `npm run sync:code` and commit the result.');
  process.exit(1);
}
console.log(outdated === 0 ? 'All Code nodes are up to date.' : `Synced ${outdated} Code node(s).`);
