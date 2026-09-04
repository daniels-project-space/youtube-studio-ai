#!/usr/bin/env python3
"""
Is self-hosted Qwen3-TTS viable on THIS box, and at what cost in wall time?

The whole "replace narration with local Qwen" decision rests on one number:
seconds of compute per second of audio. Everything else — casting range,
prosody, loudness — is fixable in software. Throughput is not, and if a
ten-minute narration takes four hours of CPU the answer has to be a rented GPU
regardless of how good the voice is.

Measured rather than assumed, because the official model card's guidance is
written for CUDA and is actively wrong here: this EPYC has avx2 only, so bf16 is
emulated and ran ~30x SLOWER than fp32 in the earlier benchmark. fp32 + eager
attention is the correct configuration on this hardware.

Also probes dynamic int8 quantisation, the one lever that can plausibly close
the gap on CPU. It is checked for QUALITY as well as speed — a 2x speedup that
mangles the voice is not a speedup, and the narration oracle is what settles it.
"""
import argparse
import gc
import json
import os
import time
from pathlib import Path

os.environ.setdefault("OMP_NUM_THREADS", "8")
os.environ.setdefault("MKL_NUM_THREADS", "8")

import soundfile as sf
import torch

OUT = Path("/root/tts-ab/out/local-feasibility")
OUT.mkdir(parents=True, exist_ok=True)

# Short on purpose: this measures throughput, not quality of a long read.
PROBE_TEXT = (
    "The vault held for ninety years. On the ninety-first, a single bolt "
    "sheared, and everything behind it went with the water."
)

DESIGN = (
    "A mature male voice in a deep, low bass-baritone register. Strong and "
    "resonant with full chest tone. Slow, measured pace with deliberate pauses. "
    "Calm and grave, quietly authoritative, never theatrical."
)


def load(model_id: str, quantise: bool):
    from qwen_tts import Qwen3TTSModel
    t0 = time.time()
    model = Qwen3TTSModel.from_pretrained(
        model_id,
        device_map="cpu",
        dtype=torch.float32,          # NOT bfloat16 — emulated on avx2-only CPUs
        attn_implementation="eager",  # flash-attn is CUDA-only
    )
    if quantise:
        # Dynamic int8 on Linear layers is the standard CPU lever; it needs no
        # calibration data and leaves the audio codec heads alone.
        model = torch.ao.quantization.quantize_dynamic(
            model, {torch.nn.Linear}, dtype=torch.qint8,
        )
    return model, time.time() - t0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign")
    ap.add_argument("--quantise", action="store_true")
    args = ap.parse_args()

    tag = "int8" if args.quantise else "fp32"
    model, load_s = load(args.model, args.quantise)
    print(f"[load] {tag} in {load_s:.0f}s", flush=True)

    t0 = time.time()
    # `instruct` IS the voice description for this model — there is no separate
    # voice_description argument, contrary to how the docs read.
    wavs, sr = model.generate_voice_design(
        text=[PROBE_TEXT], instruct=[DESIGN], language=["English"],
    )
    gen_s = time.time() - t0

    path = OUT / f"probe-{tag}.wav"
    sf.write(str(path), wavs[0], sr)
    audio_s = len(wavs[0]) / sr
    ratio = gen_s / audio_s

    result = {
        "config": tag,
        "model": args.model,
        "load_seconds": round(load_s, 1),
        "generate_seconds": round(gen_s, 1),
        "audio_seconds": round(audio_s, 2),
        "realtime_factor": round(ratio, 1),
        # The number that actually decides the architecture.
        "minutes_of_cpu_per_10min_narration": round(ratio * 600 / 60, 1),
        "path": str(path),
    }
    print(json.dumps(result, indent=2), flush=True)
    Path(f"/root/tts-ab/feasibility-{tag}.json").write_text(json.dumps(result, indent=2))

    del model
    gc.collect()


if __name__ == "__main__":
    main()
