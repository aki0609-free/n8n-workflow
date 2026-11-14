# designs/ — ワークフロー設計書（Claude への入力）

ここに置いた設計書をもとに、Claude Code がワークフローの構築からローカル n8n へのテストデプロイまでを自動で行います。

## 使い方

1. `_TEMPLATE.md` をコピーして `designs/<id>.md` を作る（`<id>` は kebab-case。`workflows/<id>.json` になる）
   ```bash
   cp designs/_TEMPLATE.md designs/order-notify.md
   ```
2. 各セクションを記入し、front matter の `status` を `ready` にする
3. コマンドを実行する
   ```bash
   npm run design:build -- designs/order-notify.md          # Claude Code が起動して構築開始（推奨）
   npm run design:build -- designs/order-notify.md --auto   # 確認なしで最後まで自動実行
   npm run design:build                                     # ready の設計書が 1 つならそれを構築
   npm run design:list                                      # 設計書の一覧と status
   ```
   - 推奨モードでは Claude Code の対話画面が開き、質問への回答や、Credential 投入・テストデプロイの許可を求められます。
   - `--auto` は質問ができないため、未決事項があると設計書の「11. 未決事項」に質問を書き込んで止まります。回答を書き込んでから再実行してください。
   - Claude Code の中から `/build-from-design designs/order-notify.md` と入力しても同じです。
4. Claude が次を行い、結果を報告する
   - 不足している情報の確認（未決事項があれば質問）
   - 必要な Credential を確認する。テンプレートに無ければ `config/` に追加し、`secrets/secrets.env` への記入を依頼する
   - Code ノードの実装と単体テスト（`code-node-engineer`）
   - `workflows/<id>.json` の構築と検証
   - 設計書の「9. テストケース」から `tests/workflows/<id>.cases.json` を作成
   - ローカル n8n へ Credential とワークフローをインポートし、有効化してテストケースを実行
   - 仕様書 `doc/specifications/<id>.md` の作成（`n8n-spec-writer`）
   - 設計書の `status` を `built` に更新

## status の流れ

| status | 意味 | Claude の動作 |
| --- | --- | --- |
| `draft` | 記入中 | 構築しない（不足箇所の指摘のみ） |
| `ready` | 記入完了 | 構築する |
| `built` | 構築済み | 再実行すると、差分を反映して再構築する |

## 書き方のコツ

- **`category` に分類コードを書く**（`config/categories.yml` の SLS / MKT / CS / OPS / DATA / AI / SMP）。構築後、Dashy のその分類のセクションに表示されます。
- **見出しの番号と名前は変えない**。Claude はこの構成を前提に読み取ります。不要なセクションは「なし」と書きます。
- **入出力は JSON の例で書く**。文章で説明するより正確に伝わります。
- **テストケースを必ず書く**。テストデプロイの合否判定に使われます。期待値には確認したい項目だけを書けば十分です（部分一致で判定します）。
- **認証情報は名前で指定する**。`config/credentials.template.json` の `name`（例: `Slack Bot`）を書きます。値は設計書に書きません。
- 決まっていないことは「11. 未決事項」に書きます。Claude が構築前に確認します。

## ファイル

| ファイル | 内容 |
| --- | --- |
| `_TEMPLATE.md` | 設計書のひな形（記入方法をコメントで記載） |
| `examples/order-notify.md` | 記入例（注文 Webhook → 金額で振り分け → Slack 通知） |
