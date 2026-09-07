#!/usr/bin/env python3
"""Dependency-free boundary contract shared by the Qwen worker and CI.

The TypeScript client and Python inference process are deployed separately. A
mock written only in TypeScript cannot prove that the Python service accepts the
same field names or returns the receipt shape the client verifies, so this file
owns that translation and can be executed without torch or the model weights.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import sys
from dataclasses import dataclass
from typing import Any

CONTRACT = "qwen3-tts-worker/v2"
MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"
REVISION = "0c0e3051f131929182e2c023b9537f8b1c68adfe"
QWEN_TTS_VERSION = "0.1.1"
TRANSFORMERS_VERSION = "4.57.3"
SAMPLE_RATE = 24_000
CAPACITY_MODE = "serverless-scale-to-zero"
ACCOUNTING = "conservative-upper-bound"

SPEAKERS = {
    "Vivian", "Serena", "Uncle_Fu", "Dylan", "Eric", "Ryan", "Aiden",
    "Ono_Anna", "Sohee",
}
LANGUAGES = {
    "Auto", "Chinese", "English", "Japanese", "Korean", "German", "French",
    "Russian", "Portuguese", "Spanish", "Italian",
}


class ContractError(ValueError):
    pass


def _sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _canonical_json(value: Any) -> str:
    # Equivalent for this JSON-only schema to src/lib/canonicalJson.ts:
    # recursively sorted keys, compact separators, and unescaped Unicode.
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _exact(value: Any, expected: Any, label: str) -> None:
    if value != expected:
        raise ContractError(f"{label} must be {expected!r}")


def _number(value: Any, label: str, minimum: float, maximum: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ContractError(f"{label} must be numeric")
    number = float(value)
    if not math.isfinite(number) or number < minimum or number > maximum:
        raise ContractError(f"{label} is outside {minimum}..{maximum}")
    return number


@dataclass(frozen=True)
class SynthRequest:
    text: str
    text_sha256: str
    speaker: str
    language: str
    instruction: str
    instruction_sha256: str
    seed: int
    max_cost_usd: float
    request_key: str
    idle_shutdown_seconds: int


def parse_request(payload: Any, idempotency_key: str | None = None) -> SynthRequest:
    if not isinstance(payload, dict):
        raise ContractError("request body must be an object")
    expected_keys = {
        "schema", "model", "revision", "qwenTtsPackageVersion",
        "transformersVersion", "dtype", "attention", "text", "textSha256",
        "speaker", "language", "instruction", "instructionSha256", "seed",
        "audioFormat", "sampleRateHz", "maxCostUsd", "runtime", "requestKey",
    }
    missing = sorted(expected_keys - payload.keys())
    extra = sorted(payload.keys() - expected_keys)
    if missing or extra:
        raise ContractError(f"request fields differ (missing={missing}, extra={extra})")

    _exact(payload["schema"], CONTRACT, "schema")
    _exact(payload["model"], MODEL, "model")
    _exact(payload["revision"], REVISION, "revision")
    _exact(payload["qwenTtsPackageVersion"], QWEN_TTS_VERSION, "qwenTtsPackageVersion")
    _exact(payload["transformersVersion"], TRANSFORMERS_VERSION, "transformersVersion")
    _exact(payload["dtype"], "bfloat16", "dtype")
    _exact(payload["attention"], "flash_attention_2", "attention")
    _exact(payload["audioFormat"], "mp3", "audioFormat")
    _exact(payload["sampleRateHz"], SAMPLE_RATE, "sampleRateHz")

    text = payload["text"]
    instruction = payload["instruction"]
    if not isinstance(text, str) or not 1 <= len(text) <= 8_000:
        raise ContractError("text must contain 1..8000 characters")
    if not isinstance(instruction, str) or len(instruction) > 600:
        raise ContractError("instruction must contain at most 600 characters")
    _exact(payload["textSha256"], _sha256(text.encode()), "textSha256")
    _exact(payload["instructionSha256"], _sha256(instruction.encode()), "instructionSha256")
    if payload["speaker"] not in SPEAKERS:
        raise ContractError("speaker is not a pinned CustomVoice speaker")
    if payload["language"] not in LANGUAGES:
        raise ContractError("language is unsupported")
    if isinstance(payload["seed"], bool) or not isinstance(payload["seed"], int) or not 0 <= payload["seed"] <= 2**53 - 1:
        raise ContractError("seed must be a non-negative safe integer")
    max_cost_usd = _number(payload["maxCostUsd"], "maxCostUsd", 0.000001, 1)

    runtime = payload["runtime"]
    if not isinstance(runtime, dict):
        raise ContractError("runtime must be an object")
    _exact(set(runtime), {
        "provider", "gpu", "capacityMode", "persistentCache",
        "idleShutdownMaxSeconds", "accounting",
    }, "runtime fields")
    _exact(runtime["provider"], "novita", "runtime.provider")
    _exact(runtime["gpu"], "RTX 4090", "runtime.gpu")
    _exact(runtime["capacityMode"], CAPACITY_MODE, "runtime.capacityMode")
    _exact(runtime["persistentCache"], True, "runtime.persistentCache")
    _exact(runtime["accounting"], ACCOUNTING, "runtime.accounting")
    idle = int(_number(runtime["idleShutdownMaxSeconds"], "idleShutdownMaxSeconds", 30, 900))

    request_key = payload["requestKey"]
    if not isinstance(request_key, str) or not _is_sha256(request_key):
        raise ContractError("requestKey must be lowercase SHA-256")
    unsigned = {key: value for key, value in payload.items() if key != "requestKey"}
    _exact(request_key, _sha256(_canonical_json(unsigned).encode()), "requestKey")
    if idempotency_key is not None:
        _exact(idempotency_key, request_key, "Idempotency-Key")

    return SynthRequest(
        text=text,
        text_sha256=payload["textSha256"],
        speaker=payload["speaker"],
        language=payload["language"],
        instruction=instruction,
        instruction_sha256=payload["instructionSha256"],
        seed=payload["seed"],
        max_cost_usd=max_cost_usd,
        request_key=request_key,
        idle_shutdown_seconds=idle,
    )


def _is_sha256(value: str) -> bool:
    return len(value) == 64 and all(char in "0123456789abcdef" for char in value)


def make_response(
    request: SynthRequest,
    audio: bytes,
    *,
    duration_sec: float,
    request_gpu_seconds: float,
    gpu_rate_usd_per_second: float,
    startup_usd: float = 0,
    storage_usd: float = 0,
) -> dict[str, Any]:
    if len(audio) < 1_000:
        raise ContractError("encoded MP3 is too small")
    duration = _number(duration_sec, "durationSec", 0.25, 3_600)
    request_seconds = _number(request_gpu_seconds, "requestGpuSeconds", 0.001, 3_600)
    gpu_rate = _number(gpu_rate_usd_per_second, "gpuRateUsdPerSecond", 0.000001, 1)
    startup = _number(startup_usd, "startupUsd", 0, 5)
    storage = _number(storage_usd, "storageUsd", 0, 5)

    # A response cannot know whether another request will reuse this worker
    # before scale-down. Charge the whole configured idle tail to this request
    # as an explicit upper bound. This may over-reserve; it never understates the
    # lifecycle cost used by the caller's spend gate.
    gpu_seconds = round(request_seconds + request.idle_shutdown_seconds, 6)
    cost_usd = round(gpu_seconds * gpu_rate + startup + storage, 9)
    if cost_usd > request.max_cost_usd + 0.000000001:
        raise ContractError(
            f"conservative lifecycle cost ${cost_usd:.6f} exceeds request ceiling ${request.max_cost_usd:.6f}"
        )

    return {
        "receipt": {
            "schema": CONTRACT,
            "requestKey": request.request_key,
            "model": MODEL,
            "revision": REVISION,
            "qwenTtsPackageVersion": QWEN_TTS_VERSION,
            "transformersVersion": TRANSFORMERS_VERSION,
            "dtype": "bfloat16",
            "attention": "flash_attention_2",
            "textSha256": request.text_sha256,
            "instructionSha256": request.instruction_sha256,
            "speaker": request.speaker,
            "language": request.language,
            "seed": request.seed,
            "audioSha256": _sha256(audio),
            "audioFormat": "mp3",
            "sampleRateHz": SAMPLE_RATE,
            "durationSec": round(duration, 3),
            "runtime": {
                "provider": "novita",
                "gpu": "RTX 4090",
                "capacityMode": CAPACITY_MODE,
                "persistentCache": True,
                "idleShutdownSeconds": request.idle_shutdown_seconds,
                "accounting": ACCOUNTING,
                "requestGpuSeconds": round(request_seconds, 6),
                "gpuSeconds": gpu_seconds,
                "gpuRateUsdPerSecond": gpu_rate,
                "startupUsd": startup,
                "storageUsd": storage,
                "costUsd": cost_usd,
            },
        },
        "audioBase64": base64.b64encode(audio).decode(),
    }


def _fixture() -> None:
    fixture = json.load(sys.stdin)
    request = parse_request(fixture["payload"], fixture.get("idempotencyKey"))
    audio = base64.b64decode(fixture["audioBase64"], validate=True)
    response = make_response(
        request,
        audio,
        duration_sec=fixture["durationSec"],
        request_gpu_seconds=fixture["requestGpuSeconds"],
        gpu_rate_usd_per_second=fixture["gpuRateUsdPerSecond"],
        startup_usd=fixture.get("startupUsd", 0),
        storage_usd=fixture.get("storageUsd", 0),
    )
    json.dump(response, sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", action="store_true")
    args = parser.parse_args()
    if not args.fixture:
        parser.error("only --fixture is supported")
    _fixture()
