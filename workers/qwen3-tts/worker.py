#!/usr/bin/env python3
"""Pinned Qwen3-TTS CustomVoice inference worker for YouTube Studio AI.

The separately deployable TypeScript caller and Python service share their
boundary through contract.py. Production remains fail-closed until the exact
container has passed the measured and human-reviewed qualification matrix.
"""
from __future__ import annotations

import gc
import importlib.metadata
import os
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

os.environ.setdefault("OMP_NUM_THREADS", "8")

import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, Header, HTTPException

from contract import (
    CONTRACT,
    MODEL,
    QWEN_TTS_VERSION,
    REVISION,
    SAMPLE_RATE,
    TRANSFORMERS_VERSION,
    ContractError,
    make_response,
    parse_request,
)

VOLUME = Path(os.environ.get("QWEN3_TTS_VOLUME", "/workspace/qwen3-tts"))
VOLUME.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("HF_HOME", str(VOLUME / "hf"))

app = FastAPI()
_lock = threading.Lock()
_model: Any | None = None
_last_used = time.monotonic()


def _exact_runtime_version(distribution: str, expected: str) -> None:
    try:
        actual = importlib.metadata.version(distribution)
    except importlib.metadata.PackageNotFoundError as error:
        raise RuntimeError(f"required package {distribution} is missing") from error
    if actual != expected:
        raise RuntimeError(f"{distribution} {actual} is not pinned {expected}")


def _runtime_attestation() -> None:
    _exact_runtime_version("qwen-tts", QWEN_TTS_VERSION)
    _exact_runtime_version("transformers", TRANSFORMERS_VERSION)
    if not torch.cuda.is_available():
        raise RuntimeError("Qwen3 TTS requires CUDA; CPU may not attest the RTX 4090 route")
    gpu_name = torch.cuda.get_device_name(0)
    if "4090" not in gpu_name:
        raise RuntimeError(f"worker GPU is {gpu_name!r}, not the pinned RTX 4090")
    try:
        _exact_runtime_version("flash-attn", os.environ.get("QWEN3_TTS_FLASH_ATTN_VERSION", "2.8.3"))
    except RuntimeError as error:
        raise RuntimeError("FlashAttention 2 is missing or unpinned") from error


def _load_model():
    global _model
    if _model is not None:
        return _model
    _runtime_attestation()
    from qwen_tts import Qwen3TTSModel

    _model = Qwen3TTSModel.from_pretrained(
        MODEL,
        revision=REVISION,
        device_map="cuda",
        dtype=torch.bfloat16,
        attn_implementation="flash_attention_2",
    )
    return _model


def _to_mp3(audio: np.ndarray, source_rate: int) -> bytes:
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "out.wav"
        mp3 = Path(tmp) / "out.mp3"
        sf.write(str(wav), audio, source_rate)
        subprocess.run(
            [
                "ffmpeg", "-y", "-loglevel", "error", "-i", str(wav),
                "-ar", str(SAMPLE_RATE), "-b:a", "192k", str(mp3),
            ],
            check=True,
        )
        return mp3.read_bytes()


def _runtime_number(name: str, minimum: float, maximum: float) -> float:
    raw = os.environ.get(name, "").strip()
    try:
        value = float(raw)
    except ValueError as error:
        raise RuntimeError(f"{name} is missing or invalid") from error
    if not minimum <= value <= maximum:
        raise RuntimeError(f"{name} is outside {minimum}..{maximum}")
    return value


@app.get("/health")
def health() -> dict[str, Any]:
    try:
        _runtime_attestation()
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    return {
        "schema": CONTRACT,
        "runtimeReady": True,
        "modelLoaded": _model is not None,
        "idleSeconds": round(time.monotonic() - _last_used, 1),
    }


@app.post("/synthesize")
def synthesize(
    payload: dict[str, Any],
    authorization: str = Header(default=""),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict[str, Any]:
    global _last_used
    expected = os.environ.get("QWEN3_TTS_WORKER_TOKEN", "")
    if not expected or authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="unauthorized")
    try:
        request = parse_request(payload, idempotency_key)
        gpu_rate = _runtime_number("QWEN3_TTS_GPU_RATE_USD_PER_SECOND", 0.000001, 1)
        storage_upper = _runtime_number("QWEN3_TTS_STORAGE_USD_PER_REQUEST_UPPER_BOUND", 0, 5)
        configured_idle = int(_runtime_number("QWEN3_TTS_IDLE_SHUTDOWN_SECONDS", 30, 900))
        if request.idle_shutdown_seconds != configured_idle:
            raise ContractError(
                f"request idle ceiling {request.idle_shutdown_seconds}s does not match "
                f"the endpoint configuration {configured_idle}s"
            )
        # Reject an impossible cost ceiling before model inference. The actual
        # receipt uses measured request time plus this same platform idle tail.
        minimum_lifecycle_cost = request.idle_shutdown_seconds * gpu_rate + storage_upper
        if minimum_lifecycle_cost > request.max_cost_usd:
            raise ContractError(
                f"request ceiling ${request.max_cost_usd:.6f} cannot cover the configured "
                f"scale-down tail (${minimum_lifecycle_cost:.6f})"
            )
    except (ContractError, RuntimeError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    started = time.monotonic()
    try:
        with _lock:
            _last_used = started
            torch.manual_seed(request.seed)
            model = _load_model()
            wavs, source_rate = model.generate_custom_voice(
                text=[request.text],
                speaker=[request.speaker],
                language=[request.language],
                instruct=[request.instruction] if request.instruction else None,
            )
            audio = wavs[0]
            mp3 = _to_mp3(audio, source_rate)
            request_seconds = time.monotonic() - started
            _last_used = time.monotonic()
        return make_response(
            request,
            mp3,
            duration_sec=len(audio) / source_rate,
            request_gpu_seconds=request_seconds,
            gpu_rate_usd_per_second=gpu_rate,
            storage_usd=storage_upper,
        )
    except ContractError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except Exception as error:
        # Release recoverable allocator state without silently changing model,
        # precision, attention, or device.
        gc.collect()
        torch.cuda.empty_cache()
        raise HTTPException(status_code=500, detail=f"pinned synthesis failed: {type(error).__name__}") from error
