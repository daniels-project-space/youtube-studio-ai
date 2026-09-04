#!/usr/bin/env python3
"""
Deploy the qwen3-tts worker onto a Novita RTX 4090 with the weights on a
persistent network volume.

WHY A VOLUME. Qwen3-TTS 1.7B is ~7 GB per model and this worker uses two of
them. Pulling those from Hugging Face on every instance start would add minutes
of paid GPU time to every cold start and would make the first narration of the
day arbitrarily slow. Worse, the DESIGNED VOICE references live here too: a
channel's narrator is a generated artefact cached by a digest of its casting
brief, so losing the volume means every channel silently gets a slightly
different speaker the next time it renders. The volume is what makes a
narrator's identity durable, not just the weights cache.

WHY NOT THE STUDIO VPS. Measured, not assumed: local CPU synthesis on the
4-core avx2 host runs 10.7-11.8x slower than realtime — roughly two hours of
compute per ten minutes of narration — and int8 quantisation runs out of memory
during conversion. The same worker code runs on either; only this deployment
makes it fast.

DELIBERATELY MANUAL. This script never creates an instance as a side effect of
another command, because a 4090 bills by the hour and an instance nobody
remembers starting is a bill nobody expected. Create, inspect, and delete are
separate verbs, and `status` prints the running cost so far.

  python deploy-novita.py create     # start it (billable from this moment)
  python deploy-novita.py status     # endpoint, state, elapsed cost
  python deploy-novita.py delete     # stop paying
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import requests

API = "https://api.novita.ai/gpu-instance/openapi/v1"
NAME = "ysa-qwen3-tts"
# 4090 in the cluster that offers network storage; $0.67/hr at time of writing.
PRODUCT = "4090.16c125g.nas"
CLUSTER = "us-dallas-nas-2"
HOURLY_USD = 0.67
STATE = Path.home() / ".ysa-qwen3-tts-instance.json"
PORT = 8790

# The worker installs its own pinned dependencies and serves the contract. HF
# and the voice cache both point at the mounted volume so nothing survives only
# in container-local storage.
STARTUP = f"""
set -eux
export QWEN3_TTS_VOLUME=/network/qwen3-tts
export HF_HOME=$QWEN3_TTS_VOLUME/hf
mkdir -p $QWEN3_TTS_VOLUME/voices $HF_HOME
pip install -q 'qwen-tts==0.1.1' fastapi uvicorn soundfile requests
apt-get update -qq && apt-get install -y -qq ffmpeg
curl -fsSL "$WORKER_SOURCE_URL" -o /worker.py
exec uvicorn worker:app --app-dir / --host 0.0.0.0 --port {PORT}
"""


def key() -> str:
    value = os.environ.get("NOVITA_API_KEY", "").strip()
    if not value:
        sys.exit("NOVITA_API_KEY is not set — inject it from the vault, never inline it")
    return value


def headers(k: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {k}", "Content-Type": "application/json"}


def volume_id(k: str) -> str:
    """The volume must already exist. Creating storage implicitly is how orphaned
    paid resources accumulate, so this reports rather than provisions."""
    explicit = os.environ.get("QWEN3_TTS_VOLUME_ID", "").strip()
    if explicit:
        return explicit
    res = requests.get(f"{API}/networkstorages/list", headers=headers(k), timeout=40)
    stores = res.json().get("networkStorages") or res.json().get("data") or []
    # Prefer a volume named for this worker. Falling back to "any volume in the
    # cluster" would silently mount somebody else's model store and fill it.
    named = [s for s in stores if "qwen" in (s.get("storageName") or "").lower()]
    for store in named or []:
        return store["storageId"]
    available = ", ".join(
        f'{s.get("storageName")} ({s.get("storageSize")}GB)'
        for s in stores if s.get("clusterId") == CLUSTER
    )
    sys.exit(
        f"no volume named for qwen3-tts in {CLUSTER}. Existing volumes there: "
        f"{available or 'none'}. Create a dedicated one (50 GB holds both models "
        f"plus the voice cache) or set QWEN3_TTS_VOLUME_ID explicitly — this will "
        f"not borrow another workload's storage."
    )


def create(k: str) -> None:
    token = os.environ.get("QWEN3_TTS_WORKER_TOKEN", "").strip()
    if len(token) < 32:
        sys.exit("QWEN3_TTS_WORKER_TOKEN must be at least 32 characters; the studio refuses shorter")
    source = os.environ.get("WORKER_SOURCE_URL", "").strip()
    if not source:
        sys.exit("WORKER_SOURCE_URL must point at worker.py (a raw URL the instance can fetch)")

    body = {
        "name": NAME,
        "productId": PRODUCT,
        "gpuNum": 1,
        "rootfsSize": 60,
        "imageUrl": "python:3.11-slim",
        "kind": "gpu",
        "billingMode": "onDemand",
        "clusterId": CLUSTER,
        "ports": f"{PORT}/http",
        "entrypoint": "/bin/bash",
        "command": f"-c '{STARTUP}'",
        "envs": [
            {"key": "QWEN3_TTS_WORKER_TOKEN", "value": token},
            {"key": "WORKER_SOURCE_URL", "value": source},
        ],
        "networkStorages": [{"Id": volume_id(k), "mountPoint": "/network"}],
    }
    res = requests.post(f"{API}/gpu/instance/create", headers=headers(k), json=body, timeout=90)
    print(res.status_code, res.text[:400])
    if res.status_code < 300:
        STATE.write_text(json.dumps({"id": res.json().get("id"), "created": time.time()}))
        print("instance:", res.json().get("id"), "— billing has started")


def status(k: str) -> None:
    res = requests.get(f"{API}/gpu/instances", headers=headers(k), timeout=40)
    found = False
    for inst in res.json().get("instances", []):
        if inst.get("name") != NAME:
            continue
        found = True
        mapping = (inst.get("portMappings") or [{}])[0]
        endpoint = mapping.get("endpoint") or "(not yet published)"
        print(f"{inst['name']} | {inst['status']} | {endpoint}")
        if STATE.exists():
            hours = (time.time() - json.loads(STATE.read_text())["created"]) / 3600
            print(f"  running {hours:.2f}h — about ${hours * HOURLY_USD:.2f} so far")
        print(f"  set QWEN3_TTS_WORKER_URL to https://{endpoint}/synthesize once status is Running")
    if not found:
        print("no instance — nothing is being billed")


def delete(k: str) -> None:
    if not STATE.exists():
        sys.exit("no recorded instance id; use status and delete from the console")
    instance = json.loads(STATE.read_text())["id"]
    res = requests.post(
        f"{API}/gpu/instance/delete", headers=headers(k), json={"instanceId": instance}, timeout=60,
    )
    print(res.status_code, res.text[:200])
    if res.status_code < 300:
        STATE.unlink()
        print("deleted — billing stopped; the volume and its voice cache persist")


if __name__ == "__main__":
    verb = sys.argv[1] if len(sys.argv) > 1 else "status"
    {"create": create, "status": status, "delete": delete}.get(verb, status)(key())
