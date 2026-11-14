/**
 * Workflow Studio: Dashy のカードから開く「実行ページ」用。
 * workflows/*.json からトリガーの情報を読み、Webhook を n8n の本番 URL に送る。
 *
 * - 呼び出し先は workflows/*.json に書かれた Webhook のパスだけ（任意の URL には送らない）
 * - 本番 URL（/webhook/<path>）は、n8n でワークフローを公開（有効化）している場合だけ使える
 * - Schedule / Manual トリガーは、n8n に外部から実行する API が無いため実行できない
 */
const fs = require('node:fs');
const path = require('node:path');

const WEBHOOK = 'n8n-nodes-base.webhook';
const FORM = 'n8n-nodes-base.formTrigger';
const BODYLESS = new Set(['GET', 'HEAD', 'DELETE']);

function isTrigger(type) {
  return type === WEBHOOK || /trigger$/i.test(type);
}

function readCases(root, name) {
  const file = path.join(root, 'tests', 'workflows', `${name}.cases.json`);
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')).cases || [];
  } catch {
    return [];
  }
}

/** ワークフロー 1 件分の、実行ページに出す情報 */
function describeRunnable(root, file, workflow) {
  const name = path.basename(file, '.json');
  const cases = readCases(root, name);
  const nodes = workflow.nodes || [];
  const webhooks = nodes
    .filter((n) => n.type === WEBHOOK && n.parameters && n.parameters.path)
    .map((n) => {
      const p = String(n.parameters.path).replace(/^\/+/, '');
      const method = (n.parameters.httpMethod || 'GET').toUpperCase();
      const example = cases.find(
        (c) => c.request && String(c.request.path || '').replace(/^\/+/, '') === p,
      );
      return {
        node: n.name,
        method,
        path: p,
        exampleBody:
          example && example.request.body !== undefined && !BODYLESS.has(method)
            ? example.request.body
            : null,
        exampleName: example ? example.name : null,
      };
    });
  const forms = nodes
    .filter((n) => n.type === FORM && n.parameters)
    .map((n) => (n.parameters.options && n.parameters.options.path) || n.parameters.path)
    .filter(Boolean)
    .map((p) => String(p).replace(/^\/+/, ''));
  const otherTriggers = nodes
    .filter((n) => isTrigger(n.type) && n.type !== WEBHOOK && n.type !== FORM)
    .map((n) => ({ node: n.name, type: n.type }));
  return {
    id: workflow.id || null,
    name: workflow.name,
    file: `workflows/${path.basename(file)}`,
    webhooks,
    forms,
    otherTriggers,
  };
}

function findWorkflow(root, id) {
  const dir = path.join(root, 'workflows');
  if (!fs.existsSync(dir)) return null;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    let workflow;
    try {
      workflow = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch {
      continue;
    }
    if (workflow.id === id) return describeRunnable(root, f, workflow);
  }
  return null;
}

/**
 * Webhook を n8n の本番 URL に送る。
 * @returns {Promise<{ url, status, ok, contentType, body, hint }>}
 */
async function runWebhook(info, index, { body, n8nUrl, fetchFn = fetch, timeoutMs = 120000 }) {
  const hook = info.webhooks[index];
  if (!hook) throw Object.assign(new Error('webhook not found'), { status: 404 });
  const url = `${n8nUrl.replace(/\/+$/, '')}/webhook/${hook.path}`;
  const init = { method: hook.method, headers: {}, signal: AbortSignal.timeout(timeoutMs) };
  if (!BODYLESS.has(hook.method) && body !== undefined && body !== null) {
    init.headers['Content-Type'] = 'application/json';
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  let res;
  try {
    res = await fetchFn(url, init);
  } catch (err) {
    return {
      url,
      status: 0,
      ok: false,
      contentType: null,
      body: '',
      hint: `n8n に接続できませんでした（${err.message}）。npm run up で起動しているか確認してください。`,
    };
  }
  const text = await res.text();
  const notRegistered = res.status === 404 && /not registered|is not active|not found/i.test(text);
  return {
    url,
    status: res.status,
    ok: res.ok,
    contentType: res.headers.get('content-type'),
    body: text.slice(0, 100000),
    hint: notRegistered
      ? 'このワークフローは n8n で公開（有効化）されていないため、本番 URL が使えません。n8n の編集画面で「Publish」してから、もう一度実行してください。'
      : null,
  };
}

module.exports = { describeRunnable, findWorkflow, runWebhook };
