# Qwen3-TTS open narration qualification

The Studio supports an explicit `qwen3` narration provider without allowing it to masquerade as Fish or ElevenLabs. The route is intentionally fail-closed until an actual worker and a reviewed quality receipt exist.

## Pinned foundation

- Repository: `QwenLM/Qwen3-TTS` (Apache-2.0).
- Model: `Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice`.
- Hugging Face revision: `0c0e3051f131929182e2c023b9537f8b1c68adfe`.
- Runtime package: `qwen-tts==0.1.1` with its declared `transformers==4.57.3` dependency.
- Inference: BF16, FlashAttention 2, 24 kHz decoded audio, MP3 delivery.
- Infrastructure: one provider-attested Novita RTX 4090 spot worker, persistent model cache, and automatic idle shutdown.

The official implementation exposes `generate_custom_voice(text, language, speaker, instruct)` and nine fixed speakers. The Studio passes only those enumerated speakers and the ten documented languages. Speaking-rate intent is translated into the model's supported natural-language instruction rather than inventing an unsupported numeric API field.

## Current status

The application contract, channel-casting bridge, cost accounting, durable Convex receipt shape, and production gates are implemented and covered without provider spend. A live Novita worker/benchmark was not available during this checkpoint, so no quality flag or receipt hash was manufactured and no GPU qualification call was made. Keep the production qualification variables absent until the benchmark below is actually reviewed.

Official references:

- https://github.com/QwenLM/Qwen3-TTS
- https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice

## Worker contract

`src/lib/qwenTts.ts` posts an idempotency-keyed `qwen3-tts-worker/v1` request to `QWEN3_TTS_WORKER_URL`. A response is accepted only when it returns:

- the exact model, revision, package versions, BF16 precision, and FlashAttention 2 implementation;
- matching text, instruction, speaker, language, seed, request, and audio SHA-256 digests;
- 24 kHz MP3 bytes inside a bounded response;
- a Novita RTX 4090 spot/persistent-cache/idle-shutdown runtime attestation;
- internally consistent GPU seconds, rate, startup, storage, and total cost.

A transport failure after POST is an unknown paid outcome. The client emits the deterministic request key for reconciliation and never resubmits. An unrecognized provider name also fails before spend instead of falling through to Fish.

During new-channel setup, the operator must choose an exact Qwen speaker. Channel Inception then:

1. ranks that speaker against provider-declared metadata and the channel's narration physics;
2. makes one real, receipt-bearing cold-open call inside the approved setup envelope;
3. measures the returned MP3 with FFmpeg and binds its SHA-256 to the worker receipt;
4. persists provider-specific casting, local-audio, and worker receipts;
5. wires the same provider/speaker/evidence into the private validation render.

An existing ElevenLabs receipt cannot authorize Qwen, and mixed Qwen narration plus the currently ElevenLabs-only whiteboard renderer is rejected before rendering.

## Production admission

Configuration alone is insufficient. Production requires all four values in the Trigger production runtime:

1. `QWEN3_TTS_WORKER_URL`
2. `QWEN3_TTS_WORKER_TOKEN`
3. `QWEN3_TTS_QUALITY_QUALIFIED=1`
4. `QWEN3_TTS_QUALITY_RECEIPT_SHA256=<64 lowercase hex>`

The quality receipt must come from a reviewed benchmark of the exact worker/model revision. That benchmark is `scripts/qwen-tts-qualify.ts`: it runs the matrix below against a live worker, measures every take with `scripts/qwen_take_measure.py` (ASR word-error rate, integrated loudness, true peak, duration and pace), refuses to emit a receipt if any axis fails or is UNMEASURED, refuses again until a human verdict has been recorded per take, and hashes the measurements together with those verdicts so neither can be edited afterwards. Instruction following is judged as the pace separation between a calm and an energetic take, which one take cannot fake. At minimum, retain:

- one English documentary passage for Aiden and Ryan;
- one calm/slow passage and one energetic passage to verify instruction following;
- a multilingual sample for every language intended for a real channel;
- actual MP3 bytes, text/instruction hashes, WER or transcript comparison, loudness, clipping, duration/pace, GPU lifecycle receipt, and a human register/performance verdict;
- the final aggregate receipt whose SHA-256 is placed in the runtime environment.

Every production channel still needs voice evidence bound to its exact Qwen speaker and channel. The normal local cold-open and final FFmpeg narration evidence gates remain active. A global worker benchmark cannot authorize a mismatched channel voice.

## Cost authority

Planning reserves a conservative `$1 / 1,000 characters` ceiling until real worker benchmarking supports a tighter operator override via `PRICE_TTS_QWEN_MAX_PER_KCHAR_USD`. Actual run spend ignores character pricing and uses only the worker's verified GPU lifecycle receipts. This protects admission without pretending the self-hosted worker has a managed per-character invoice.
