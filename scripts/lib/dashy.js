/**
 * Dashy の conf.yml を、config/dashboard.yml・config/categories.yml・workflows/*.json から組み立てる。
 * ファイル I/O は呼び出し側（scripts/dashy-sync.js）で行い、ここは純粋関数のみ。
 */

const CATEGORY_CODE = /^[A-Z][A-Z0-9]{1,4}$/;
const DASHY_TITLE_MAX = 18; // Dashy の item.title の最大長

function getTagNames(workflow) {
  return (workflow.tags || [])
    .map((t) => (typeof t === 'string' ? t : t && t.name))
    .filter((t) => typeof t === 'string' && t !== '');
}

/** ワークフローのタグのうち、分類コードに該当するものを返す */
function getCategoryCodes(workflow, codes) {
  return getTagNames(workflow).filter((t) => codes.includes(t));
}

/** 分類定義の妥当性チェック */
function validateCategories(categories) {
  const errors = [];
  const seen = new Set();
  (categories || []).forEach((c, i) => {
    if (!c || !CATEGORY_CODE.test(c.code || '')) {
      errors.push(
        `categories[${i}]: code "${c && c.code}" は英大文字で始まる 2〜5 文字にしてください`,
      );
    } else if (seen.has(c.code)) {
      errors.push(`categories[${i}]: code "${c.code}" が重複しています`);
    } else {
      seen.add(c.code);
    }
    if (!c || typeof c.name !== 'string' || c.name === '') {
      errors.push(`categories[${i}]: name がありません`);
    }
  });
  return errors;
}

/** Dashy の 18 文字制限に収まる短いタイトル（括弧以降の補足は落とす） */
function shortTitle(name, max = DASHY_TITLE_MAX) {
  const base =
    String(name)
      .replace(/\s*[(（].*$/, '')
      .trim() || String(name);
  const chars = [...base];
  return chars.length <= max ? base : `${chars.slice(0, max - 1).join('')}…`;
}

/** 文字列中の {key} を links の値で置き換える（オブジェクト・配列は再帰） */
function fillLinks(value, links) {
  if (typeof value === 'string') {
    return value.replace(/\{(\w+)\}/g, (m, key) => (key in links ? String(links[key]) : m));
  }
  if (Array.isArray(value)) return value.map((v) => fillLinks(v, links));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillLinks(v, links)]));
  }
  return value;
}

function webhookEndpoints(workflow, n8nBaseUrl) {
  const base = n8nBaseUrl.replace(/\/+$/, '');
  return (workflow.nodes || [])
    .filter((n) => n.type === 'n8n-nodes-base.webhook' && n.parameters && n.parameters.path)
    .map((n) => {
      const path = String(n.parameters.path).replace(/^\/+/, '');
      return {
        method: (n.parameters.httpMethod || 'GET').toUpperCase(),
        path,
        url: `${base}/webhook/${path}`,
      };
    });
}

/** Form Trigger のフォーム URL（/form/<path>）。path は options.path（v2.2 以降）か parameters.path */
function formEndpoints(workflow, n8nBaseUrl) {
  const base = n8nBaseUrl.replace(/\/+$/, '');
  return (workflow.nodes || [])
    .filter((n) => n.type === 'n8n-nodes-base.formTrigger' && n.parameters)
    .map((n) => (n.parameters.options && n.parameters.options.path) || n.parameters.path)
    .filter(Boolean)
    .map((p) => {
      const path = String(p).replace(/^\/+/, '');
      return { path, url: `${base}/form/${path}` };
    });
}

/**
 * @param {object} entry
 * @param {string} entry.name ファイル名（拡張子なし）
 * @param {object} entry.workflow ワークフロー JSON
 * @param {boolean} entry.hasSpec doc/specifications/<name>.md があるか
 * @param {string|null} entry.designPath 設計書のリポジトリ相対パス
 * @param {string|null} entry.summary 説明文（設計書の title など）
 */
function buildItem(entry, code, links) {
  const { name, workflow, hasSpec, designPath, summary } = entry;
  const repo = `${links.repoUrl}/blob/${links.repoBranch}`;
  const endpoints = webhookEndpoints(workflow, links.n8nBaseUrl);
  const forms = formEndpoints(workflow, links.n8nBaseUrl);
  const editorUrl = workflow.id
    ? `${links.n8nBaseUrl.replace(/\/+$/, '')}/workflow/${workflow.id}`
    : links.n8nBaseUrl;

  const description = [
    `[${code}] ${workflow.name}`,
    summary && summary !== workflow.name ? summary : null,
    ...endpoints.map((e) => `${e.method} /webhook/${e.path}`),
    ...forms.map((f) => `FORM /form/${f.path}`),
  ]
    .filter(Boolean)
    .join(' | ');

  // カード本体は普通のリンクにする（subItems を付けると Dashy はアイコンの並びとして描き、
  // カード自体がリンクでなくなるため）。クリックでワークフローを実行する:
  // - フォームがあればフォームを開く
  // - 無ければ Workflow Studio の実行ページ（Webhook を送る。POST はリンクだけでは送れないため）
  const runUrl =
    links.studioUrl && workflow.id
      ? `${links.studioUrl.replace(/\/+$/, '')}/run?id=${encodeURIComponent(workflow.id)}`
      : editorUrl;
  const item = {
    title: shortTitle(workflow.name),
    description,
    url: forms.length > 0 ? forms[0].url : runUrl,
    icon: forms.length > 0 ? 'fas fa-clipboard-list' : 'fas fa-play-circle',
    tags: [code, ...endpoints.map((e) => e.method), ...(forms.length > 0 ? ['FORM'] : [])],
  };

  // 付随するリンク（編集画面・URL のコピー・仕様書・設計書）は「リンク」セクションにまとめる
  const linkGroup = {
    title: shortTitle(workflow.name),
    description: `[${code}] ${workflow.name} のリンク`,
    subItems: [
      { title: 'n8n で編集', url: editorUrl, icon: 'fas fa-pen' },
      ...forms.map((f) => ({
        title: `フォーム /form/${f.path}`,
        url: f.url,
        icon: 'fas fa-clipboard-list',
      })),
      ...endpoints.map((e) => ({
        title: `${e.method} ${e.url} をコピー`,
        url: e.url,
        icon: 'fas fa-copy',
        target: 'clipboard',
      })),
      ...(hasSpec
        ? [
            {
              title: '仕様書',
              url: `${repo}/doc/specifications/${name}.md`,
              icon: 'fas fa-file-alt',
            },
          ]
        : []),
      ...(designPath
        ? [{ title: '設計書', url: `${repo}/${designPath}`, icon: 'fas fa-drafting-compass' }]
        : []),
    ],
  };
  return { item, linkGroup };
}

/**
 * @param {{ dashboard: object, categories: object[], workflows: object[] }} input
 * @returns {{ config: object, warnings: string[] }}
 */
function buildDashyConfig({ dashboard, categories, workflows }) {
  const links = dashboard.links || {};
  const codes = categories.map((c) => c.code);
  const warnings = [];
  const byCode = new Map(codes.map((c) => [c, []]));
  const uncategorized = [];
  const linkGroups = [];

  for (const entry of [...workflows].sort((a, b) =>
    a.workflow.name.localeCompare(b.workflow.name),
  )) {
    const found = getCategoryCodes(entry.workflow, codes);
    if (found.length !== 1) {
      warnings.push(
        `${entry.name}: 分類コードのタグが ${found.length} 個です（ちょうど 1 個にしてください）`,
      );
      const built = buildItem(entry, found[0] || '未分類', links);
      uncategorized.push(built.item);
      linkGroups.push(built.linkGroup);
      continue;
    }
    const built = buildItem(entry, found[0], links);
    byCode.get(found[0]).push(built.item);
    linkGroups.push(built.linkGroup);
  }

  const sections = [];
  if (dashboard.toolsSection) sections.push(fillLinks(dashboard.toolsSection, links));
  for (const category of categories) {
    const items = byCode.get(category.code);
    if (items.length === 0) continue;
    sections.push({
      name: `[${category.code}] ${category.name}`,
      icon: category.icon || 'fas fa-folder',
      items,
    });
  }
  if (uncategorized.length > 0) {
    sections.push({ name: '未分類', icon: 'fas fa-question-circle', items: uncategorized });
  }
  if (linkGroups.length > 0) {
    sections.push({
      name: 'リンク・資料',
      icon: 'fas fa-link',
      displayData: { collapsed: true },
      items: linkGroups,
    });
  }

  return {
    config: {
      pageInfo: fillLinks(dashboard.pageInfo || { title: 'n8n Workflow Portal' }, links),
      appConfig: fillLinks(dashboard.appConfig || {}, links),
      sections,
    },
    warnings,
  };
}

module.exports = {
  CATEGORY_CODE,
  getTagNames,
  getCategoryCodes,
  validateCategories,
  shortTitle,
  fillLinks,
  webhookEndpoints,
  formEndpoints,
  buildDashyConfig,
};
