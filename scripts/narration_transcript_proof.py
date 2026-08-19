#!/usr/bin/env python3
"""Offline source-narration transcript proof for production QA.

The model is preinstalled and prewarmed into the Trigger image.  This script
must never resolve a model name or download at task time: a missing local model
is an unavailable proof, not a lower-quality fallback.
"""
import argparse
import hashlib
import json
import os
import re
import sys
from collections import Counter
from importlib.metadata import version


SCHEMA_VERSION = "narration-transcript-proof/v1"
MODEL_ID = "Systran/faster-whisper-small.en"
MODEL_REVISION = "d1d751a5f8271d482d14ca55d9e2deeebbae577f"
FASTER_WHISPER_VERSION = "1.2.1"
MAX_WORD_ERROR_RATE = 0.18
MIN_LEXICAL_RECALL = 0.92


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def tokens(text):
    return re.findall(r"[a-z0-9]+(?:'[a-z0-9]+)?", text.lower())


def levenshtein(reference, hypothesis):
    # One row keeps a 30-minute script tractable without hiding any mismatch.
    previous = list(range(len(hypothesis) + 1))
    for ref_index, ref_word in enumerate(reference, 1):
        current = [ref_index]
        for hyp_index, hyp_word in enumerate(hypothesis, 1):
            current.append(min(
                previous[hyp_index] + 1,
                current[hyp_index - 1] + 1,
                previous[hyp_index - 1] + (ref_word != hyp_word),
            ))
        previous = current
    return previous[-1]


def lexical_recall(reference, hypothesis):
    expected = Counter(reference)
    observed = Counter(hypothesis)
    matched = sum(min(count, observed[word]) for word, count in expected.items())
    return matched / max(1, len(reference))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--expected-text", required=True)
    parser.add_argument("--source-sha256", required=True)
    parser.add_argument("--expected-text-sha256", required=True)
    parser.add_argument("--model-dir", required=True)
    args = parser.parse_args()

    if not os.path.isdir(args.model_dir):
        raise RuntimeError("pinned local Whisper model directory is unavailable")
    if version("faster-whisper") != FASTER_WHISPER_VERSION:
        raise RuntimeError("installed faster-whisper version does not match the certified runtime")
    if sha256_file(args.input) != args.source_sha256:
        raise RuntimeError("input SHA-256 does not match requested narration source")
    with open(args.expected_text, "r", encoding="utf-8") as expected_file:
        expected_text = expected_file.read()
    if hashlib.sha256(expected_text.encode("utf-8")).hexdigest() != args.expected_text_sha256:
        raise RuntimeError("expected narration text SHA-256 does not match requested script")
    reference = tokens(expected_text)
    if len(reference) < 10:
        raise RuntimeError("expected narration is too short for transcript proof")

    from faster_whisper import WhisperModel

    model = WhisperModel(args.model_dir, device="cpu", compute_type="int8")
    segments, _ = model.transcribe(
        args.input,
        language="en",
        task="transcribe",
        beam_size=5,
        word_timestamps=True,
        vad_filter=True,
        condition_on_previous_text=True,
    )
    words = []
    transcript_parts = []
    for segment in segments:
        text = (segment.text or "").strip()
        if text:
            transcript_parts.append(text)
        for word in segment.words or []:
            value = (word.word or "").strip()
            if value:
                words.append({
                    "text": value,
                    "startMs": int(round(word.start * 1000)),
                    "endMs": int(round(word.end * 1000)),
                })
    transcript_text = " ".join(transcript_parts)
    hypothesis = tokens(transcript_text)
    if not hypothesis:
        raise RuntimeError("transcriber produced no spoken words")
    distance = levenshtein(reference, hypothesis)
    word_error_rate = distance / len(reference)
    recall = lexical_recall(reference, hypothesis)
    missing_numeric_terms = sorted({word for word in reference if any(char.isdigit() for char in word) and word not in hypothesis})
    passed = word_error_rate <= MAX_WORD_ERROR_RATE and recall >= MIN_LEXICAL_RECALL

    receipt = {
        "schemaVersion": SCHEMA_VERSION,
        "provider": "faster-whisper",
        "model": {
            "id": MODEL_ID,
            "revision": MODEL_REVISION,
            "packageVersion": FASTER_WHISPER_VERSION,
            "computeType": "int8-cpu",
        },
        "source": {
            "sha256": args.source_sha256,
            "byteLength": os.path.getsize(args.input),
        },
        "expected": {
            "textSha256": args.expected_text_sha256,
            "wordCount": len(reference),
        },
        "transcript": {
            "text": transcript_text,
            "wordCount": len(hypothesis),
            "words": words,
        },
        "assessment": {
            "wordErrorRate": word_error_rate,
            "lexicalRecall": recall,
            "missingNumericTerms": missing_numeric_terms,
            "thresholds": {
                "maxWordErrorRate": MAX_WORD_ERROR_RATE,
                "minLexicalRecall": MIN_LEXICAL_RECALL,
            },
            "passed": passed,
        },
    }
    print(json.dumps(receipt, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"narration transcript proof failed: {error}", file=sys.stderr)
        sys.exit(1)
