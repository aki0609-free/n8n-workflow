#!/usr/bin/env bash
# workflows/ の JSON をローカル n8n（docker compose の n8n サービス）へ CLI インポートする。
#
#   bash scripts/n8n-import.sh                         # workflows/*.json をすべてインポート
#   bash scripts/n8n-import.sh workflows/foo.json ...  # 指定ファイルのみ
#
# 同じ "id" を持つワークフローは上書き（upsert）される。
set -euo pipefail

cd "$(dirname "$0")/.."

SERVICE="n8n"
CONTAINER_DIR="/home/node/workflows"

if ! docker compose ps --status running --services 2>/dev/null | grep -qx "$SERVICE"; then
  echo "error: n8n コンテナが起動していません。先に 'npm run n8n:up' を実行してください。" >&2
  exit 1
fi

# インポート前に構文・構造チェックと Code ノード同期チェック
node scripts/validate-workflows.js "$@"
node scripts/sync-code-nodes.js --check

if [ "$#" -eq 0 ]; then
  set -- workflows/*.json
fi

status=0
for file in "$@"; do
  case "$file" in
    workflows/*.json) ;;
    *)
      echo "skip: $file (workflows/ 配下の .json のみ対象)" >&2
      status=1
      continue
      ;;
  esac
  if [ ! -f "$file" ]; then
    echo "error: $file が見つかりません" >&2
    status=1
    continue
  fi
  name="$(basename "$file")"
  echo "→ importing $file"
  if ! docker compose exec -T "$SERVICE" n8n import:workflow --input="$CONTAINER_DIR/$name"; then
    status=1
  fi
done

# Dashy のカタログを更新（失敗してもインポート結果には影響させない）
node scripts/dashy-sync.js || echo "warning: dashy:sync に失敗しました" >&2

exit "$status"
