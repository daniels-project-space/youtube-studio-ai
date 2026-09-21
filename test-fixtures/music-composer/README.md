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
