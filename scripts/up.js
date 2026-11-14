#!/usr/bin/env node
/**
 * ローカル環境（n8n・PostgreSQL・Dashy）を一括で起動し、使える状態になるまで待って URL を表示する。
 *
 *   npm run up               起動 → ヘルスチェック → URL とワークフロー一覧を表示
 *   npm run up -- --import   起動後に workflows/*.json をすべて n8n にインポートする
 *                            （n8n の UI で編集してまだエクスポートしていない変更は上書きされる）
 *   npm run down             停止（データは残る）
 *
 * ポートは環境変数 N8N_PORT / DASHY_PORT（未指定なら 5678 / 4000）。.env は読まない。
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const withImport = args.includes('--import');

const n8nUrl = `http://localhost:${process.env.N8N_PORT || 5678}`;
const dashyUrl = `http://localhost:${process.env.DASHY_PORT || 4000}`;

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(
      `\nerror: ${command} ${commandArgs.join(' ')} が失敗しました（exit ${result.status}）`,
    );
    process.exit(result.status || 1);
  }
}

async function waitFor(label, url, timeoutSec) {
  const deadline = Date.now() + timeoutSec * 1000;
  process.stdout.write(`  ${label} の起動を待っています`);
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        console.log(' ✓');
        return true;
      }
    } catch {
      // まだ起動していない
    }
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(' ✗（タイムアウト）');
  return false;
}

/** workflows/*.json から、名前と呼び出し URL（Webhook・フォーム）を取り出す */
function listWorkflows() {
  const dir = path.join(ROOT, 'workflows');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => {
      const wf = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      const endpoints = (wf.nodes || []).flatMap((n) => {
        const p = n.parameters || {};
        if (n.type === 'n8n-nodes-base.webhook' && p.path) {
          return [`${(p.httpMethod || 'GET').toUpperCase()} ${n8nUrl}/webhook/${p.path}`];
        }
        if (n.type === 'n8n-nodes-base.formTrigger' && p.options && p.options.path) {
          return [`FORM ${n8nUrl}/form/${p.options.path}`];
        }
        return [];
      });
      return { name: wf.name, editor: `${n8nUrl}/workflow/${wf.id}`, endpoints };
    });
}

(async () => {
  console.log('▶ Dashy の設定を生成');
  run('node', ['scripts/dashy-sync.js']);

  console.log('\n▶ コンテナを起動（n8n・PostgreSQL・Dashy）');
  run('docker', ['compose', 'up', '-d']);

  console.log('\n▶ ヘルスチェック');
  const n8nOk = await waitFor('n8n', `${n8nUrl}/healthz`, 180);
  const dashyOk = await waitFor('Dashy', dashyUrl, 120);
  if (!n8nOk) {
    console.error('\nn8n が起動しませんでした。`npm run n8n:logs` でログを確認してください。');
    process.exit(1);
  }

  if (withImport) {
    console.log('\n▶ ワークフローをインポート');
    run('bash', ['scripts/n8n-import.sh']);
  }

  console.log('\n■ 起動しました');
  console.log(`  n8n      ${n8nUrl}`);
  console.log(
    `  Dashy    ${dashyUrl}${dashyOk ? '' : '（応答なし。少し待ってから開いてください）'}`,
  );
  console.log('  Studio   未提供（段階 2 で追加予定）');

  const workflows = listWorkflows();
  if (workflows.length > 0) {
    console.log('\n■ ワークフロー（workflows/）');
    for (const wf of workflows) {
      console.log(`  ${wf.name}`);
      console.log(`    編集    ${wf.editor}`);
      for (const e of wf.endpoints) console.log(`    呼び出し ${e}`);
    }
    if (!withImport) {
      console.log(
        '\n  n8n に未登録・古い場合は `npm run up -- --import` か `npm run n8n:import` で取り込めます。',
      );
    }
    console.log(
      '  本番 URL（/webhook/・/form/）は、n8n で公開（有効化）したワークフローだけ使えます。',
    );
  }
})().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
