# Loop audio boundary oracle

The v2 sample-clock verifier tested body and loop-wrap windows but never the
first or last second. A render with missing delivery fades could therefore
pass its sampled comparisons.

`scripts/verify-yue2-assembly-audio.ts` now emits v3 evidence. It independently
calculates the two-second fade-in and final fade-out in PCM sample space, wraps
reference windows at the exact source-frame boundary, and compares decoded AAC
against that expected signal. It does not apply the production FFmpeg fade
filter to construct its reference. Correlation must be at least 0.98 and RMS
ratio must be within 0.95-1.05. Each decode/probe has a 30-second deadline.

## Rejecting tests

The permanent offline `musicLoopAudioProof.test.ts` creates real 48kHz stereo
PCM and AAC outputs with a 21.25-second source and 64-second delivered audio.
The correct result passes body, wrap and both fade checks, including a source
wrap at 63.75 seconds inside the final fade window. Independently encoded
missing-intro-fade, missing-ending-fade and half-gain results are all rejected
by the intended comparison. The final frozen run passed in 50.7 seconds.

## Retained media checks

- Existing 60-second retained-source diagnostic: three windows pass, including
  both fades. Minimum correlation 0.9999438543; minimum RMS ratio 0.9978093926.
- Existing one-hour 1080p diagnostic: seven windows pass, including middle/late
  wraps and the last second at 3599 seconds. Minimum correlation 0.9999438543;
  RMS ratios range from 0.9978093926 to 0.9995958791.
- New local receipts are named `audio-alignment-v3.json` beside each original
  master. Existing v2 evidence is retained unchanged.

Focused lint and TypeScript pass; the code graph was refreshed. No application
encoding settings changed. These are sparse signal/clock/envelope checks, not
continuous full-file decode, musical approval, perceptual seam approval, or
channel visual qualification. Silent boundary references fail as unprovable
rather than receiving a fabricated alignment score. No thumbnail tests, GPU
starts, provider generation, or production deployment were performed.
