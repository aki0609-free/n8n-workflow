#!/usr/bin/env node
/**
 * ローカル n8n にインポート済みのワークフローを「テストデプロイ」して検証する。
 *
 *   node scripts/n8n-test-run.js workflows/<name>.json [--keep-active]
 *
 * 1. tests/workflows/<name>.cases.json を読み込む
 * 2. n8n Public API（N8N_API_KEY）でワークフローの存在確認・有効化
 * 3. 各ケースのリクエストを本番 Webhook URL（/webhook/<path>）へ送信し、期待値と照合
 * 4. もともと無効だった場合は無効に戻す（--keep-active で維持）
 *
 * N8N_API_KEY は環境変数、または secrets/secrets.env から読む（値は表示しない）。
 */
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('./lib/secrets');
const { runCase } = require('./lib/case-runner');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const keepActive = args.includes('--keep-active');
const workflowFile = args.find((a) => !a.startsWith('--'));

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

if (!workflowFile)
  fail('usage: node scripts/n8n-test-run.js workflows/<name>.json [--keep-active]');

const name = path.basename(workflowFile, '.json');
const workflow = JSON.parse(fs.readFileSync(path.resolve(workflowFile), 'utf8'));
const casesFile = path.join(ROOT, 'tests', 'workflows', `${name}.cases.json`);
if (!fs.existsSync(casesFile)) fail(`test cases not found: ${path.relative(ROOT, casesFile)}`);
const { cases = [] } = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
if (!workflow.id) fail(`${workflowFile} has no "id"`);

const secretsPath = path.join(ROOT, 'secrets', 'secrets.env');
const secrets = fs.existsSync(secretsPath) ? parseEnv(fs.readFileSync(secretsPath, 'utf8')) : {};
const apiKey = process.env.N8N_API_KEY || secrets.N8N_API_KEY;
if (!apiKey) {
  fail(
    'N8N_API_KEY が未設定です。n8n UI > Settings > n8n API で発行し、secrets/secrets.env に記入してください。',
  );
}
const baseUrl = process.env.N8N_BASE_URL || `http://localhost:${process.env.N8N_PORT || 5678}/`;

async function api(method, apiPath) {
  const res = await fetch(new URL(`api/v1/${apiPath}`, baseUrl), {
    method,
    headers: { 'X-N8N-API-KEY': apiKey, Accept: 'application/json' },
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(`${method} /api/v1/${apiPath} → ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

(async () => {
  console.log(`▶ ${workflow.name} (id=${workflow.id}) @ ${baseUrl}`);

  let remote;
  try {
    remote = await api('GET', `workflows/${workflow.id}`);
  } catch (err) {
    fail(
      `ワークフローが n8n に見つかりません。先に 'npm run n8n:import -- ${workflowFile}' を実行してください。\n  ${err.message}`,
    );
  }

  const wasActive = remote.active === true;
  if (!wasActive) {
    try {
      await api('POST', `workflows/${workflow.id}/activate`);
      console.log('  activated');
    } catch (err) {
      fail(
        `有効化に失敗しました（Credential 未設定やノード設定エラーの可能性）:\n  ${err.message}`,
      );
    }
  }

  const results = [];
  try {
    if (cases.length === 0) console.log('  (no webhook test cases; activation check only)');
    for (const testCase of cases) {
      const result = await runCase(testCase, { baseUrl });
      results.push(result);
      console.log(`  ${result.ok ? '✓' : '✗'} ${result.name}`);
      if (!result.ok) {
        for (const e of result.errors) console.log(`      - ${e}`);
        if (result.body !== undefined)
          console.log(`      response(${result.status}): ${result.body}`);
      }
    }
  } finally {
    if (!wasActive && !keepActive) {
      await api('POST', `workflows/${workflow.id}/deactivate`).catch((err) =>
        console.error(`  warning: deactivate failed: ${err.message}`),
      );
      console.log('  deactivated (restored)');
    }
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => fail(err.message));
