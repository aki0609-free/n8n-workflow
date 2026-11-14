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

const ROOT = path.resolve(__dirname, '..');
const [command, ...rest] = process.argv.slice(2);

// --auto（非対話モード）で Claude に許可するツール。.claude/settings.json の deny は引き続き有効
const AUTO_ALLOWED_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'Glob',
  'Grep',
  'Agent',
  'Skill',
  'Bash(npm run:*)',
  'Bash(npm test:*)',
  'Bash(npm test)',
  'Bash(node scripts/validate-workflows.js:*)',
  'Bash(node scripts/sync-code-nodes.js:*)',
  'Bash(node scripts/describe-workflow.js:*)',
  'Bash(node scripts/n8n-test-run.js:*)',
  'Bash(node -e:*)',
  'Bash(bash scripts/n8n-import.sh:*)',
  'Bash(bash scripts/n8n-credentials.sh:*)',
  'Bash(.venv/bin/ruff:*)',
  'Bash(.venv/bin/pytest:*)',
  'Bash(docker compose ps:*)',
  'Bash(docker compose up:*)',
  'Bash(docker compose logs:*)',
  'Bash(curl -sf http://localhost:*)',
  'Bash(git status:*)',
  'Bash(git diff:*)',
  'Bash(date:*)',
];

const AUTO_SYSTEM_PROMPT = [
  'あなたは非対話モード（claude -p）で実行されています。ユーザーに質問することはできません。',
  '- 設計書に未決事項や不足があり構築できない場合は、質問を設計書の「11. 未決事項」に追記して終了する。',
  '- secrets:check で未入力のキーがある場合は、Phase 2〜3 まで進めたうえで、記入が必要なキーを報告して終了する。',
  '- 最後に、実施内容・テスト結果・ユーザーが行うべきことを簡潔に出力する。',
].join('\n');

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

  const prompt = `/build-from-design ${rel}`;
  const claudeArgs = auto
    ? [
        '-p',
        prompt,
        '--permission-mode',
        'acceptEdits',
        '--allowedTools',
        ...AUTO_ALLOWED_TOOLS,
        '--append-system-prompt',
        AUTO_SYSTEM_PROMPT,
      ]
    : [prompt];

  console.log(`▶ Claude Code で ${rel} を構築します（${auto ? '非対話モード' : '対話モード'}）`);
  return new Promise((resolve) => {
    const child = spawn('claude', claudeArgs, { cwd: ROOT, stdio: 'inherit' });
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
