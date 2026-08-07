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
GEMMA_MODEL = "google/gemma-3-12b-it-qat-q4_0-unquantized"
LTX_MODEL = "Lightricks/LTX-2.3"
LTX_REVISION = "7caa482d5cd10a2eae6b34cb48f093ebc45a263e"
LTX_RUNTIME_REPOSITORY = "Lightricks/LTX-2"
LTX_RUNTIME_REVISION = "4f8905737aac86a554637cac86c178877a39c744"
LTX_DEV_CHECKPOINT = "ltx-2.3-22b-dev.safetensors"
LTX_DISTILLED_CHECKPOINT = "ltx-2.3-22b-distilled-1.1.safetensors"
LTX_DISTILLED_LORA_CHECKPOINT = "ltx-2.3-22b-distilled-lora-384-1.1.safetensors"
LTX_SPATIAL_UPSCALER_CHECKPOINT = "ltx-2.3-spatial-upscaler-x2-1.1.safetensors"
LTX_FILE_CONTRACTS = {
    "ltx-dev": (LTX_DEV_CHECKPOINT, "7ab7225325bc403448ea84b6db2269811a880e5118cd2ee2b6282a93d585016f", 46_149_344_974),
    "ltx-distilled": (LTX_DISTILLED_CHECKPOINT, "b33b7fe4bbfe084f484be4aaf90b0f1d95dca20d403ac4c0e037eb8c4f0af7cc", 46_149_345_334),
    "ltx-distilled-lora": (LTX_DISTILLED_LORA_CHECKPOINT, "f5d4953f3386197a4b4f5abdb17616ff256171e8075c111d6e7d2dfa6e823b3a", 7_605_507_256),
    "ltx-spatial-upscaler": (LTX_SPATIAL_UPSCALER_CHECKPOINT, "5f416311fa8172b65af67530758964708d29a317b830d689a51143b7f91913ed", 995_743_560),
}
STATUS_BATCH_SECONDS = 60
MAX_HTTP_ATTEMPTS = 4
MAX_MANIFEST_JOBS = 240
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
JOB_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$")

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
    video_settings = {
        "draft": (1280, 704, 8, 1, 1, "distilled"),
        "production": (1920, 1088, 40, 4, 1, "two-stage-hq"),
        "hero": (1920, 1088, 48, 4, 1, "two-stage-hq"),
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
        width, height, steps, guidance, candidates, pipeline = video_settings[profile_id]
        profile: dict[str, Any] = {
            "contractVersion": "1.0.0", "id": profile_id, "phase": phase,
            "model": LTX_MODEL, "revision": LTX_REVISION,
            "checkpoint": LTX_DISTILLED_CHECKPOINT if pipeline == "distilled" else LTX_DEV_CHECKPOINT,
            "width": width, "height": height, "steps": steps,
            "guidanceScale": guidance, "precision": "bf16", "candidates": candidates,
            "infrastructure": APPROVED_INFRASTRUCTURE, "fps": 25, "pipeline": pipeline,
            "twoStageRefine": pipeline == "two-stage-hq",
            "spatialUpscalerCheckpoint": LTX_SPATIAL_UPSCALER_CHECKPOINT,
            "allowFallback": False,
        }
        if pipeline == "two-stage-hq":
            profile["distilledLoraCheckpoint"] = LTX_DISTILLED_LORA_CHECKPOINT
        return profile
    raise ValueError(f"unsupported approved render profile: {profile_id}/{phase}")


def validate_model_specs(model_specs: Any, phase: str, pipeline: str | None) -> list[dict[str, Any]]:
    if not isinstance(model_specs, list) or not all(isinstance(spec, dict) for spec in model_specs):
        raise ValueError("manifest model cache contract is missing")
    model_ids = [str(spec.get("id") or "") for spec in model_specs]
    if len(model_ids) != len(set(model_ids)):
        raise ValueError("manifest model cache identities must be unique")
    required = {"z-image-turbo"} if phase == "image" else {
        "gemma-3-12b", "ltx-spatial-upscaler",
        "ltx-distilled" if pipeline == "distilled" else "ltx-dev",
    }
    if phase == "video" and pipeline == "two-stage-hq":
        required.add("ltx-distilled-lora")
    if set(model_ids) != required:
        raise ValueError(f"manifest models must exactly match required cache identities: {sorted(required)}")
    for spec in model_specs:
        if spec["id"] == "z-image-turbo" and (
            spec.get("kind") != "tree"
            or spec.get("repository") != ZIMAGE_MODEL
            or spec.get("revision") != ZIMAGE_REVISION
        ):
            raise ValueError("manifest Z-Image tree does not match the official pinned repository revision")
        if spec["id"] == "gemma-3-12b" and (
            spec.get("kind") != "tree"
            or spec.get("repository") != GEMMA_MODEL
            or not re.fullmatch(r"[a-f0-9]{40}", str(spec.get("revision") or ""))
        ):
            raise ValueError("manifest Gemma tree does not match the official LTX text encoder repository")
        contract = LTX_FILE_CONTRACTS.get(str(spec["id"]))
        if contract is None:
            continue
        filename, expected_sha256, expected_size = contract
        if (
            spec.get("kind") != "file"
            or spec.get("manifestSha256") != expected_sha256
            or spec.get("sizeBytes") != expected_size
            or Path(str(spec.get("sourcePath") or "")).name != filename
            or Path(str(spec.get("localPath") or "")).name != filename
        ):
            raise ValueError(f"manifest model {spec['id']} does not match the official pinned LTX file")
    return model_specs


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path, chunk_size: int = 8 * 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(chunk_size), b""):
            if STOP.is_set():
                raise InterruptedError("model verification interrupted")
            digest.update(chunk)
    return digest.hexdigest()


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
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read()
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


def _copy_verified_file(source: Path, target: Path, expected_sha256: str, expected_size: int | None = None) -> None:
    if target.is_file() and (expected_size is None or target.stat().st_size == expected_size):
        if sha256_file(target) == expected_sha256:
            return
    if not source.is_file() or (expected_size is not None and source.stat().st_size != expected_size):
        raise FileNotFoundError(f"staged model file is missing or incomplete: {source}")
    if sha256_file(source) != expected_sha256:
        raise ValueError(f"staged model file hash mismatch: {source}")
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.name}.{os.getpid()}.partial")
    with source.open("rb") as source_file, temporary.open("wb") as target_file:
        while chunk := source_file.read(8 * 1024 * 1024):
            if STOP.is_set():
                temporary.unlink(missing_ok=True)
                raise InterruptedError("model hydration interrupted")
            target_file.write(chunk)
    if sha256_file(temporary) != expected_sha256:
        temporary.unlink(missing_ok=True)
        raise ValueError(f"local model copy hash mismatch: {target}")
    os.replace(temporary, target)


def hydrate_model(spec: dict[str, Any], volume_root: Path, cache_root: Path) -> Path:
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
        if kind == "file":
            _copy_verified_file(source, target, expected, int(spec["sizeBytes"]) if spec.get("sizeBytes") else None)
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
                    and sha256_file(_within(target, relative)) == file_hash
                    for relative, file_hash, size in validated_files
                ):
                    return target
            except Exception:
                pass
        for relative, file_hash, size in validated_files:
            _copy_verified_file(_within(source, relative), _within(target, relative), file_hash, size)
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
    manifest_id = str(manifest.get("manifestId") or "")
    if not re.fullmatch(rf"{manifest['phase']}-[a-f0-9]{{32}}", manifest_id):
        raise ValueError("render manifest identity does not match its phase")
    if not manifest["jobs"] or len(manifest["jobs"]) > MAX_MANIFEST_JOBS:
        raise ValueError(f"render manifest must contain 1..{MAX_MANIFEST_JOBS} jobs")
    max_cost_usd = manifest.get("maxCostUsd")
    if isinstance(max_cost_usd, bool) or not isinstance(max_cost_usd, (int, float)) or not math.isfinite(max_cost_usd) or max_cost_usd <= 0:
        raise ValueError("render manifest requires a positive finite hard spend cap")
    if int(manifest.get("expiresAt") or 0) <= int(time.time() * 1000):
        raise ValueError("render manifest expired")
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
    if manifest["phase"] == "video" and profile.get("pipeline") not in ("distilled", "two-stage-hq"):
        raise ValueError("render profile does not use an approved official LTX pipeline")
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
            if negative_prompt is not None and (not isinstance(negative_prompt, str) or len(negative_prompt) > 20_000):
                raise ValueError(f"render job {job['id']} has invalid negative prompt")
            source = job.get("input")
            if source is not None:
                if not isinstance(source, dict) or not SHA256_RE.fullmatch(str(source.get("sha256") or "")):
                    raise ValueError(f"render job {job['id']} has invalid input contract")
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


def _job_output(job: dict[str, Any], workdir: Path) -> Path:
    extension = ".png" if job["phase"] == "image" else ".mp4"
    return workdir / f"{job['id']}{extension}"


def render_image(job: dict[str, Any], models: dict[str, Path], output: Path) -> None:
    import torch
    from diffusers import ZImagePipeline

    model_path = str(models["z-image-turbo"])
    pipe = _IMAGE_PIPELINES.get(model_path)
    if pipe is None:
        pipe = ZImagePipeline.from_pretrained(model_path, torch_dtype=torch.bfloat16, local_files_only=True)
        pipe.to("cuda")
        _IMAGE_PIPELINES[model_path] = pipe
    generator = torch.Generator(device="cuda").manual_seed(int(job["seed"]))

    def interrupt_after_step(_pipe: Any, _step: int, _timestep: Any, callback_kwargs: dict[str, Any]) -> dict[str, Any]:
        if STOP.is_set():
            raise InterruptedError("image render interrupted")
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


def _run_bounded(command: list[str], timeout_seconds: int) -> None:
    process = subprocess.Popen(command, start_new_session=True)
    started = time.monotonic()
    while process.poll() is None:
        if STOP.wait(2):
            _terminate_process_group(process)
            raise InterruptedError("render interrupted")
        if time.monotonic() - started > timeout_seconds:
            _terminate_process_group(process)
            raise TimeoutError("render exceeded bounded worker timeout")
    if process.returncode != 0:
        raise RuntimeError(f"renderer exited with status {process.returncode}")


def build_video_command(
    job: dict[str, Any],
    profile: dict[str, Any],
    models: dict[str, Path],
    output: Path,
    image_path: Path | None,
) -> list[str]:
    pipeline = str(profile["pipeline"])
    command = [
        sys.executable,
        "-m",
        "ltx_pipelines.distilled" if pipeline == "distilled" else "ltx_pipelines.ti2vid_two_stages_hq",
        "--gemma-root", str(models["gemma-3-12b"]),
        "--spatial-upsampler-path", str(models["ltx-spatial-upscaler"]),
        "--prompt", str(job["prompt"]),
        "--output-path", str(output),
        "--seed", str(int(job["seed"])),
        "--height", str(int(job["height"])),
        "--width", str(int(job["width"])),
        "--num-frames", str(int(job["frames"])),
        "--frame-rate", str(float(job["fps"])),
        "--offload", "cpu",
    ]
    if image_path:
        command.extend(["--image", str(image_path), "0", "1.0"])
    if pipeline == "distilled":
        command.extend(["--distilled-checkpoint-path", str(models["ltx-distilled"])])
    else:
        command.extend([
            "--checkpoint-path", str(models["ltx-dev"]),
            "--distilled-lora", str(models["ltx-distilled-lora"]), "0.8",
            "--num-inference-steps", str(int(job["steps"])),
            "--video-cfg-guidance-scale", str(float(profile["guidanceScale"])),
        ])
        if str(job.get("negativePrompt") or "").strip():
            command.extend(["--negative-prompt", str(job["negativePrompt"])])
    return command


def render_video(job: dict[str, Any], profile: dict[str, Any], models: dict[str, Path], output: Path, workdir: Path) -> None:
    pipeline = profile.get("pipeline")
    if pipeline not in ("distilled", "two-stage-hq"):
        raise ValueError("unsupported LTX pipeline")
    frames = int(job["frames"])
    width, height = int(job["width"]), int(job["height"])
    if frames < 9 or (frames - 1) % 8 or width % 64 or height % 64:
        raise ValueError("LTX frame count and two-stage dimensions are invalid")
    image_path: Path | None = None
    if job.get("input"):
        source = job["input"]
        image_path = workdir / f"{job['id']}-input.png"
        download(str(source["getUrl"]), image_path, source.get("sha256"))
    command = build_video_command(job, profile, models, output, image_path)
    _run_bounded(command, int(job.get("timeoutSeconds", 7_200)))


def _put_file(url: str, output: Path, headers: dict[str, str]) -> None:
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


def _load_checkpoint(target: dict[str, Any] | None, manifest_id: str, expected_job_ids: set[str]) -> set[str]:
    if not target or not target.get("getUrl"):
        return set()
    try:
        data = json.loads(_request(str(target["getUrl"]), timeout=30))
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return set()
        raise
    if not isinstance(data, dict) or data.get("manifestId") != manifest_id or not isinstance(data.get("completedJobIds"), list):
        raise ValueError("checkpoint identity mismatch")
    values = data["completedJobIds"]
    if not all(isinstance(value, str) for value in values) or len(values) != len(set(values)):
        raise ValueError("checkpoint completed job identities are invalid")
    completed = set(values)
    if not completed.issubset(expected_job_ids):
        raise ValueError("checkpoint contains jobs outside its render manifest")
    return completed


def _heartbeat_loop(target: dict[str, Any] | None, state: dict[str, Any]) -> None:
    while not STOP.wait(STATUS_BATCH_SECONDS):
        try:
            put_json(target, {**state, "status": "running", "heartbeatAt": int(time.time())})
        except Exception as error:
            print(f"heartbeat warning: {type(error).__name__}", flush=True)


def _report_json(target: dict[str, Any] | None, value: dict[str, Any], label: str) -> bool:
    try:
        put_json(target, value)
        return True
    except Exception as error:
        print(f"{label} warning: {type(error).__name__}", file=sys.stderr, flush=True)
        return False


def main() -> int:
    manifest_url = os.environ.get("NOVITA_JOB_MANIFEST_URL", "")
    manifest_hash = os.environ.get("NOVITA_MANIFEST_SHA256", "")
    if not manifest_url.startswith("https://") or not SHA256_RE.fullmatch(manifest_hash):
        raise ValueError("SHA-bound HTTPS render manifest is required")
    manifest = validate_manifest(json.loads(_request(manifest_url, timeout=30)), manifest_hash)
    expected_job_ids = {str(job["id"]) for job in manifest["jobs"]}
    checkpoint = manifest.get("checkpoint")
    completed: set[str] = set()
    state = {"manifestId": manifest["manifestId"], "completedJobIds": []}
    heartbeat = threading.Thread(target=_heartbeat_loop, args=(manifest.get("heartbeat"), state), daemon=True)
    heartbeat.start()
    failure: str | None = None
    done = False
    completion_reported = False
    try:
        completed = _load_checkpoint(checkpoint, manifest["manifestId"], expected_job_ids)
        state["completedJobIds"] = sorted(completed)
        volume_root = Path(os.environ.get("NOVITA_MODEL_VOLUME", "/network"))
        cache_root = Path(os.environ.get("NOVITA_LOCAL_MODEL_CACHE", "/workspace/model-cache"))
        model_specs = validate_model_specs(
            manifest.get("models"), manifest["phase"], manifest["profile"].get("pipeline"),
        )
        models = {str(spec["id"]): hydrate_model(spec, volume_root, cache_root) for spec in model_specs}

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
                    render_image(job, models, output)
                else:
                    render_video(job, manifest["profile"], models, output, workdir)
                upload_artifact(job, output, manifest)
                completed.add(job["id"])
                state["completedJobIds"] = sorted(completed)
                put_json(checkpoint, {**state, "updatedAt": int(time.time()), "status": "running"})
        done = completed == expected_job_ids
    except BaseException as error:
        failure = f"{type(error).__name__}: {error}"[:500]
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
