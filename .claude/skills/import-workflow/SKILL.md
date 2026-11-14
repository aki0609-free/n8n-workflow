---
name: import-workflow
description: workflows/ 配下の n8n ワークフロー JSON をローカルの n8n インスタンス（docker compose）へ CLI でインポートする。「ワークフローを n8n に反映して」「ローカルの n8n にインポートして」「n8n で動作確認したい」といった依頼のときに使用する。
argument-hint: "[workflows/<file>.json ...]（省略時は全件）"
allowed-tools: Bash(docker compose ps:*), Bash(docker compose up:*), Bash(docker compose logs:*), Bash(bash scripts/n8n-import.sh:*), Bash(node scripts/validate-workflows.js:*), Bash(node scripts/sync-code-nodes.js:*), Bash(curl:*), Bash(npm run secrets:check:*), Bash(bash scripts/n8n-credentials.sh:*)
---

# import-workflow

`workflows/` の JSON をローカル n8n へ `n8n import:workflow` でインポートします。
docker-compose.yml で `./workflows` がコンテナの `/home/node/workflows` にマウントされている前提です。

対象: $ARGUMENTS（空の場合は `workflows/*.json` すべて）

## 手順

1. **コンテナの起動確認**
   ```bash
   docker compose ps --status running --services
   ```
   出力に `n8n` が無ければ、`.env` の存在をユーザーに確認したうえで起動する（`.env` は読まないこと。無い場合は `cp env.example .env` を案内する）。
   ```bash
   docker compose up -d
   ```
   起動後、ヘルスチェックが通るまで待つ:
   ```bash
   curl -sf http://localhost:5678/healthz
   ```

2. **Code ノードの同期**（`src/javascript/code-nodes/` を変更していた場合）
   ```bash
   node scripts/sync-code-nodes.js
   ```

3. **Credential の投入**（ワークフローが `credentials` を参照している場合）
   ```bash
   npm run secrets:check                      # 値は表示されない。未入力ならユーザーに記入を依頼
   bash scripts/n8n-credentials.sh "<name>"   # config/credentials.template.json の name
   ```

4. **インポート実行**（スクリプト内で構造バリデーションと同期チェックも行われる）
   ```bash
   bash scripts/n8n-import.sh $ARGUMENTS
   ```
   - 引数は `workflows/xxx.json` 形式のリポジトリ相対パスで渡す。
   - 同じ `id` のワークフローは上書きされる。`id` が無い JSON は毎回新規作成されるため、`id` を付与するよう提案する。

5. **結果確認**
   - 成功: `Successfully imported N workflow(s)` が出力される。
   - 失敗時は `docker compose logs --tail=100 n8n` で原因を確認する。よくある原因:
     - PostgreSQL への接続エラー → postgres コンテナのヘルスチェック待ち。少し待って再実行。
     - `Unrecognized node type` → n8n のバージョンが古い。`.env` の `N8N_VERSION` の更新をユーザーに提案。
     - Credential 未設定 → インポート自体は成功する。`secrets/secrets.env` への記入と手順 3 の実行を案内する。

6. **報告**
   インポートしたファイル、n8n 上のワークフロー名、エディタ URL（`http://localhost:5678/workflow/<id>`）、
   Webhook を含む場合はテスト URL（`http://localhost:5678/webhook-test/<path>`）を伝える。
   インポートしたワークフローは非アクティブ状態のため、本番 URL（`/webhook/<path>`）を使うには UI で有効化が必要な点も添える。

## 注意
- `docker compose down -v` はデータベースを消去するため実行しない。
- UI 上で編集した内容を Git に戻す場合は `bash scripts/n8n-export.sh <id>` を使い、`git diff workflows/` で差分を確認する。
