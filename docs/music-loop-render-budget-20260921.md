# Music loop render budget

The owner permits natural-length source performances for Lo-Fi, sleep, and
meditation. Assembly still owns the exact requested final video duration.
This is not approval of the retained source's musical or perceptual quality.

## Timeout mismatch

The previous eight-hour diagnostic render failed at the verifier's fixed
900,000ms FFmpeg timeout. The production compositor separately allowed
2,700,000ms per pass, potentially 135 minutes across its three passes, while
`runPipeline` has a 4,200-second task ceiling.

A local 120-second AAC-only probe of the retained folded source completed at
9.84x real time, using the existing 48kHz stereo source, native AAC encoder,
384k bitrate, and fade-in filter. Linear extrapolation gives approximately
49 minutes for eight hours of audio alone. This is an estimate, not an
eight-hour completion result or a production-worker benchmark.

## Change

`composeMusicLoopDeblur` now shares a 3,600,000ms monotonic deadline across
body encoding, intro encoding, and final mux/audio encoding. Every pass gets
only the remaining budget. Invalid or over-cap overrides fail before spawning
FFmpeg. The verifier uses and records the same default instead of overriding
it with 15 minutes. No preset, CRF, bitrate, sample rate, fade, duration, or
source-approval policy changes.

This gives the final audio pass more time when preparation is quick, but bounds
the entire compositor more tightly than three independent 45-minute limits.
It leaves ten minutes relative to the task ceiling, not a guaranteed reserve:
earlier pipeline work, later QA, and upload also consume task time. A slow
worker or large 4K source may still exceed the budget. The eight-hour rerun and
full pipeline deadline fit remain unverified; no timeout increase is evidence
of long-form completion.

## Verification

- Mocked-process regression exercises shrinking pass budgets, expiration before
  another spawn, default and short-render budgets, invalid inputs, and unchanged
  codec arguments. It does not claim media quality.
- Real offline FFmpeg packet assembly regression passed for a 60-second master.
- The retained-source verifier completed a fresh 60-second diagnostic export in
  10,129ms: 1,800 frames, 320x176 synthetic visual, exact video/audio/container
  duration, 48kHz stereo, and unchanged source SHA. Source has 6,837,056 frames;
  the two-second seam fold has 6,741,056 frames.
- Master SHA-256:
  `f4ed4b6817a50e3a0ed440d9964b69828fb300e52fa9b125ab8c6d46efdcb455`.
- Local evidence directory:
  `/var/lib/youtube-studio-render/operator/composed-score-assembly-20260921-budget-60/`.
- Independent decoded-audio comparison at 10 seconds passed: correlation
  0.9999917365 and RMS ratio 0.9994014293. This short export does not reach a
  source wrap and therefore does not provide new seam evidence.
- TypeScript, focused ESLint, and the Next production build passed. The local
  Graphify code graph was refreshed. No broad readiness rerun was performed.

No GPU start, paid provider generation, thumbnail test, production deployment,
owner approval, or publishing occurred for this change. The earlier one-hour
1080p proof remains separate evidence; neither it nor this short diagnostic
proves eight-hour completion, channel visual quality, or source suitability.
