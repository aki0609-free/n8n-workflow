---
# ===== メタ情報（必須） =====
id: my-workflow            # kebab-case。workflows/<id>.json、doc/specifications/<id>.md の名前になる
title: ワークフローの名前    # n8n 上の表示名（Dashy では先頭 18 文字まで表示）
category: SMP              # 分類コード（config/categories.yml: SLS / MKT / CS / OPS / DATA / AI / SMP）
status: draft              # draft（記入中） | ready（構築してよい） | built（構築済み。Claude が更新）
owner: 担当者名
---

# <title>

<!--
記入ルール
- 見出し（## 1. 〜 ## 11.）の番号と名前は変更しない。不要なセクションは「なし」と書く。
- HTML コメントで書かれた部分は記入ガイド。記入後は消してもよい。
- API キーなどの値は書かない。認証情報は config/credentials.template.json の name で指定する。
-->

## 1. 目的・背景

<!-- 何のために、誰が使うのか。2〜5 行。仕様書の「目的」にそのまま使われる -->

## 2. トリガー

<!--
種類: webhook | schedule | manual | app-event（例: Slack のメッセージ受信）
- webhook  : メソッド・パス・認証の有無・応答方法（すぐ 200 を返す / 処理結果を返す）
- schedule : cron 式またはわかりやすい表現（例: 平日 9:00 JST）
-->

| 項目 | 値 |
| --- | --- |
| 種類 | webhook |
| メソッド / パス | POST `/my-workflow` |
| 認証 | なし |
| 応答 | 処理結果を JSON で返す |

## 3. 入力データ

<!-- トリガーが受け取るデータ。項目の表と JSON の例の両方を書く -->

| 項目 | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `field` | string | ○ | 説明 |

```json
{
  "field": "value"
}
```

## 4. 処理ステップ

<!--
上から順に実行される処理を 1 ステップずつ書く。1 ステップがおおむね 1 ノードになる。
- 種類: n8n のノード名が分かれば書く（Code / IF / Switch / HTTP Request / Slack / Set など）。分からなければ「おまかせ」
- ロジックが複雑なもの（計算・整形・判定など）は種類を「Code」にすると、JS で実装して単体テストを付ける
-->

### Step 1: ステップ名

- **種類**: Code
- **入力**: 前のステップから受け取るもの
- **処理**: やること（条件や計算式は具体的に）
- **出力**: 次のステップに渡すもの（JSON の例があると確実）
- **失敗時**: 停止 / リトライ（回数・間隔）/ スキップして続行 / エラー通知

### Step 2: ステップ名

- **種類**:
- **入力**:
- **処理**:
- **出力**:
- **失敗時**:

## 5. 分岐条件

<!-- IF / Switch で流れが分かれる場合のみ。無ければ「なし」 -->

| 分岐点 | 条件 | true / 該当時 | false / それ以外 |
| --- | --- | --- | --- |
| Step N | `amount >= 100000` | Step X へ | Step Y へ |

## 6. 出力・外部連携

<!-- 最終的に何をどこへ出すか（レスポンス、Slack 投稿、DB 書き込み、メール送信など） -->

| 出力先 | 操作 | 内容 | 使用する認証情報 |
| --- | --- | --- | --- |
| Webhook レスポンス | JSON を返す | `{ "ok": true }` | — |

## 7. 認証情報・設定値

<!--
- 認証情報: config/credentials.template.json の name（Slack Bot / OpenAI / Anthropic / Notion / GitHub /
  Generic API (Header) / SMTP / External Postgres）。テンプレートに無いサービスは「新規: サービス名」と書く
- 設定値: secrets/secrets.env の [env] キー（ワークフローでは {{ $env.KEY }} で参照）
-->

| 種類 | 名前 / キー | 用途 |
| --- | --- | --- |
| 認証情報 | Slack Bot | 通知の投稿 |
| 設定値 | SLACK_DEFAULT_CHANNEL | 投稿先チャンネル |

## 8. エラーハンドリング

<!-- 全体として失敗をどう扱うか。入力不正時の応答、外部 API 失敗時のリトライ、エラー通知先など -->

- 入力が不正な場合:
- 外部 API が失敗した場合:
- エラー通知:

## 9. テストケース

<!--
テストデプロイの合否判定に使う（tests/workflows/<id>.cases.json に変換される）。
- webhook トリガーの場合は request / expect を JSON で書く。expect.json は部分一致（確認したい項目だけ書く）
- 外部サービスに副作用がある処理（Slack 投稿など）は、テストで実際に実行されることに注意して書く
- webhook 以外のトリガーは、確認方法を文章で書く（Claude は有効化の成否までを自動確認する）
-->

### Case 1: 正常系の説明

```json
{
  "request": { "method": "POST", "path": "my-workflow", "body": { "field": "value" } },
  "expect": { "status": 200, "json": { "ok": true } }
}
```

### Case 2: 異常系の説明

```json
{
  "request": { "method": "POST", "path": "my-workflow", "body": {} },
  "expect": { "status": 400, "json": { "ok": false } }
}
```

## 10. 非機能要件

<!-- 不明なら空欄でよい（仕様書では「要確認」になる） -->

| 項目 | 値 |
| --- | --- |
| 想定実行頻度 / 件数 | |
| タイムアウト | |
| 実行時間帯の制約 | |

## 11. 未決事項

<!-- 決まっていないこと。ここに項目がある場合、Claude は構築前に確認する。無ければ「なし」 -->

- なし
