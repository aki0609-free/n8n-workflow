# CLAUDE.md

このファイルは Claude Code がこのリポジトリで作業する際のガイドです。

## プロジェクト概要
n8n のワークフロー（JSON）と、コードベースのカスタムロジック（JavaScript / Python）を 1 つのリポジトリで管理し、Git と GitHub Actions でテスト・検証するプロジェクト。

- ワークフロー定義の正（Source of Truth）は `workflows/*.json`
- Code ノードのロジックの正は `src/javascript/code-nodes/*.js`（JSON 側は `npm run sync:code` で生成）
- ローカル実行環境は docker compose（n8n + PostgreSQL）

## セットアップ
```bash
npm install
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
cp env.example .env   # N8N_ENCRYPTION_KEY などを設定（.env は Git 管理外・Claude は読まない）
npm run secrets:init  # secrets/secrets.env を作成（API キーはユーザーが記入。Claude は読まない）
npm run n8n:up        # http://localhost:5678
```

## よく使うコマンド
| 目的 | コマンド |
| --- | --- |
| JS 単体テスト | `npm test` |
| Python 単体テスト | `.venv/bin/pytest` |
| Python lint / format | `.venv/bin/ruff check . && .venv/bin/ruff format --check .` |
| JS format チェック | `npm run format:check` |
| ワークフロー JSON 検証 | `npm run validate:workflows` |
| Code ノード埋め込み更新 | `npm run sync:code`（CI は `npm run sync:code:check`） |
| ワークフロー構造の出力 | `npm run describe -- workflows/<file>.json`（`--json` も可） |
| CI 相当（JS 側一括） | `npm run ci` |
| 一括起動（n8n・DB・Dashy・Studio、起動待ち・URL 表示） | `npm run up`（`-- --import` でワークフローも取り込む）/ 停止 `npm run down` |
| Workflow Studio（アプリ作成サイト :3100） | `npm run studio`（フォアグラウンド）/ `npm run studio:start` / `npm run studio:stop` |
| n8n 起動 / 停止 / ログ | `npm run n8n:up` / `npm run n8n:down` / `npm run n8n:logs` |
| n8n へインポート | `npm run n8n:import -- workflows/<file>.json`（引数省略で全件） |
| n8n からエクスポート | `npm run n8n:export -- <workflowId>`（引数省略で全件） |
| Dashy の conf.yml 生成 | `npm run dashy:sync`（n8n:up・n8n:import でも自動実行。Dashy は http://localhost:4000） |
| 認証情報の入力状況 | `npm run secrets:check [-- KEY ...]`（値は表示されない） |
| Credential を n8n へ投入 | `npm run n8n:credentials [-- "<name>" ...]` |
| テストデプロイ | `npm run n8n:test -- workflows/<file>.json`（`tests/workflows/<file>.cases.json` を実行） |
| 設計書から構築 | `npm run design:build -- designs/<id>.md [--auto]`（= `/build-from-design`）、一覧は `npm run design:list` |

## アーキテクチャ
```
designs/                      ワークフロー設計書（入力）。_TEMPLATE.md の構成で書く
studio/                       Workflow Studio（設計書・対話からアプリを作る Web サイト。claude -p を呼ぶ）
workflows/                    n8n ワークフロー JSON（import/export 対象、コンテナにマウント）
config/                       secrets.example.env（キー一覧）・credentials.template.json（Credential 定義）
                              categories.yml（分類コード）・dashboard.yml（Dashy の固定部分）
dashy/user-data/              Dashy の conf.yml（dashy:sync で生成・Git 管理外）
secrets/                      実際の値（Git 管理外・Claude は読み書き禁止）
tests/workflows/              テストデプロイ用ケース（<name>.cases.json）
src/javascript/code-nodes/    Code ノードのロジック（run(items) を export する CommonJS）
src/python/data_processing/   データ処理・スクレイピング（python -m data_processing で CLI 実行）
tests/javascript/             Jest テスト
tests/python/                 pytest テスト
scripts/                      validate-workflows / sync-code-nodes / describe-workflow / n8n-import / n8n-export
doc/                          利用ガイド（README.md が目次）
doc/specifications/           ワークフローごとの仕様書（n8n-spec-writer が生成）
.github/workflows/ci.yml      JSON 検証・同期チェック・Jest・Ruff・pytest・compose 検証
.claude/                      Claude Code 設定（エージェント・スキル・フック）
```

### Code ノード同期の仕組み
1. ワークフロー JSON の Code ノードの `jsCode` 1 行目に `// @source src/javascript/code-nodes/<name>.js` を書く
2. `npm run sync:code` がソースを埋め込み、末尾に `return module.exports.run($input.all());` を付与する
3. CI の `sync:code:check` で埋め込み漏れを検出する

## Claude Code の構成
- 前提: n8n の無料版（セルフホスト）と Claude Code のサブスクリプションの範囲で完結させる。n8n の AI ビルダー（クレジット制）や従量課金の API には依存しない
- MCP: `.mcp.json` にローカル n8n の MCP サーバーを登録（OAuth）。ノード定義の取得・検証（`search_nodes` / `get_node_types` /
  `validate_node_config`）と、テスト実行（`execute_workflow`）に使う。n8n 上のワークフローを MCP で直接作成・変更しない（正は `workflows/*.json`）
- デフォルトエージェント: `n8n-workflow-expert`（`.claude/settings.json` の `agent`）
- サブエージェント:
  - `code-node-engineer` … Code ノード JS / Python の実装と単体テスト
  - `n8n-spec-writer` … ワークフロー・処理の変更を読み取り `doc/specifications/<name>.md` を作成・更新
  - `design-interviewer` … Workflow Studio の「対話から作成」で、聞き取りから設計書の下書きを作る（書き込み不可）
- スキル:
  - `build-from-design` … 設計書から構築・テストデプロイ・仕様書作成まで一括実行
  - `import-workflow` … ローカル n8n への CLI インポート
- フック:
  - `format-on-edit.js` … 編集後に JS/TS は Prettier、Python は Ruff で自動整形
  - `spec-reminder.js` … `workflows/`・`src/javascript/code-nodes/`・`src/python/` の編集時に仕様書の更新を通知
- 詳細は `doc/claude-code.md`

## ドキュメントの更新ルール
- ノード・接続・Code ノード・Python 処理を変更したら、作業の最後に `n8n-spec-writer` で仕様書を更新する
- フォルダ構成・コマンド・CI を変更したら、`doc/` の該当ガイド（project-structure / development-workflow / ci-cd / claude-code / secrets / design-driven-development / dashboard）も更新する

## コーディング規約
- ワークフロー JSON
  - 固定の `id` を持たせる。`active: false`、`pinData: {}`、`settings.availableInMCP: true` でコミットする
  - `tags` に `config/categories.yml` の分類コードをちょうど 1 つ付ける（例: `[{ "name": "SLS" }]`）
  - Credential の実値・API キーを JSON に含めない。認証は `config/credentials.template.json` の固定 ID で参照し、
    設定値は `{{ $env.KEY }}` で参照する（詳細は `doc/secrets.md`）
  - `jsCode` を JSON 上で直接編集しない（ソースを編集して `npm run sync:code`）
  - `workflows/` は Prettier の対象外（n8n の出力形式を維持する）
- JavaScript: CommonJS、Prettier（シングルクォート・100 桁）。Code ノードは n8n グローバルに依存しない純粋関数にする
- Python: 3.11+、型ヒント必須、Ruff（line-length 100）。ネットワーク I/O とロジックを分離し、テストではネットワークに触れない
- 変更を完了とする前に、`npm run validate:workflows`・`npm test`・`pytest` を実行してパスを確認する
- `.env` と `secrets/` は読まない・書かない・コミットしない。未入力のキーは `npm run secrets:check` で確認し、記入はユーザーに依頼する
- `docker compose down -v`（DB 消去）は実行しない
