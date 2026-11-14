# hooks

フックスクリプトを配置するディレクトリです。
`.claude/settings.json` の `hooks` から `$CLAUDE_PROJECT_DIR/.claude/hooks/<script>` のように参照します。

| スクリプト | イベント | 内容 |
| --- | --- | --- |
| `format-on-edit.js` | PostToolUse (`Write\|Edit\|MultiEdit`) | JS/TS → Prettier、Python → `ruff check --fix` + `ruff format` |
| `spec-reminder.js` | PostToolUse (`Write\|Edit\|MultiEdit`) | `workflows/*.json`・`src/javascript/code-nodes/`・`src/python/` の編集時に、`n8n-spec-writer` で仕様書を更新するよう Claude へ通知（ブロックしない） |

- フォーマッタ未インストール時は警告のみでスキップします（`npm install` / `pip install -r requirements-dev.txt` で有効化）。
- フォーマッタがエラー（構文エラーや自動修正できない lint 違反）を返した場合は exit 2 となり、内容が Claude にフィードバックされます。
- 動作確認: `echo '{"tool_input":{"file_path":"'"$PWD"'/src/javascript/code-nodes/format-contacts.js"}}' | node .claude/hooks/format-on-edit.js`
