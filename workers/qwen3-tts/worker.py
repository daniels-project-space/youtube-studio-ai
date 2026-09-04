#!/usr/bin/env python3
"""
qwen3-tts-worker/v1 — the engine behind the studio's `qwen3` narration provider.

The provider, its receipts, cost accounting, Convex validators and production
gates all shipped some time ago; what never existed was anything to serve them,
so `QWEN3_TTS_WORKER_URL` was unset and the whole path was inert. This is that
service.

WHY A GPU BOX AND NOT THE STUDIO VPS. Local CPU synthesis was benchmarked
rather than assumed: 10.7-11.8x slower than realtime on this 4-core avx2 host,
about two hours of compute per ten minutes of narration, and int8 quantisation
runs out of memory during conversion. Fine for a cold open, hopeless for a
catalogue. A 4090 with the weights already on an attached volume removes both
the throughput problem and the cold-start download.

WHY DESIGN-THEN-CLONE AND NOT CustomVoice PRESETS. The pinned model exposes nine
preset speakers, of which exactly two are English and both are male — a studio
casting twelve channels of different character across two voices is the same
convergence defect as every channel sharing one accent colour. VoiceDesign
builds a voice from a text brief instead, and measured on the same script it
lands the casting (F0 84.9-88.4 Hz against a 90.4 Hz reference) that presets
structurally cannot reach.

But VoiceDesign draws a NEW voice on every call — the model card warns the same
description "may produce slightly different voices each time" — so calling it
per sentence changes speaker mid-paragraph. Measured timbre drift: 0.0175
per-sentence versus 0.0040 for design-once-then-clone. So a voice is designed
ONCE per channel, cached on the volume by a hash of its brief, and every
sentence thereafter is cloned against that one reference. The cache is what
makes a channel's narrator stable across videos and months, not merely within
one render.

FAIL CLOSED. The studio refuses a receipt whose digests do not match what it
asked for, so this never substitutes a different voice, model or revision when
something is missing — it returns an error and lets the caller decide.
"""
from __future__ import annotations

import base64
import gc
import hashlib
import io
import json
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
from pydantic import BaseModel, Field

CONTRACT = "qwen3-tts-worker/v1"
DESIGN_MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"
BASE_MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
SAMPLE_RATE = 24_000

# The attached volume. Weights and designed voice references both live here so
# an instance that starts, works and shuts down pays no download cost and — more
# importantly — returns the SAME voice it returned last week.
VOLUME = Path(os.environ.get("QWEN3_TTS_VOLUME", "/workspace/qwen3-tts"))
VOICE_CACHE = VOLUME / "voices"
VOICE_CACHE.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("HF_HOME", str(VOLUME / "hf"))

app = FastAPI()
_lock = threading.Lock()
_models: dict[str, Any] = {}
_last_used = time.time()


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _load(model_id: str):
    """One model resident at a time.

    Two 1.7B models in fp32 are ~6.8 GB each. On a 24 GB card both fit, but the
    designed-voice reference is produced once and then never again for that
    channel, so keeping VoiceDesign resident wastes memory that batching the
    clone path can use.
    """
    from qwen_tts import Qwen3TTSModel

    if model_id in _models:
        return _models[model_id]
    for other in list(_models):
        if other != model_id:
            del _models[other]
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
    cuda = torch.cuda.is_available()
    _models[model_id] = Qwen3TTSModel.from_pretrained(
        model_id,
        device_map="cuda" if cuda else "cpu",
        # bf16 only where the hardware implements it. On an avx2-only CPU it is
        # emulated and runs ~30x SLOWER than fp32, which is the opposite of the
        # advice on the model card.
        dtype=torch.bfloat16 if cuda else torch.float32,
        attn_implementation="flash_attention_2" if cuda else "eager",
    )
    return _models[model_id]


class SynthRequest(BaseModel):
    schema_: str = Field(alias="schema")
    text: str
    language: str = "English"
    instruction: str | None = None
    # Exactly one casting route must be supplied.
    speaker: str | None = None
    voice_design: str | None = None
    voice_key: str | None = None
    seed: int | None = None
    request_key: str


def _designed_voice(design: str, voice_key: str, seed: int | None):
    """Return (reference audio, reference text) for a channel's designed voice.

    Cached on the volume by a digest of the brief, so the same brief always
    yields the same speaker. Regenerating it per render would give every video
    a slightly different narrator, which is the drift this design exists to
    avoid.
    """
    digest = _sha256(f"{voice_key}\0{design}\0{seed or 0}".encode())[:32]
    ref_wav = VOICE_CACHE / f"{digest}.wav"
    ref_txt = VOICE_CACHE / f"{digest}.txt"
    if ref_wav.exists() and ref_txt.exists():
        audio, sr = sf.read(str(ref_wav))
        return (audio, sr), ref_txt.read_text(), digest, True

    # A reference line chosen to exercise range: a statement, a question, a
    # contrast and a falling close. The clone inherits the reference's delivery,
    # so a monotone reference yields monotone narration.
    reference_text = (
        "This is where the record begins, and where most accounts quietly stop. "
        "So what actually happened next? Not what was reported — what happened. "
        "The answer is smaller than the legend, and far harder to forget."
    )
    model = _load(DESIGN_MODEL)
    if seed is not None:
        torch.manual_seed(seed)
    wavs, sr = model.generate_voice_design(
        text=[reference_text], instruct=[design], language=["English"],
    )
    sf.write(str(ref_wav), wavs[0], sr)
    ref_txt.write_text(reference_text)
    return (wavs[0], sr), reference_text, digest, False


def _to_mp3(audio: np.ndarray, sr: int) -> bytes:
    """MP3 at the contract's sample rate. The studio measures the returned bytes
    with ffmpeg and binds their digest to the receipt, so the encode must happen
    here rather than being reported second-hand."""
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "out.wav"
        mp3 = Path(tmp) / "out.mp3"
        sf.write(str(wav), audio, sr)
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav),
             "-ar", str(SAMPLE_RATE), "-b:a", "192k", str(mp3)],
            check=True,
        )
        return mp3.read_bytes()


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "schema": CONTRACT,
        "cuda": torch.cuda.is_available(),
        "loaded": list(_models),
        "cached_voices": len(list(VOICE_CACHE.glob("*.wav"))),
        "idle_seconds": round(time.time() - _last_used, 1),
    }


@app.post("/synthesize")
def synthesize(req: SynthRequest, authorization: str = Header(default="")) -> dict[str, Any]:
    global _last_used
    expected = os.environ.get("QWEN3_TTS_WORKER_TOKEN", "")
    if not expected or authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="unauthorized")
    if req.schema_ != CONTRACT:
        raise HTTPException(status_code=400, detail=f"unsupported schema {req.schema_}")
    if bool(req.speaker) == bool(req.voice_design):
        raise HTTPException(status_code=400, detail="supply exactly one of speaker or voice_design")

    started = time.time()
    with _lock:
        _last_used = started
        if req.seed is not None:
            torch.manual_seed(req.seed)

        if req.voice_design:
            (ref_audio, ref_sr), ref_text, voice_digest, cached = _designed_voice(
                req.voice_design, req.voice_key or "", req.seed,
            )
            base = _load(BASE_MODEL)
            prompt = base.create_voice_clone_prompt(
                ref_audio=(ref_audio, ref_sr), ref_text=ref_text,
            )
            wavs, sr = base.generate_voice_clone(
                text=[req.text], language=[req.language], voice_clone_prompt=prompt,
            )
            route = "voice_design_clone"
            model_id = BASE_MODEL
        else:
            model = _load("Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice")
            wavs, sr = model.generate_custom_voice(
                text=[req.text], speaker=[req.speaker], language=[req.language],
                instruct=[req.instruction] if req.instruction else None,
            )
            route, model_id, voice_digest, cached = "custom_voice", \
                "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice", "", False

        audio = wavs[0]
        mp3 = _to_mp3(audio, sr)

    return {
        "schema": CONTRACT,
        "route": route,
        "model": model_id,
        "audio_base64": base64.b64encode(mp3).decode(),
        "audio_sha256": _sha256(mp3),
        "text_sha256": _sha256(req.text.encode()),
        "request_key": req.request_key,
        "voice_digest": voice_digest,
        "voice_was_cached": cached,
        "sample_rate": SAMPLE_RATE,
        "audio_seconds": round(len(audio) / sr, 3),
        "generate_seconds": round(time.time() - started, 2),
        "device": "cuda" if torch.cuda.is_available() else "cpu",
    }
