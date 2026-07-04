#!/usr/bin/env python3
"""
whisper_align.py — force-align narration audio to per-word timestamps.

CLI contract (UNCHANGED from the original openai-whisper version — callers in
src/lib/whiteboardSync.ts depend on it):

    python3 scripts/whisper_align.py <audio> <out.json>

Writes out.json = [{"text": str, "start": <ms>, "end": <ms>}, ...] and prints
the word count on stdout.

Engine: faster-whisper (CTranslate2). The "base" model is a ~145MB one-time
download and needs NO torch, so a fresh Trigger worker cold-starts in about a
minute instead of pulling the multi-GB torch wheel that openai-whisper drags
in. If faster_whisper is not importable (e.g. an old VPS venv that only has
openai-whisper installed), we fall back to the legacy engine with the exact
same output shape, so both environments keep working.
"""
import json
import sys


def align_faster(path):
    from faster_whisper import WhisperModel

    # int8 keeps memory small and is plenty accurate for cue alignment; we only
    # need word starts within ~100ms, not transcription-grade fidelity.
    model = WhisperModel("base", compute_type="int8")
    segments, _info = model.transcribe(path, word_timestamps=True, language="en")
    words = []
    for seg in segments:  # generator — transcription happens as we iterate
        for w in seg.words or []:
            words.append({
                "text": w.word.strip(),
                "start": int(round(w.start * 1000)),
                "end": int(round(w.end * 1000)),
            })
    return words


def align_openai(path):
    import whisper

    model = whisper.load_model("base")
    result = model.transcribe(path, word_timestamps=True, language="en")
    words = []
    for seg in result.get("segments", []):
        for w in seg.get("words", []):
            words.append({
                "text": str(w.get("word", "")).strip(),
                "start": int(round(float(w["start"]) * 1000)),
                "end": int(round(float(w["end"]) * 1000)),
            })
    return words


def main():
    if len(sys.argv) < 3:
        print("usage: whisper_align.py <audio> <out.json>", file=sys.stderr)
        sys.exit(2)
    audio, out = sys.argv[1], sys.argv[2]
    try:
        words = align_faster(audio)
    except ImportError:
        # Only an IMPORT failure falls back — a real transcription error should
        # surface loudly, not be masked by a second (much slower) engine.
        print("faster_whisper unavailable — falling back to openai-whisper", file=sys.stderr)
        words = align_openai(audio)
    with open(out, "w") as f:
        json.dump(words, f)
    print(len(words))


if __name__ == "__main__":
    main()
