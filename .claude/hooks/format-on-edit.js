#!/usr/bin/env node
/**
 * PostToolUse フック: Write / Edit / MultiEdit の直後に編集ファイルを自動フォーマットする。
 *   - .js .cjs .mjs .jsx .ts .tsx … Prettier（node_modules/.bin/prettier）
 *   - .py                         … Ruff（ruff check --fix → ruff format）
 *
 * フォーマッタが未インストールの場合はスキップする（編集自体は止めない）。
 * フォーマッタがエラーを返した場合は exit 2 で stderr を Claude に返し、修正を促す。
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const JS_EXTS = new Set(['.js', '.cjs', '.mjs', '.jsx', '.ts', '.tsx']);

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function which(cmd) {
  const r = spawnSync('command', ['-v', cmd], { shell: true, encoding: 'utf8' });
  return r.status === 0 ? cmd : null;
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: projectDir, encoding: 'utf8' });
  return { ok: r.status === 0, output: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}

function resolveRuff() {
  const venvRuff = path.join(projectDir, '.venv', 'bin', 'ruff');
  if (fs.existsSync(venvRuff)) return [venvRuff, []];
  if (which('ruff')) return ['ruff', []];
  if (which('uvx')) return ['uvx', ['ruff']];
  return null;
}

function main() {
  let input;
  try {
    input = JSON.parse(readStdin() || '{}');
  } catch {
    return 0;
  }
  const filePath = input.tool_input && input.tool_input.file_path;
  if (!filePath || !fs.existsSync(filePath)) return 0;

  const rel = path.relative(projectDir, filePath);
  if (rel.startsWith('..') || rel.split(path.sep).includes('node_modules')) return 0;

  const ext = path.extname(filePath).toLowerCase();

  if (JS_EXTS.has(ext)) {
    const prettier = path.join(projectDir, 'node_modules', '.bin', 'prettier');
    if (!fs.existsSync(prettier)) {
      console.error('[format-on-edit] prettier not installed; run `npm install`. Skipped.');
      return 0;
    }
    const r = run(prettier, ['--write', '--ignore-unknown', filePath]);
    if (!r.ok) {
      console.error(`[format-on-edit] prettier failed for ${rel}:\n${r.output}`);
      return 2;
    }
    return 0;
  }

  if (ext === '.py') {
    const ruff = resolveRuff();
    if (!ruff) {
      console.error('[format-on-edit] ruff not found; run `pip install -r requirements-dev.txt`. Skipped.');
      return 0;
    }
    const [cmd, prefix] = ruff;
    const lint = run(cmd, [...prefix, 'check', '--fix', '--quiet', filePath]);
    const fmt = run(cmd, [...prefix, 'format', '--quiet', filePath]);
    if (!fmt.ok) {
      console.error(`[format-on-edit] ruff format failed for ${rel}:\n${fmt.output}`);
      return 2;
    }
    if (!lint.ok) {
      console.error(`[format-on-edit] ruff check reported issues in ${rel}:\n${lint.output}`);
      return 2;
    }
  }
  return 0;
}

process.exit(main());
