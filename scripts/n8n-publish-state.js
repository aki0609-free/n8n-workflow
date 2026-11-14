#!/usr/bin/env node
/**
 * n8n:import の前後で、ワークフローの公開（有効化）状態を保つ。
 * n8n の import:workflow は、取り込んだワークフローを非公開にしてしまうため、
 * 取り込む前に公開中だったものを記録し、取り込んだ後に公開し直す。
 *
 *   node scripts/n8n-publish-state.js save <stateFile> <workflows/x.json ...>
 *   node scripts/n8n-publish-state.js restore <stateFile>
 *
 * N8N_API_KEY が無い場合は警告だけ出して何もしない（取り込み自体は止めない）。
 */
const fs = require('node:fs');
const path = require('node:path');
const { loadApiKey, createClient } = require('./lib/n8n-api');

const ROOT = path.resolve(__dirname, '..');
const [command, stateFile, ...files] = process.argv.slice(2);

function workflowIds(paths) {
  return paths
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.resolve(ROOT, f), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter((wf) => wf && wf.id)
    .map((wf) => ({ id: wf.id, name: wf.name }));
}

async function main() {
  if (!['save', 'restore'].includes(command) || !stateFile) {
    console.error('usage: n8n-publish-state.js <save|restore> <stateFile> [files...]');
    return 1;
  }
  const apiKey = loadApiKey(ROOT);
  if (!apiKey) {
    if (command === 'save') {
      console.error(
        'warning: N8N_API_KEY が未設定のため、公開中のワークフローはインポート後に非公開になります（n8n の画面で Publish し直してください）',
      );
    }
    return 0;
  }
  const client = createClient({ apiKey });

  if (command === 'save') {
    const published = [];
    for (const wf of workflowIds(files)) {
      if ((await client.isPublished(wf.id)) === true) published.push(wf);
    }
    fs.writeFileSync(stateFile, JSON.stringify(published));
    return 0;
  }

  if (!fs.existsSync(stateFile)) return 0;
  const published = JSON.parse(fs.readFileSync(stateFile, 'utf8') || '[]');
  let failed = 0;
  for (const wf of published) {
    try {
      await client.setPublished(wf.id, true);
      console.log(`↻ 公開し直しました: ${wf.name}`);
    } catch (err) {
      failed += 1;
      console.error(`warning: ${wf.name} を公開し直せませんでした: ${err.message}`);
    }
  }
  return failed > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`warning: 公開状態の確認に失敗しました: ${err.message}`);
    process.exit(0);
  });
