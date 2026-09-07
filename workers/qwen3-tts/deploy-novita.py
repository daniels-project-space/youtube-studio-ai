#!/usr/bin/env python3
"""Plan and manage the Qwen3-TTS Novita serverless endpoint.

The previous script created an on-demand GPU instance while its receipt claimed
spot capacity and automatic idle shutdown. This version uses Novita's actual
serverless endpoint contract: zero minimum workers, one maximum worker, and a
platform-enforced idle timeout. `plan` is read-only; `create` is the only verb
that starts a billable resource.
"""
from __future__ import annotations

import json
import math
import os
import re
import sys
from pathlib import Path
from typing import Any

API = "https://api.novita.ai/gpu-instance/openapi/v1"
NAME = "ysa-qwen3-tts"
PORT = 8790
IDLE_SECONDS = 300
STATE = Path(os.environ.get("QWEN3_TTS_STATE_FILE", ".qwen3-tts-endpoint.json")).resolve()


def required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        sys.exit(f"{name} is required")
    return value


def api_key() -> str:
    return required("NOVITA_API_KEY")


def headers(key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}


def exact_hourly_rate() -> float:
    raw = required("QWEN3_TTS_GPU_RATE_USD_PER_HOUR")
    try:
        value = float(raw)
    except ValueError:
        sys.exit("QWEN3_TTS_GPU_RATE_USD_PER_HOUR must be numeric")
    if not math.isfinite(value) or not 0 < value <= 10:
        sys.exit("QWEN3_TTS_GPU_RATE_USD_PER_HOUR is outside 0..10")
    return value


def endpoint_body() -> dict[str, Any]:
    image = required("QWEN3_TTS_IMAGE")
    if not re.search(r"@sha256:[a-f0-9]{64}$", image):
        sys.exit("QWEN3_TTS_IMAGE must be an immutable registry digest, not a mutable tag")
    token = required("QWEN3_TTS_WORKER_TOKEN")
    if len(token) < 32:
        sys.exit("QWEN3_TTS_WORKER_TOKEN must be at least 32 characters")
    volume_id = required("QWEN3_TTS_VOLUME_ID")
    cluster_id = required("QWEN3_TTS_SERVERLESS_CLUSTER_ID")
    product_id = required("QWEN3_TTS_SERVERLESS_PRODUCT_ID")
    hourly_rate = exact_hourly_rate()
    image_auth_id = os.environ.get("QWEN3_TTS_IMAGE_AUTH_ID", "").strip()

    return {
        "endpoint": {
            "name": NAME,
            "appName": NAME,
            "workerConfig": {
                "minNum": 0,
                "maxNum": 1,
                "freeTimeout": IDLE_SECONDS,
                "maxConcurrent": 1,
                "gpuNum": 1,
                "requestTimeout": 900,
            },
            "ports": [{"port": str(PORT)}],
            "policy": {"type": "concurrency", "value": 1},
            "image": {
                "image": image,
                **({"authId": image_auth_id} if image_auth_id else {}),
            },
            "products": [{"id": product_id}],
            "rootfsSize": 100,
            "volumeMounts": [{
                "type": "network",
                "id": volume_id,
                "mountPath": "/network",
            }],
            "clusterID": cluster_id,
            "envs": [
                {"key": "QWEN3_TTS_WORKER_TOKEN", "value": token},
                {"key": "QWEN3_TTS_VOLUME", "value": "/network/qwen3-tts"},
                {"key": "QWEN3_TTS_IDLE_SHUTDOWN_SECONDS", "value": str(IDLE_SECONDS)},
                {"key": "QWEN3_TTS_GPU_RATE_USD_PER_SECOND", "value": f"{hourly_rate / 3600:.12f}"},
                {"key": "QWEN3_TTS_STORAGE_USD_PER_REQUEST_UPPER_BOUND", "value": "0.001"},
                {"key": "QWEN3_TTS_FLASH_ATTN_VERSION", "value": "2.8.3"},
            ],
            "healthy": {"path": "/health"},
        },
    }


def public_plan(body: dict[str, Any]) -> dict[str, Any]:
    clone = json.loads(json.dumps(body))
    for item in clone["endpoint"]["envs"]:
        if item["key"] == "QWEN3_TTS_WORKER_TOKEN":
            item["value"] = "<redacted>"
    return clone


def plan(_: str) -> None:
    body = endpoint_body()
    print(json.dumps(public_plan(body), indent=2))
    rate = exact_hourly_rate()
    print(
        f"\nIdle-tail upper bound per isolated request: "
        f"${IDLE_SECONDS * rate / 3600:.4f} plus request GPU time and storage."
    )


def create(key: str) -> None:
    import requests

    body = endpoint_body()
    response = requests.post(f"{API}/endpoint/create", headers=headers(key), json=body, timeout=90)
    if response.status_code >= 300:
        sys.exit(f"Novita endpoint create failed with HTTP {response.status_code}")
    endpoint_id = str(response.json().get("id") or "")
    if not endpoint_id:
        sys.exit("Novita endpoint create returned no endpoint id")
    STATE.write_text(json.dumps({"id": endpoint_id, "name": NAME}) + "\n")
    print(f"created endpoint {endpoint_id}; max workers 1, idle scale-down {IDLE_SECONDS}s")


def _list(key: str) -> list[dict[str, Any]]:
    import requests

    response = requests.get(
        f"{API}/endpoints?pageSize=100&pageNum=0",
        headers=headers(key),
        timeout=40,
    )
    if response.status_code >= 300:
        sys.exit(f"Novita endpoint list failed with HTTP {response.status_code}")
    return response.json().get("endpoints", [])


def status(key: str) -> None:
    matches = [entry for entry in _list(key) if entry.get("name") == NAME or entry.get("id") == _state_id()]
    if not matches:
        print("no Qwen3-TTS endpoint")
        return
    for entry in matches:
        config = entry.get("workerConfig") or {}
        state = entry.get("state") or {}
        print(
            f"{entry.get('id')} | {state.get('state')} | workers "
            f"{config.get('minNum')}..{config.get('maxNum')} | idle {config.get('freeTimeout')}s"
        )
        print(f"  URL: {entry.get('url') or '(not published yet)'}/synthesize")


def _state_id() -> str:
    if not STATE.exists():
        return ""
    try:
        return str(json.loads(STATE.read_text()).get("id") or "")
    except (OSError, json.JSONDecodeError):
        return ""


def delete(key: str) -> None:
    import requests

    endpoint_id = _state_id()
    if not endpoint_id:
        sys.exit("no recorded endpoint id; inspect status and delete explicitly in Novita")
    response = requests.post(
        f"{API}/endpoint/delete",
        headers=headers(key),
        json={"name": endpoint_id},
        timeout=60,
    )
    if response.status_code >= 300:
        sys.exit(f"Novita endpoint delete failed with HTTP {response.status_code}")
    STATE.unlink(missing_ok=True)
    print(f"deleted endpoint {endpoint_id}")


if __name__ == "__main__":
    verb = sys.argv[1] if len(sys.argv) > 1 else "plan"
    if verb == "plan":
        plan("")
    elif verb in {"create", "status", "delete"}:
        {"create": create, "status": status, "delete": delete}[verb](api_key())
    else:
        sys.exit("usage: deploy-novita.py [plan|create|status|delete]")
