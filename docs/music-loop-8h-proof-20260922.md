# Eight-hour 1080p loop timing proof

The local production compositor completed the previously failing eight-hour
diagnostic in one uninterrupted attempt. It used the retained YuE2 listening
source, native float seam preparation, default `veryfast`/CRF20 video settings,
384k AAC target, and the shared one-hour render deadline. No GPU was started.

## Measured result

- Final video, audio and container duration: exactly 28,800 seconds.
- Video: 1920x1080, H.264, 30fps, 864,000 frames reported by ffprobe.
- Audio: 48kHz stereo AAC; measured stream bitrate approximately 288kb/s under
  the unchanged 384k target, not a reduced encoder setting.
- Assembly wall time: 2,938,670ms (48m58.67s), including output inspection but
  excluding the final whole-file SHA calculation.
- Final size: 12,983,194,060 bytes.
- Master SHA-256:
  `c413635329f976ab5b3d652e5708766883f4caa00aab231e39f6f2dc622e7d8d`.
- Listening source SHA-256 unchanged:
  `74183b3537381622fa9c83a031a9a51a7f9314763e3634c20eb2cdda8a307b93`.
- Source: 6,837,056 frames; two-second seam fold: 6,741,056 frames.

The final mux/audio process itself ran beyond the previous 45-minute production
timeout. This is actual evidence for the deadline repair, not only an
extrapolation from the short AAC throughput probe. The verifier, compositor,
and music helper are unchanged from `b4e36e3a31189cf32626212a12bb8e1c10eb6d32`.

## Independent checks

The v3 audio oracle at `0d3be336071a3fd9bf44f8a19a2331e3d3f0fd7d` passes seven
windows: beginning/middle/late body samples, two loop wraps, fade-in and the
final second at 28,799s. Correlations range from 0.9999438543 to 0.9999942823;
RMS ratios range from 0.9978093926 to 0.9995958791. Substituting the original
unfolded listening source fails at 10 seconds (correlation 0.0229163754).
Separate real-media regressions reject missing fades and incorrect gain.

Native PNG frames at 5s, 14,400s and 28,799.9s were decoded and inspected. They
show the expected synthetic pattern, with progressive intro blur at 5s and
nonblank middle/late pictures. Three consecutive frames from 28,799.8s have
luma means 121.806, 121.813 and 121.792; successive luma differences 2.59302
and 1.90279 establish motion in this sampled late window.

Committed exact machine receipts:

- `test-fixtures/music-composer/assembly/natural-loop-8h-1080p.json`
- `test-fixtures/music-composer/assembly/natural-loop-8h-audio-alignment.json`

Local master, source fold, inspection, receipts, sampled PNGs and late-frame
signal statistics are retained under:
`/var/lib/youtube-studio-render/operator/composed-score-assembly-20260921-budget-28800-1080/`.

## Qualification boundary

This closes the local eight-hour default-compositor timing gap at 1080p. The
picture is a 320x176 synthetic timing pattern scaled to 1080p, not real channel
artwork or a native-resolution quality reference. The sampled checks are not
a complete eight-hour decode, musical approval, perceptual seam approval, 4K
qualification, or proof of every alternate intro/render mode.

This was not a live owner-approved pipeline execution, production deployment,
storage upload or YouTube delivery. Final QA and transfer time also need to fit
the production task/storage envelope; the measured 13GB artifact makes those
limits important to verify. No thumbnail module or generation was involved.
Existing channel pipelines and their baseline outputs remain unchanged.
