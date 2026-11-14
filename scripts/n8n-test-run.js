#!/usr/bin/env node
/**
 * ローカル n8n にインポート済みのワークフローを「テストデプロイ」して検証する。
 *
 *   node scripts/n8n-test-run.js workflows/<name>.json [--keep-active]
 *
 * 1. tests/workflows/<name>.cases.json を読み込む
 * 2. n8n Public API（N8N_API_KEY）でワークフローの存在確認・有効化
 * 3. 各 HTTP ケースのリクエストを本番 Webhook URL（/webhook/<path>）へ送信し、期待値と照合
 *    MCP ケース（`trigger` を持つもの）はスキップして一覧だけ表示する（Claude が MCP で実行する）
 * 4. もともと無効だった場合は無効に戻す（--keep-active で維持）
 *
 * N8N_API_KEY は環境変数、または secrets/secrets.env から読む（値は表示しない）。
 */
const fs = require('node:fs');
const path = require('node:path');
const { loadApiKey, defaultBaseUrl, createClient } = require('./lib/n8n-api');
const { runCase, isMcpCase } = require('./lib/case-runner');

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
const { cases: allCases = [] } = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
const cases = allCases.filter((c) => !isMcpCase(c));
const mcpCases = allCases.filter(isMcpCase);
if (!workflow.id) fail(`${workflowFile} has no "id"`);

const apiKey = loadApiKey(ROOT);
if (!apiKey) {
  fail(
    'N8N_API_KEY が未設定です。n8n UI > Settings > n8n API で発行し、secrets/secrets.env に記入してください。',
  );
}
const baseUrl = defaultBaseUrl();
const { api, setPublished } = createClient({ apiKey, baseUrl });

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
      await setPublished(workflow.id, true);
      console.log('  published');
    } catch (err) {
      fail(
        `公開（有効化）に失敗しました（Credential 未設定やノード設定エラーの可能性）:\n  ${err.message}`,
      );
    }
  }

  const results = [];
  try {
    if (cases.length === 0) console.log('  (no webhook test cases; activation check only)');
    for (const c of mcpCases) {
      console.log(`  · ${c.name}  [MCP ケース: Claude が execute_workflow で実行]`);
    }
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
      await setPublished(workflow.id, false)
        .then(() => console.log('  unpublished (restored)'))
        .catch((err) => console.error(`  warning: unpublish failed: ${err.message}`));
    }
  }

  const failed = results.filter((r) => !r.ok).length;
  const skipped = mcpCases.length ? `, ${mcpCases.length} skipped (MCP)` : '';
  console.log(`\n${results.length - failed} passed, ${failed} failed${skipped}`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => fail(err.message));
