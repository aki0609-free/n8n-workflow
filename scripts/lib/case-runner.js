/**
 * ワークフローのテストケース（tests/workflows/<name>.cases.json）を実行・判定する。
 * fetch を注入できるようにして、単体テストでは HTTP を発生させない。
 */

/**
 * expected が actual の部分集合かを判定し、不一致のパスを返す。
 * - オブジェクト: expected に書いたキーだけ比較
 * - 配列: 長さ一致 + 要素ごとに部分一致
 * - その他: 厳密等価
 */
function diffSubset(actual, expected, pathLabel = '$') {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return [`${pathLabel}: expected array`];
    if (actual.length !== expected.length) {
      return [`${pathLabel}: expected length ${expected.length}, got ${actual.length}`];
    }
    return expected.flatMap((e, i) => diffSubset(actual[i], e, `${pathLabel}[${i}]`));
  }
  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) {
      return [`${pathLabel}: expected object`];
    }
    return Object.entries(expected).flatMap(([k, v]) =>
      k in actual ? diffSubset(actual[k], v, `${pathLabel}.${k}`) : [`${pathLabel}.${k}: missing`],
    );
  }
  return Object.is(actual, expected)
    ? []
    : [`${pathLabel}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`];
}

function buildRequest(testCase, baseUrl) {
  const req = testCase.request || {};
  if (!req.path) throw new Error(`case "${testCase.name}": request.path is required`);
  const url = new URL(`webhook/${req.path.replace(/^\/+/, '')}`, baseUrl.replace(/\/?$/, '/'));
  for (const [k, v] of Object.entries(req.query || {})) url.searchParams.set(k, String(v));
  const method = (req.method || 'POST').toUpperCase();
  const headers = { ...(req.headers || {}) };
  let body;
  if (req.body !== undefined && method !== 'GET' && method !== 'HEAD') {
    body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json';
    }
  }
  return { url: url.toString(), init: { method, headers, body } };
}

async function runCase(testCase, { baseUrl, fetchFn = fetch, timeoutMs = 30000 }) {
  const { url, init } = buildRequest(testCase, baseUrl);
  const expect = testCase.expect || {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    const errors = [];
    const expectedStatus = expect.status ?? 200;
    if (res.status !== expectedStatus) {
      errors.push(`status: expected ${expectedStatus}, got ${res.status}`);
    }
    if (expect.json !== undefined) {
      if (json === undefined) errors.push('body: expected JSON response');
      else errors.push(...diffSubset(json, expect.json));
    }
    if (expect.textContains !== undefined && !text.includes(expect.textContains)) {
      errors.push(`body: expected to contain ${JSON.stringify(expect.textContains)}`);
    }
    return {
      name: testCase.name,
      ok: errors.length === 0,
      errors,
      status: res.status,
      body: text.slice(0, 2000),
    };
  } catch (err) {
    return { name: testCase.name, ok: false, errors: [`request failed: ${err.message}`] };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { diffSubset, buildRequest, runCase };
