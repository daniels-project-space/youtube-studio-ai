#!/usr/bin/env python3
"""Immutable one-shot Novita image/video worker.

The controller supplies one SHA-bound manifest through a presigned HTTPS URL.
The worker never receives Novita or R2 credentials: inputs and outputs use
short-lived, object-scoped URLs. Model weights are copied from the mounted
network volume into the fast local cache and verified before inference.
"""

from __future__ import annotations

import fcntl
import hashlib
import http.client
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
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

CONTRACT_VERSION = "2.0.0"
ZIMAGE_MODEL = "Tongyi-MAI/Z-Image-Turbo"
ZIMAGE_REVISION = "f332072aa78be7aecdf3ee76d5c247082da564a6"
LTX_MODEL = "Lightricks/LTX-2.5"
LTX_REVISION = "ce298b1259d61ce6c87e05154b9ad339b16f32a0"
LTX_RUNTIME_REPOSITORY = "Lightricks/LTX-2"
LTX_RUNTIME_REVISION = "fd4ded7f2d88d3da713abcdd4ad41ecc4a9314ca"
LTX_TRANSFORMER_CHECKPOINT = "ltx-2.5-22b-distilled-transformer-bf16.safetensors"
LTX_TEXT_ENCODER_CHECKPOINT = "gemma4-12b-with-proj-ltx-2.5-bf16.safetensors"
LTX_VIDEO_VAE_CHECKPOINT = "ltx-2.5-video-vae-bf16.safetensors"
LTX_AUDIO_VAE_CHECKPOINT = "ltx-2.5-audio-vae-bf16.safetensors"
LTX_SPATIAL_UPSCALER_CHECKPOINT = "ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors"
LTX_FILE_CONTRACTS = {
    "ltx-transformer": (
        f"diffusion_models/{LTX_TRANSFORMER_CHECKPOINT}",
        "31eb3cad89b9e54e99dd3baf286f70825ac4f6c660a70d9184d895be76d7bff4",
        42_018_190_584,
    ),
    "ltx-text-encoder": (
        f"text_encoders/{LTX_TEXT_ENCODER_CHECKPOINT}",
        "1c647a94c0e902fb87f9a403cbca36a8b6d8e5867094442df1b41ae557cfd1c6",
        26_263_860_594,
    ),
    "ltx-video-vae": (
        f"vae/{LTX_VIDEO_VAE_CHECKPOINT}",
        "847e14ca7f3355debca0cea4eaa24ac0fbcdf0061da054ac89ca638a869ddba3",
        1_472_223_346,
    ),
    "ltx-audio-vae": (
        f"vae/{LTX_AUDIO_VAE_CHECKPOINT}",
        "c52733d37f6a7fb7949c3dc0fb468c6cb2169e4d836983a73babb9f0d54837a5",
        364_866_540,
    ),
    "ltx-spatial-upscaler": (
        f"latent_upscale_models/{LTX_SPATIAL_UPSCALER_CHECKPOINT}",
        "eb5a71fe4068ee87ccdb1c3aa635e547ca76bd2d30ae20ae889f2c325c0677e8",
        995_778_752,
    ),
}
STATUS_BATCH_SECONDS = 60
MAX_HTTP_ATTEMPTS = 4
MAX_MANIFEST_JOBS = 240
MIN_WORKER_RUNTIME_SECONDS = 60
MAX_WORKER_RUNTIME_SECONDS = 2 * 60 * 60
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
JOB_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$")
REQUIRED_GPU_SKU = "RTX 4090"
REQUIRED_GPU_COUNT = 1

STOP = threading.Event()
_IMAGE_PIPELINES: dict[str, Any] = {}

APPROVED_INFRASTRUCTURE = {
    "provider": "novita",
    "capacityMode": "spot",
    "weightStorage": "local-persistent-disk",
    "cacheMount": "/workspace/model-cache",
    "checkpointing": True,
    "idleShutdownSeconds": 300,
    "elasticGpuCeiling": 8,
}


def approved_profile(profile_id: str, phase: str) -> dict[str, Any]:
    image_settings = {
        "draft": (1280, 736, 9, 0, 1),
        "production": (1920, 1088, 9, 0, 1),
        "hero": (2048, 1152, 9, 0, 2),
    }
    # LTX 2.5 distilled is itself a two-stage pipeline: 640x352 stage one,
    # followed by latent-space x2 refinement to the 1280x704 deliverable.
    # Keep all profile IDs on this single proven hardware contract; quality
    # differs through upstream still selection/QA, never a hidden GPU fallback.
    video_settings = {
        "draft": (1,),
        "production": (1,),
        "hero": (1,),
    }
    if phase == "image" and profile_id in image_settings:
        width, height, steps, guidance, candidates = image_settings[profile_id]
        return {
            "contractVersion": "1.0.0", "id": profile_id, "phase": phase,
            "model": ZIMAGE_MODEL, "revision": ZIMAGE_REVISION,
            "checkpoint": "Z-Image-Turbo", "width": width, "height": height,
            "steps": steps, "guidanceScale": guidance, "precision": "bf16",
            "candidates": candidates, "infrastructure": APPROVED_INFRASTRUCTURE,
            "allowFallback": False,
        }
    if phase == "video" and profile_id in video_settings:
        (candidates,) = video_settings[profile_id]
        return {
            "contractVersion": "1.0.0", "id": profile_id, "phase": phase,
            "model": LTX_MODEL, "revision": LTX_REVISION,
            "checkpoint": LTX_TRANSFORMER_CHECKPOINT,
            "width": 1280, "height": 704, "steps": 8,
            "guidanceScale": 1, "precision": "bf16", "candidates": candidates,
            "infrastructure": APPROVED_INFRASTRUCTURE, "fps": 25,
            "pipeline": "distilled", "twoStageRefine": True,
            "textEncoderCheckpoint": LTX_TEXT_ENCODER_CHECKPOINT,
            "videoVaeCheckpoint": LTX_VIDEO_VAE_CHECKPOINT,
            "audioVaeCheckpoint": LTX_AUDIO_VAE_CHECKPOINT,
            "spatialUpscalerCheckpoint": LTX_SPATIAL_UPSCALER_CHECKPOINT,
            "quantization": "fp8-cast", "offload": "cpu", "spatialUpscaleFactor": 2,
            "stageOneWidth": 640, "stageOneHeight": 352,
            "allowFallback": False,
        }
    raise ValueError(f"unsupported approved render profile: {profile_id}/{phase}")


def requested_creative_adapter_ids(jobs: Any, phase: str) -> set[str]:
    if phase != "video":
        return set()
    if not isinstance(jobs, list):
        raise ValueError("manifest jobs must be a list")
    ids: set[str] = set()
    for job in jobs:
        adapter = job.get("creativeAdapter") if isinstance(job, dict) else None
        if adapter is None:
            continue
        if not isinstance(adapter, dict):
            raise ValueError("creative adapter must be a structured job contract")
        adapter_id = str(adapter.get("id") or "")
        strength = adapter.get("strength")
        trigger_tokens = adapter.get("triggerTokens")
        if (
            not re.fullmatch(r"ltx-creative-[a-z0-9][a-z0-9-]{1,78}", adapter_id)
            or isinstance(strength, bool) or not isinstance(strength, (int, float))
            or not math.isfinite(float(strength)) or not 0.15 <= float(strength) <= 0.95
            or not isinstance(trigger_tokens, list) or not 1 <= len(trigger_tokens) <= 8
            or not all(isinstance(token, str) and token.strip() for token in trigger_tokens)
        ):
            raise ValueError("creative adapter contract is invalid")
        if not all(token.lower() in str(job.get("prompt") or "").lower() for token in trigger_tokens):
            raise ValueError("creative adapter trigger tokens are missing from the LTX prompt")
        ids.add(adapter_id)
    return ids


def validate_model_specs(
    model_specs: Any,
    phase: str,
    pipeline: str | None,
    creative_adapter_ids: set[str] | None = None,
) -> list[dict[str, Any]]:
    creative_adapter_ids = creative_adapter_ids or set()
    if not isinstance(model_specs, list) or not all(isinstance(spec, dict) for spec in model_specs):
        raise ValueError("manifest model cache contract is missing")
    model_ids = [str(spec.get("id") or "") for spec in model_specs]
    if len(model_ids) != len(set(model_ids)):
        raise ValueError("manifest model cache identities must be unique")
    if phase == "video" and pipeline != "distilled":
        raise ValueError("manifest video profile must use the approved LTX 2.5 distilled x2 pipeline")
    required = {"z-image-turbo"} if phase == "image" else set(LTX_FILE_CONTRACTS) | creative_adapter_ids
    supplied = set(model_ids)
    if not required.issubset(supplied):
        raise ValueError(f"manifest models are missing required cache identities: {sorted(required - supplied)}")
    # The shared renderer admits a single provenance-pinned model manifest
    # containing both Z-Image and LTX.  The inactive base model is permitted
    # but never hydrated for this phase; only explicitly selected LoRAs are
    # otherwise allowed as optional entries.
    inactive_base_model_ids = set(LTX_FILE_CONTRACTS) if phase == "image" else {"z-image-turbo"}
    optional_adapter_ids = supplied - required - inactive_base_model_ids
    if any(not adapter_id.startswith("ltx-creative-") for adapter_id in optional_adapter_ids):
        raise ValueError(f"manifest models contain unexpected cache identities: {sorted(optional_adapter_ids)}")
    for spec in model_specs:
        if spec["id"] == "z-image-turbo":
            if (
                spec.get("kind") != "tree"
                or spec.get("repository") != ZIMAGE_MODEL
                or spec.get("revision") != ZIMAGE_REVISION
                or not SHA256_RE.fullmatch(str(spec.get("manifestSha256") or ""))
            ):
                raise ValueError("manifest Z-Image tree does not match the official pinned repository revision")
            continue
        contract = LTX_FILE_CONTRACTS.get(str(spec["id"]))
        if contract is None:
            adapter = spec.get("creativeAdapter")
            trigger_tokens = adapter.get("triggerTokens") if isinstance(adapter, dict) else None
            source_path = Path(str(spec.get("sourcePath") or "")).as_posix()
            local_path = Path(str(spec.get("localPath") or "")).as_posix()
            if (
                spec.get("kind") != "file"
                or spec.get("repository") != LTX_MODEL
                or spec.get("revision") != LTX_REVISION
                or not SHA256_RE.fullmatch(str(spec.get("manifestSha256") or ""))
                or not isinstance(adapter, dict)
                or adapter.get("contractVersion") != "ltx-creative-adapter/v1"
                or adapter.get("baseModel") != LTX_MODEL
                or adapter.get("baseRevision") != LTX_REVISION
                or adapter.get("runtimeRevision") != LTX_RUNTIME_REVISION
                or adapter.get("role") not in {"visual-style", "camera-control", "material-style"}
                or not isinstance(trigger_tokens, list) or not 1 <= len(trigger_tokens) <= 8
                or not isinstance(adapter.get("benchmark"), dict)
                or adapter["benchmark"].get("rtx4090ProfileBenchmarked") is not True
                or adapter["benchmark"].get("visualVerdict") != "pass"
                or "/loras/" not in source_path or "/loras/" not in local_path
            ):
                raise ValueError(f"manifest creative adapter {spec['id']} is not an exact benchmarked LTX 2.5 adapter")
            continue
        relative_path, expected_sha256, expected_size = contract
        source_path = Path(str(spec.get("sourcePath") or "")).as_posix()
        local_path = Path(str(spec.get("localPath") or "")).as_posix()
        if (
            spec.get("kind") != "file"
            or spec.get("repository") != LTX_MODEL
            or spec.get("revision") != LTX_REVISION
            or spec.get("manifestSha256") != expected_sha256
            or spec.get("sizeBytes") != expected_size
            or not source_path.endswith(relative_path)
            or not local_path.endswith(relative_path)
        ):
            raise ValueError(f"manifest model {spec['id']} does not match the official pinned LTX file")
    # A cached optional adapter must never be hydrated into an ordinary LTX
    # take. Keep it inspected/allowlisted, then return only the base files and
    # explicitly selected adapters for this worker's local cache.
    return [spec for spec in model_specs if str(spec.get("id")) in required]


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _check_deadline(deadline_monotonic: float | None = None) -> None:
    """Raise promptly once the sealed worker lifetime has elapsed."""
    if deadline_monotonic is not None and time.monotonic() >= deadline_monotonic:
        STOP.set()
    if STOP.is_set():
        raise InterruptedError("worker exceeded its sealed lifetime")


def sha256_file(
    path: Path,
    chunk_size: int = 8 * 1024 * 1024,
    deadline_monotonic: float | None = None,
) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(chunk_size), b""):
            _check_deadline(deadline_monotonic)
            digest.update(chunk)
    return digest.hexdigest()


def _normalized_gpu_sku(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", re.sub(r"nvidia|geforce|graphics|gpu", "", value.lower()))


def _is_rtx_4090_sku(value: str) -> bool:
    """Accept only canonical naming variants of the one permitted 4090 SKU."""
    return bool(re.fullmatch(r"rtx4090(?:24gb(?:highfrequency)?)?", _normalized_gpu_sku(value)))


def assert_rtx_4090_host() -> None:
    """Fail closed if Novita ever starts this worker on another GPU SKU."""
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            check=True,
            capture_output=True,
            text=True,
            timeout=20,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeError("unable to attest the required RTX 4090 GPU") from error
    names = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    if len(names) != REQUIRED_GPU_COUNT or any(not _is_rtx_4090_sku(name) for name in names):
        raise RuntimeError(
            f"worker requires exactly one {REQUIRED_GPU_SKU}; provider reported {names or 'no GPU'}"
        )


def _parse_https_url(url: str) -> urllib.parse.SplitResult:
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("worker object URLs must use credential-free HTTPS authorities")
    return parsed


def _request(
    url: str,
    *,
    method: str = "GET",
    body: bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout: int = 120,
) -> bytes:
    _parse_https_url(url)
    request = urllib.request.Request(url, data=body, headers=headers or {}, method=method)
    for attempt in range(MAX_HTTP_ATTEMPTS):
        _check_deadline()
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                value = response.read()
                _check_deadline()
                return value
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as error:
            retryable = not isinstance(error, urllib.error.HTTPError) or error.code in (408, 425, 429, 500, 502, 503, 504)
            if not retryable or attempt + 1 >= MAX_HTTP_ATTEMPTS:
                raise
            STOP.wait(min(20, 2 ** attempt))
    raise RuntimeError("bounded HTTP retry exhausted")


def put_json(target: dict[str, Any] | None, value: dict[str, Any]) -> None:
    if not target:
        return
    body = canonical_bytes(value)
    headers = {str(k): str(v) for k, v in (target.get("headers") or {}).items()}
    headers.setdefault("Content-Type", "application/json")
    _request(str(target["putUrl"]), method="PUT", body=body, headers=headers)


def _validate_delivery_target(target: Any, label: str, *, require_get: bool = False) -> dict[str, Any]:
    if not isinstance(target, dict):
        raise ValueError(f"{label} delivery contract is missing")
    _parse_https_url(str(target.get("putUrl") or ""))
    if require_get:
        _parse_https_url(str(target.get("getUrl") or ""))
    headers = target.get("headers") or {}
    if not isinstance(headers, dict) or not all(isinstance(key, str) and isinstance(value, str) for key, value in headers.items()):
        raise ValueError(f"{label} delivery headers are invalid")
    return target


def download(url: str, target: Path, expected_sha256: str | None = None) -> None:
    data = _request(url)
    if expected_sha256 and sha256_bytes(data) != expected_sha256:
        raise ValueError(f"downloaded object hash mismatch for {target.name}")
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.name}.{os.getpid()}.partial")
    temporary.write_bytes(data)
    os.replace(temporary, target)


def _within(root: Path, value: str) -> Path:
    root = root.resolve()
    candidate = Path(value)
    if not candidate.is_absolute():
        candidate = root / candidate
    candidate = candidate.resolve()
    if candidate != root and root not in candidate.parents:
        raise ValueError(f"path escapes approved root: {value}")
    return candidate


def _copy_verified_file(
    source: Path,
    target: Path,
    expected_sha256: str,
    expected_size: int | None = None,
    deadline_monotonic: float | None = None,
) -> None:
    _check_deadline(deadline_monotonic)
    if target.is_file() and (expected_size is None or target.stat().st_size == expected_size):
        if sha256_file(target, deadline_monotonic=deadline_monotonic) == expected_sha256:
            return
    if not source.is_file() or (expected_size is not None and source.stat().st_size != expected_size):
        raise FileNotFoundError(f"staged model file is missing or incomplete: {source}")
    if sha256_file(source, deadline_monotonic=deadline_monotonic) != expected_sha256:
        raise ValueError(f"staged model file hash mismatch: {source}")
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.name}.{os.getpid()}.partial")
    with source.open("rb") as source_file, temporary.open("wb") as target_file:
        while chunk := source_file.read(8 * 1024 * 1024):
            try:
                _check_deadline(deadline_monotonic)
            except InterruptedError:
                temporary.unlink(missing_ok=True)
                raise
            target_file.write(chunk)
    if sha256_file(temporary, deadline_monotonic=deadline_monotonic) != expected_sha256:
        temporary.unlink(missing_ok=True)
        raise ValueError(f"local model copy hash mismatch: {target}")
    os.replace(temporary, target)


def hydrate_model(
    spec: dict[str, Any],
    volume_root: Path,
    cache_root: Path,
    deadline_monotonic: float | None = None,
) -> Path:
    _check_deadline(deadline_monotonic)
    model_id = str(spec.get("id") or "")
    kind = str(spec.get("kind") or "")
    expected = str(spec.get("manifestSha256") or "")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,63}", model_id) or kind not in ("file", "tree") or not SHA256_RE.fullmatch(expected):
        raise ValueError("invalid model cache contract")
    source = _within(volume_root, str(spec.get("sourcePath") or ""))
    target = _within(cache_root, str(spec.get("localPath") or model_id))
    target.parent.mkdir(parents=True, exist_ok=True)
    lock_path = cache_root / ".locks" / f"{model_id}.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a+b") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        _check_deadline(deadline_monotonic)
        if kind == "file":
            _copy_verified_file(
                source,
                target,
                expected,
                int(spec["sizeBytes"]) if spec.get("sizeBytes") else None,
                deadline_monotonic,
            )
            return target

        source_manifest = source / ".model-manifest.json"
        manifest_bytes = source_manifest.read_bytes()
        manifest = json.loads(manifest_bytes)
        if sha256_bytes(canonical_bytes(manifest)) != expected:
            raise ValueError(f"model tree manifest hash mismatch: {model_id}")
        files = manifest.get("files") if isinstance(manifest, dict) else None
        if not isinstance(files, list) or not files:
            raise ValueError(f"model tree manifest contains no files: {model_id}")
        validated_files: list[tuple[str, str, int]] = []
        seen_paths: set[str] = set()
        for item in files:
            if not isinstance(item, dict):
                raise ValueError(f"invalid model tree entry: {model_id}")
            relative = str(item.get("path") or "")
            file_hash = str(item.get("sha256") or "")
            size = int(item.get("sizeBytes") or 0)
            if not relative or relative in seen_paths or not SHA256_RE.fullmatch(file_hash) or size < 1:
                raise ValueError(f"invalid model tree entry: {model_id}")
            _within(source, relative)
            _within(target, relative)
            seen_paths.add(relative)
            validated_files.append((relative, file_hash, size))
        sentinel = target / ".verified-model.json"
        if sentinel.is_file():
            try:
                cached = json.loads(sentinel.read_text("utf-8"))
                if cached.get("manifestSha256") == expected and all(
                    (_within(target, relative)).is_file()
                    and (_within(target, relative)).stat().st_size == size
                    and sha256_file(_within(target, relative), deadline_monotonic=deadline_monotonic) == file_hash
                    for relative, file_hash, size in validated_files
                ):
                    return target
            except Exception:
                pass
        for relative, file_hash, size in validated_files:
            _copy_verified_file(
                _within(source, relative),
                _within(target, relative),
                file_hash,
                size,
                deadline_monotonic,
            )
        sentinel.parent.mkdir(parents=True, exist_ok=True)
        sentinel.write_text(json.dumps({"manifestSha256": expected, "verifiedAt": int(time.time())}), "utf-8")
        return target


def validate_manifest(manifest: Any, expected_sha256: str) -> dict[str, Any]:
    if not isinstance(manifest, dict):
        raise ValueError("render manifest must be a JSON object")
    claimed_hash = manifest.get("manifestSha256")
    unsigned = {key: value for key, value in manifest.items() if key != "manifestSha256"}
    if claimed_hash != expected_sha256 or sha256_bytes(canonical_bytes(unsigned)) != expected_sha256:
        raise ValueError("render manifest hash mismatch")
    if manifest.get("contractVersion") != CONTRACT_VERSION:
        raise ValueError("unsupported render manifest contract")
    if manifest.get("phase") not in ("image", "video") or not isinstance(manifest.get("jobs"), list):
        raise ValueError("invalid render manifest phase or jobs")
    if manifest.get("gpuSku") != REQUIRED_GPU_SKU or manifest.get("gpuCount") != REQUIRED_GPU_COUNT:
        raise ValueError(f"render manifest must pin exactly one {REQUIRED_GPU_SKU}")
    manifest_id = str(manifest.get("manifestId") or "")
    if not re.fullmatch(rf"{manifest['phase']}-[a-f0-9]{{32}}", manifest_id):
        raise ValueError("render manifest identity does not match its phase")
    if not manifest["jobs"] or len(manifest["jobs"]) > MAX_MANIFEST_JOBS:
        raise ValueError(f"render manifest must contain 1..{MAX_MANIFEST_JOBS} jobs")
    max_cost_usd = manifest.get("maxCostUsd")
    if isinstance(max_cost_usd, bool) or not isinstance(max_cost_usd, (int, float)) or not math.isfinite(max_cost_usd) or max_cost_usd <= 0:
        raise ValueError("render manifest requires a positive finite hard spend cap")
    expires_at = manifest.get("expiresAt")
    if isinstance(expires_at, bool) or not isinstance(expires_at, int) or expires_at <= int(time.time() * 1000):
        raise ValueError("render manifest expired")
    max_runtime_seconds = manifest.get("maxRuntimeSeconds")
    if max_runtime_seconds is not None and (
        isinstance(max_runtime_seconds, bool)
        or not isinstance(max_runtime_seconds, int)
        or not MIN_WORKER_RUNTIME_SECONDS <= max_runtime_seconds <= MAX_WORKER_RUNTIME_SECONDS
    ):
        raise ValueError(
            f"render manifest maxRuntimeSeconds must be an integer from "
            f"{MIN_WORKER_RUNTIME_SECONDS} to {MAX_WORKER_RUNTIME_SECONDS}",
        )
    profile = manifest.get("profile")
    if not isinstance(profile, dict) or profile.get("allowFallback") is not False:
        raise ValueError("render profile must be immutable and fail closed")
    expected_profile_hash = sha256_bytes(canonical_bytes(profile))
    if manifest.get("profileSha256") != expected_profile_hash:
        raise ValueError("render profile hash mismatch")
    try:
        expected_profile = approved_profile(str(profile.get("id") or ""), str(manifest["phase"]))
    except ValueError as error:
        raise ValueError("render profile is not an approved immutable profile") from error
    if profile != expected_profile:
        raise ValueError("render profile drifts from its approved immutable model and runtime settings")
    if manifest["phase"] == "video" and (
        manifest.get("runtimeRepository") != LTX_RUNTIME_REPOSITORY
        or manifest.get("runtimeRevision") != LTX_RUNTIME_REVISION
    ):
        raise ValueError("render manifest does not pin the approved official LTX runtime")
    if manifest["phase"] == "video" and profile.get("pipeline") != "distilled":
        raise ValueError("render profile does not use the approved official LTX 2.5 distilled x2 pipeline")
    _validate_delivery_target(manifest.get("checkpoint"), "checkpoint", require_get=True)
    _validate_delivery_target(manifest.get("heartbeat"), "heartbeat")
    _validate_delivery_target(manifest.get("completion"), "completion")
    ids = [job.get("id") for job in manifest["jobs"] if isinstance(job, dict)]
    if len(ids) != len(manifest["jobs"]) or len(set(ids)) != len(ids) or not all(JOB_ID_RE.fullmatch(str(item)) for item in ids):
        raise ValueError("render job identities must be unique and valid")
    for job in manifest["jobs"]:
        prompt = job.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 20_000:
            raise ValueError(f"render job {job['id']} requires a prompt")
        seed = job.get("seed")
        if isinstance(seed, bool) or not isinstance(seed, int) or seed < 0 or seed > 2**63 - 1:
            raise ValueError(f"render job {job['id']} has invalid seed")
        for field in ("width", "height", "steps"):
            value = job.get(field)
            if isinstance(value, bool) or not isinstance(value, int) or value < 1:
                raise ValueError(f"render job {job['id']} has invalid {field}")
        if job["width"] != profile.get("width") or job["height"] != profile.get("height") or job["steps"] != profile.get("steps"):
            raise ValueError(f"render job {job['id']} drifts from its immutable profile")
        if manifest["phase"] == "image":
            guidance = job.get("guidanceScale")
            if isinstance(guidance, bool) or not isinstance(guidance, (int, float)) or not math.isfinite(guidance):
                raise ValueError(f"render job {job['id']} has invalid guidance scale")
            if float(guidance) != float(profile.get("guidanceScale")):
                raise ValueError(f"render job {job['id']} drifts from its immutable profile")
        else:
            frames, fps = job.get("frames"), job.get("fps")
            if isinstance(frames, bool) or not isinstance(frames, int) or frames < 9 or (frames - 1) % 8:
                raise ValueError(f"render job {job['id']} has invalid LTX frame count")
            if isinstance(fps, bool) or not isinstance(fps, (int, float)) or not math.isfinite(fps) or fps <= 0:
                raise ValueError(f"render job {job['id']} has invalid frame rate")
            if float(fps) != float(profile.get("fps")):
                raise ValueError(f"render job {job['id']} drifts from its immutable profile")
            timeout = job.get("timeoutSeconds", 7_200)
            if isinstance(timeout, bool) or not isinstance(timeout, int) or timeout < 60 or timeout > 7_200:
                raise ValueError(f"render job {job['id']} has invalid bounded timeout")
            negative_prompt = job.get("negativePrompt")
            if negative_prompt is not None:
                raise ValueError(f"render job {job['id']} cannot use a negative prompt with LTX 2.5 distilled")
            for field in ("input", "endInput"):
                source = job.get(field)
                if source is not None:
                    if not isinstance(source, dict) or not SHA256_RE.fullmatch(str(source.get("sha256") or "")):
                        raise ValueError(f"render job {job['id']} has invalid {field} contract")
                    _parse_https_url(str(source.get("getUrl") or ""))
        artifact = _validate_delivery_target(job.get("artifact"), f"render job {job['id']} artifact")
        normalized_headers = {key.lower(): value for key, value in artifact.get("headers", {}).items()}
        expected_metadata = {
            "x-amz-meta-manifest-id": manifest_id,
            "x-amz-meta-profile-sha256": expected_profile_hash,
            "x-amz-meta-job-id": str(job["id"]),
        }
        if any(normalized_headers.get(key) != value for key, value in expected_metadata.items()):
            raise ValueError(f"render job {job['id']} artifact URL is not bound to its immutable identity")
    return manifest


def sealed_deadline(manifest: dict[str, Any]) -> tuple[float, int]:
    """Return the monotonic deadline and its wall-clock receipt value.

    `expiresAt` is signed into every manifest and is the outer billing bound.
    A controller may add `maxRuntimeSeconds` as a stricter per-worker bound;
    neither value can extend the other.  This conversion happens once after
    validation so wall-clock adjustments cannot prolong a running worker.
    """
    now_ms = int(time.time() * 1000)
    expires_at = int(manifest["expiresAt"])
    deadline_at = expires_at
    max_runtime_seconds = manifest.get("maxRuntimeSeconds")
    if max_runtime_seconds is not None:
        deadline_at = min(deadline_at, now_ms + int(max_runtime_seconds) * 1_000)
    remaining_seconds = (deadline_at - now_ms) / 1_000
    if remaining_seconds <= 0:
        raise ValueError("render manifest sealed lifetime has elapsed")
    return time.monotonic() + remaining_seconds, deadline_at


def arm_sealed_deadline(deadline_monotonic: float, stop_event: threading.Event = STOP) -> threading.Timer:
    """Set the cooperative worker stop fence at the immutable deadline."""
    delay = max(0.0, deadline_monotonic - time.monotonic())
    timer = threading.Timer(delay, stop_event.set)
    timer.daemon = True
    timer.start()
    return timer


def _job_output(job: dict[str, Any], workdir: Path) -> Path:
    extension = ".png" if job["phase"] == "image" else ".mp4"
    return workdir / f"{job['id']}{extension}"


def render_image(
    job: dict[str, Any],
    models: dict[str, Path],
    output: Path,
    deadline_monotonic: float | None = None,
) -> None:
    _check_deadline(deadline_monotonic)
    import torch
    from diffusers import ZImagePipeline

    model_path = str(models["z-image-turbo"])
    pipe = _IMAGE_PIPELINES.get(model_path)
    if pipe is None:
        pipe = ZImagePipeline.from_pretrained(model_path, torch_dtype=torch.bfloat16, local_files_only=True)
        _check_deadline(deadline_monotonic)
        # Z-Image Turbo's bf16 text encoder + transformer exceed a 24 GB
        # card when resident together.  Keep its normal high-quality bf16
        # execution, but hand components to the RTX 4090 one at a time.
        # This is the upstream-recommended path for memory-constrained GPUs.
        pipe.enable_model_cpu_offload()
        _check_deadline(deadline_monotonic)
        _IMAGE_PIPELINES[model_path] = pipe
    generator = torch.Generator(device="cuda").manual_seed(int(job["seed"]))

    def interrupt_after_step(_pipe: Any, _step: int, _timestep: Any, callback_kwargs: dict[str, Any]) -> dict[str, Any]:
        _check_deadline(deadline_monotonic)
        return callback_kwargs

    result = pipe(
        prompt=str(job["prompt"]),
        height=int(job["height"]),
        width=int(job["width"]),
        num_inference_steps=int(job["steps"]),
        guidance_scale=float(job["guidanceScale"]),
        generator=generator,
        callback_on_step_end=interrupt_after_step,
    )
    result.images[0].save(output, format="PNG")


def _terminate_process_group(process: subprocess.Popen[Any]) -> None:
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=20)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            return
        process.wait(timeout=10)


def _run_bounded(
    command: list[str],
    timeout_seconds: int,
    deadline_monotonic: float | None = None,
) -> None:
    _check_deadline(deadline_monotonic)
    # Keep renderer diagnostics bounded, durable only for this process, and
    # attach the tail to the signed checkpoint if inference fails. Without it
    # a non-zero LTX exit gives the control plane no actionable repair signal.
    with tempfile.TemporaryFile(mode="w+b") as stderr_file:
        process = subprocess.Popen(
            command,
            start_new_session=True,
            stdout=subprocess.DEVNULL,
            stderr=stderr_file,
        )
        started = time.monotonic()
        while process.poll() is None:
            if STOP.wait(2):
                _terminate_process_group(process)
                _check_deadline(deadline_monotonic)
                raise InterruptedError("render interrupted")
            if deadline_monotonic is not None and time.monotonic() >= deadline_monotonic:
                STOP.set()
                _terminate_process_group(process)
                raise InterruptedError("render exceeded sealed lifetime")
            if time.monotonic() - started > timeout_seconds:
                _terminate_process_group(process)
                raise TimeoutError("render exceeded bounded worker timeout")
        if process.returncode != 0:
            stderr_file.seek(0, os.SEEK_END)
            size = stderr_file.tell()
            stderr_file.seek(max(0, size - 4_000))
            diagnostic = re.sub(r"\s+", " ", stderr_file.read().decode("utf-8", "replace")).strip()
            raise RuntimeError(f"renderer exited with status {process.returncode}: {diagnostic or 'no stderr'}")


def build_video_command(
    job: dict[str, Any],
    profile: dict[str, Any],
    models: dict[str, Path],
    output: Path,
    image_path: Path | None,
    end_image_path: Path | None = None,
) -> list[str]:
    pipeline = str(profile["pipeline"])
    if pipeline != "distilled":
        raise ValueError("unsupported LTX pipeline")
    command = [
        sys.executable,
        "-m",
        "ltx_pipelines.distilled",
        "--transformer-path", str(models["ltx-transformer"]),
        "--text-encoder-path", str(models["ltx-text-encoder"]),
        "--video-vae-path", str(models["ltx-video-vae"]),
        "--audio-vae-path", str(models["ltx-audio-vae"]),
        "--spatial-upsampler-path", str(models["ltx-spatial-upscaler"]),
        "--quantization", str(profile["quantization"]),
        "--prompt", str(job["prompt"]),
        "--output-path", str(output),
        "--seed", str(int(job["seed"])),
        "--height", str(int(job["height"])),
        "--width", str(int(job["width"])),
        "--num-frames", str(int(job["frames"])),
        "--frame-rate", str(float(job["fps"])),
        "--offload", str(profile["offload"]),
    ]
    if image_path:
        command.extend(["--image", str(image_path), "0", "1.0"])
    if end_image_path:
        command.extend(["--image", str(end_image_path), str(int(job["frames"]) - 1), "1.0"])
    adapter = job.get("creativeAdapter")
    if adapter is not None:
        adapter_id = str(adapter["id"])
        adapter_path = models.get(adapter_id)
        if adapter_path is None:
            raise ValueError(f"creative adapter {adapter_id} is unavailable in the local model cache")
        command.extend(["--lora", str(adapter_path), str(float(adapter["strength"]))])
    return command


def probe_video_output(output: Path, width: int, height: int) -> dict[str, int | bool]:
    """Require the actual encoded MP4 to match the sealed LTX stage-two target and carry audible LTX audio."""
    result = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "stream=codec_type,width,height", "-of", "json", str(output),
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError("ffprobe could not inspect rendered LTX video")
    try:
        streams = json.loads(result.stdout).get("streams")
    except (TypeError, ValueError, json.JSONDecodeError) as error:
        raise RuntimeError("ffprobe returned malformed rendered LTX video metadata") from error
    if not isinstance(streams, list) or not all(isinstance(stream, dict) for stream in streams):
        raise RuntimeError("ffprobe returned malformed rendered LTX stream metadata")
    video_streams = [stream for stream in streams if stream.get("codec_type") == "video"]
    audio_streams = [stream for stream in streams if stream.get("codec_type") == "audio"]
    if len(video_streams) != 1:
        raise RuntimeError("rendered LTX output must contain exactly one usable video stream")
    stream = video_streams[0]
    if stream.get("width") != width or stream.get("height") != height:
        raise RuntimeError(f"rendered LTX output geometry must be {width}x{height}")
    if len(audio_streams) != 1:
        raise RuntimeError("rendered LTX output must contain exactly one generated audio stream")
    # A container-level audio stream is not enough evidence: a silent AAC track
    # would survive assembly but contributes nothing to the intended physical
    # scene. Keep the threshold conservative so quiet room tone remains valid;
    # FFmpeg reports digital silence around -91 dBFS.
    audio_result = subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-nostats", "-i", str(output),
            "-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-",
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=60,
    )
    if audio_result.returncode != 0:
        raise RuntimeError("ffmpeg could not measure rendered LTX audio")
    mean_match = re.search(r"mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB", audio_result.stderr)
    mean_db = float(mean_match.group(1)) if mean_match else None
    if mean_db is None or mean_db <= -65.0:
        raise RuntimeError("rendered LTX output contains no usable generated audio")
    return {"outputWidth": width, "outputHeight": height, "hasAudio": True}


def render_video(
    job: dict[str, Any],
    profile: dict[str, Any],
    models: dict[str, Path],
    output: Path,
    workdir: Path,
    deadline_monotonic: float | None = None,
) -> dict[str, Any]:
    _check_deadline(deadline_monotonic)
    pipeline = profile.get("pipeline")
    if pipeline != "distilled":
        raise ValueError("unsupported LTX pipeline")
    frames = int(job["frames"])
    width, height = int(job["width"]), int(job["height"])
    if (
        frames < 9 or (frames - 1) % 8 or width % 64 or height % 64
        or width != 1280 or height != 704
        or profile.get("stageOneWidth") != width // 2
        or profile.get("stageOneHeight") != height // 2
        or profile.get("spatialUpscaleFactor") != 2
    ):
        raise ValueError("LTX frame count and two-stage dimensions are invalid")
    image_path: Path | None = None
    if job.get("input"):
        source = job["input"]
        image_path = workdir / f"{job['id']}-input.png"
        download(str(source["getUrl"]), image_path, source.get("sha256"))
        _check_deadline(deadline_monotonic)
    end_image_path: Path | None = None
    if job.get("endInput"):
        source = job["endInput"]
        end_image_path = workdir / f"{job['id']}-end-input.png"
        download(str(source["getUrl"]), end_image_path, source.get("sha256"))
        _check_deadline(deadline_monotonic)
    command = build_video_command(job, profile, models, output, image_path, end_image_path)
    timeout_seconds = int(job.get("timeoutSeconds", 7_200))
    if deadline_monotonic is not None:
        remaining_seconds = math.floor(deadline_monotonic - time.monotonic())
        if remaining_seconds < 1:
            _check_deadline(deadline_monotonic)
            raise InterruptedError("render exceeded sealed lifetime")
        timeout_seconds = min(timeout_seconds, remaining_seconds)
    _run_bounded(command, timeout_seconds, deadline_monotonic)
    output_proof = probe_video_output(output, width, height)
    return {
        **output_proof,
        "stageOneWidth": width // 2,
        "stageOneHeight": height // 2,
        "spatialUpscaleFactor": 2,
        "pipeline": "distilled",
        "quantization": "fp8-cast",
        "offload": "cpu",
    }


def _put_file(url: str, output: Path, headers: dict[str, str]) -> None:
    _check_deadline()
    parsed = _parse_https_url(url)
    request_path = urllib.parse.urlunsplit(("", "", parsed.path or "/", parsed.query, ""))
    size = output.stat().st_size
    for key, value in headers.items():
        if key.lower() == "content-length" and value != str(size):
            raise ValueError("artifact content length does not match rendered output")
    request_headers = {**headers, "Content-Length": str(size)}
    for attempt in range(MAX_HTTP_ATTEMPTS):
        connection: http.client.HTTPSConnection | None = None
        try:
            if STOP.is_set():
                raise InterruptedError("artifact upload interrupted")
            connection = http.client.HTTPSConnection(parsed.hostname, parsed.port or 443, timeout=120)
            with output.open("rb") as source:
                connection.request("PUT", request_path, body=source, headers=request_headers)
                response = connection.getresponse()
                response.read(64 * 1024)
                status = response.status
            if 200 <= status < 300:
                return
            if status not in (408, 425, 429, 500, 502, 503, 504):
                raise RuntimeError(f"artifact upload failed with HTTP {status}")
        except (http.client.HTTPException, OSError, TimeoutError):
            if attempt + 1 >= MAX_HTTP_ATTEMPTS:
                raise
        finally:
            if connection is not None:
                connection.close()
        if attempt + 1 >= MAX_HTTP_ATTEMPTS:
            raise RuntimeError("bounded artifact upload retry exhausted")
        if STOP.wait(min(20, 2 ** attempt)):
            raise InterruptedError("artifact upload interrupted")


def upload_artifact(job: dict[str, Any], output: Path, manifest: dict[str, Any]) -> None:
    _check_deadline()
    artifact = job.get("artifact")
    if not isinstance(artifact, dict) or not str(artifact.get("putUrl") or "").startswith("https://"):
        raise ValueError("job artifact delivery contract is missing")
    headers = {str(k): str(v) for k, v in (artifact.get("headers") or {}).items()}
    headers.setdefault("Content-Type", str(artifact.get("contentType") or "application/octet-stream"))
    expected_metadata = {
        # The full manifest hash cannot be embedded in a presigned URL that is
        # itself part of that manifest without creating a circular hash. The
        # stable request-derived manifest ID is the artifact ownership key.
        "x-amz-meta-manifest-id": str(manifest["manifestId"]),
        "x-amz-meta-profile-sha256": str(manifest["profileSha256"]),
        "x-amz-meta-job-id": str(job["id"]),
    }
    normalized_headers = {key.lower(): value for key, value in headers.items()}
    for key, value in expected_metadata.items():
        if normalized_headers.get(key) != value:
            raise ValueError(f"artifact URL is not bound to required metadata: {key}")
    _put_file(str(artifact["putUrl"]), output, headers)


def _load_checkpoint(
    target: dict[str, Any] | None,
    manifest_id: str,
    expected_job_ids: set[str],
) -> tuple[set[str], dict[str, dict[str, Any]]]:
    if not target or not target.get("getUrl"):
        return set(), {}
    try:
        data = json.loads(_request(str(target["getUrl"]), timeout=30))
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return set(), {}
        raise
    if not isinstance(data, dict) or data.get("manifestId") != manifest_id or not isinstance(data.get("completedJobIds"), list):
        raise ValueError("checkpoint identity mismatch")
    values = data["completedJobIds"]
    if not all(isinstance(value, str) for value in values) or len(values) != len(set(values)):
        raise ValueError("checkpoint completed job identities are invalid")
    completed = set(values)
    if not completed.issubset(expected_job_ids):
        raise ValueError("checkpoint contains jobs outside its render manifest")
    raw_outputs = data.get("videoOutputs", {})
    if not isinstance(raw_outputs, dict) or not all(isinstance(key, str) and isinstance(value, dict) for key, value in raw_outputs.items()):
        raise ValueError("checkpoint video output evidence is invalid")
    if not set(raw_outputs).issubset(completed):
        raise ValueError("checkpoint video output evidence is outside completed jobs")
    return completed, {str(key): dict(value) for key, value in raw_outputs.items()}


def video_render_contract(profile: dict[str, Any]) -> dict[str, Any]:
    """Return the exact runtime/geometry values the controller must see again."""
    return {
        "model": profile["model"],
        "revision": profile["revision"],
        "checkpoint": profile["checkpoint"],
        "precision": profile["precision"],
        "pipeline": profile["pipeline"],
        "twoStageRefine": profile["twoStageRefine"],
        "textEncoderCheckpoint": profile["textEncoderCheckpoint"],
        "videoVaeCheckpoint": profile["videoVaeCheckpoint"],
        "audioVaeCheckpoint": profile["audioVaeCheckpoint"],
        "spatialUpscalerCheckpoint": profile["spatialUpscalerCheckpoint"],
        "quantization": profile["quantization"],
        "offload": profile["offload"],
        "spatialUpscaleFactor": profile["spatialUpscaleFactor"],
        "stageOneWidth": profile["stageOneWidth"],
        "stageOneHeight": profile["stageOneHeight"],
        "outputWidth": profile["width"],
        "outputHeight": profile["height"],
    }


def assert_video_output_proof(proof: dict[str, Any], profile: dict[str, Any]) -> None:
    expected = {
        "outputWidth": profile["width"],
        "outputHeight": profile["height"],
        "stageOneWidth": profile["stageOneWidth"],
        "stageOneHeight": profile["stageOneHeight"],
        "spatialUpscaleFactor": profile["spatialUpscaleFactor"],
        "pipeline": profile["pipeline"],
        "quantization": profile["quantization"],
        "offload": profile["offload"],
    }
    if any(proof.get(key) != value for key, value in expected.items()):
        raise ValueError("video output evidence drifts from the sealed LTX 2.5 x2 profile")


def _heartbeat_loop(
    target: dict[str, Any] | None,
    state: dict[str, Any],
    deadline_monotonic: float,
) -> None:
    while True:
        try:
            _check_deadline(deadline_monotonic)
        except InterruptedError:
            return
        remaining_seconds = max(0.0, deadline_monotonic - time.monotonic())
        if STOP.wait(min(STATUS_BATCH_SECONDS, remaining_seconds)):
            return
        try:
            _check_deadline(deadline_monotonic)
            put_json(target, {**state, "status": "running", "heartbeatAt": int(time.time())})
        except InterruptedError:
            return
        except Exception as error:
            print(f"heartbeat warning: {type(error).__name__}", flush=True)


def _report_json(target: dict[str, Any] | None, value: dict[str, Any], label: str) -> bool:
    try:
        put_json(target, value)
        return True
    except Exception as error:
        print(f"{label} warning: {type(error).__name__}", file=sys.stderr, flush=True)
        return False


def _bounded_error_message(error: BaseException, limit: int = 1_200) -> str:
    """Keep failure receipts small without discarding the renderer's root-cause tail."""
    message = f"{type(error).__name__}: {error}".strip()
    if len(message) <= limit:
        return message
    marker = " … [diagnostic tail] … "
    head = min(240, max(80, limit // 4))
    tail = max(1, limit - head - len(marker))
    return f"{message[:head]}{marker}{message[-tail:]}"


def main() -> int:
    manifest_url = os.environ.get("NOVITA_JOB_MANIFEST_URL", "")
    manifest_hash = os.environ.get("NOVITA_MANIFEST_SHA256", "")
    if not manifest_url.startswith("https://") or not SHA256_RE.fullmatch(manifest_hash):
        raise ValueError("SHA-bound HTTPS render manifest is required")
    manifest = validate_manifest(json.loads(_request(manifest_url, timeout=30)), manifest_hash)
    deadline_monotonic, deadline_at = sealed_deadline(manifest)
    expiry_timer = arm_sealed_deadline(deadline_monotonic)
    expected_job_ids = {str(job["id"]) for job in manifest["jobs"]}
    checkpoint = manifest.get("checkpoint")
    completed: set[str] = set()
    state = {
        "manifestId": manifest["manifestId"],
        "completedJobIds": [],
        "deadlineAt": deadline_at,
        **({"renderContract": video_render_contract(manifest["profile"]), "videoOutputs": {}}
           if manifest["phase"] == "video" else {}),
    }
    heartbeat = threading.Thread(
        target=_heartbeat_loop,
        args=(manifest.get("heartbeat"), state, deadline_monotonic),
        daemon=True,
    )
    heartbeat.start()
    failure: str | None = None
    done = False
    completion_reported = False
    try:
        completed, checkpoint_video_outputs = _load_checkpoint(checkpoint, manifest["manifestId"], expected_job_ids)
        state["completedJobIds"] = sorted(completed)
        if manifest["phase"] == "video":
            for proof in checkpoint_video_outputs.values():
                assert_video_output_proof(proof, manifest["profile"])
            if set(checkpoint_video_outputs) != completed:
                raise ValueError("checkpoint LTX video evidence must cover every completed job")
            state["videoOutputs"] = checkpoint_video_outputs
        # The cloud control plane performs a catalog check before creation, but
        # the data plane independently verifies the physical device before any
        # model cache or inference work begins. This makes a SKU mismatch
        # non-billable model work rather than a silent hardware fallback.
        assert_rtx_4090_host()
        # Completion is accepted by the cloud controller only with this
        # data-plane attestation. It is populated *after* nvidia-smi succeeds,
        # never merely echoed from the controller manifest.
        state["gpuSku"] = REQUIRED_GPU_SKU
        state["gpuCount"] = REQUIRED_GPU_COUNT
        volume_root = Path(os.environ.get("NOVITA_MODEL_VOLUME", "/network"))
        cache_root = Path(os.environ.get("NOVITA_LOCAL_MODEL_CACHE", "/workspace/model-cache"))
        model_specs = validate_model_specs(
            manifest.get("models"), manifest["phase"], manifest["profile"].get("pipeline"),
            requested_creative_adapter_ids(manifest.get("jobs"), manifest["phase"]),
        )
        models = {
            str(spec["id"]): hydrate_model(spec, volume_root, cache_root, deadline_monotonic)
            for spec in model_specs
        }

        with tempfile.TemporaryDirectory(prefix="novita-render-") as temporary:
            workdir = Path(temporary)
            for raw_job in manifest["jobs"]:
                if STOP.is_set():
                    raise InterruptedError("worker interrupted before next job")
                job = {**raw_job, "phase": manifest["phase"]}
                if job["id"] in completed:
                    continue
                output = _job_output(job, workdir)
                if manifest["phase"] == "image":
                    render_image(job, models, output, deadline_monotonic)
                else:
                    proof = render_video(job, manifest["profile"], models, output, workdir, deadline_monotonic)
                    assert_video_output_proof(proof, manifest["profile"])
                    state["videoOutputs"][str(job["id"])] = proof
                upload_artifact(job, output, manifest)
                completed.add(job["id"])
                state["completedJobIds"] = sorted(completed)
                put_json(checkpoint, {**state, "updatedAt": int(time.time()), "status": "running"})
        done = completed == expected_job_ids
        if manifest["phase"] == "video":
            done = done and set(state["videoOutputs"]) == expected_job_ids
    except BaseException as error:
        failure = _bounded_error_message(error)
        _report_json(
            checkpoint,
            {**state, "updatedAt": int(time.time()), "status": "interrupted" if STOP.is_set() else "failed", "error": failure},
            "checkpoint",
        )
    finally:
        completion_reported = _report_json(manifest.get("completion"), {
            **state,
            "status": "done" if done and failure is None else "interrupted" if STOP.is_set() else "failed",
            "finishedAt": int(time.time()),
            "error": failure,
        }, "completion")
        STOP.set()
        expiry_timer.cancel()
        heartbeat.join(timeout=2)
    done = done and failure is None and completion_reported
    return 0 if done else 2


def _signal(_signum: int, _frame: Any) -> None:
    STOP.set()


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, _signal)
    signal.signal(signal.SIGINT, _signal)
    try:
        exit_code = main()
    except Exception as exc:
        print(f"worker fatal: {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
        raise
    raise SystemExit(exit_code)
