# Real Composer Score Comparison

Two explicitly separate OpenRouter evaluations used the same retained Seaside
identity/topic and 30-second source controls. These are real provider responses,
not manually authored scores. No GPU was started and no channel was mutated.
The source snapshot lacks audio DNA/show bible and is not a current channel
export; its provenance and exact source-file hash are in the input JSON.

| Attempt | Composer instructions | Native parser | Reported text cost |
| --- | --- | --- | --- |
| Before | `d6f04071` | Rejected nonblank `T:` header; output also contains unsupported bracketed note chords and bracketed quoted chord names | $0.01219950 |
| After | Explicit native dialect restrictions in this change | Passed unchanged; 10 complete 4/4 bars at 80 BPM = 30 symbolic seconds | $0.01379925 |

Total: $0.02599875. No automatic retries or replacement scores. The after
attempt records source-file SHA-256 identities for its evaluator and composer
implementation. Later evaluator-only naming/test changes do not rewrite that
historical record. Both attempts retain their exact brief/request and outcome.

The after score has 2/3/3/2 bars corresponding to the arrangement's
0–0.2/0.2–0.5/0.5–0.8/0.8–1 section windows, with a final sustained tonic.
Its direction requests felt piano, Rhodes, bass, brushed drums and seaside rain.
Those are composition instructions, not evidence that generated audio contains
them. The largely quarter-note melodic sketch does not prove rich performance,
instrumental-only audio, convincing channel personality or a seamless repeat.
All of those require actual GPU output and audition. Final-video exact duration
is separately owned by assembly.

`evaluate-music-composer.test.ts`, with `YUE2_TEST_RUNTIME` set to the isolated
runtime checkout, replays both retained requests through that runtime's actual
CPU-only validator: before must reject and after must pass. Synthetic cases
separately test bounded admission, missing-parser refusal, unchanged score
handoff, retained failed charges and refusal to redispatch a claimed attempt.

## Real RTX3090 Render

The after arrangement was submitted once through the authenticated Studio
gateway to the installed isolated runtime image at revision
`bb57888e2e9772131c3acc8deb2e36bb10493341`. Subsequent recovery used the same
job ID and GET-only worker access. `gpu-material.json` is the real private-R2
readback, including the exact accepted request, candidate hashes, verified
execution accounting and measured listening-audio signal. Audio is retained
outside Git in `youtube-studio-ai-private` under the candidate's exact keys.

- Job: `yue2-eval-cb3b5e41babd7634f0b40ebc8ed278297874394b6b6a09052d73291c667fb813`.
- Native output: 6,837,056 frames, 48 kHz stereo FLOAT, 142.4386667 seconds.
- Native SHA-256: `c22b388febc0a0b19d7e33180f658f1c8ee861a32f2450f77f2b7e51a2276529`.
- Unclipped source SHA-256: `6ce0eda3230b61c18c9d2762f2bb0598b0f1728b5253601b5ff77fb2252c85ce`.
- Listening SHA-256: `74183b3537381622fa9c83a031a9a51a7f9314763e3634c20eb2cdda8a307b93`.
- Listening preparation: -2 dB linear attenuation only; same frame count, no
  trimming, looping, compression, resampling or musical edits. Measured true
  peak -1.2 dBTP, zero non-finite/full-scale samples and no flagged quiet windows.
- Supervised execution: 84.1593594 seconds, $0.004208 allocated compute
  estimate. This excludes VM startup/transfer time and is not provider billing.
- VM stopped and provider-confirmed at `2026-09-21T20:04:21.002Z`; tunnel and
  guard inactive. Cumulative conservative GPU reservations: 58 cents of the
  previously approved $1, not an invoice total.

This is a 4.75x source-duration difference, not exact adherence to the 30-second
symbolic score. The runtime's real adapter rejects a changed supplied score
before semantic generation; symbolic timing nevertheless does not impose the
audio semantic sequence's length. The owner's natural-loop policy permits this
measured source length, but cannot certify arrangement fidelity or efficient
duration control. Do not relabel it as a 30-second performance or hide the
discrepancy by trimming. Exact final-video duration remains assembly's job.

The technical review status is `needs_audition`, not approved. A full-length
192 kbps MP3 audition copy is available locally at
`/var/lib/youtube-studio-render/operator/composed-score-audio-20260921/audition.mp3`.
Owner listening review was requested; instrumental-only output, emotional
quality, channel fit, repetition, ending and seamless reuse remain unverified.
No legacy pipeline, production provider selection, thumbnail or publishing
state was changed.
