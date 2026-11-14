/**
 * n8n Code ノード: "Format Contacts"
 *
 * Webhook で受け取った連絡先データを正規化・検証・重複排除する。
 * モード: Run Once for All Items
 *
 * 規約:
 *   - `run(items)` を module.exports で公開する（n8n の items 配列 = [{ json: {...} }] を受け取り、同形式で返す）
 *   - n8n ランタイム依存の変数（$input, $json 等）は使わず純粋関数にする → Jest で単体テスト可能
 *   - `npm run sync:code` で workflows/*.json の該当 Code ノードへ埋め込まれる
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return EMAIL_PATTERN.test(email) ? email : null;
}

function normalizeName(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

function normalizePhone(value) {
  if (value === undefined || value === null) return null;
  const digits = String(value).replace(/[^\d+]/g, '');
  return digits.length > 0 ? digits : null;
}

function extractRecords(json) {
  // Webhook ノードは body 配下にペイロードを置くため両方に対応する
  const payload = json && typeof json.body === 'object' && json.body !== null ? json.body : json;
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.contacts)) return payload.contacts;
  return payload ? [payload] : [];
}

function run(items) {
  const seen = new Set();
  const valid = [];
  const invalid = [];

  for (const item of items) {
    for (const record of extractRecords(item.json)) {
      const email = normalizeEmail(record.email);
      const contact = {
        name: normalizeName(record.name),
        email,
        phone: normalizePhone(record.phone),
      };

      if (!email) {
        invalid.push({ ...contact, rawEmail: record.email ?? null, reason: 'invalid_email' });
        continue;
      }
      if (seen.has(email)) continue;
      seen.add(email);
      valid.push(contact);
    }
  }

  return [
    {
      json: {
        contacts: valid,
        invalid,
        summary: { valid: valid.length, invalid: invalid.length },
      },
    },
  ];
}

module.exports = { run, normalizeEmail, normalizeName, normalizePhone, extractRecords };
