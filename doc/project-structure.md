# フォルダ構成と役割

```
project001/
├── designs/                        ワークフロー設計書（Claude への入力）
│   ├── _TEMPLATE.md                設計書のひな形
│   └── examples/order-notify.md    記入例
├── workflows/                      n8n ワークフロー定義（JSON）
│   └── contacts-intake.json        サンプル: Webhook → 連絡先整形 → レスポンス
├── config/
│   ├── secrets.example.env         認証情報の入力欄のひな形（値は空）
│   ├── credentials.template.json   n8n の Credential 定義（値は ${KEY} で参照）
│   ├── categories.yml              分類コードの一覧（SLS・OPS など）
│   └── dashboard.yml               Dashy の固定メニュー・リンク先
├── dashy/user-data/                Dashy の設定（conf.yml は dashy:sync で生成・Git 管理外）
├── secrets/                        ★ Git 管理外。secrets.env に実際の値を記入
├── src/
│   ├── javascript/
│   │   └── code-nodes/             Code ノードのロジック（1 ノード = 1 ファイル）
│   │       └── format-contacts.js
│   └── python/
│       └── data_processing/        データ処理・スクレイピング用 Python パッケージ
│           ├── __init__.py
│           ├── __main__.py         CLI（stdin JSON → stdout JSON）
│           ├── cleaning.py         レコードの整形・日付正規化・重複排除
│           └── scraping.py         HTML 取得・タイトル / リンク抽出
├── tests/
│   ├── javascript/                 Jest テスト
│   ├── python/                     pytest テスト
│   └── workflows/                  テストデプロイ用のケース（<name>.cases.json）
├── scripts/
│   ├── validate-workflows.js       ワークフロー JSON の構文・構造・Credential 参照・秘密情報の直書きチェック
│   ├── sync-code-nodes.js          Code ノードへのソース埋め込み / 同期チェック
│   ├── describe-workflow.js        ワークフローの構造情報を出力（仕様書生成用）
│   ├── secrets.js                  secrets/secrets.env の作成・入力状況チェック
│   ├── design.js                   設計書の一覧・Claude を起動して構築（design:list / design:build）
│   ├── dashy-sync.js               Dashy の conf.yml を生成
│   ├── n8n-credentials.sh          Credential をローカル n8n へ一括インポート
│   ├── n8n-import.sh               ローカル n8n へインポート
│   ├── n8n-export.sh               ローカル n8n からエクスポート
│   ├── n8n-test-run.js             テストデプロイ（有効化 → Webhook でケース実行 → 無効化）
│   └── lib/                        上記スクリプトのロジック（Jest でテスト）
├── doc/                            ドキュメント（このフォルダ）
│   └── specifications/             ワークフローごとの仕様書
├── .github/workflows/ci.yml        GitHub Actions
├── .claude/                        Claude Code 設定（チーム共有）
│   ├── settings.json               デフォルトエージェント・権限・フック
│   ├── agents/                     サブエージェント定義
│   ├── skills/import-workflow/     n8n インポート用スキル
│   └── hooks/                      自動フォーマット・仕様書更新リマインダー
├── docker-compose.yml              n8n + PostgreSQL + Dashy
├── env.example                     環境変数のひな形（.env にコピーして使う）
├── package.json                    Node.js 依存関係と npm スクリプト
├── pyproject.toml                  Python のメタデータと Ruff / pytest 設定
├── requirements-dev.txt            Python 開発ツール（CI でも使用）
├── CLAUDE.md                       Claude Code 向けのプロジェクトルール
└── .editorconfig / .prettierrc.json / .prettierignore / .nvmrc / .gitignore / .mcp.json
```

## 各フォルダの役割とルール

### `workflows/`
- n8n からエクスポートした形式そのままの JSON を置きます。ファイル名は kebab-case（例: `contacts-intake.json`）。
- docker compose でコンテナの `/home/node/workflows` にマウントされ、インポート・エクスポートの受け渡し場所になります。
- **固定の `id` を持たせます**。インポートは `id` で上書きされるため、`id` が無いと取り込むたびに別のワークフローが増えます。
- `active: false`、`pinData: {}` の状態でコミットします。API キーなどの秘密情報は書かず、n8n の Credential を参照させます。
- Prettier の対象外です（n8n の出力形式を保ち、差分を小さくするため）。

### `designs/`
- Claude Code に渡すワークフロー設計書です。`/build-from-design designs/<id>.md` で構築からテストデプロイまで行います。
- 詳しくは [design-driven-development.md](design-driven-development.md) を参照してください。

### `config/` と `secrets/`
- `config/` には、認証情報の **入力欄と定義**（値は空）を置きます。コミットします。
- `secrets/secrets.env` には **実際の値** を書きます。Git 管理外で、Claude Code からも読めない設定にしています。
- 詳しくは [secrets.md](secrets.md) を参照してください。

### `src/javascript/code-nodes/`
- Code ノードの中身を通常の JS（CommonJS）として書く場所です。
- 各ファイルは `run(items)` を `module.exports` で公開します。`items` は n8n の `[{ json: {...} }]` 形式で、戻り値も同じ形式です。
- `$input` や `$json` などの n8n 専用の変数は使いません。そのため Jest でそのままテストできます。
- ワークフロー側へは `npm run sync:code` で埋め込みます（[development-workflow.md](development-workflow.md#code-ノードを追加変更する) 参照）。

### `src/python/data_processing/`
- データ整形やスクレイピングなど、Python の方が書きやすい処理を置くパッケージです。標準ライブラリのみで動作します。
- `python -m data_processing clean --key id` のように、JSON を標準入力で受け取って標準出力に返す CLI として使えます。
  外部のワーカーや Execute Command ノード（Python が入った環境が必要）から呼び出す想定です。
- 通信処理と変換ロジックは分けて書き、テストでは通信を行いません。

### `tests/`
- `tests/javascript/*.test.js` … Code ノードとスクリプトのテスト。`workflows/` の全 JSON の構造チェックも含みます。
- `tests/python/test_*.py` … Python パッケージのテスト。`pyproject.toml` で `src/python` が import パスに追加されています。

### `scripts/`
| スクリプト | npm スクリプト | 役割 |
| --- | --- | --- |
| `validate-workflows.js` | `npm run validate:workflows` | JSON 構文、必須フィールド、ノード名と ID の重複、存在しないノードへの接続を検出 |
| `sync-code-nodes.js` | `npm run sync:code` / `sync:code:check` | `// @source` 付き Code ノードにソースを埋め込む / 同期漏れを検出 |
| `describe-workflow.js` | `npm run describe -- <file>` | ノード一覧・接続・Mermaid 図・Credential 参照を出力 |
| `n8n-import.sh` | `npm run n8n:import -- [files]` | 検証してから `n8n import:workflow` を実行 |
| `n8n-export.sh` | `npm run n8n:export -- [id]` | `n8n export:workflow` で `workflows/` に書き出す |

### `doc/`
- `doc/*.md` … プロジェクトの使い方（人間向け）。
- `doc/specifications/<ワークフロー名>.md` … ワークフローごとの仕様書。`n8n-spec-writer` エージェントが作成・更新します。

### `.claude/`
Claude Code の設定です。詳細は [claude-code.md](claude-code.md) を参照してください。`settings.local.json` は個人用で Git の管理対象外です。

## Git の管理対象外（`.gitignore`）
`.env`、`secrets/`、`node_modules/`、`.venv/`、`coverage/`、Python のキャッシュ、`.DS_Store`、`.claude/settings.local.json`、`CLAUDE.local.md`。
