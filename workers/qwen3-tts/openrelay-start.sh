#!/usr/bin/env bash
# Persistent-volume bootstrap for the public PyTorch base fallback.
#
# GitHub organization policy may leave a source-linked GHCR package private.
# This launcher keeps every heavy mutable layer on /workspace instead: the
# pinned worker source and Python environment are built once, then Qwen's
# entrypoint separately downloads its immutable model revision once. Neither
# path is repeated after an OpenRelay stop/start.
set -euo pipefail

readonly VOLUME="${QWEN3_TTS_VOLUME:-/workspace/qwen3-tts}"
readonly SOURCE_DIR="$VOLUME/source"
readonly VENV_DIR="$VOLUME/venv"
readonly RUNTIME_MARKER="$VOLUME/.runtime-ready-v1"
readonly SOURCE_REPOSITORY="https://github.com/daniels-project-space/youtube-studio-ai.git"
readonly SOURCE_COMMIT="286b8b3f97edce0d58e1bec1e2e4bce99738029a"

mkdir -p "$VOLUME"
if [[ ! -f "$RUNTIME_MARKER" ]]; then
  export DEBIAN_FRONTEND=noninteractive PIP_NO_CACHE_DIR=1 MAX_JOBS=4
  apt-get update
  apt-get install -y --no-install-recommends build-essential ffmpeg git
  rm -rf /var/lib/apt/lists/*

  if [[ ! -d "$SOURCE_DIR/.git" ]]; then
    rm -rf "$SOURCE_DIR"
    git init "$SOURCE_DIR"
    git -C "$SOURCE_DIR" remote add origin "$SOURCE_REPOSITORY"
  fi
  git -C "$SOURCE_DIR" fetch --depth=1 origin "$SOURCE_COMMIT"
  git -C "$SOURCE_DIR" checkout --detach --force FETCH_HEAD

  python -m venv --system-site-packages "$VENV_DIR"
  "$VENV_DIR/bin/python" -m pip install \
    "qwen-tts==0.1.1" \
    "transformers==4.57.3" \
    "fastapi==0.116.1" \
    "uvicorn==0.35.0" \
    "soundfile==0.13.1"
  "$VENV_DIR/bin/python" -m pip install "flash-attn==2.8.3" --no-build-isolation
  printf '%s\n' "$SOURCE_COMMIT" > "$RUNTIME_MARKER.partial"
  mv "$RUNTIME_MARKER.partial" "$RUNTIME_MARKER"
fi

export PATH="$VENV_DIR/bin:$PATH"
cd "$SOURCE_DIR"
exec python entrypoint.py
