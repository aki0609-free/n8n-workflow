# はじめに（環境構築）

## 必要なもの

| ツール | バージョン | 用途 |
| --- | --- | --- |
| Node.js | 20 以上（`.nvmrc` 参照） | Jest・Prettier・各種スクリプト |
| Python | 3.11 以上 | データ処理モジュール・pytest・Ruff |
| Docker / Docker Compose | Compose v2 | ローカルの n8n と PostgreSQL |
| Git | — | バージョン管理 |

## セットアップ

```bash
# 1. Node.js の依存関係
npm install

# 2. Python の仮想環境と開発ツール
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt

# 3. 環境変数ファイル
cp env.example .env
#   N8N_ENCRYPTION_KEY をランダムな値に変更する（例: openssl rand -hex 32）
#   POSTGRES_PASSWORD も必要に応じて変更する
```

> `env.example` はドット無しのファイル名です。Claude Code の設定で `.env.*` の読み取りを禁止しているため、この名前にしています。

```bash
# 4. API キー・認証情報（使うサービスの分だけ記入すればよい）
npm run secrets:init      # secrets/secrets.env を作成（Git 管理外）
npm run secrets:check     # 入力状況を確認
```

`.env` は n8n と DB を動かすための設定、`secrets/secrets.env` はワークフローが使う外部サービスの API キーです。詳しくは [secrets.md](secrets.md) を参照してください。

### 環境変数

| 変数 | 既定値 | 説明 |
| --- | --- | --- |
| `N8N_VERSION` | `2.47.7` | n8n イメージのタグ。破壊的変更を避けるため固定（上げる前に n8n の breaking changes を確認） |
| `N8N_PORT` | `5678` | ホスト側のポート |
| `DASHY_VERSION` / `DASHY_PORT` | `4.9.0` / `4000` | Dashy のイメージタグとポート |
| `GENERIC_TIMEZONE` | `Asia/Tokyo` | n8n のタイムゾーン（Schedule Trigger などに影響） |
| `N8N_ENCRYPTION_KEY` | （要変更） | Credential の暗号化キー。**一度決めたら変更しない**（変更すると保存済み Credential を復号できなくなる） |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `n8n` / … / `n8n` | PostgreSQL の接続情報 |

## ローカル n8n の起動

```bash
npm run up            # n8n・PostgreSQL・Dashy を一括起動し、使えるようになるまで待って URL を表示
npm run up -- --import  # 起動後に workflows/*.json もすべて取り込む（UI での未エクスポートの変更は上書きされる）
npm run n8n:logs      # ログの確認（Ctrl+C で終了）
```

`npm run n8n:up` は起動だけを行います（待ち合わせや URL の表示はしません）。

ブラウザで http://localhost:5678 を開き、初回はオーナーアカウントを作成します。
ワークフローの一覧（Dashy）は http://localhost:4000 で開けます（[dashboard.md](dashboard.md)）。

続けて、次の 2 つを行います。

- **Settings > n8n API** で API キーを発行し、`secrets/secrets.env` の `N8N_API_KEY` に記入します（自動テストデプロイで使います）。
- 認証情報を記入済みであれば、`npm run n8n:credentials` で n8n に登録します。
- Claude Code を使う場合は、n8n MCP を接続します（**Settings → Instance-level MCP** を有効化し、Claude Code で `/mcp` → n8n → Authenticate）。詳しくは [claude-code.md](claude-code.md#n8n-mcp-サーバーmcpjson) を参照してください。

## サンプルワークフローを動かす

```bash
npm run n8n:import    # workflows/*.json をすべて取り込む
```

1. n8n の UI で「Contacts Intake (Webhook → Format → Respond)」を開く
2. 「Test workflow」をクリックして Webhook を待ち受け状態にする
3. 別のターミナルからリクエストを送る

```bash
curl -X POST http://localhost:5678/webhook-test/contacts-intake \
  -H 'Content-Type: application/json' \
  -d '{"contacts":[{"name":" Alice ","email":"ALICE@example.com"},{"name":"Bob","email":"bad"}]}'
```

正規化済みの連絡先・不正なデータ・件数のサマリーが JSON で返れば成功です。

`N8N_API_KEY` を設定済みであれば、`npm run n8n:test -- workflows/contacts-intake.json` で、有効化から `tests/workflows/contacts-intake.cases.json` の実行、無効化までを自動で行えます。詳しくは [specifications/contacts-intake.md](specifications/contacts-intake.md) を参照してください。

## 停止

```bash
npm run down          # コンテナ停止（データは Docker ボリュームに残る。npm run n8n:down と同じ）
```

`docker compose down -v` はデータベースのボリュームまで削除します。ワークフローや Credential がすべて消えるため、意図した場合以外は実行しないでください。

## 動作確認（テスト一式）

```bash
npm run ci                                    # Prettier・ワークフロー検証・同期チェック・Jest
.venv/bin/ruff check . && .venv/bin/ruff format --check .
.venv/bin/pytest
```
