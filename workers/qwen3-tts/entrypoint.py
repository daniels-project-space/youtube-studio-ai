#!/usr/bin/env python3
"""Seed the pinned Qwen model to the persistent volume before serving.

The model is never baked into the OCI image.  A freshly created OpenRelay disk
downloads the immutable Hugging Face revision once; every later stop/start
uses that verified local cache and runs offline.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from huggingface_hub import snapshot_download

MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"
REVISION = "0c0e3051f131929182e2c023b9537f8b1c68adfe"


def write_marker(path: Path) -> None:
    temporary = path.with_suffix(".partial")
    with temporary.open("w", encoding="utf-8") as output:
        json.dump({"model": MODEL, "revision": REVISION}, output, sort_keys=True)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)


def cache_model() -> Path:
    volume = Path(os.environ.get("QWEN3_TTS_VOLUME", "/workspace/qwen3-tts")).resolve()
    cache = volume / "hf"
    marker = volume / ".qwen3-tts-model-ready.json"
    volume.mkdir(parents=True, exist_ok=True)
    expected = {"model": MODEL, "revision": REVISION}
    if marker.exists():
        try:
            actual = json.loads(marker.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise RuntimeError("Qwen model cache marker is unreadable") from error
        if actual != expected:
            raise RuntimeError("Qwen persistent model cache belongs to a different pinned revision")
        snapshot = snapshot_download(
            repo_id=MODEL, revision=REVISION, cache_dir=str(cache), local_files_only=True
        )
    else:
        if cache.exists() and any(cache.iterdir()):
            raise RuntimeError("Qwen model cache exists without a verified marker; refusing an unsafe overwrite")
        snapshot = snapshot_download(repo_id=MODEL, revision=REVISION, cache_dir=str(cache))
        write_marker(marker)
    # `snapshot_download(cache_dir=...)` receives the hub cache directory,
    # while `HF_HOME` is its parent. Keeping those distinct lets the serving
    # library locate the exact snapshot while offline rather than looking for
    # a nested `hf/hub` cache that was never populated.
    os.environ["HF_HOME"] = str(volume)
    os.environ["HF_HUB_CACHE"] = str(cache)
    os.environ["HF_HUB_OFFLINE"] = "1"
    return Path(snapshot)


def main() -> None:
    os.environ["QWEN3_TTS_MODEL_PATH"] = str(cache_model())
    os.execvp(
        "uvicorn",
        ["uvicorn", "worker:app", "--host", "0.0.0.0", "--port", "8790", "--workers", "1"],
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # startup must fail rather than serve with a partial cache
        print(f"qwen-entrypoint: {type(error).__name__}: {error}", file=sys.stderr, flush=True)
        raise
