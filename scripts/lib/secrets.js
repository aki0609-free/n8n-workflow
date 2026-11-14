/**
 * secrets/secrets.env と config/credentials.template.json を扱うロジック。
 * 秘密の「値」はログに出さない。キー名だけを返す・表示する。
 */

const PLACEHOLDER = /\$\{([A-Z][A-Z0-9_]*)(\?)?(?::(number|boolean))?\}/g;
const WHOLE_PLACEHOLDER = /^\$\{([A-Z][A-Z0-9_]*)(\?)?(?::(number|boolean))?\}$/;

/** KEY=VALUE 形式をパースする（# コメント、空行、export 接頭辞、クォートに対応） */
function parseEnv(text) {
  const result = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2];
    const quoted = value.match(/^(['"])(.*)\1$/);
    if (quoted) {
      value = quoted[2];
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    result[match[1]] = value;
  }
  return result;
}

/** ファイルに出現する順でキー名を返す */
function listKeys(text) {
  return Object.keys(parseEnv(text));
}

/** テンプレートの文字列から参照している変数を列挙する */
function collectPlaceholders(value, found = []) {
  if (typeof value === 'string') {
    for (const m of value.matchAll(PLACEHOLDER)) {
      found.push({ key: m[1], optional: m[2] === '?' });
    }
  } else if (Array.isArray(value)) {
    value.forEach((v) => collectPlaceholders(v, found));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((v) => collectPlaceholders(v, found));
  }
  return found;
}

function convert(raw, type) {
  if (type === 'number') {
    const n = Number(raw);
    if (Number.isNaN(n)) throw new Error('expected a number');
    return n;
  }
  if (type === 'boolean') return /^(true|1|yes)$/i.test(raw);
  return raw;
}

function renderValue(value, env) {
  if (typeof value === 'string') {
    const whole = value.match(WHOLE_PLACEHOLDER);
    if (whole) {
      const raw = env[whole[1]] ?? '';
      if (raw === '' && whole[2] === '?') return undefined; // 任意項目は未入力なら省略
      return convert(raw, whole[3]);
    }
    return value.replace(PLACEHOLDER, (_, key) => env[key] ?? '');
  }
  if (Array.isArray(value)) return value.map((v) => renderValue(v, env));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const rendered = renderValue(v, env);
      if (rendered !== undefined) out[k] = rendered;
    }
    return out;
  }
  return value;
}

/**
 * テンプレートに値を埋め込んで n8n の import:credentials 形式に変換する。
 * 必須の変数が未入力の Credential はスキップする。
 * @returns {{ credentials: object[], skipped: { name: string, missing: string[] }[] }}
 */
function renderCredentials(template, env) {
  const credentials = [];
  const skipped = [];
  for (const entry of template) {
    const missing = [
      ...new Set(
        collectPlaceholders(entry.data)
          .filter((p) => !p.optional && !(env[p.key] && env[p.key].trim() !== ''))
          .map((p) => p.key),
      ),
    ];
    if (missing.length > 0) {
      skipped.push({ name: entry.name, missing });
      continue;
    }
    try {
      credentials.push({
        id: entry.id,
        name: entry.name,
        type: entry.type,
        data: renderValue(entry.data, env),
      });
    } catch (err) {
      skipped.push({ name: entry.name, missing: [], error: err.message });
    }
  }
  return { credentials, skipped };
}

/**
 * キーの入力状況を返す（値は返さない）。
 * @param {string[]} keys 確認するキー
 * @param {Record<string,string>} env secrets.env の内容
 */
function checkKeys(keys, env) {
  return keys.map((key) => ({
    key,
    status: !(key in env) ? 'missing' : env[key].trim() === '' ? 'empty' : 'set',
  }));
}

/** example にあって secrets.env に無いキーを、example の行のまま返す（追記用） */
function linesToAppend(exampleText, secretsText) {
  const existing = new Set(listKeys(secretsText));
  return exampleText
    .split(/\r?\n/)
    .map((line) => line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/))
    .filter((m) => m && !existing.has(m[1]))
    .map((m) => `${m[1]}=${m[2]}`);
}

module.exports = {
  parseEnv,
  listKeys,
  collectPlaceholders,
  renderCredentials,
  checkKeys,
  linesToAppend,
};
