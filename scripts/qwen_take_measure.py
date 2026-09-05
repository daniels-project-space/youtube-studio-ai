#!/usr/bin/env python3
"""Measure one narration take: intelligibility, loudness, and pace.

Written for scripts/qwen-tts-qualify.ts, which orchestrates the Qwen3-TTS
qualification benchmark but has no audio libraries of its own. Everything that
needs to look at a waveform lives here so there is one implementation rather
than a TypeScript opinion and a Python one that drift apart.

Deliberately NOT reusing the two existing scripts:

  narration_transcript_proof.py  is a production PROOF tool. It demands a pinned
                                 model directory, an exact input SHA-256, an
                                 exact expected-text SHA-256, and hard-codes
                                 language="en". Those constraints are correct for
                                 proving a shipped narration and wrong for
                                 benchmarking a take that does not exist yet, in
                                 Spanish or German.
  narration-oracle.py            scans a hard-coded directory against a hard-coded
                                 script table. It has no per-file entry point.

Axes, and why each one:

  wer            An ASR round-trip is the only intelligibility check that cannot
                 be argued with. If a transcript of the synthesised audio does
                 not recover the words that were sent, the voice is not usable
                 for narration no matter how pleasant it sounds.
  lufs / peak    A take that is quiet or clipping fails the same final-master
                 audio gates the rest of the pipeline enforces, so it is better
                 to find out during qualification than during a render.
  wordsPerSec    Pace is the axis the CustomVoice model can only be steered on
                 through a natural-language instruction. Measuring it is the only
                 way to know whether the instruction did anything at all.

Exit code is 0 with JSON on stdout even when a measurement fails; the caller
decides what is fatal. A measurement that could not be taken is reported as
null, never as a passing value.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

# faster-whisper language codes for the languages a live channel publishes in.
LANGUAGE_CODES = {
    "english": "en", "spanish": "es", "german": "de", "french": "fr",
    "italian": "it", "portuguese": "pt", "russian": "ru", "japanese": "ja",
    "korean": "ko", "chinese": "zh",
}

DEFAULT_MODEL = "small"


def words(text: str) -> list[str]:
    """Lowercased word tokens, punctuation and case discarded.

    TTS output is judged on whether the WORDS survive, not on whether an ASR
    guessed the same punctuation. Keeping punctuation would inflate the error
    rate with differences no listener would notice.
    """
    return re.findall(r"[a-z0-9À-ɏ]+", text.lower())


def word_error_rate(reference: str, hypothesis: str) -> float:
    """Levenshtein distance over word tokens, normalised by reference length."""
    ref, hyp = words(reference), words(hypothesis)
    if not ref:
        return 1.0
    # Standard DP; the sequences here are one short paragraph, so the O(n*m)
    # table is trivially small.
    prev = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, start=1):
        cur = [i]
        for j, h in enumerate(hyp, start=1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r != h)))
        prev = cur
    return prev[len(hyp)] / len(ref)


def duration_sec(path: Path) -> float | None:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", str(path)],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        return float(out)
    except Exception:
        return None


def loudness(path: Path) -> tuple[float | None, float | None]:
    """Integrated loudness (LUFS) and true peak (dBTP) from loudnorm's measure pass."""
    try:
        proc = subprocess.run(
            ["ffmpeg", "-hide_banner", "-nostats", "-i", str(path),
             "-af", "loudnorm=print_format=json", "-f", "null", "-"],
            capture_output=True, text=True, check=True,
        )
        blob = re.search(r"\{[\s\S]*\}", proc.stderr.replace("\r", ""))
        if not blob:
            return None, None
        parsed = json.loads(blob.group(0))
        return float(parsed["input_i"]), float(parsed["input_tp"])
    except Exception:
        return None, None


def transcribe(path: Path, language: str, model_size: str) -> str | None:
    try:
        from faster_whisper import WhisperModel
    except Exception:
        return None
    try:
        model = WhisperModel(model_size, device="cpu", compute_type="int8")
        segments, _ = model.transcribe(
            str(path), language=language, task="transcribe",
            beam_size=5, vad_filter=True, condition_on_previous_text=False,
        )
        return " ".join((s.text or "").strip() for s in segments).strip()
    except Exception:
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", required=True)
    ap.add_argument("--reference", required=True, help="the exact text that was synthesised")
    ap.add_argument("--language", default="English")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    args = ap.parse_args()

    path = Path(args.audio)
    if not path.is_file():
        print(json.dumps({"error": f"no such audio file: {path}"}))
        return 0

    code = LANGUAGE_CODES.get(args.language.strip().lower(), "en")
    dur = duration_sec(path)
    lufs, peak = loudness(path)
    transcript = transcribe(path, code, args.model)
    wer = word_error_rate(args.reference, transcript) if transcript is not None else None
    ref_words = len(words(args.reference))

    print(json.dumps({
        "durationSec": round(dur, 3) if dur is not None else None,
        "lufs": round(lufs, 2) if lufs is not None else None,
        "truePeakDbtp": round(peak, 2) if peak is not None else None,
        "transcript": transcript,
        "wer": round(wer, 4) if wer is not None else None,
        "referenceWords": ref_words,
        "wordsPerSec": round(ref_words / dur, 3) if dur else None,
        "language": code,
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
