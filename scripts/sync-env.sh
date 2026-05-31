#!/usr/bin/env bash
#
# sync-env.sh — consolidate .env.local from the project-hub vault.
#
# Pulls youtube-studio-ai-scoped secrets from the central vault and writes a
# managed block into .env.local (gitignored). Uses shell-var indirection so no
# secret literal is ever echoed. Re-runnable / idempotent (replaces its own
# managed block). NEVER commit .env.local.
#
# Usage:  bash scripts/sync-env.sh
set -euo pipefail

VAULT_URL="${VAULT_URL:-https://fantastic-roadrunner-485.convex.cloud}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$HERE/.env.local"
MARKER="# --- vault-managed (youtube-studio-ai) ---"

getone() { # service keyName -> value (consumed only via command substitution)
  curl -s -X POST "$VAULT_URL/api/query" -H 'Content-Type: application/json' \
    -d "{\"path\":\"secrets:getOne\",\"args\":{\"service\":\"$1\",\"keyName\":\"$2\"},\"format\":\"json\"}" \
    | python3 -c 'import sys,json; d=json.load(sys.stdin); v=d.get("value"); print(v.get("value") if isinstance(v,dict) else "")'
}

TRIGGER_SECRET_KEY="$(getone trigger TRIGGER_SECRET_KEY_YOUTUBE_STUDIO_DEV)"
TRIGGER_PROJECT_REF="$(getone trigger TRIGGER_PROJECT_REF_YOUTUBE_STUDIO)"
R2_ACCOUNT_ID="$(getone cloudflare R2_ACCOUNT_ID)"
R2_ACCESS_KEY_ID="$(getone cloudflare R2_ACCESS_KEY_ID)"
R2_SECRET_ACCESS_KEY="$(getone cloudflare R2_SECRET_ACCESS_KEY)"
R2_ENDPOINT="$(getone cloudflare R2_ENDPOINT)"
TELEGRAM_BOT_TOKEN="$(getone telegram TELEGRAM_BOT_TOKEN)"

# Strip any prior managed block.
if [ -f "$ENV_FILE" ] && grep -qF "$MARKER" "$ENV_FILE"; then
  python3 - "$ENV_FILE" "$MARKER" <<'PY'
import sys
p, marker = sys.argv[1], sys.argv[2]
txt = open(p).read()
open(p, "w").write(txt.split(marker)[0].rstrip() + "\n")
PY
fi

{
  echo ""
  echo "$MARKER"
  echo "# Pulled from project-hub vault. DO NOT COMMIT."
  echo "TRIGGER_SECRET_KEY=${TRIGGER_SECRET_KEY}"
  echo "TRIGGER_PROJECT_REF=${TRIGGER_PROJECT_REF}"
  echo "R2_ACCOUNT_ID=${R2_ACCOUNT_ID}"
  echo "R2_ACCESS_KEY_ID=${R2_ACCESS_KEY_ID}"
  echo "R2_SECRET_ACCESS_KEY=${R2_SECRET_ACCESS_KEY}"
  echo "R2_ENDPOINT=${R2_ENDPOINT}"
  echo "R2_BUCKET=youtube-studio-ai"
  echo "TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}"
} >> "$ENV_FILE"

echo "wrote managed block to $ENV_FILE (keys only):"
grep -E '^[A-Z].*=' "$ENV_FILE" | cut -d= -f1 | sort -u
