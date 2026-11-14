/**
 * designs/*.md の front matter（--- で囲まれた key: value）を読む。
 */
const fs = require('node:fs');
const path = require('node:path');

const VALID_STATUS = ['draft', 'ready', 'built'];

function parseFrontMatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    data[m[1]] = m[2].replace(/\s+#.*$/, '').trim();
  }
  return data;
}

/** 構築対象として使えるかを判定し、問題点を返す */
function checkBuildable(meta, categoryCodes) {
  if (!meta) return ['front matter（--- で囲まれたメタ情報）がありません'];
  const problems = [];
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(meta.id || '')) {
    problems.push(`id "${meta.id ?? ''}" は kebab-case で指定してください`);
  }
  if (!meta.title) problems.push('title がありません');
  if (categoryCodes && !categoryCodes.includes(meta.category)) {
    problems.push(
      `category "${meta.category ?? ''}" は config/categories.yml の分類コード（${categoryCodes.join(' / ')}）にしてください`,
    );
  }
  if (!VALID_STATUS.includes(meta.status)) {
    problems.push(
      `status "${meta.status ?? ''}" は ${VALID_STATUS.join(' / ')} のいずれかにしてください`,
    );
  } else if (meta.status === 'draft') {
    problems.push('status が draft です。記入が終わったら ready にしてください');
  }
  return problems;
}

/** designs/ 直下（_ で始まるファイルを除く）と examples/ の設計書を列挙する */
function listDesigns(root) {
  const dir = path.join(root, 'designs');
  const files = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (
        entry.name.endsWith('.md') &&
        !entry.name.startsWith('_') &&
        entry.name !== 'README.md'
      ) {
        files.push(full);
      }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return files.sort().map((file) => ({
    file: path.relative(root, file),
    meta: parseFrontMatter(fs.readFileSync(file, 'utf8')),
  }));
}

module.exports = { parseFrontMatter, checkBuildable, listDesigns, VALID_STATUS };
