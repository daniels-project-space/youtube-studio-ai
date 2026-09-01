# MiniMax-Music3 channel-score qualification

The Studio contains an explicit `minimax_music3` score provider, but it is intentionally production-closed until the exact worker, license controls, and a listened benchmark are present. It is never an automatic fallback for Suno or Mureka.

## Pinned foundation

- Official model: `MiniMaxAI/MiniMax-Music3`.
- Exact Hugging Face revision: `fbdf52fbaaca799592917417eb05f1899f1255ec`.
- Runtime repository: `comfyanonymous/ComfyUI`.
- Exact ComfyUI revision adding MiniMax Music 3 support: `efd4e951a00e85bd92e79f1d685427912b0dad5e`.
- Output: 32 kHz, 16-bit, stereo PCM WAV; duration is bounded to 10–300 seconds.
- Infrastructure: two distinct provider-attested Novita RTX 4090 spot GPUs, persistent storage, checkpointing, and automatic idle shutdown.

Official references:

- https://github.com/MiniMax-AI/MiniMax-Music3
- https://huggingface.co/MiniMaxAI/MiniMax-Music3
- https://github.com/comfyanonymous/ComfyUI/commit/efd4e951a00e85bd92e79f1d685427912b0dad5e

## What is sealed before spend

`src/engine/channelMusicProgram.ts` derives a fingerprint-bound program from the current channel, Style DNA, content lane, topic, and composer brief. It gives every channel role a different musical structure, loudness target, narration priority, instrumentation, texture, exclusions, and gap-free section map. For MiniMax it emits the model's official three-part caption shape: Global Metadata, Vocal Details, and Arrangement.

The production `music` block persists that plan before provider submission. Managed providers receive the same identity and a condensed arrangement map. MiniMax receives the complete structured caption and lyrics-control section tags.

## Worker and integrity contract

`src/lib/minimaxMusic3.ts` sends one deterministic, idempotency-keyed `minimax-music3-worker/v1` POST. The client accepts a result only when the receipt binds:

- the exact program, caption, lyrics control, seed, duration, CFG, top-k, model, model revision, and runtime revision;
- two distinct RTX 4090 GPU identities, spot capacity, persistent storage, checkpointing, idle shutdown, and internally consistent actual cost;
- the durable credential-free HTTPS output URL plus its SHA-256, byte length, sample rate, channel count, bit depth, codec, and container;
- the exact reviewed qualification receipt hash and required license/safeguard attestations.

The client downloads the WAV, parses its RIFF chunks, and verifies every integrity and format field before returning it. A transport failure after POST is an unknown paid outcome: the deterministic request key is surfaced for reconciliation and the client never submits a second generation automatically.

## Quality and mastering

The global worker benchmark is not permission to declare every new score good. Every generated track remains `pending_private_draft_review` until the private validation video is heard. `music-program-quality/v1` requires complete section-by-section review, real human audition, emotional and arrangement depth, non-generic judgment, loudness range, crest factor, true peak, clipping, flat-top, silence, DC, and artifact evidence.

Production mastering applies one measured constant gain. It does not compress, limit, normalize sections independently, or hide a source whose peak headroom cannot reach the sealed LUFS target.

## License and production admission

The official MiniMax-Music3 license requires prominent `MiniMax-Music3` attribution in a commercial product UI, generated-content disclosure, safeguards for hosted use, operator review of the annual-revenue authorization threshold, and the license's other conditions. This document is operational guidance, not legal advice.

All of these Trigger production values are required:

1. `MINIMAX_MUSIC3_WORKER_URL`
2. `MINIMAX_MUSIC3_WORKER_TOKEN`
3. `MINIMAX_MUSIC3_QUALITY_QUALIFIED=1`
4. `MINIMAX_MUSIC3_QUALITY_RECEIPT_SHA256=<64 lowercase hex>`
5. `MINIMAX_MUSIC3_LICENSE_ATTESTED=1`
6. `MINIMAX_MUSIC3_UI_ATTRIBUTION_ENABLED=1`
7. `MINIMAX_MUSIC3_DISCLOSURE_ENABLED=1`
8. `MINIMAX_MUSIC3_SAFEGUARDS_ATTESTED=1`

Do not set these from a source-only test. Retain the native WAVs, runtime receipts, actual cost, full-section measurements, and human audition evidence behind the qualification hash.

## Current status

The channel program, caller wiring, worker contract, UI provider description, license gates, integrity validation, cost accounting, and tests are implemented. No live two-GPU Novita worker was available at this checkpoint, so no production qualification flag or receipt hash was manufactured and no paid MiniMax render was attempted.
