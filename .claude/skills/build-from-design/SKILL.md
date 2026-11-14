---
name: build-from-design
description: designs/ に置かれた設計書（Markdown）から、n8n ワークフローの構築・Code ノードの実装とテスト・ローカル n8n へのテストデプロイ・仕様書作成までを一括で行う。「設計書からワークフローを作って」「designs/xxx.md を構築して」と依頼されたときに使用する。
argument-hint: "designs/<id>.md"
---

# build-from-design

設計書 `$ARGUMENTS` からワークフローを構築し、ローカル n8n でテストまで行います。
各フェーズの終わりに 1 行で進捗を報告してください。途中で止まる場合は、理由と再開に必要なユーザーの作業を明示します。

n8n の無料版（セルフホスト）と Claude Code のサブスクリプションの範囲で完結させます。n8n の AI ビルダーや、
従量課金の API キーが必要な仕組みは使いません。n8n MCP（`mcp__n8n__*`）の使い方は `.claude/agents/n8n-workflow-expert.md` の
「n8n MCP の使い方」に従います。

## Phase 0. 設計書の読み込みと確認

1. `$ARGUMENTS` を読む。引数が無い場合は `designs/` 直下の `status: ready` の設計書を一覧し、どれを構築するか確認する（`_TEMPLATE.md` と `examples/` は対象外。ただし明示的に指定された場合は構築してよい）。
2. front matter を確認する:
   - `status: draft` → 構築しない。記入が足りないセクションを指摘して終了
   - `status: ready` / `built` → 続行（`built` の場合は既存の `workflows/<id>.json` を更新する）
3. 見出し 1〜11 がそろっているか、トリガー・入力例・各ステップ・テストケースが具体的に書かれているかを確認する。
4. 「11. 未決事項」に項目がある、または実装に必要な情報が欠けている場合は、**構築を始める前に** AskUserQuestion でまとめて質問する。
   非対話モード（`npm run design:build -- <file> --auto`）で質問できない場合は、質問を設計書の「11. 未決事項」に追記して終了する。
5. n8n MCP が使えるか確認する: `mcp__n8n__search_nodes` を設計書のトリガー種別（例: `["webhook"]`）で 1 回呼ぶ。
   - 成功 → 以降のフェーズで MCP を使う
   - ツールが無い・エラー（n8n 未起動、未認証）→ n8n が止まっていれば `npm run n8n:up` を試す。それでも使えなければ MCP なしで進め、
     最終報告に「MCP 未接続のためノード定義の照合と MCP ケースの実行をしていない」と書く。
     ユーザーへの案内: n8n の Settings → Instance-level MCP を有効化し、Claude Code で `/mcp` → n8n → Authenticate

## Phase 1. 認証情報の準備

1. 「7. 認証情報・設定値」を `config/credentials.template.json`（`name`）と `config/secrets.example.env`（キー）に対応付ける。
2. テンプレートに無いサービス（「新規: …」）がある場合:
   - `config/credentials.template.json` に定義を追加する（`id` は 16 文字の英数字で一意。`data` の値は `${KEY}` の形式）
   - n8n の Credential の型名とフィールド名は、n8n のドキュメントやノードのソースで確認する。分からない場合は `httpHeaderAuth`（Generic API (Header) と同じ形式）で代用する
   - `config/secrets.example.env` に `[cred]` / `[env]` の注記付きでキーを追加する
3. 入力状況を確認する（値は表示されない）:
   ```bash
   npm run secrets:check -- <必要なキー...> N8N_API_KEY
   ```
   未入力のキーがある場合は、ユーザーに次を依頼して **待つ**（Claude は `secrets/` を読み書きできない）:
   - `npm run secrets:init`（新しいキーを secrets/secrets.env に追記）
   - `secrets/secrets.env` に値を記入
   - `N8N_API_KEY` は n8n UI > Settings > n8n API で発行（Webhook の HTTP テストで公開・非公開の切り替えに使う。
     未入力でも、MCP が使えれば Phase 4 の代替手順で確認できる）
   Phase 2〜3 はこの間に進めてよい。Phase 4 の前に必ず再確認する。

## Phase 2. ロジックの実装（Code ノード）

「4. 処理ステップ」で種類が Code のステップごとに、`code-node-engineer` サブエージェントへ依頼する。依頼には次を含める:
- ソースファイルのパス `src/javascript/code-nodes/<id>-<step-name>.js`
- 入力 items と出力 items の JSON 例（設計書の 3・4 セクションから）
- 処理ルールと異常系（設計書の 4・8 セクションから）
- テストケース（設計書の 9 セクションから、そのステップに関係する部分）

## Phase 3. ワークフロー JSON の構築

`n8n-workflow-expert` のルール（`.claude/agents/n8n-workflow-expert.md`）に従い `workflows/<id>.json` を作成・更新する。

まず、ノードごとに MCP で定義を確かめる（MCP が使える場合）:
1. `search_nodes` で、設計書の各ステップに合うノードの type と discriminator（resource / operation / mode）を調べる。
   複数のステップで使う定石があれば `get_workflow_best_practices` も見る
2. `get_node_types` を discriminator 付きで呼び、パラメータ名と構造、最新の version を確認する。推測でパラメータ名を書かない
3. `validate_node_config` で、各ノードの `parameters` と `typeVersion` を検証する（複数ノードを 1 回で渡せる）。
   エラーが無くなるまで直してから JSON に書く。Code ノードは `jsCode` を `// @source ...` 1 行にした状態で検証してよい
4. Credential 投入済みのサービスで、チャンネル名などの実際の値が必要なら `explore_node_resources` で確認する

続けて JSON を組み立てる:
- `id`: 新規の場合は 16 文字の英数字を生成する（`node -e "console.log(require('crypto').randomBytes(12).toString('base64url').replace(/[-_]/g,'x').slice(0,16))"`）。既存の場合は変更しない
- `name`: front matter の `title`
- `settings`: `{ "executionOrder": "v1", "availableInMCP": true }`
- `tags`: `[{ "name": "<front matter の category>" }]`（分類コードはちょうど 1 つ。Dashy のセクション分けに使われる）
- Webhook: `path` は設計書どおり。設計書が「処理結果を返す」の場合は `responseMode: "responseNode"` にする
- Code ノード: `jsCode` を `// @source <path>\n` にして `npm run sync:code`
- 認証情報: `"credentials": { "<type>": { "id": "<template の id>", "name": "<template の name>" } }`
- 設定値: `{{ $env.KEY }}`。値を JSON に直接書かない
- 失敗時の設定: リトライは `retryOnFail` / `maxTries` / `waitBetweenTries`、続行は `onError: "continueErrorOutput"` など
- Form Trigger: 各項目に `fieldName` を付け、`options.path` を設計書のパスにする
- 設計書の「9. テストケース」を `tests/workflows/<id>.cases.json` に変換する。ケースは 2 種類:
  - Webhook トリガー → HTTP ケース `{ "name", "request", "expect": { "status", "json", "textContains" } }`
  - それ以外（Form / Schedule / Manual）→ MCP ケース。`inputs` は MCP の `execute_workflow` の `inputs` と同じ形
    ```json
    {
      "name": "フォーム送信で受付番号が作られる",
      "trigger": "Form Trigger",
      "inputs": { "formData": { "name": "Alice", "email": "alice@example.com" } },
      "expect": { "status": "success", "node": "Build Reply", "json": { "accepted": true } }
    }
    ```
    `expect.node` の出力の 1 件目に対して、`expect.json` を部分一致で判定する。Schedule / Manual は `inputs` を省略する

検証（すべて成功するまで修正する）:
```bash
npm run sync:code && npm run validate:workflows && npm test
.venv/bin/ruff check . && .venv/bin/pytest   # Python を変更した場合
```

## Phase 4. テストデプロイ（ローカル n8n）

1. `docker compose ps --status running --services` に n8n が無ければ `npm run n8n:up` で起動し、`curl -sf http://localhost:5678/healthz` が通るまで待つ。
   - `secrets/secrets.env` を新しく作った、または値を変更した場合は、`docker compose up -d --force-recreate n8n` で環境変数を反映させる
2. `npm run secrets:check -- <必要なキー...> N8N_API_KEY` が成功することを再確認する。
3. 認証情報を投入する: `npm run n8n:credentials -- "<name>" ...`（必要なものだけ）
4. インポートする: `npm run n8n:import -- workflows/<id>.json`
5. HTTP ケースと有効化を確認する: `npm run n8n:test -- workflows/<id>.json`
   - 公開（有効化）できるか = Credential やノード設定に問題が無いかも、ここで確認される
   - MCP ケースは `skipped (MCP)` と表示されるだけなので、次の手順で実行する
6. MCP ケースを実行する（MCP が使える場合）:
   1. `get_workflow_details`（`workflowId` は JSON の `id`、`detailLevel: "execution"`）でトリガー名と入力の形を確認する
   2. ケースごとに `execute_workflow`（`executionMode: "manual"`、`triggerNodeName` = `trigger`、`inputs`）を呼ぶ
   3. 返ってきた executionId で `get_workflow_execution`（`includeData: true`、`nodeNames: [expect.node]`）を呼び、
      実行の `status` と、そのノードの出力の 1 件目が `expect.json` と部分一致するかを判定する
   4. 結果を `✓ / ✗ <ケース名>` の形で報告する
   - `N8N_API_KEY` が未入力で手順 5 を実行できない場合は、HTTP ケースも同じ方法で代わりに確認する
     （`inputs: { "webhookData": { "method", "body", "query", "headers" } }`、判定は Respond to Webhook の直前のノードの出力）。
     この方法では HTTP のステータスコードと応答本文は確かめられないため、報告にその旨を書く
7. 失敗した場合は `docker compose logs --tail=100 n8n`、レスポンス、実行データから原因を特定し、Phase 2〜3 に戻って修正する（最大 3 回）。
   - 修正したら `npm run n8n:import -- workflows/<id>.json` で取り込み直してから再テストする
   - 3 回直らない場合は、原因の仮説と確認してほしい点をまとめて報告し、終了する。
   - MCP ケースが無い Schedule トリガーなどは、有効化の確認までを行い、設計書に書かれた確認方法をユーザーに案内する。

## Phase 5. 仕上げ

1. `n8n-spec-writer` サブエージェントに `doc/specifications/<id>.md` の作成・更新を依頼する。その際、「目的」「非機能要件」などは設計書 `$ARGUMENTS` を一次情報として使うよう伝える。
   仕様書の作成後に `npm run dashy:sync` を実行し、Dashy のカタログ（仕様書・設計書へのリンクを含む）を更新する。
2. 設計書の front matter を `status: built` に更新し、末尾に次を追記（または更新）する:
   ```markdown
   ## 構築結果
   - ワークフロー: `workflows/<id>.json`（n8n: http://localhost:5678/workflow/<workflowId>）
   - Dashy: http://localhost:4000 の「[<category>] …」セクション
   - 仕様書: `doc/specifications/<id>.md`
   - テスト: `tests/workflows/<id>.cases.json`（最終実行: YYYY-MM-DD、N 件成功）
   ```
3. 最終報告: 作成・変更したファイル、テストデプロイの結果、ユーザーが行うこと（Credential の値の記入、本番での有効化など）。コミットはユーザーの指示があるまで行わない。

## 禁止事項
- `secrets/` 配下を読む・表示する・編集すること。`node scripts/secrets.js credentials` を直接実行すること
- API キーなどの値をワークフロー JSON・設計書・仕様書・テストケースに書くこと
- `docker compose down -v` の実行
- MCP の `create_workflow_from_code` / `update_workflow` / `publish_workflow` で、構築対象のワークフローを n8n 上で直接作成・変更すること
  （正は `workflows/<id>.json`。n8n への反映は `npm run n8n:import`）
