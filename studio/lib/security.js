/**
 * Workflow Studio: アクセス制限。
 * Studio は Claude にリポジトリを書き換えさせるため、このマシンのブラウザからの操作だけを受け付ける。
 * - Host ヘッダー: localhost / 127.0.0.1 のみ（DNS リバインディング対策）
 *   Dashy コンテナからの死活確認（host.docker.internal）は GET の / と /api/health だけ許可
 * - 書き込み系（POST / PUT / DELETE）: Origin が Studio 自身で、Content-Type が application/json のもの
 *   （ほかのサイトからのリクエストを拒否する）
 */

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const STATUS_PATHS = new Set(['/', '/api/health']);

function hostName(hostHeader) {
  if (typeof hostHeader !== 'string') return null;
  const m = hostHeader
    .trim()
    .toLowerCase()
    .match(/^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/);
  return m ? { name: m[1], port: m[2] ? Number(m[2]) : 80 } : null;
}

/** @returns {string | null} 拒否する理由（許可するなら null） */
function checkRequest({ method, url, headers }, port) {
  const host = hostName(headers.host);
  const pathname = (url || '/').split('?')[0];
  if (!host || host.port !== port) return 'invalid host';
  const local = LOCAL_HOSTS.includes(host.name);
  if (!local) {
    const statusCheck =
      host.name === 'host.docker.internal' && method === 'GET' && STATUS_PATHS.has(pathname);
    if (!statusCheck) return 'invalid host';
  }
  if (!['GET', 'HEAD'].includes(method)) {
    const origin = headers.origin;
    const allowed = LOCAL_HOSTS.map((h) => `http://${h}:${port}`);
    if (!origin || !allowed.includes(origin.toLowerCase())) return 'invalid origin';
    if (!String(headers['content-type'] || '').startsWith('application/json')) {
      return 'content-type must be application/json';
    }
  }
  return null;
}

module.exports = { checkRequest, hostName };
