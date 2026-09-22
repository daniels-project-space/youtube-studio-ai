# Long-form video repetition qualification

## Verified result

The retained eight-hour 1080p master passed the final-code packet verifier in
137,142 ms, inside a network-disabled process. The exact receipt is
`test-fixtures/music-composer/assembly/natural-loop-8h-video-packets.json`.
The master is 12,983,194,060 bytes; all 864,000 video packets were inspected.
Its SHA-256 remains
`c413635329f976ab5b3d652e5708766883f4caa00aab231e39f6f2dc622e7d8d`.

The verifier checks every decode/presentation clock, packet duration, keyframe
boundary and repeated body payload. It retains only one 900-packet template.
The 30-second intro and first 30-second body have independently verified IDR
boundaries. Each of the remaining 958 body units matches the reference body.
Full-file hashes before and after scanning, plus file identity/size checks,
bind this evidence to the retained master. A five-minute deadline bounds work.

This deliberately supports only the current renderer's complete 30-second
units, H.264 AVCC, 30fps and 90-second to eight-hour outputs. It is not a
general-purpose media validator. The CLI is the current real caller:

```sh
node --import tsx scripts/verify-music-loop-video-repetition.ts MASTER.mp4 DURATION_SECONDS RECEIPT.json
```

## Avoiding impossible paid reviews

The existing maximum review gap is 90 seconds for long videos. Even optimally
placed samples require at least 319 interior frames for eight hours; the
normal broad/focus budget cannot satisfy that rule. Required `reviewRender`
now rejects mathematically impossible budgets before scene detection, frame
extraction or vision requests. Explicit complete-focus frames count toward
the bound. Existing final coverage checks remain authoritative: passing this
necessary bound does not prove adequate sample placement or quality.

The failure is non-retryable and proposes no visual repair. This prevents
wasted visual-review purchases, not earlier assembly or other QA costs.
Draft review behavior is unchanged.

## Scope and remaining work

Packet equality is not decoded visual quality, audio continuity, channel
personality, owner approval or release authority. No production review
coverage waiver consumes this receipt. A future loop-aware review must bind
the exact-master repetition evidence to reviewed intro/body material and
the release certificate before it can replace repeated visual sampling.
The existing separate audio-alignment receipt remains a non-perceptual test.

Regression coverage includes a real 90-second render through
`composeMusicLoopDeblur`, successful packet qualification, and rejection after
changing a late body packet byte. Synthetic cases cover incomplete/extra
packets, changed clocks, payloads, keyframes and malformed records. Actual
required-review admission tests prove zero decoder/model calls for an
impossible budget. No thumbnail tests or generation are included in this
batch. No GPU start, channel migration or production promotion was performed.
