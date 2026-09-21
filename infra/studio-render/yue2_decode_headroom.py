"""Decode retained latents without new composition; compare before the official clamp."""
import argparse
import fcntl
import math
import os
from pathlib import Path
import re
import signal
import time


def compare_decoder_output(raw, reference):
    import numpy as np

    if (raw.dtype != np.float32 or reference.dtype != np.float32 or
            raw.ndim != 2 or raw.shape[1] != 2 or raw.shape[0] < 1 or raw.shape != reference.shape or
            not np.isfinite(raw).all() or not np.isfinite(reference).all()):
        raise ValueError("Expected finite matching native float32 stereo arrays")
    if not np.array_equal(np.clip(raw, -1, 1), reference):
        raise ValueError("Unclipped decode does not reproduce the retained official samples")
    peak = float(np.max(np.abs(raw)))
    return {"clamped_samples_equal_reference": True,
            "samples_outside_unit_range": int(np.count_nonzero(np.abs(raw) > 1)),
            "raw_sample_peak": peak, "raw_sample_peak_dbfs": 20 * math.log10(peak) if peak else None,
            "gain_applied": False, "production_approved": False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-state", type=Path, required=True)
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}", args.job_id):
        parser.error("Unsafe job ID")
    if args.output.exists() or args.output.is_symlink():
        parser.error("Output must be a new directory")
    from music_runtime.supervisor import _contain_child
    _contain_child(os.getppid())
    signal.alarm(180)
    from music_runtime.config import MANIFEST, effective_config
    from music_runtime.official import OfficialBackend, require_precision
    from music_runtime.runner import inspect_job
    from music_runtime.store import file_hash, inventory, seal
    import numpy as np
    import soundfile as sf
    import torch
    from yue2 import YuE2Pipeline
    from yue2.protocol import GenerationConfig

    # Lock the source ledger's actual inode even through its read-only mount.
    lock_path = args.source_state / ".runner.lock"
    descriptor = os.open(lock_path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        source = args.source_state / "jobs" / args.job_id
        inspected = inspect_job(source)
        terminal = inspected["attempts"][-1]
        if terminal["status"] != "completed" or inspected["config"]["manifest"] != MANIFEST:
            raise ValueError("Require a completed source with the exact pinned manifest")
        attempt = source / "attempts" / f'{terminal["attempt"]:04d}'
        evidence = attempt / "evidence"
        latents = np.load(evidence / "latent.npy", allow_pickle=False)
        if latents.dtype != np.float32 or latents.ndim != 2 or latents.shape[1] != 64 or not 1 <= len(latents) <= 7500:
            raise ValueError("Unsupported retained latent geometry")
        reference, rate = sf.read(evidence / "audio-native.wav", dtype="float32", always_2d=True)
        if rate != 48000 or len(reference) != terminal["result"]["frames"]:
            raise ValueError("Retained native format mismatch")
        args.output.mkdir(mode=0o700)
        started = time.monotonic()
        seal(args.output / "started.json", {"source_job_id": args.job_id,
            "source_terminal_sha256": file_hash(attempt / "terminal.json"),
            "latent_sha256": file_hash(evidence / "latent.npy"),
            "reference_wav_sha256": file_hash(evidence / "audio-native.wav"),
            "script_sha256": file_hash(Path(__file__)), "deadline_seconds": 180})
        try:
            runtime = OfficialBackend().preflight(effective_config("/mnt/yue2-hf-cache"))
            with YuE2Pipeline.from_pretrained(
                MANIFEST["model"]["repository"], vae=MANIFEST["vae"]["repository"],
                revision=MANIFEST["model"]["revision"], vae_revision=MANIFEST["vae"]["revision"],
                local_files_only=True, token=False, cache_dir="/mnt/yue2-hf-cache",
                device="cuda:0", memory_budget_gib=24, backend="torch", quantization="none",
                offload_ar=False, verify_hashes=True, vae_core_frames=1024,
                generation_config=GenerationConfig.from_dict(MANIFEST["preset"]["generation"]), progress=False,
            ) as pipe:
                official = pipe.decode(latents)
                if not np.array_equal(official, reference):
                    raise ValueError("Official re-decode differs from retained native samples")
                require_precision(pipe._vae, "torch.float32")
                model = pipe._vae.to("cuda:0")
                try:
                    z = torch.as_tensor(latents, dtype=torch.float32).T.unsqueeze(0)
                    with torch.inference_mode():
                        decoded = model.decode_tiled(z, core_frames=1024, halo_frames=16, output_device="cpu")
                    raw = decoded[0].float().T.contiguous().numpy()
                finally:
                    model.to("cpu")
                comparison = compare_decoder_output(raw, reference)
            np.save(args.output / "audio-unclipped.npy", raw, allow_pickle=False)
            sf.write(args.output / "audio-unclipped.wav", raw, 48000, subtype="FLOAT")
            restored, restored_rate = sf.read(args.output / "audio-unclipped.wav", dtype="float32", always_2d=True)
            if restored_rate != 48000 or not np.array_equal(restored, raw):
                raise ValueError("Unclipped float export changed samples")
            artifacts = inventory(args.output, freeze=True)
            result = {"schema": "studio-yue2-unclipped-comparison/v1", "status": "completed",
                "source_job_id": args.job_id, "sample_rate": 48000, "channels": 2, "frames": len(raw),
                "comparison": comparison, "runtime": runtime, "artifacts": artifacts,
                "elapsed_seconds": time.monotonic() - started, "composition_generated": False,
                "production_approved": False}
            seal(args.output / "result.json", result)
            print("Completed verified unclipped comparison; no production approval")
        except Exception as error:
            seal(args.output / "failure.json", {"type": type(error).__name__, "message": str(error),
                "elapsed_seconds": time.monotonic() - started, "production_approved": False})
            raise


if __name__ == "__main__":
    main()
