#!/usr/bin/env python3
"""Dedicated, sealed LTX 2.5 audio-to-video worker for a Novita GPU.

This is deliberately separate from ``worker.py``.  The established worker
only drives LTX's distilled image-to-video CLI on the 24 GB RTX 4090 profile.
Audio-conditioned LTX generation has a different two-stage pipeline, model
bundle and quality benchmark.  Sharing an entrypoint would make it too easy
to label an ordinary image-to-video render as audio-to-video.

The worker receives no cloud credentials.  It accepts one hash-bound manifest,
hydrates only its manifest-bound local model cache, uses short-lived URLs for
the mastered audio/reference images/output, and emits per-job checkpoint
evidence.  It is benchmark-only until a separate control-plane admission
records the pinned runtime and matched A/B quality result.
"""

from __future__ import annotations

import json
import math
import os
import re
import signal
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
from pathlib import Path
from typing import Any

# Keep direct execution and isolated contract imports equivalent. The worker
# image runs this file by absolute path, while the Python contract test loads it
# through ``importlib`` from the repository root.
_WORKER_DIR = str(Path(__file__).resolve().parent)
if _WORKER_DIR not in sys.path:
    sys.path.insert(0, _WORKER_DIR)
import worker as common


CONTRACT_VERSION = "1.0.0"
PHASE = "audio_video"
PROFILE_ID = "ltx25-a2vid-benchmark-v1"
MAX_JOBS = 1
MIN_AUDIO_DURATION_MS = 2_000
MAX_AUDIO_DURATION_MS = 20_000
ALLOWED_GPU_SKUS = {"RTX 4090", "RTX 5090"}
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
REVISION_RE = re.compile(r"^[a-f0-9]{40}$")
JOB_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$")
PATH_RE = re.compile(r"^(?!/)(?!.*(?:^|/)\.\.(?:/|$))[A-Za-z0-9][A-Za-z0-9._/@+=:-]{1,511}$")
AUDIO_CONTENT_TYPES = {"audio/mpeg", "audio/wav", "audio/x-wav", "audio/flac", "audio/mp4", "audio/aac"}
IMAGE_CONTENT_TYPES = {"image/png", "image/jpeg", "image/webp"}
COMPONENT_IDS = (
    "a2vid-transformer",
    "a2vid-text-encoder",
    "a2vid-video-vae",
    "a2vid-audio-vae",
    "a2vid-spatial-upscaler",
    "a2vid-stage2-distilled-lora",
)


def _hash(value: Any) -> str:
    return common.sha256_bytes(common.canonical_bytes(value))


def _require_hash(value: Any, label: str) -> str:
    value = str(value or "")
    if not SHA256_RE.fullmatch(value):
        raise ValueError(f"{label} must be a SHA-256")
    return value


def _require_positive_int(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ValueError(f"{label} must be a positive integer")
    return value


def _require_url(value: Any, label: str) -> str:
    url = str(value or "")
    common._parse_https_url(url)
    return url


def _require_object_ref(value: Any, label: str, *, content_types: set[str]) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    if set(value) != {"getUrl", "sha256", "contentType"}:
        raise ValueError(f"{label} has unsupported fields")
    content_type = str(value.get("contentType") or "")
    if content_type not in content_types:
        raise ValueError(f"{label} has an unsupported content type")
    return {
        "getUrl": _require_url(value.get("getUrl"), f"{label}.getUrl"),
        "sha256": _require_hash(value.get("sha256"), f"{label}.sha256"),
        "contentType": content_type,
    }


def _profile_components(value: Any) -> tuple[dict[str, Any], ...]:
    if not isinstance(value, list) or len(value) != len(COMPONENT_IDS):
        raise ValueError("A2Vid profile must name its exact six runtime components")
    by_id: dict[str, dict[str, Any]] = {}
    for component in value:
        if not isinstance(component, dict) or set(component) != {"id", "path", "sha256", "sizeBytes"}:
            raise ValueError("A2Vid profile component has unsupported fields")
        component_id = str(component.get("id") or "")
        if component_id not in COMPONENT_IDS or component_id in by_id:
            raise ValueError("A2Vid profile has an invalid or duplicate component identity")
        path = str(component.get("path") or "")
        if not PATH_RE.fullmatch(path):
            raise ValueError("A2Vid profile component path is unsafe")
        by_id[component_id] = {
            "id": component_id,
            "path": path,
            "sha256": _require_hash(component.get("sha256"), f"A2Vid component {component_id}.sha256"),
            "sizeBytes": _require_positive_int(component.get("sizeBytes"), f"A2Vid component {component_id}.sizeBytes"),
        }
    if set(by_id) != set(COMPONENT_IDS):
        raise ValueError("A2Vid profile is missing a required runtime component")
    return tuple(by_id[component_id] for component_id in COMPONENT_IDS)


def validate_profile(value: Any) -> dict[str, Any]:
    """Validate the one bounded probe profile without inventing a model pin.

    The LTX model is gated, so immutable revisions and component byte hashes are
    intentionally supplied by an accepted model manifest instead of copied from
    a moving public branch.  They are still part of the signed profile and must
    match the local cache specification byte-for-byte.
    """
    if not isinstance(value, dict):
        raise ValueError("A2Vid profile must be an object")
    expected_keys = {
        "contractVersion", "id", "phase", "model", "modelRevision", "runtimeRepository", "runtimeRevision",
        "pipeline", "width", "height", "steps", "fps", "precision", "quantization", "offload",
        "stageOneWidth", "stageOneHeight", "spatialUpscaleFactor", "requiredGpuSku", "minimumVramGb",
        "licenseReceiptFingerprint", "components", "benchmarkOnly", "allowFallback",
    }
    if set(value) != expected_keys:
        raise ValueError("A2Vid profile has unsupported or missing fields")
    if (
        value.get("contractVersion") != CONTRACT_VERSION
        or value.get("id") != PROFILE_ID
        or value.get("phase") != PHASE
        or value.get("model") != "Lightricks/LTX-2.5"
        or value.get("runtimeRepository") != "Lightricks/LTX-2"
        or value.get("pipeline") != "a2vid_two_stage"
        or value.get("precision") != "bf16"
        or value.get("quantization") != "fp8-cast"
        or value.get("offload") != "cpu"
        or value.get("benchmarkOnly") is not True
        or value.get("allowFallback") is not False
    ):
        raise ValueError("A2Vid profile does not use the sealed self-hosted benchmark contract")
    model_revision = str(value.get("modelRevision") or "")
    runtime_revision = str(value.get("runtimeRevision") or "")
    if not REVISION_RE.fullmatch(model_revision) or not REVISION_RE.fullmatch(runtime_revision):
        raise ValueError("A2Vid profile must pin immutable model and runtime revisions")
    width = _require_positive_int(value.get("width"), "A2Vid profile.width")
    height = _require_positive_int(value.get("height"), "A2Vid profile.height")
    steps = _require_positive_int(value.get("steps"), "A2Vid profile.steps")
    fps = value.get("fps")
    if isinstance(fps, bool) or not isinstance(fps, (int, float)) or not math.isfinite(fps) or float(fps) != 25.0:
        raise ValueError("A2Vid profile must use the sealed 25 fps benchmark cadence")
    if (width, height, steps) != (1280, 704, 8) or width % 64 or height % 64:
        raise ValueError("A2Vid profile must use the sealed 1280x704 eight-step benchmark geometry")
    if value.get("stageOneWidth") != 640 or value.get("stageOneHeight") != 352 or value.get("spatialUpscaleFactor") != 2:
        raise ValueError("A2Vid profile must use the native 640x352 to 1280x704 two-stage path")
    gpu_sku = str(value.get("requiredGpuSku") or "")
    minimum_vram_gb = _require_positive_int(value.get("minimumVramGb"), "A2Vid profile.minimumVramGb")
    if gpu_sku not in ALLOWED_GPU_SKUS or minimum_vram_gb < 24 or minimum_vram_gb > 64:
        raise ValueError("A2Vid profile must pin a supported single Novita GPU and its VRAM floor")
    components = _profile_components(value.get("components"))
    return {
        "contractVersion": CONTRACT_VERSION,
        "id": PROFILE_ID,
        "phase": PHASE,
        "model": "Lightricks/LTX-2.5",
        "modelRevision": model_revision,
        "runtimeRepository": "Lightricks/LTX-2",
        "runtimeRevision": runtime_revision,
        "pipeline": "a2vid_two_stage",
        "width": width,
        "height": height,
        "steps": steps,
        "fps": 25,
        "precision": "bf16",
        "quantization": "fp8-cast",
        "offload": "cpu",
        "stageOneWidth": 640,
        "stageOneHeight": 352,
        "spatialUpscaleFactor": 2,
        "requiredGpuSku": gpu_sku,
        "minimumVramGb": minimum_vram_gb,
        "licenseReceiptFingerprint": _require_hash(value.get("licenseReceiptFingerprint"), "A2Vid profile.licenseReceiptFingerprint"),
        "components": list(components),
        "benchmarkOnly": True,
        "allowFallback": False,
    }


def validate_model_specs(model_specs: Any, profile: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(model_specs, list) or len(model_specs) != len(COMPONENT_IDS) or not all(isinstance(spec, dict) for spec in model_specs):
        raise ValueError("A2Vid manifest must provide exactly its sealed runtime components")
    expected = {component["id"]: component for component in profile["components"]}
    seen: set[str] = set()
    for spec in model_specs:
        component_id = str(spec.get("id") or "")
        component = expected.get(component_id)
        if component is None or component_id in seen:
            raise ValueError("A2Vid manifest has an unexpected or duplicate runtime component")
        seen.add(component_id)
        source_path = Path(str(spec.get("sourcePath") or "")).as_posix()
        local_path = Path(str(spec.get("localPath") or "")).as_posix()
        if (
            spec.get("kind") != "file"
            or spec.get("repository") != profile["model"]
            or spec.get("revision") != profile["modelRevision"]
            or spec.get("manifestSha256") != component["sha256"]
            or spec.get("sizeBytes") != component["sizeBytes"]
            or not source_path.endswith(component["path"])
            or not local_path.endswith(component["path"])
        ):
            raise ValueError(f"A2Vid runtime component {component_id} drifts from the sealed profile")
    if seen != set(expected):
        raise ValueError("A2Vid manifest is missing a sealed runtime component")
    return list(model_specs)


def _validate_artifact(value: Any, manifest_id: str, profile_hash: str, job_id: str) -> None:
    artifact = common._validate_delivery_target(value, f"A2Vid job {job_id} artifact")
    headers = {str(key).lower(): str(item) for key, item in artifact.get("headers", {}).items()}
    expected = {
        "x-amz-meta-manifest-id": manifest_id,
        "x-amz-meta-profile-sha256": profile_hash,
        "x-amz-meta-job-id": job_id,
    }
    if any(headers.get(key) != item for key, item in expected.items()):
        raise ValueError(f"A2Vid job {job_id} artifact URL is not bound to its sealed identity")


def _validate_job(job: Any, profile: dict[str, Any], manifest_id: str, profile_hash: str) -> dict[str, Any]:
    if not isinstance(job, dict):
        raise ValueError("A2Vid job must be an object")
    allowed = {
        "id", "prompt", "seed", "width", "height", "steps", "frames", "fps", "timeoutSeconds",
        "audio", "openingInput", "endingInput", "artifact",
    }
    if set(job) - allowed:
        raise ValueError("A2Vid job contains unsupported controls or adapters")
    job_id = str(job.get("id") or "")
    if not JOB_ID_RE.fullmatch(job_id):
        raise ValueError("A2Vid job identity is invalid")
    prompt = str(job.get("prompt") or "").strip()
    if not prompt or len(prompt) > 20_000:
        raise ValueError(f"A2Vid job {job_id} requires a bounded prompt")
    seed = job.get("seed")
    if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed <= 2**63 - 1:
        raise ValueError(f"A2Vid job {job_id} has an invalid seed")
    for field in ("width", "height", "steps"):
        if job.get(field) != profile[field]:
            raise ValueError(f"A2Vid job {job_id} drifts from its immutable profile")
    frames = job.get("frames")
    if isinstance(frames, bool) or not isinstance(frames, int) or frames < 9 or (frames - 1) % 8:
        raise ValueError(f"A2Vid job {job_id} has an invalid LTX frame count")
    if job.get("fps") != profile["fps"]:
        raise ValueError(f"A2Vid job {job_id} drifts from its immutable frame rate")
    timeout = job.get("timeoutSeconds")
    if isinstance(timeout, bool) or not isinstance(timeout, int) or not 60 <= timeout <= 7_200:
        raise ValueError(f"A2Vid job {job_id} has an invalid bounded timeout")
    audio = job.get("audio")
    if not isinstance(audio, dict) or set(audio) != {"getUrl", "sha256", "contentType", "startMs", "endMs"}:
        raise ValueError(f"A2Vid job {job_id} must bind one sealed music-source segment")
    # The download reference is deliberately separate from the timing window.
    # Reusing the generic object parser against the full audio object would
    # silently discard the window or accidentally accept extra controls.
    audio_ref = _require_object_ref(
        {key: audio[key] for key in ("getUrl", "sha256", "contentType")},
        f"A2Vid job {job_id}.audio",
        content_types=AUDIO_CONTENT_TYPES,
    )
    start_ms = audio.get("startMs")
    end_ms = audio.get("endMs")
    if isinstance(start_ms, bool) or not isinstance(start_ms, int) or start_ms < 0 or isinstance(end_ms, bool) or not isinstance(end_ms, int):
        raise ValueError(f"A2Vid job {job_id} has an invalid audio window")
    duration_ms = end_ms - start_ms
    if not MIN_AUDIO_DURATION_MS <= duration_ms <= MAX_AUDIO_DURATION_MS:
        raise ValueError(f"A2Vid job {job_id} must use a 2–20 second sealed audio segment")
    video_duration_ms = round(frames / float(profile["fps"]) * 1_000)
    if abs(video_duration_ms - duration_ms) > 120:
        raise ValueError(f"A2Vid job {job_id} video duration must match its sealed audio segment")
    opening = job.get("openingInput")
    ending = job.get("endingInput")
    if ending is not None and opening is None:
        raise ValueError(f"A2Vid job {job_id} ending reference requires an approved opening reference")
    opening_ref = _require_object_ref(opening, f"A2Vid job {job_id}.openingInput", content_types=IMAGE_CONTENT_TYPES) if opening is not None else None
    ending_ref = _require_object_ref(ending, f"A2Vid job {job_id}.endingInput", content_types=IMAGE_CONTENT_TYPES) if ending is not None else None
    _validate_artifact(job.get("artifact"), manifest_id, profile_hash, job_id)
    return {
        **job,
        "id": job_id,
        "prompt": prompt,
        "audio": {**audio_ref, "startMs": start_ms, "endMs": end_ms},
        **({"openingInput": opening_ref} if opening_ref else {}),
        **({"endingInput": ending_ref} if ending_ref else {}),
    }


def validate_manifest(manifest: Any, expected_sha256: str) -> dict[str, Any]:
    if not isinstance(manifest, dict):
        raise ValueError("A2Vid manifest must be a JSON object")
    unsigned = {key: value for key, value in manifest.items() if key != "manifestSha256"}
    if manifest.get("manifestSha256") != expected_sha256 or _hash(unsigned) != expected_sha256:
        raise ValueError("A2Vid manifest hash mismatch")
    required = {
        "contractVersion", "manifestId", "phase", "gpuSku", "gpuCount", "expiresAt", "maxCostUsd",
        "maxRuntimeSeconds", "profile", "profileSha256", "models", "jobs", "checkpoint", "heartbeat",
        "completion", "manifestSha256",
    }
    if set(manifest) != required or manifest.get("contractVersion") != CONTRACT_VERSION or manifest.get("phase") != PHASE:
        raise ValueError("unsupported sealed A2Vid manifest")
    manifest_id = str(manifest.get("manifestId") or "")
    if not re.fullmatch(r"audio_video-[a-f0-9]{32}", manifest_id):
        raise ValueError("A2Vid manifest identity does not match its phase")
    if manifest.get("gpuSku") not in ALLOWED_GPU_SKUS or manifest.get("gpuCount") != 1:
        raise ValueError("A2Vid manifest must pin exactly one supported Novita GPU")
    max_cost_usd = manifest.get("maxCostUsd")
    if isinstance(max_cost_usd, bool) or not isinstance(max_cost_usd, (int, float)) or not math.isfinite(max_cost_usd) or max_cost_usd <= 0:
        raise ValueError("A2Vid manifest requires a positive finite hard spend cap")
    expires_at = manifest.get("expiresAt")
    if isinstance(expires_at, bool) or not isinstance(expires_at, int) or expires_at <= int(time.time() * 1_000):
        raise ValueError("A2Vid manifest expired")
    max_runtime_seconds = manifest.get("maxRuntimeSeconds")
    if isinstance(max_runtime_seconds, bool) or not isinstance(max_runtime_seconds, int) or not common.MIN_WORKER_RUNTIME_SECONDS <= max_runtime_seconds <= common.MAX_WORKER_RUNTIME_SECONDS:
        raise ValueError("A2Vid manifest has an invalid sealed runtime cap")
    profile = validate_profile(manifest.get("profile"))
    profile_hash = _hash(profile)
    if manifest.get("profileSha256") != profile_hash or manifest.get("gpuSku") != profile["requiredGpuSku"]:
        raise ValueError("A2Vid manifest profile identity drifts from its sealed hardware contract")
    common._validate_delivery_target(manifest.get("checkpoint"), "A2Vid checkpoint", require_get=True)
    common._validate_delivery_target(manifest.get("heartbeat"), "A2Vid heartbeat")
    common._validate_delivery_target(manifest.get("completion"), "A2Vid completion")
    models = validate_model_specs(manifest.get("models"), profile)
    jobs = manifest.get("jobs")
    if not isinstance(jobs, list) or len(jobs) != MAX_JOBS:
        raise ValueError("A2Vid benchmark manifest must contain exactly one job")
    validated_jobs = [_validate_job(job, profile, manifest_id, profile_hash) for job in jobs]
    if len({job["id"] for job in validated_jobs}) != len(validated_jobs):
        raise ValueError("A2Vid job identities must be unique")
    return {**manifest, "profile": profile, "models": models, "jobs": validated_jobs}


def _assert_gpu(manifest: dict[str, Any]) -> None:
    result = subprocess.run(
        ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
        check=True,
        capture_output=True,
        text=True,
        timeout=15,
    )
    rows = [row.strip() for row in result.stdout.splitlines() if row.strip()]
    if len(rows) != 1:
        raise RuntimeError("A2Vid worker requires exactly one attested GPU")
    name, _, memory = rows[0].partition(",")
    normalized_name = name.upper()
    actual = "RTX 5090" if "5090" in normalized_name else "RTX 4090" if "4090" in normalized_name else ""
    memory_match = re.search(r"(\d+)", memory)
    memory_mib = int(memory_match.group(1)) if memory_match else 0
    profile = manifest["profile"]
    if actual != manifest["gpuSku"] or actual != profile["requiredGpuSku"] or memory_mib < profile["minimumVramGb"] * 1024:
        raise RuntimeError("A2Vid host GPU does not match its sealed SKU or VRAM contract")


def build_a2vid_command(job: dict[str, Any], profile: dict[str, Any], models: dict[str, Path], output: Path, audio_path: Path, opening_path: Path | None, ending_path: Path | None) -> list[str]:
    required = set(COMPONENT_IDS)
    if set(models) != required:
        raise ValueError("A2Vid local cache does not contain its exact sealed component set")
    command = [
        sys.executable, "-m", "ltx_pipelines.a2vid_two_stage",
        "--transformer-path", str(models["a2vid-transformer"]),
        "--text-encoder-path", str(models["a2vid-text-encoder"]),
        "--video-vae-path", str(models["a2vid-video-vae"]),
        "--audio-vae-path", str(models["a2vid-audio-vae"]),
        "--spatial-upsampler-path", str(models["a2vid-spatial-upscaler"]),
        "--distilled-lora", str(models["a2vid-stage2-distilled-lora"]), "1.0",
        "--quantization", str(profile["quantization"]),
        "--offload", str(profile["offload"]),
        "--prompt", str(job["prompt"]),
        "--output-path", str(output),
        "--seed", str(int(job["seed"])),
        "--height", str(int(job["height"])),
        "--width", str(int(job["width"])),
        "--num-frames", str(int(job["frames"])),
        "--frame-rate", str(float(job["fps"])),
        "--audio-path", str(audio_path),
        "--audio-start-time", str(job["audio"]["startMs"] / 1_000),
        "--audio-max-duration", str((job["audio"]["endMs"] - job["audio"]["startMs"]) / 1_000),
    ]
    if opening_path is not None:
        command.extend(["--image", str(opening_path), "0", "1.0"])
    if ending_path is not None:
        command.extend(["--image", str(ending_path), str(int(job["frames"]) - 1), "1.0"])
    return command


def _render_job(job: dict[str, Any], profile: dict[str, Any], models: dict[str, Path], output: Path, workdir: Path, deadline_monotonic: float) -> dict[str, Any]:
    audio_path = workdir / f"{job['id']}-audio"
    common.download(job["audio"]["getUrl"], audio_path, job["audio"]["sha256"])
    opening_path: Path | None = None
    ending_path: Path | None = None
    if job.get("openingInput"):
        opening_path = workdir / f"{job['id']}-opening.png"
        common.download(job["openingInput"]["getUrl"], opening_path, job["openingInput"]["sha256"])
    if job.get("endingInput"):
        ending_path = workdir / f"{job['id']}-ending.png"
        common.download(job["endingInput"]["getUrl"], ending_path, job["endingInput"]["sha256"])
    command = build_a2vid_command(job, profile, models, output, audio_path, opening_path, ending_path)
    remaining_seconds = math.floor(deadline_monotonic - time.monotonic())
    if remaining_seconds < 1:
        raise InterruptedError("A2Vid render exceeded sealed lifetime")
    common._run_bounded(command, min(int(job["timeoutSeconds"]), remaining_seconds), deadline_monotonic)
    proof = common.probe_video_output(output, int(profile["width"]), int(profile["height"]), int(job["frames"]), int(job["fps"]))
    return {
        **proof,
        "pipeline": "a2vid_two_stage",
        "audioPreserved": True,
        "sourceAudioSha256": job["audio"]["sha256"],
        "audioStartMs": job["audio"]["startMs"],
        "audioEndMs": job["audio"]["endMs"],
        "stageOneWidth": profile["stageOneWidth"],
        "stageOneHeight": profile["stageOneHeight"],
        "spatialUpscaleFactor": profile["spatialUpscaleFactor"],
        "modelRevision": profile["modelRevision"],
        "runtimeRevision": profile["runtimeRevision"],
    }


def _assert_output_proof(proof: Any, job: dict[str, Any], profile: dict[str, Any]) -> None:
    if not isinstance(proof, dict):
        raise ValueError("A2Vid output proof must be an object")
    expected = {
        "outputWidth": profile["width"], "outputHeight": profile["height"], "frameCount": job["frames"],
        "frameRate": job["fps"], "hasAudio": True, "pipeline": "a2vid_two_stage", "audioPreserved": True,
        "sourceAudioSha256": job["audio"]["sha256"], "audioStartMs": job["audio"]["startMs"],
        "audioEndMs": job["audio"]["endMs"], "stageOneWidth": profile["stageOneWidth"],
        "stageOneHeight": profile["stageOneHeight"], "spatialUpscaleFactor": 2,
        "modelRevision": profile["modelRevision"], "runtimeRevision": profile["runtimeRevision"],
    }
    if any(proof.get(key) != value for key, value in expected.items()):
        raise ValueError("A2Vid output proof drifts from the sealed audio, runtime, or geometry contract")


def _load_a2vid_checkpoint(target: dict[str, Any] | None, manifest_id: str, expected_job_id: str) -> tuple[set[str], dict[str, dict[str, Any]]]:
    """Reload only an A2Vid checkpoint; never treat direct-video evidence as one.

    ``worker.py`` has a similarly shaped helper for its ``videoOutputs`` key.
    A separate name here is intentional: a checkpoint created by the standard
    image-to-video worker cannot be replayed as evidence that mastered audio
    conditioning occurred.
    """
    if not target or not target.get("getUrl"):
        return set(), {}
    try:
        data = json.loads(common._request(str(target["getUrl"]), timeout=30))
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return set(), {}
        raise
    if not isinstance(data, dict) or data.get("manifestId") != manifest_id or not isinstance(data.get("completedJobIds"), list):
        raise ValueError("A2Vid checkpoint identity mismatch")
    completed_values = data["completedJobIds"]
    if not all(isinstance(value, str) for value in completed_values) or len(completed_values) != len(set(completed_values)):
        raise ValueError("A2Vid checkpoint completed job identities are invalid")
    completed = set(completed_values)
    if not completed.issubset({expected_job_id}):
        raise ValueError("A2Vid checkpoint contains jobs outside its render manifest")
    raw_outputs = data.get("audioVideoOutputs", {})
    if not isinstance(raw_outputs, dict) or not all(isinstance(key, str) and isinstance(value, dict) for key, value in raw_outputs.items()):
        raise ValueError("A2Vid checkpoint output evidence is invalid")
    if set(raw_outputs) != completed:
        raise ValueError("A2Vid checkpoint output evidence must cover every completed job")
    return completed, {str(key): dict(value) for key, value in raw_outputs.items()}


def main() -> int:
    manifest_url = os.environ.get("NOVITA_JOB_MANIFEST_URL", "")
    manifest_hash = os.environ.get("NOVITA_MANIFEST_SHA256", "")
    if not manifest_url.startswith("https://") or not SHA256_RE.fullmatch(manifest_hash):
        raise ValueError("SHA-bound HTTPS A2Vid manifest is required")
    manifest = validate_manifest(json.loads(common._request(manifest_url, timeout=30)), manifest_hash)
    deadline_monotonic, deadline_at = common.sealed_deadline(manifest)
    expiry_timer = common.arm_sealed_deadline(deadline_monotonic)
    checkpoint = manifest["checkpoint"]
    job = manifest["jobs"][0]
    state: dict[str, Any] = {"manifestId": manifest["manifestId"], "completedJobIds": [], "deadlineAt": deadline_at, "audioVideoOutputs": {}}
    heartbeat = threading.Thread(target=common._heartbeat_loop, args=(manifest.get("heartbeat"), state, deadline_monotonic), daemon=True)
    heartbeat.start()
    failure: str | None = None
    done = False
    completion_reported = False
    try:
        completed, outputs = _load_a2vid_checkpoint(checkpoint, manifest["manifestId"], job["id"])
        state["completedJobIds"] = sorted(completed)
        for completed_job_id, proof in outputs.items():
            if completed_job_id != job["id"]:
                raise ValueError("A2Vid checkpoint contains another job")
            _assert_output_proof(proof, job, manifest["profile"])
        state["audioVideoOutputs"] = outputs
        if job["id"] not in completed:
            _assert_gpu(manifest)
            state["gpuSku"] = manifest["gpuSku"]
            state["gpuCount"] = 1
            volume_root = Path(os.environ.get("NOVITA_MODEL_VOLUME", "/network"))
            cache_root = Path(os.environ.get("NOVITA_LOCAL_MODEL_CACHE", "/workspace/model-cache"))
            models = {str(spec["id"]): common.hydrate_model(spec, volume_root, cache_root, deadline_monotonic) for spec in manifest["models"]}
            with tempfile.TemporaryDirectory(prefix="novita-a2vid-") as temporary:
                output = common._job_output({"id": job["id"], "phase": PHASE}, Path(temporary))
                proof = _render_job(job, manifest["profile"], models, output, Path(temporary), deadline_monotonic)
                _assert_output_proof(proof, job, manifest["profile"])
                common.upload_artifact(job, output, manifest)
            state["audioVideoOutputs"][job["id"]] = proof
            state["completedJobIds"] = [job["id"]]
            common.put_json(checkpoint, {**state, "updatedAt": int(time.time()), "status": "running"})
        done = state["completedJobIds"] == [job["id"]] and set(state["audioVideoOutputs"]) == {job["id"]}
    except BaseException as error:
        failure = common._bounded_error_message(error)
        common._report_json(checkpoint, {**state, "updatedAt": int(time.time()), "status": "interrupted" if common.STOP.is_set() else "failed", "error": failure}, "A2Vid checkpoint")
    finally:
        completion_reported = common._report_json(manifest.get("completion"), {**state, "status": "done" if done and failure is None else "interrupted" if common.STOP.is_set() else "failed", "finishedAt": int(time.time()), "error": failure}, "A2Vid completion")
        common.STOP.set()
        expiry_timer.cancel()
        heartbeat.join(timeout=2)
    return 0 if done and failure is None and completion_reported else 2


def _signal(_signum: int, _frame: Any) -> None:
    common.STOP.set()


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, _signal)
    signal.signal(signal.SIGINT, _signal)
    raise SystemExit(main())
