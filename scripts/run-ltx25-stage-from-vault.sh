#!/usr/bin/env bash
set -euo pipefail

# Kept separate so the Hugging Face token is never placed in a process argv,
# shell history entry, repository file, or supervisor log.
export HF_TOKEN
HF_TOKEN="$(pass show codex/shared/huggingface/ltx-2-5-read-token)"
exec node "$(dirname "$0")/stage-ltx25-volume.mjs"
