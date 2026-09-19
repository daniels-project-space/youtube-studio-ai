# Language-practice capability — current-source design

9 September 2026. Goal item178. **Assessed; not implemented, admitted or
qualified.** This is a focused structural-design decision, not an extra paid
planning/judging stage per lesson.

## Current mechanisms and actual gaps

- `learning_contract` calls `buildLearningContract` in
  `src/engine/learningContract.ts`. It binds an objective, demonstration beats,
  sources and a generic retrieval question to an Episode Graph. Its stated
  purpose is not linguistic correctness, pronunciation or practice timing.
- `narration_tts` in `src/trigger/blocks/narratedBlocks.ts` dispatches through
  `synthNarration`, with one selected provider/speaker/language for the current
  narration batch. Its Qwen branch carries explicit language and speaker to
  the real adapter, with budget and receipt checks. A per-turn bilingual cast
  and deliberate learner response intervals are not represented there.
- `src/lib/qwenTts.ts` pins CustomVoice1.7B, model/package identity, speakers,
  languages and byte-bound receipts. Its runtime receipt is currently specific
  to the Novita route. The separately requested Salad integration cannot be
  claimed by returning this receipt with a different provider name.
- `src/lib/narrationTranscriptProof.ts` pins `faster-whisper-small.en` and an
  English-specific model revision. `scripts/narration_transcript_proof.py`
  explicitly transcribes with `language="en"` and requires at least ten
  expected words. A one-word vocabulary take cannot pass this contract as-is.
- `src/lib/narrationCueTiming.ts` tokenizes with an ASCII-letter/digit regex.
  Existing lexical/timing thresholds are not a proof of accented-language or
  non-space-script fidelity. Do not broaden regexes and call the old
  calibration multilingual.
- `motionComic.ts` already dispatches individual dialogue lines with voice
  identities and measured durations, but its comic-specific input, caching,
  bubbles and assembly are not a reusable language-practice track.

The official Qwen documentation describes explicit language/speaker inputs and
batch lists for CustomVoice. That supports adapter investigation, not an
audition or a deployed multilingual-quality claim.
[Qwen's official implementation](https://github.com/QwenLM/Qwen3-TTS).
The current transcription model is explicitly English-only.
[SYSTRAN's model](https://huggingface.co/Systran/faster-whisper-small.en).

## Smallest useful representation

A lesson owns a versioned ordered **turn track**, separate from ordinary
narration and generic retrieval prompts. Each turn binds its learning purpose,
speaker identity, explicit language, approved spoken text, learner instruction,
answer/reveal content and response pause. Each rendered utterance binds its
actual provider request, text/voice/config fingerprints, audio bytes and
measured duration. The compiled timeline binds those receipts, not guessed
words-per-second timings.

Use three explicit phases: listen, respond, reveal. Render response time as
exact timeline silence; do not ask the TTS provider to invent a long pause.
Keep answer text hidden until its planned reveal and ensure captions cannot
leak it early. Support listen-only or repeat turns as declared variants rather
than inserting meaningless response time everywhere.

Separate pedagogical repetition from a provider purchase. The same already
approved utterance can be replayed at multiple declared points within a lesson
without a second synthesis. A changed pause, layout, font or reveal animation
must not invalidate unchanged audio. Cross-episode reuse remains subject to
the channel's asset/originality policy; this design does not waive it.

For distinct utterances, compare per-turn synthesis with bounded
same-speaker/language worker batching. Preserve individually bound output
receipts and repair units. One enormous combined narration request could make
one pronunciation correction rebuy the entire lesson and makes precise
silence/cast changes harder; fewer requests alone is not a saving.

## Qualification and implementation sequence

1. Implement strict request/turn/audio/timeline schemas and provider-free
   planning/replay checks. Bound counts, text, durations and total runtime;
   reject unknown speakers/languages, stale audio identity, missing answers,
   overlapping phases, early answer captions and unsupported combinations
   before paid work. Use actual registered callers and compiler ordering.
2. First connect an English-listening practice slice to the existing verified
   English speech path. This is staging, not completion of bilingual support.
   A minimum-length whole-lesson transcript must not hide a missing critical
   one-word turn: verify each turn's coverage and timing independently.
3. Qualify any multilingual ASR/tokenization extension separately with pinned
   versions, language-aware matching and known-bad/known-good audio. Preserve
   the English model and thresholds for existing English channels until an
   evidence-backed change is approved. Pronunciation/minimal-pair quality
   needs a real listening test; acceptable aggregate WER is not sufficient.
4. Bind turn payloads through the actual scene/assembly compiler. Render and
   review a full lesson in admitted aspects, checking text direction, glyphs,
   line breaks, speaker changes, deliberate silence and no premature answers.
5. Integrate planner discovery, bounded scheduling/batch preparation, saved
   assets and selective retry. Prove a new automatically created channel with
   no manual substitution of the lesson or audio. Then polish and visually
   test its Golden card, controls and real progress before verified release.

## Independent experiments

Compare identical lesson content across per-turn and grouped-request paths.
Measure actual accepted-lesson cost, discarded turns, rework after one bad
utterance, worker warm-up and wall time. Listening tests cover short words,
negation, numbers, accents, minimal pairs, speaker swaps and late lesson turns.
Corrupt one word or answer on purpose; shift one reveal; shorten one response
pause; substitute another lesson's valid audio receipt. Each must fail at its
own boundary without regenerating unaffected paid work.

No synthesis, model installation, provider switch, production mutation or
quality-policy change was performed for this design. Multilingual validation
and the live Salad TTS worker remain prerequisites, not a reason to stop other
goal work.
