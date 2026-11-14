---
id: order-notify
title: 注文通知（金額で振り分けて Slack 通知）
category: SLS
status: ready
owner: sales-ops
---

# 注文通知（金額で振り分けて Slack 通知）

## 1. 目的・背景

EC サイトで注文が確定したときに、営業チームへ Slack で通知する。
10 万円以上の高額注文は対応を急ぐため、別チャンネル（#sales-alert）に通知して見落としを防ぐ。

## 2. トリガー

| 項目 | 値 |
| --- | --- |
| 種類 | webhook |
| メソッド / パス | POST `/order-notify` |
| 認証 | なし（社内ネットワークからのみ呼ばれる想定） |
| 応答 | 処理結果を JSON で返す |

## 3. 入力データ

| 項目 | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `orderId` | string | ○ | 注文番号 |
| `customerName` | string | ○ | 顧客名 |
| `amount` | number | ○ | 税込金額（円）。0 以上 |
| `items` | array | — | `{ name, quantity }` の配列 |

```json
{
  "orderId": "A-1001",
  "customerName": "山田商事",
  "amount": 128000,
  "items": [{ "name": "ノートPC", "quantity": 1 }]
}
```

## 4. 処理ステップ

### Step 1: 注文の検証と整形

- **種類**: Code
- **入力**: Webhook のボディ
- **処理**:
  - 必須項目（`orderId`・`customerName`・`amount`）を検証する。`amount` が数値でない、または負の場合は不正とする
  - `priority` を付与する。`amount >= 100000` なら `high`、それ以外は `normal`
  - Slack に投稿する本文 `message` を作る:
    `[高額注文] A-1001 山田商事 様 ¥128,000（ノートPC×1）`（normal の場合は先頭が `[注文]`）
- **出力**: `{ valid, errors, orderId, priority, message }`
- **失敗時**: 停止（入力不正は Step 2 で 400 を返す）

### Step 2: 入力チェック

- **種類**: IF
- **入力**: Step 1 の出力
- **処理**: `valid` が true かどうか
- **出力**: true → Step 3、false → Step 5
- **失敗時**: 停止

### Step 3: 優先度で振り分け

- **種類**: IF
- **入力**: Step 1 の出力
- **処理**: `priority` が `high` かどうか
- **出力**: true → Slack の #sales-alert、false → `SLACK_DEFAULT_CHANNEL`
- **失敗時**: 停止

### Step 4: Slack 通知

- **種類**: Slack（メッセージ送信）
- **入力**: Step 3 の振り分け結果
- **処理**: `message` を該当チャンネルに投稿する
- **出力**: 成功レスポンス `{ ok: true, orderId, priority }`
- **失敗時**: リトライ 3 回（5 秒間隔）。それでも失敗したら 502 を返す

### Step 5: 不正入力の応答

- **種類**: Respond to Webhook
- **入力**: Step 1 の出力（valid = false）
- **処理**: ステータス 400 で `{ ok: false, errors }` を返す
- **出力**: HTTP レスポンス
- **失敗時**: —

## 5. 分岐条件

| 分岐点 | 条件 | true / 該当時 | false / それ以外 |
| --- | --- | --- | --- |
| Step 2 | `valid === true` | Step 3 へ | Step 5（400 応答）へ |
| Step 3 | `priority === "high"` | #sales-alert に投稿 | `SLACK_DEFAULT_CHANNEL` に投稿 |

## 6. 出力・外部連携

| 出力先 | 操作 | 内容 | 使用する認証情報 |
| --- | --- | --- | --- |
| Slack #sales-alert | メッセージ投稿 | 高額注文の通知 | Slack Bot |
| Slack `SLACK_DEFAULT_CHANNEL` | メッセージ投稿 | 通常注文の通知 | Slack Bot |
| Webhook レスポンス | JSON を返す | 成功: `{ ok: true, orderId, priority }` / 不正: 400 `{ ok: false, errors }` | — |

## 7. 認証情報・設定値

| 種類 | 名前 / キー | 用途 |
| --- | --- | --- |
| 認証情報 | Slack Bot | 通知の投稿 |
| 設定値 | SLACK_DEFAULT_CHANNEL | 通常注文の投稿先 |

## 8. エラーハンドリング

- 入力が不正な場合: 400 と不正項目の一覧を返す。Slack には投稿しない
- 外部 API が失敗した場合: Slack 投稿を 3 回リトライし、失敗したら 502 `{ ok: false, errors: ["slack_failed"] }` を返す
- エラー通知: なし（呼び出し元がレスポンスで判断する）

## 9. テストケース

### Case 1: 高額注文は high として処理される

```json
{
  "request": {
    "method": "POST",
    "path": "order-notify",
    "body": { "orderId": "T-1", "customerName": "テスト商事", "amount": 150000 }
  },
  "expect": { "status": 200, "json": { "ok": true, "orderId": "T-1", "priority": "high" } }
}
```

### Case 2: 通常注文は normal として処理される

```json
{
  "request": {
    "method": "POST",
    "path": "order-notify",
    "body": { "orderId": "T-2", "customerName": "テスト商事", "amount": 3000 }
  },
  "expect": { "status": 200, "json": { "ok": true, "priority": "normal" } }
}
```

### Case 3: 金額が不正なら 400

```json
{
  "request": {
    "method": "POST",
    "path": "order-notify",
    "body": { "orderId": "T-3", "customerName": "テスト商事", "amount": -1 }
  },
  "expect": { "status": 400, "json": { "ok": false } }
}
```

## 10. 非機能要件

| 項目 | 値 |
| --- | --- |
| 想定実行頻度 / 件数 | 1 日 200 件程度 |
| タイムアウト | 10 秒以内に応答 |
| 実行時間帯の制約 | なし |

## 11. 未決事項

- なし
