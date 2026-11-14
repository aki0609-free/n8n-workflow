#!/usr/bin/env node
/**
 * 設計書まわりのコマンド。
 *
 *   npm run design:list                              設計書の一覧と status
 *   npm run design:build -- designs/<id>.md          Claude Code を起動して構築（対話モード・推奨）
 *   npm run design:build -- designs/<id>.md --auto   非対話モードで最後まで自動実行
 *   npm run design:build                             ready の設計書が 1 つだけならそれを構築
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const YAML = require('yaml');
const { parseFrontMatter, checkBuildable, listDesigns } = require('./lib/design-doc');
const { buildArgs, childEnv } = require('./lib/claude-cli');

const ROOT = path.resolve(__dirname, '..');
const [command, ...rest] = process.argv.slice(2);

function list() {
  const designs = listDesigns(ROOT);
  if (designs.length === 0) {
    console.log('設計書がありません。designs/_TEMPLATE.md をコピーして作成してください。');
    return 0;
  }
  const icon = { draft: '✎', ready: '▶', built: '✓' };
  for (const { file, meta } of designs) {
    const status = meta?.status ?? '?';
    console.log(
      `${icon[status] ?? '?'} ${status.padEnd(6)} ${file.padEnd(40)} ${meta?.title ?? ''}`,
    );
  }
  return 0;
}

function resolveTarget(file) {
  if (file) return file;
  const ready = listDesigns(ROOT).filter(
    (d) => d.meta?.status === 'ready' && !d.file.startsWith('designs/examples/'),
  );
  if (ready.length === 1) return ready[0].file;
  console.error(
    ready.length === 0
      ? 'status: ready の設計書がありません。ファイルを指定してください: npm run design:build -- designs/<id>.md'
      : `ready の設計書が複数あります。どれか指定してください:\n${ready.map((d) => `  ${d.file}`).join('\n')}`,
  );
  return null;
}

function build(args) {
  const auto = args.includes('--auto');
  const target = resolveTarget(args.find((a) => !a.startsWith('--')));
  if (!target) return Promise.resolve(1);

  const abs = path.resolve(ROOT, target);
  if (!fs.existsSync(abs)) {
    console.error(`設計書が見つかりません: ${target}`);
    return Promise.resolve(1);
  }
  const rel = path.relative(ROOT, abs);
  const { categories = [] } = YAML.parse(
    fs.readFileSync(path.join(ROOT, 'config', 'categories.yml'), 'utf8'),
  );
  const problems = checkBuildable(
    parseFrontMatter(fs.readFileSync(abs, 'utf8')),
    categories.map((c) => c.code),
  );
  if (problems.length > 0) {
    console.error(`${rel} はまだ構築できません:`);
    for (const p of problems) console.error(`  - ${p}`);
    return Promise.resolve(1);
  }

  // --auto の許可ツールとシステムプロンプトは scripts/lib/claude-cli.js で管理する
  const claudeArgs = auto ? buildArgs(rel) : [`/build-from-design ${rel}`];

  console.log(`▶ Claude Code で ${rel} を構築します（${auto ? '非対話モード' : '対話モード'}）`);
  return new Promise((resolve) => {
    const child = spawn('claude', claudeArgs, { cwd: ROOT, stdio: 'inherit', env: childEnv() });
    child.on('error', (err) => {
      console.error(
        err.code === 'ENOENT'
          ? 'claude コマンドが見つかりません。Claude Code をインストールしてください: https://docs.claude.com/claude-code'
          : err.message,
      );
      resolve(1);
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

const commands = { list: () => Promise.resolve(list()), build: () => build(rest) };
if (!commands[command]) {
  console.error('usage: node scripts/design.js <list|build [designs/<id>.md] [--auto]>');
  process.exit(1);
}
commands[command]().then((code) => process.exit(code));
