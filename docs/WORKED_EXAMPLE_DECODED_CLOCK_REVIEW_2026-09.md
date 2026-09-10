# Worked-example decoded audio clock review — 2026-09-10

## Decision

The worked-example arithmetic lane now records an audible, decoder-derived
sample clock in addition to the existing container-duration measurement. The
visual compiler consumes the decoded clock for sentence endpoints, while the
legacy format clock remains bound for compatibility and final-master metadata.
An old or partial receipt can still restore retained audio, but cannot qualify
the arithmetic reveal renderer.

## Root cause addressed

MP3 `format.duration` includes codec/container padding. In the retained local
fixture, the final file reports `26.618776s`, while its decoded frames contain
`1,171,640` samples at `44,100Hz` (`26.567800454s`). Summing the retained part
sample counts and the sample-rounded concat gaps reproduces the final decoded
sample count exactly. No fixed delay, guessed scale, or provider regeneration is
used.

## Implementation

- `probeDecodedAudioSamples` sums FFprobe `frame.nb_samples` after decoder
  skip/discard handling. It is an explicit opt-in helper; ordinary narration
  still uses the cheap existing probe.
- Each arithmetic narration part persists both its format observation and its
  decoded `{sampleRate, sampleCount, durationSec}` observation when available.
- The final decoded observation is persisted only when no voice transform is
  active. Missing decoded evidence, resampling/FX ambiguity, inconsistent rates,
  and part/final sample-count drift remain fail-closed for arithmetic visuals.
- `audioGapSamples` mirrors `concatAudioWithGaps`'s three-decimal `apad` input,
  so the integer timeline is tied to the actual FFmpeg command.
- `decodedSentenceTimings` reconstructs cues from integer samples. A final
  endpoint may be clamped only within the bounded per-segment sample
  quantization allowance when the container bound is one or more rounded
  samples shorter.

## Evidence

- `src/lib/__tests__/decodedAudioClock.test.ts`: real FFmpeg 1.0s and 0.75s MP3
  fixtures; exact 44,100 and 33,075 sample assertions.
- `src/lib/__tests__/narrationSegmentClock.test.ts`: decoded timeline and
  missing-part/sample-drift rejection contracts.
- `src/trigger/blocks/__tests__/workedExampleAudioSource.test.ts`: six provider
  and chapter/sentence combinations, local cache restore, final-only download,
  bounded probe recovery, estimate limits, altered-byte refusal, and decoded
  clock presence on fresh sentence runs. Provider calls are fixture-only.
- `src/lib/__tests__/sceneCompilerWorkedExample.test.ts` and
  `src/engine/__tests__/workedExampleVisual.test.ts`: decoded endpoints flow
  through plan → graph → manifest without changing ordinary grammar.
- `scripts/scene-compiler-worked-example-proof.mts`: 38 native browser/frame
  snapshots plus four negative controls; encoded 1920×1080 H.264 output; no
  provider calls.

## Current boundary

This remains a held arithmetic capability until a fresh natural-speech take is
available for pronunciation/editorial review. Synthetic tone fixtures prove
sample construction, cache identity, and renderer wiring only; they are not a
speech-quality approval.
