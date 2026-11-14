#!/usr/bin/env node
/**
 * 認証情報の管理 CLI。
 *
 *   node scripts/secrets.js init               secrets/secrets.env を作成 / 新しいキーを追記
 *   node scripts/secrets.js check [KEY...]     入力状況を表示（値は出さない）。KEY 指定時は未入力で exit 1
 *   node scripts/secrets.js credentials        n8n import:credentials 用 JSON を stdout へ（n8n-credentials.sh 専用）
 */
const fs = require('node:fs');
const path = require('node:path');
const {
  parseEnv,
  listKeys,
  renderCredentials,
  checkKeys,
  linesToAppend,
} = require('./lib/secrets');

const ROOT = path.resolve(__dirname, '..');
const EXAMPLE = path.join(ROOT, 'config', 'secrets.example.env');
const TEMPLATE = path.join(ROOT, 'config', 'credentials.template.json');
const SECRETS_DIR = path.join(ROOT, 'secrets');
const SECRETS = path.join(SECRETS_DIR, 'secrets.env');

const read = (file) => fs.readFileSync(file, 'utf8');
const loadEnv = () => (fs.existsSync(SECRETS) ? parseEnv(read(SECRETS)) : null);

function init() {
  fs.mkdirSync(SECRETS_DIR, { recursive: true, mode: 0o700 });
  const example = read(EXAMPLE);
  if (!fs.existsSync(SECRETS)) {
    fs.writeFileSync(SECRETS, example, { mode: 0o600 });
    console.log(
      'Created secrets/secrets.env. 値を記入してください（このファイルは Git 管理外です）。',
    );
    return 0;
  }
  const lines = linesToAppend(example, read(SECRETS));
  if (lines.length === 0) {
    console.log('secrets/secrets.env は最新です（追加すべきキーはありません）。');
    return 0;
  }
  const header = `\n# --- added from config/secrets.example.env on ${new Date().toISOString().slice(0, 10)} ---\n`;
  fs.appendFileSync(SECRETS, `${header}${lines.join('\n')}\n`);
  console.log(`secrets/secrets.env に ${lines.length} 個のキーを追記しました:`);
  for (const l of lines) console.log(`  + ${l.split('=')[0]}`);
  return 0;
}

function check(keys) {
  const env = loadEnv();
  if (!env) {
    console.error('secrets/secrets.env がありません。`npm run secrets:init` を実行してください。');
    return 1;
  }
  const targets = keys.length > 0 ? keys : listKeys(read(EXAMPLE));
  const results = checkKeys(targets, env);
  const icon = { set: '✓', empty: '·', missing: '✗' };
  for (const r of results) console.log(`${icon[r.status]} ${r.key.padEnd(28)} ${r.status}`);

  if (keys.length === 0) {
    const template = JSON.parse(read(TEMPLATE));
    const { credentials, skipped } = renderCredentials(template, env);
    console.log('\nn8n Credentials:');
    for (const c of credentials) console.log(`  ✓ ${c.name} (${c.type}, id=${c.id})`);
    for (const s of skipped) {
      console.log(
        `  · ${s.name} — 未入力: ${s.missing.join(', ')}${s.error ? ` (${s.error})` : ''}`,
      );
    }
    return 0;
  }
  const ng = results.filter((r) => r.status !== 'set');
  if (ng.length > 0) {
    console.error(`\n未入力のキーがあります: ${ng.map((r) => r.key).join(', ')}`);
    console.error('secrets/secrets.env に値を記入してから再実行してください。');
    return 1;
  }
  return 0;
}

function credentials(names) {
  if (process.env.N8N_CREDENTIALS_PIPE !== '1' || process.stdout.isTTY) {
    console.error(
      'このコマンドは秘密の値を出力するため、scripts/n8n-credentials.sh からのみ実行できます。',
    );
    return 1;
  }
  const env = loadEnv();
  if (!env) {
    console.error('secrets/secrets.env がありません。`npm run secrets:init` を実行してください。');
    return 1;
  }
  let template = JSON.parse(read(TEMPLATE));
  if (names.length > 0)
    template = template.filter((t) => names.includes(t.name) || names.includes(t.id));
  const { credentials: creds, skipped } = renderCredentials(template, env);
  for (const s of skipped) {
    console.error(
      `skip: ${s.name} (未入力: ${s.missing.join(', ')}${s.error ? `; ${s.error}` : ''})`,
    );
  }
  for (const c of creds) console.error(`ready: ${c.name} (${c.type}, id=${c.id})`);
  process.stdout.write(JSON.stringify(creds));
  return 0;
}

const [command, ...rest] = process.argv.slice(2);
const commands = {
  init: () => init(),
  check: () => check(rest),
  credentials: () => credentials(rest),
};

if (!commands[command]) {
  console.error('usage: node scripts/secrets.js <init|check [KEY...]|credentials>');
  process.exit(1);
}
process.exit(commands[command]());
