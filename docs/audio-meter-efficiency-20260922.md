# Bounded full-programme audio meters

## Shared caller change

`measureAudio` feeds final narrated/music QA and Short release admission.
`masterAudioTransparentGain` checks complete source and encoded-result loudness
and true peak. Both now request EBUR128 summaries without per-frame logs and
cap combined captured stdout/stderr at 64 KiB per measurement. The optional
capture limit does not change unrelated FFmpeg commands.

The full audio is still decoded and measured. No sampling, altered gain,
resampling, compressed dynamics, cached measurement or reduced quality gate
replaces that scan. Existing 600-second loudness/peak and 300-second window
timeouts remain unchanged. Window volumedetect output is bounded too.

Overflow kills the child and waits for closure before returning unavailable
evidence. QA receives null on unavailable measurements; existing production
callers already reject that state. Transparent mastering throws before encode
when its source meter is unavailable. Both parsers require the last EBUR128
summary instead of accepting any earlier per-frame `I:` line.

## Independent checks

- The former implementation at `15fd23cb`, loaded directly from Git, accepted
  a synthetic successful process containing only `I: -18.0 LUFS` as a complete
  measurement. The new process-boundary regression rejects that exact case,
  malformed summaries, a broken later summary, nonzero exit and stdout/stderr
  overflow. It verifies closure before resolution and no encode after overflow.
- Real FFmpeg fixtures compare new full-programme and window measurements
  directly with the old commands. A much louder second half changes the full
  reading, preventing a quiet-opening-only measurement from satisfying parity.
- Real fixed-gain mastering still reaches its loudness target and passes an
  independently executed old-command true-peak measurement. Existing admission
  cases still reject encoded overshoot, missing peak evidence and impossible
  source targets without an extra encode or limiter.
- Focused tests, typecheck, lint and production build pass. Selected tests have
  no thumbnail assertions. No thumbnail generation, GPU start, cloud API call,
  live channel change or production promotion was performed.

## Retained eight-hour master

Both actual `measureAudio` implementations scanned the retained 28,800-second,
12,983,194,060-byte 1080p master in network-disabled processes. Both returned
exactly -16.3 LUFS, within the unchanged ten-minute meter deadline.

| Observed quantity | Old `15fd23cb` | New implementation |
| --- | ---: | ---: |
| Node maximum RSS (KiB) | 183176 | 94592 |
| GNU time maximum RSS, including children (KiB) | 183304 | 172320 |
| Elapsed meter time (ms) | 162626 | 178165 |
| Captured stderr bytes | Not instrumented | 1766 |
| Captured stdout bytes | Not instrumented | 0 |

The replacement made exactly one FFmpeg call. Its smaller parent-process
footprint is not a claim that all FFmpeg memory halved. Builds, graph update
and short regression checks overlapped the replacement scan, and filesystem
caches were not controlled; these observations do not establish a runtime or
fleet-billing improvement. No full-source audio was skipped. The receipt is
`test-fixtures/music-composer/assembly/natural-loop-8h-audio-meter.json`.

FFmpeg's official [EBUR128 filter documentation](https://ffmpeg.org/ffmpeg-filters.html#ebur128)
defines the separate frame logging level. Local filter capabilities and real
output were checked; changing that log level does not disable analysis.

## Limits

This improves measurement memory and log handling, not perceptual music quality,
channel fit, musical originality or owner approval. It does not complete the
remaining loop-aware visual review integration or qualify the whole production
eight-hour QA/runtime budget.
