#!/usr/bin/env bash
# ローカル n8n 上のワークフローを workflows/ へエクスポートする（UI で編集した内容を Git に戻す用）。
#
#   bash scripts/n8n-export.sh          # 全ワークフローを <id>.json として出力
#   bash scripts/n8n-export.sh <id>     # 指定 ID のみ workflows/<id>.json へ出力
set -euo pipefail

cd "$(dirname "$0")/.."

SERVICE="n8n"
CONTAINER_DIR="/home/node/workflows"

if ! docker compose ps --status running --services 2>/dev/null | grep -qx "$SERVICE"; then
  echo "error: n8n コンテナが起動していません。先に 'npm run n8n:up' を実行してください。" >&2
  exit 1
fi

if [ "$#" -ge 1 ]; then
  docker compose exec -T "$SERVICE" n8n export:workflow --id="$1" --pretty --output="$CONTAINER_DIR/$1.json"
else
  docker compose exec -T "$SERVICE" n8n export:workflow --all --separate --pretty --output="$CONTAINER_DIR/"
fi

node scripts/validate-workflows.js
echo "Exported. 'git diff workflows/' で差分を確認してください。"
