/**
 * n8n Public API（/api/v1）の小さなクライアント。
 * N8N_API_KEY は環境変数、または secrets/secrets.env から読む（値は表示しない）。
 */
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('./secrets');

const ROOT = path.resolve(__dirname, '..', '..');

function loadApiKey(root = ROOT, env = process.env) {
  if (env.N8N_API_KEY) return env.N8N_API_KEY;
  const file = path.join(root, 'secrets', 'secrets.env');
  if (!fs.existsSync(file)) return null;
  return parseEnv(fs.readFileSync(file, 'utf8')).N8N_API_KEY || null;
}

function defaultBaseUrl(env = process.env) {
  return env.N8N_BASE_URL || `http://localhost:${env.N8N_PORT || 5678}/`;
}

/**
 * @param {{ apiKey: string, baseUrl?: string, fetchFn?: typeof fetch }} options
 */
function createClient({ apiKey, baseUrl = defaultBaseUrl(), fetchFn = fetch }) {
  async function api(method, apiPath) {
    const res = await fetchFn(new URL(`api/v1/${apiPath}`, baseUrl), {
      method,
      headers: { 'X-N8N-API-KEY': apiKey, Accept: 'application/json' },
    });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`${method} /api/v1/${apiPath} → ${res.status} ${text.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    return text ? JSON.parse(text) : {};
  }

  // n8n 2.x 以降は publish / unpublish。古いバージョン（エンドポイントが無い = 404）は activate / deactivate
  async function setPublished(id, publish) {
    const [current, legacy] = publish ? ['publish', 'activate'] : ['unpublish', 'deactivate'];
    try {
      await api('POST', `workflows/${id}/${current}`);
    } catch (err) {
      if (err.status !== 404 && err.status !== 405) throw err;
      await api('POST', `workflows/${id}/${legacy}`);
    }
  }

  /** 公開中なら true。見つからなければ null */
  async function isPublished(id) {
    try {
      return (await api('GET', `workflows/${id}`)).active === true;
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  return { api, setPublished, isPublished };
}

module.exports = { loadApiKey, defaultBaseUrl, createClient };
