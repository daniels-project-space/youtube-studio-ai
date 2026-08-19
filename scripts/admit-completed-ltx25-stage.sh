#!/usr/bin/env bash
set -euo pipefail

stage_session="${LTX_STAGE_SESSION:-ltx25-stage-v2}"
stage_log="${LTX_STAGE_LOG:-/var/tmp/youtube-studio-ltx25-stage-v2.log}"
admission_log="${LTX_STAGE_ADMISSION_LOG:-/var/tmp/youtube-studio-ltx25-stage-v2-admission.log}"
while tmux has-session -t "$stage_session" 2>/dev/null; do sleep 30; done

receipt_key="$(sed -nE 's/.*"receiptKey":"([^"]+)".*/\1/p' "$stage_log" | head -1)"
if ! rg -q '"event":"verified"' "$stage_log" || [[ ! "$receipt_key" =~ ^novita/staging/ltx-2\.5-[a-f0-9]{24}\.json$ ]]; then
  printf '%s stage did not complete a valid LTX receipt; admission skipped\n' "$(date -u +%FT%TZ)" >> "$admission_log"
  exit 1
fi
codex-vault-exec cloudflare R2_ACCESS_KEY_ID=R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY=R2_SECRET_ACCESS_KEY R2_ENDPOINT=R2_ENDPOINT -- node "$(dirname "$0")/admit-ltx25-stage.mjs" "$receipt_key" >> "$admission_log" 2>&1
