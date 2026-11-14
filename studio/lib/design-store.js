/**
 * Workflow Studio: 設計書（designs/*.md）の一覧・読み込み・保存と、対話の返答からの設計書の取り出し。
 */
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const { parseFrontMatter, checkBuildable, listDesigns } = require('../../scripts/lib/design-doc');

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TEMPLATE_FILE = 'designs/_TEMPLATE.md';

function loadCategories(root) {
  const file = path.join(root, 'config', 'categories.yml');
  if (!fs.existsSync(file)) return [];
  return (YAML.parse(fs.readFileSync(file, 'utf8')).categories || []).map(({ code, name }) => ({
    code,
    name,
  }));
}

/** 設計書の一覧。構築できない理由（problems）も付ける */
function listAll(root) {
  const codes = loadCategories(root).map((c) => c.code);
  return listDesigns(root).map(({ file, meta }) => ({
    file,
    id: meta?.id ?? null,
    title: meta?.title ?? null,
    category: meta?.category ?? null,
    status: meta?.status ?? null,
    example: file.startsWith('designs/examples/'),
    problems: checkBuildable(meta, codes),
  }));
}

/** 一覧にある設計書かテンプレートだけを読む（任意のパスは読まない） */
function readDesign(root, file) {
  const allowed = new Set([TEMPLATE_FILE, ...listDesigns(root).map((d) => d.file)]);
  if (!allowed.has(file)) throw Object.assign(new Error(`not found: ${file}`), { status: 404 });
  return fs.readFileSync(path.join(root, file), 'utf8');
}

/**
 * 保存先を決めて内容を検証する。
 * - file を指定（既存の設計書の編集）: 一覧にあるファイルだけ
 * - file なし（新規）: designs/<front matter の id>.md。既にある場合は overwrite が必要
 * @returns {{ file: string, errors: string[], problems: string[] }}
 *   errors があると保存しない。problems は構築できない理由（保存はできる）
 */
function planSave(root, content, { file, overwrite = false } = {}) {
  const errors = [];
  const meta = parseFrontMatter(content);
  if (!meta) errors.push('front matter（--- で囲まれたメタ情報）がありません');
  else if (!ID_PATTERN.test(meta.id || '')) {
    errors.push(`id "${meta.id ?? ''}" は英小文字・数字・ハイフン（kebab-case）にしてください`);
  }

  let target = file;
  if (file) {
    const existing = new Set(listDesigns(root).map((d) => d.file));
    if (!existing.has(file)) errors.push(`${file} は既存の設計書ではありません`);
  } else if (meta && ID_PATTERN.test(meta.id || '')) {
    target = `designs/${meta.id}.md`;
    if (fs.existsSync(path.join(root, target)) && !overwrite) {
      errors.push(`${target} は既にあります（上書きする場合は確認してください）`);
    }
  }

  const codes = loadCategories(root).map((c) => c.code);
  return { file: target || null, errors, problems: meta ? checkBuildable(meta, codes) : [] };
}

function saveDesign(root, content, options = {}) {
  const plan = planSave(root, content, options);
  if (plan.errors.length === 0) {
    const text = content.endsWith('\n') ? content : `${content}\n`;
    fs.writeFileSync(path.join(root, plan.file), text);
  }
  return plan;
}

/**
 * Claude の返答から設計書の下書きを取り出す（最後のものを使う）。
 * 設計書の中に ``` があるため、外側は ~~~markdown か ````markdown で囲まれている前提。
 */
function extractDesignDraft(text) {
  if (typeof text !== 'string') return null;
  const patterns = [
    /^~~~(?:markdown|md)[^\n]*\n([\s\S]*?)\n~~~\s*$/gm,
    /^````(?:markdown|md)[^\n]*\n([\s\S]*?)\n````\s*$/gm,
  ];
  let found = null;
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      if (found === null || m.index > found.index) found = { index: m.index, body: m[1] };
    }
  }
  if (!found) return null;
  const content = found.body.replace(/^\s+/, '');
  const meta = parseFrontMatter(content);
  return meta ? { content, meta } : null;
}

module.exports = {
  TEMPLATE_FILE,
  loadCategories,
  listAll,
  readDesign,
  planSave,
  saveDesign,
  extractDesignDraft,
};
