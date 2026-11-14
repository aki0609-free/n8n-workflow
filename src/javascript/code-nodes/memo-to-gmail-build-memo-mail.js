/**
 * n8n Code ノード: "Build Memo Mail"（designs/memo-to-gmail.md Step 2）
 *
 * Form Trigger で受け取ったメモから、Gmail 送信用の件名・本文を組み立てる。
 * モード: Run Once for All Items（入力 1 件につき出力 1 件）
 *
 * 規約:
 *   - `run(items, now)` を module.exports で公開する（n8n の items 配列 = [{ json: {...} }] を受け取り、同形式で返す）
 *   - n8n ランタイム依存の変数（$input, $json 等）は使わず純粋関数にする → Jest で単体テスト可能
 *   - 現在時刻は `now` 引数で注入できる（n8n 上では省略され new Date() が使われる）
 *   - `npm run sync:code` で workflows/*.json の該当 Code ノードへ埋め込まれる
 */

const SUBJECT_TITLE_MAX = 20;
const ELLIPSIS = '…';
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function toTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * memo から件名用の文字列を作る。改行は半角スペースに置換し、
 * コードポイント単位で 20 文字を超える場合は「…」を含めて 20 文字に収める。
 */
function buildTitleFromMemo(memo) {
  const flattened = toTrimmedString(memo).replace(/\r\n|\r|\n/g, ' ');
  const chars = Array.from(flattened);
  if (chars.length <= SUBJECT_TITLE_MAX) return flattened;
  return chars.slice(0, SUBJECT_TITLE_MAX - 1).join('') + ELLIPSIS;
}

function resolveSubjectTitle(title, memo) {
  const trimmedTitle = toTrimmedString(title);
  if (trimmedTitle) return trimmedTitle;
  return buildTitleFromMemo(memo);
}

function parseDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Date を Asia/Tokyo（UTC+9 固定）の "YYYY-MM-DD HH:mm" にする。 */
function formatJst(date) {
  const jst = new Date(date.getTime() + JST_OFFSET_MS);
  return (
    `${jst.getUTCFullYear()}-${pad2(jst.getUTCMonth() + 1)}-${pad2(jst.getUTCDate())} ` +
    `${pad2(jst.getUTCHours())}:${pad2(jst.getUTCMinutes())}`
  );
}

function resolveSentAtText(submittedAt, now) {
  const date = parseDate(submittedAt) || parseDate(now) || new Date();
  return formatJst(date);
}

function buildMemoMail(json, now) {
  const data = json && typeof json === 'object' ? json : {};
  const memo = toTrimmedString(data.memo);
  const errors = memo ? [] : ['memo_required'];

  const subjectTitle = memo ? resolveSubjectTitle(data.title, memo) : toTrimmedString(data.title);
  const sentAtText = resolveSentAtText(data.submittedAt, now);

  return {
    valid: errors.length === 0,
    errors,
    subjectTitle,
    sentAtText,
    subject: `[メモ] ${sentAtText} ${subjectTitle}`,
    text: `${memo}\n\n---\n送信日時: ${sentAtText}`,
  };
}

function run(items, now = new Date()) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({ json: buildMemoMail(item && item.json, now) }));
}

module.exports = {
  run,
  buildMemoMail,
  buildTitleFromMemo,
  resolveSubjectTitle,
  resolveSentAtText,
  formatJst,
  parseDate,
};
