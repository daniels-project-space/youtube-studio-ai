#!/usr/bin/env python3
"""Pinned, evidence-only scene-boundary analysis for final video masters.

This script intentionally has no dependency bootstrap path. The Trigger image
build installs its exact requirements into /opt/youtube-studio-qa-scene-analysis
and verifies the distributions before a task can start. A missing or mismatched
runtime is an error, not permission to invoke pip at task time.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from importlib.metadata import version
from pathlib import Path
from typing import Any

SCHEMA_VERSION = "1.0.0"
SCENEDETECT_HEADLESS_VERSION = "0.7.1"
OPENCV_PYTHON_HEADLESS_VERSION = "4.12.0.88"
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Produce a bound PySceneDetect adaptive-detector receipt."
    )
    parser.add_argument("--input", required=True, help="Final-master video to decode.")
    parser.add_argument(
        "--source-sha256",
        required=True,
        help="Expected lowercase SHA-256 of --input; mismatches fail closed.",
    )
    parser.add_argument("--adaptive-threshold", type=float, default=3.0)
    parser.add_argument("--min-scene-len-frames", type=int, default=15)
    parser.add_argument("--window-width", type=int, default=2)
    parser.add_argument("--min-content-val", type=float, default=15.0)
    return parser.parse_args()


def require_pinned_runtime() -> None:
    actual_scene_detect = version("scenedetect-headless")
    actual_opencv = version("opencv-python-headless")
    if actual_scene_detect != SCENEDETECT_HEADLESS_VERSION:
        raise RuntimeError(
            "pinned build-image dependency mismatch for scenedetect-headless: "
            f"expected {SCENEDETECT_HEADLESS_VERSION}, found {actual_scene_detect}. "
            "Runtime dependency installation is forbidden."
        )
    if actual_opencv != OPENCV_PYTHON_HEADLESS_VERSION:
        raise RuntimeError(
            "pinned build-image dependency mismatch for opencv-python-headless: "
            f"expected {OPENCV_PYTHON_HEADLESS_VERSION}, found {actual_opencv}. "
            "Runtime dependency installation is forbidden."
        )


def hash_file(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    byte_length = 0
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
            byte_length += len(chunk)
    return digest.hexdigest(), byte_length


def validate_args(args: argparse.Namespace) -> tuple[Path, str]:
    source = Path(args.input)
    if not source.is_file():
        raise ValueError(f"final-master input is not a file: {source}")
    expected_hash = args.source_sha256
    if not SHA256_RE.fullmatch(expected_hash):
        raise ValueError("--source-sha256 must be exactly 64 lowercase hexadecimal characters")
    if args.adaptive_threshold <= 0:
        raise ValueError("--adaptive-threshold must be positive")
    if args.min_scene_len_frames < 1:
        raise ValueError("--min-scene-len-frames must be at least one")
    if args.window_width < 1:
        raise ValueError("--window-width must be at least one")
    if args.min_content_val <= 0:
        raise ValueError("--min-content-val must be positive")
    return source, expected_hash


def scene_receipt(args: argparse.Namespace) -> dict[str, Any]:
    source, expected_hash = validate_args(args)
    require_pinned_runtime()

    actual_hash, byte_length = hash_file(source)
    if actual_hash != expected_hash:
        raise RuntimeError(
            "final-master source hash mismatch: supplied sourceSha256 does not bind "
            "the analyzed bytes."
        )

    # Import only after exact distribution checks. `scenedetect-headless`
    # exposes the regular PySceneDetect module name, while `cv2` is import-
    # checked above to prove the headless OpenCV decoder is present.
    from scenedetect import AdaptiveDetector, detect

    detector = AdaptiveDetector(
        adaptive_threshold=args.adaptive_threshold,
        min_scene_len=args.min_scene_len_frames,
        window_width=args.window_width,
        min_content_val=args.min_content_val,
    )
    scenes = detect(str(source), detector, show_progress=False)
    serialized_scenes = [
        {
            "startFrame": int(start.get_frames()),
            "endFrameExclusive": int(end.get_frames()),
            "startSec": start.get_seconds(),
            "endSecExclusive": end.get_seconds(),
        }
        for start, end in scenes
    ]

    return {
        "schemaVersion": SCHEMA_VERSION,
        "provider": "pyscenedetect",
        "detector": "adaptive",
        "versions": {
            "scenedetectHeadless": SCENEDETECT_HEADLESS_VERSION,
            "opencvPythonHeadless": OPENCV_PYTHON_HEADLESS_VERSION,
        },
        "config": {
            "adaptiveThreshold": args.adaptive_threshold,
            "minSceneLenFrames": args.min_scene_len_frames,
            "windowWidth": args.window_width,
            "minContentVal": args.min_content_val,
        },
        "source": {"sha256": actual_hash, "byteLength": byte_length},
        "scenes": serialized_scenes,
    }


def main() -> None:
    print(json.dumps(scene_receipt(parse_args()), sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
