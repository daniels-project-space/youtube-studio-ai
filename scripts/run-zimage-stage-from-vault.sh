#!/usr/bin/env bash
set -euo pipefail

# Do not expand this token into a tmux command or process argv.  The stage
# controller receives it only as an inherited environment value and passes it
# to the isolated, short-lived staging worker.
export HF_TOKEN
HF_TOKEN="$(pass show codex/shared/huggingface/ltx-2-5-read-token)"
exec node "$(dirname "$0")/stage-zimage-volume.mjs"
