# ワークフロー仕様書

ワークフローごとの仕様書です。原則として `n8n-spec-writer` サブエージェントが作成・更新します（[claude-code.md](../claude-code.md) 参照）。

- 命名: `workflows/<name>.json` → `doc/specifications/<name>.md`
- 書式: [_TEMPLATE.md](_TEMPLATE.md)
- 「9. 補足（手動記述）」は人間が書く欄です。エージェントはこの欄を変更しません。
- 「**要確認**」と書かれた項目は、コードからは判断できない事項です。担当者が確認して追記してください。

## 一覧

| 仕様書 | ワークフロー | トリガー | 概要 |
| --- | --- | --- | --- |
| [contacts-intake.md](contacts-intake.md) | `workflows/contacts-intake.json` | Webhook（POST `/contacts-intake`） | 連絡先データを受け取り、正規化・検証・重複排除して JSON で返す |
| [memo-to-gmail.md](memo-to-gmail.md) | `workflows/memo-to-gmail.json` | Form Trigger（`/form/memo-to-gmail`） | フォームで入力したメモを、件名に「[メモ]」と日時を付けて SMTP で自分の Gmail に送る |
