#!/usr/bin/env python3
"""
NARRATION ORACLE — a stand-in for listening.

Narration cannot be signed off by typechecking, and I cannot hear the takes. So
the question "does this sound right?" has to be decomposed into things that can
be measured on the waveform and that a generator cannot game by being confident.

Six axes, each answering a distinct failure that real narration exhibits:

  1. INTELLIGIBILITY   ASR round-trip word error rate. Synthesize the script,
                       transcribe the audio with a model that never saw the
                       script, and diff. Catches dropped sentences, mangled
                       words, hallucinated repeats and bad pronunciation. This
                       is the strongest single axis because the transcriber has
                       no stake in the outcome.
  2. CASTING           Median F0 against the intended register. A "deep male"
                       brief that renders at 210 Hz is miscast no matter how
                       clean it sounds.
  3. CONSISTENCY       MFCC timbre drift between segments. Qwen's voice-design
                       call redraws a slightly different speaker on every
                       invocation, so a multi-sentence render can change voice
                       mid-paragraph. Drift catches that; nothing else does.
  4. DELIVERABILITY    Integrated loudness and true peak. Qwen outputs around
                       -21 to -25 LUFS and the studio's own gate rejects assets
                       below its floor, so a perfect read can still be unusable.
  5. PACING            Words per minute. Daniel's timing and pacing notes are a
                       real constraint: the same words at 180 wpm and 120 wpm
                       are different videos.
  6. PROSODY           F0 variation and pause structure. This axis exists
                       because the other five can all pass on a flat, robotic
                       read — a monotone delivery has low F0 spread and no
                       sentence-final pauses. Without it the oracle would
                       happily approve something nobody would listen to.

WHERE THIS ORACLE CAN STILL BE WRONG, and why it is used anyway:
  - It cannot judge *character* — warmth, authority, menace. F0 and MFCC are
    proxies. So the intended register is supplied per take rather than assumed.
  - ASR errors are not always TTS errors; a rare proper noun may be transcribed
    wrongly from perfectly good audio. WER is therefore reported against a
    REFERENCE take (ElevenLabs) rather than against zero, so only the delta
    matters.
  - It says nothing about music-bed interaction, which is the assembly module's
    problem, not narration's.

Calibration principle carried over from the thumbnail work: a threshold that
rejects the approved reference is broken, not strict. The ElevenLabs takes are
the reference here, so any gate must pass them.
"""
import json
import math
import os
import re
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

AUDIO = Path("/root/tts-ab/compare/audio")
SCRIPTS = json.load(open("/root/tts-ab/scripts.json"))


# ---------------------------------------------------------------- utilities
def to_wav(path: Path) -> Path:
    """Decode anything to 16 kHz mono wav for analysis (ffmpeg, not librosa's
    audioread fallback, which is slow and version-sensitive)."""
    out = Path("/tmp/oracle") / (path.stem + ".16k.wav")
    out.parent.mkdir(parents=True, exist_ok=True)
    if not out.exists():
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(path),
             "-ac", "1", "-ar", "16000", str(out)],
            check=True,
        )
    return out


def read_wav(path: Path):
    with wave.open(str(path), "rb") as w:
        sr = w.getframerate()
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    return data.astype(np.float32) / 32768.0, sr


def normalise_words(text: str):
    return re.sub(r"[^a-z0-9' ]+", " ", text.lower()).split()


def wer(reference: str, hypothesis: str) -> float:
    """Levenshtein over words. Not imported from a package so the metric is
    inspectable rather than trusted."""
    r, h = normalise_words(reference), normalise_words(hypothesis)
    if not r:
        return 0.0
    d = np.zeros((len(r) + 1, len(h) + 1), dtype=np.int32)
    d[:, 0] = np.arange(len(r) + 1)
    d[0, :] = np.arange(len(h) + 1)
    for i in range(1, len(r) + 1):
        for j in range(1, len(h) + 1):
            cost = 0 if r[i - 1] == h[j - 1] else 1
            d[i, j] = min(d[i - 1, j] + 1, d[i, j - 1] + 1, d[i - 1, j - 1] + cost)
    return float(d[len(r), len(h)]) / len(r)


# ------------------------------------------------------------------- axes
_asr = None


def transcribe(path: Path) -> str:
    global _asr
    from faster_whisper import WhisperModel
    if _asr is None:
        # small is enough to catch dropped/mangled words and runs on this CPU.
        _asr = WhisperModel("small", device="cpu", compute_type="int8")
    segments, _ = _asr.transcribe(str(path), language="en", beam_size=1)
    return " ".join(s.text for s in segments)


def loudness(path: Path):
    """Integrated LUFS + true peak via ffmpeg's ebur128 — the same measurement a
    broadcaster would use, rather than a home-made RMS."""
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", str(path),
         "-filter_complex", "ebur128=peak=true", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    text = proc.stderr
    lufs = re.findall(r"I:\s*(-?\d+\.\d+) LUFS", text)
    peak = re.findall(r"Peak:\s*(-?\d+\.\d+) dBFS", text)
    return (float(lufs[-1]) if lufs else None, float(peak[-1]) if peak else None)


def pitch_stats(y, sr):
    import librosa
    f0, voiced, _ = librosa.pyin(
        y, sr=sr, fmin=60, fmax=400, frame_length=2048,
    )
    vals = f0[~np.isnan(f0)]
    if vals.size == 0:
        return None, None
    return float(np.median(vals)), float(np.std(vals))


def timbre_drift(y, sr, segments=6):
    """Mean pairwise cosine distance between per-segment MFCC means.

    A single speaker reading continuously drifts very little. A render that
    redraws its voice per sentence shows a jump here even when every sentence
    sounds fine on its own — which is exactly the Qwen voice-design trap.
    """
    import librosa
    chunk = len(y) // segments
    if chunk < sr // 2:
        return None
    means = []
    for i in range(segments):
        seg = y[i * chunk:(i + 1) * chunk]
        m = librosa.feature.mfcc(y=seg, sr=sr, n_mfcc=13).mean(axis=1)
        means.append(m / (np.linalg.norm(m) + 1e-9))
    dists = [
        1 - float(np.dot(means[i], means[j]))
        for i in range(len(means)) for j in range(i + 1, len(means))
    ]
    return float(np.mean(dists))


def pause_stats(y, sr, thresh_db=-40.0, min_pause=0.18):
    """Count and total the silences. A read with no pauses is a run-on; a read
    with enormous gaps is dead air. Both are audible defects that every other
    axis here would pass."""
    frame = int(sr * 0.02)
    if frame <= 0 or len(y) < frame:
        return 0, 0.0
    frames = len(y) // frame
    energy = np.array([
        20 * math.log10(float(np.sqrt(np.mean(y[i * frame:(i + 1) * frame] ** 2))) + 1e-9)
        for i in range(frames)
    ])
    silent = energy < thresh_db
    pauses, run = [], 0
    for s in silent:
        if s:
            run += 1
        else:
            if run * 0.02 >= min_pause:
                pauses.append(run * 0.02)
            run = 0
    return len(pauses), float(sum(pauses))


def grade(path: Path, script: str, label: str):
    w = to_wav(path)
    y, sr = read_wav(w)
    dur = len(y) / sr
    hyp = transcribe(w)
    f0_med, f0_std = pitch_stats(y, sr)
    lufs, peak = loudness(path)
    n_pause, pause_total = pause_stats(y, sr)
    words = len(normalise_words(script))
    return {
        "take": label,
        "seconds": round(dur, 1),
        "wer": round(wer(script, hyp), 4),
        "f0_median_hz": round(f0_med, 1) if f0_med else None,
        "f0_std_hz": round(f0_std, 1) if f0_std else None,
        "timbre_drift": round(timbre_drift(y, sr) or 0, 4),
        "lufs": lufs,
        "true_peak_dbfs": peak,
        "wpm": round(words / (dur / 60), 1) if dur else None,
        "pauses": n_pause,
        "pause_seconds": round(pause_total, 1),
    }


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else ""
    rows = []
    for f in sorted(AUDIO.iterdir()):
        if f.suffix not in {".wav", ".mp3"}:
            continue
        if only and only not in f.name:
            continue
        job = next((j for j in SCRIPTS if j in f.stem), None)
        if not job:
            continue
        rows.append(grade(f, SCRIPTS[job], f.stem))
        print(json.dumps(rows[-1]), flush=True)
    Path("/root/tts-ab/oracle_report.json").write_text(json.dumps(rows, indent=2))
    print(f"\nwrote /root/tts-ab/oracle_report.json ({len(rows)} takes)")


if __name__ == "__main__":
    main()
