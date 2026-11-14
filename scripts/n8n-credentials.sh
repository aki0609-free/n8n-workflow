#!/usr/bin/env bash
# secrets/secrets.env の値を config/credentials.template.json に埋め込み、
# ローカル n8n へ Credential として一括インポートする。
#
#   bash scripts/n8n-credentials.sh                 # 値が揃っている Credential をすべて
#   bash scripts/n8n-credentials.sh "Slack Bot" ... # 名前または ID で指定
#
# 平文の JSON はホストにファイルとして残さず、標準入力でコンテナに渡す。
# 同じ id の Credential は上書きされる。
set -euo pipefail

cd "$(dirname "$0")/.."

SERVICE="n8n"

if ! docker compose ps --status running --services 2>/dev/null | grep -qx "$SERVICE"; then
  echo "error: n8n コンテナが起動していません。先に 'npm run n8n:up' を実行してください。" >&2
  exit 1
fi

json="$(N8N_CREDENTIALS_PIPE=1 node scripts/secrets.js credentials "$@")"

if [ "$json" = "[]" ]; then
  echo "インポート対象の Credential がありません（secrets/secrets.env の入力状況は 'npm run secrets:check' で確認）。"
  exit 0
fi

printf '%s' "$json" | docker compose exec -T "$SERVICE" sh -c '
  umask 077
  f="$(mktemp)"
  cat > "$f"
  n8n import:credentials --input="$f"
  rc=$?
  rm -f "$f"
  exit $rc
'
unset json
echo "Credential をインポートしました。"
