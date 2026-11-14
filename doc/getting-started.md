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

### 環境変数

| 変数 | 既定値 | 説明 |
| --- | --- | --- |
| `N8N_VERSION` | `latest` | n8n イメージのタグ。チームで揃えるため具体的なバージョンへの固定を推奨 |
| `N8N_PORT` | `5678` | ホスト側のポート |
| `GENERIC_TIMEZONE` | `Asia/Tokyo` | n8n のタイムゾーン（Schedule Trigger などに影響） |
| `N8N_ENCRYPTION_KEY` | （要変更） | Credential の暗号化キー。**一度決めたら変更しない**（変更すると保存済み Credential を復号できなくなる） |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `n8n` / … / `n8n` | PostgreSQL の接続情報 |

## ローカル n8n の起動

```bash
npm run n8n:up        # docker compose up -d
npm run n8n:logs      # ログの確認（Ctrl+C で終了）
```

ブラウザで http://localhost:5678 を開き、初回はオーナーアカウントを作成します。

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

正規化済みの連絡先・不正なデータ・件数のサマリーが JSON で返れば成功です。詳しくは [specifications/contacts-intake.md](specifications/contacts-intake.md) を参照してください。

## 停止

```bash
npm run n8n:down      # コンテナ停止（データは Docker ボリュームに残る）
```

`docker compose down -v` はデータベースのボリュームまで削除します。ワークフローや Credential がすべて消えるため、意図した場合以外は実行しないでください。

## 動作確認（テスト一式）

```bash
npm run ci                                    # Prettier・ワークフロー検証・同期チェック・Jest
.venv/bin/ruff check . && .venv/bin/ruff format --check .
.venv/bin/pytest
```
