---
id: memo-to-gmail
title: メモを自分の Gmail に送る
category: OPS
status: built
owner: studio
---

# メモを自分の Gmail に送る

## 1. 目的・背景

思いついたことや、あとでやることを、フォームからすぐに自分の Gmail へ送って残すためのアプリ。
Dashy から開いたフォームにメモを書いて送信すると、Gmail の SMTP（アプリパスワード）で自分宛てにメールが届く。
件名の頭に「[メモ]」と日時を付けて、Gmail で検索や振り分けをしやすくする。使うのは本人だけ。

## 2. トリガー

| 項目 | 値 |
| --- | --- |
| 種類 | form |
| パス | `/form/memo-to-gmail`（http://localhost:5678/form/memo-to-gmail） |
| フォームのタイトル | メモをメールで送る |
| フォームの説明 | 入力したメモを自分の Gmail に送ります |
| ボタンの文言 | 送信 |
| 認証 | なし（ローカル環境で本人だけが使う想定） |
| 応答 | 最後のノードの結果を表示する（`responseMode: lastNode`）。成功時は「メモを送信しました」、失敗時はエラーメッセージを表示 |

## 3. 入力データ

| fieldName | ラベル | 種類 | 必須 | 説明 |
| --- | --- | --- | --- | --- |
| `title` | 件名 | text | — | メールの件名に使う。空欄なら本文の最初の 20 文字を使う |
| `memo` | メモ | textarea | ○ | メールの本文。改行はそのまま残す |

```json
{
  "title": "買い物リスト",
  "memo": "牛乳\n卵\nパン",
  "submittedAt": "2026-11-14T10:30:00.000+09:00"
}
```

※ `submittedAt` はフォームトリガーが自動で付ける送信日時（ワークフローのタイムゾーン Asia/Tokyo）。

## 4. 処理ステップ

### Step 1: フォーム受付

- **種類**: n8n Form Trigger
- **入力**: フォームの送信内容
- **処理**: 「3. 入力データ」の 2 項目を持つフォームを出す。`responseMode` は `lastNode`（最後のフォーム完了ノードの内容を表示する）
- **出力**: `{ title, memo, submittedAt }`
- **失敗時**: 停止

### Step 2: メール内容の作成（Build Memo Mail）

- **種類**: Code
- **入力**: Step 1 の出力
- **処理**:
  - `memo` の前後の空白を取り除く。空になる場合（空白や改行だけの場合）は `valid: false`、`errors: ["memo_required"]` にする
  - `subjectTitle` を決める。`title` の前後の空白を取り除き、空でなければそれを使う。空なら `memo` の改行を半角スペースに置き換え、最初の 20 文字（絵文字なども 1 文字として数える）を使う。20 文字を超えた場合は先頭 19 文字＋「…」（「…」を含めて 20 文字）にする
  - 日時 `sentAtText` を `submittedAt` から日本時間の `YYYY-MM-DD HH:mm` 形式で作る（`submittedAt` が無い・解析できない場合は現在時刻を使う）
  - `subject` = `[メモ] {sentAtText} {subjectTitle}`
    例: `[メモ] 2026-11-14 10:30 買い物リスト`
  - `text` = `memo`（前後の空白を除いたもの）＋ 空行 ＋ `---` ＋ `送信日時: {sentAtText}`
- **出力**:
  ```json
  {
    "valid": true,
    "errors": [],
    "subjectTitle": "買い物リスト",
    "sentAtText": "2026-11-14 10:30",
    "subject": "[メモ] 2026-11-14 10:30 買い物リスト",
    "text": "牛乳\n卵\nパン\n\n---\n送信日時: 2026-11-14 10:30"
  }
  ```
- **失敗時**: 停止

### Step 3: 入力チェック

- **種類**: IF
- **入力**: Step 2 の出力
- **処理**: `valid` が true かどうか
- **出力**: true → Step 4、false → Step 6
- **失敗時**: 停止

### Step 4: メール送信（Send Memo Mail）

- **種類**: Send Email（SMTP、operation: send）
- **入力**: Step 2 の出力
- **処理**:
  - 送信元 `fromEmail` = `{{ $env.SMTP_FROM }}`、宛先 `toEmail` = `{{ $env.SMTP_FROM }}`
  - 件名 = `subject`、形式 = text、本文 = `text`
  - 「This email was sent automatically with n8n」の一文は付けない（`appendAttribution: false`）
- **出力**: 送信結果 → Step 5
- **失敗時**: リトライ 2 回（5 秒間隔）。それでも失敗したらエラー出力（On Error: Continue (using error output)）から Step 7 へ進む

### Step 5: 送信完了の表示（Done）

- **種類**: n8n Form（completion）
- **入力**: Step 4 の成功出力
- **処理**: タイトル「メモを送信しました」、メッセージ「Gmail を確認してください。件名: {subject}」を表示する
- **出力**: フォームの完了画面
- **失敗時**: —

### Step 6: 入力不正の表示（Invalid Input）

- **種類**: n8n Form（completion）
- **入力**: Step 2 の出力（valid = false）
- **処理**: タイトル「送信できませんでした」、メッセージ「メモが空です。内容を入力してもう一度送信してください。」を表示する
- **出力**: フォームの完了画面
- **失敗時**: —

### Step 7: 送信失敗の表示（Send Failed）

- **種類**: n8n Form（completion）
- **入力**: Step 4 のエラー出力
- **処理**: タイトル「送信に失敗しました」、メッセージ「メールを送信できませんでした。SMTP の設定（アプリパスワードなど）を確認してください。」を表示する
- **出力**: フォームの完了画面
- **失敗時**: —

## 5. 分岐条件

| 分岐点 | 条件 | true / 該当時 | false / それ以外 |
| --- | --- | --- | --- |
| Step 3 | `valid === true` | Step 4（メール送信）へ | Step 6（入力不正の表示）へ |
| Step 4 | メール送信が成功した | Step 5（送信完了の表示）へ | Step 7（送信失敗の表示）へ |

## 6. 出力・外部連携

| 出力先 | 操作 | 内容 | 使用する認証情報 |
| --- | --- | --- | --- |
| 自分の Gmail（`SMTP_FROM`） | メール送信（SMTP） | 件名 `[メモ] 日時 件名`、本文はメモ＋送信日時 | SMTP |
| フォームの完了画面 | 画面表示 | 成功 / 入力不正 / 送信失敗のメッセージ | — |

## 7. 認証情報・設定値

| 種類 | 名前 / キー | 用途 |
| --- | --- | --- |
| 認証情報 | SMTP | Gmail の SMTP でメールを送る（ホスト `smtp.gmail.com`・ポート 587・SECURE false・ユーザーは Gmail アドレス・パスワードはアプリパスワード。値は本人が `secrets/secrets.env` に記入） |
| 設定値 | SMTP_FROM | 送信元と宛先の両方に使う自分の Gmail アドレス |

## 8. エラーハンドリング

- 入力が不正な場合: メモが空（空白や改行だけ）の場合はメールを送らず、フォームに「送信できませんでした」を表示する。メモ欄は必須なので、まったくの空欄はフォーム側で送信できない
- 外部 API が失敗した場合: SMTP 送信を 2 回リトライ（5 秒間隔）し、それでも失敗したらフォームに「送信に失敗しました」と SMTP 設定を確認する案内を表示する。実行は n8n の実行履歴に残る
- エラー通知: なし（フォームの画面で本人がその場で確認する）

## 9. テストケース

※ Case 1・2 は実際に自分の Gmail へメールが 1 通ずつ届く（件名に「テスト」が入る）。
※ 件名の日時は実行時刻で変わるため、自動判定は日時を含まない項目（`subjectTitle` など）で行う。

### Case 1: 件名ありのメモが送信される

```json
{
  "trigger": "Form Trigger",
  "inputs": { "formData": { "title": "テスト件名", "memo": "テストのメモです\n2 行目" } },
  "expect": {
    "status": "success",
    "node": "Build Memo Mail",
    "json": { "valid": true, "subjectTitle": "テスト件名" }
  }
}
```

確認方法（手動）: Gmail に `[メモ] YYYY-MM-DD HH:mm テスト件名` の件名でメールが届き、本文に 2 行のメモと「送信日時:」が入っていること。

### Case 2: 件名が空なら本文の最初の 20 文字が件名になる

```json
{
  "trigger": "Form Trigger",
  "inputs": {
    "formData": { "title": "", "memo": "テスト本文の先頭二十文字を件名に使うことを確かめる" }
  },
  "expect": {
    "status": "success",
    "node": "Build Memo Mail",
    "json": { "valid": true, "subjectTitle": "テスト本文の先頭二十文字を件名に使うこ…" }
  }
}
```

### Case 3: メモが空白だけならメールを送らない

```json
{
  "trigger": "Form Trigger",
  "inputs": { "formData": { "title": "空メモ", "memo": "   \n  " } },
  "expect": {
    "status": "success",
    "node": "Build Memo Mail",
    "json": { "valid": false, "errors": ["memo_required"] }
  }
}
```

確認方法: 実行履歴で「Send Memo Mail」が実行されず、「Invalid Input」まで進んでいること。

## 10. 非機能要件

| 項目 | 値 |
| --- | --- |
| 想定実行頻度 / 件数 | 1 日数件〜数十件（本人のみ） |
| タイムアウト | 30 秒以内に完了画面を表示（リトライを含む） |
| 実行時間帯の制約 | なし |

## 11. 未決事項

- なし

## 構築結果
- ワークフロー: `workflows/memo-to-gmail.json`（n8n: http://localhost:5678/workflow/1uLVnIsVtSyS4cLe、公開済み）
- フォーム: http://localhost:5678/form/memo-to-gmail（Dashy の「[OPS] 社内業務・運用」のカードから開く）
- 仕様書: `doc/specifications/memo-to-gmail.md`
- テスト: `tests/workflows/memo-to-gmail.cases.json`（MCP ケース。最終確認: 2026-11-14。空メモの分岐と、本番フォームからの送信で Gmail への送信成功を確認）
