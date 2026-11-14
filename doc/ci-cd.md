# CI/CD

`.github/workflows/ci.yml` で、`main` への push とすべてのプルリクエストに対して次のジョブを並列実行します。

| ジョブ | 実行内容 | 失敗したときの対処 |
| --- | --- | --- |
| **Workflow JSON checks** | `jq` による JSON 構文チェック → `validate-workflows.js` → `sync-code-nodes.js --check` | エラーに出たファイルを修正する。同期漏れなら `npm run sync:code` を実行してコミットする |
| **JavaScript** | `npm ci` → `prettier --check` → `jest --coverage` | `npm run format` で整形する。テストが失敗した場合は `npm test` をローカルで再現して修正する |
| **Python** | `ruff check` → `ruff format --check` → `pytest`（Python 3.12） | `.venv/bin/ruff check --fix . && .venv/bin/ruff format .` を実行し、`.venv/bin/pytest` で再現する |
| **docker-compose config** | `env.example` を `.env` にコピーして `docker compose config --quiet` | `docker-compose.yml` の構文や変数名を確認する |

## ローカルで CI と同じチェックを実行する

```bash
npm run ci
.venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/pytest
```

## ワークフロー構造チェックの検出内容

`scripts/lib/workflow-validator.js` は次の項目を検出します。

- `name`・`nodes`・`connections` が無い、または型が違う
- ノードの `id`・`name`・`type`・`typeVersion`・`position`・`parameters` が無い、または型が違う
- ノード名やノード ID が重複している
- `connections` が存在しないノードを参照している（ノード名を変更して接続を直し忘れたときなど）

## デプロイについて

現時点では CI（検証）のみで、本番 n8n への自動デプロイは含まれていません。追加する場合は次の方法が考えられます。

- n8n の Public API（`POST /api/v1/workflows`、`PUT /api/v1/workflows/{id}`）を `main` へのマージ時に呼び出す
- API キーは GitHub の Secrets（例: `N8N_API_KEY`、`N8N_BASE_URL`）に保存し、リポジトリには書かない
