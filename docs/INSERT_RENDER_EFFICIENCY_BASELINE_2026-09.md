# Insert rendering — efficiency baseline, not a speed claim

12 September 2026. Follow-up to backlog items 61, 63, 76 and 158. Runtime `688e9ba` is frozen while its correctness release is verified. No codec, quality setting, motion, resolution, frame rate or provider has been changed for this investigation.

## Observed bottleneck

The actual `renderDataInsert` caller emits 1920×1080, 30fps, PNG-backed VP8 alpha clips through Remotion 4.0.506. Native command inspection confirms CRF9 and `yuva420p` with alternate reference frames disabled. The bundled libvpx encoder's defaults are `deadline=good` and `cpu-used=1`.

Both 13-second diagnostic clips produced their 390 browser PNG frames well before native encoding finished: approximately 44 seconds for the stat and 108 seconds for the irregular-axis chart. Native encoding remained CPU-active beyond 24 and 15 minutes under competing local work. At one observation, 60-second CPU pressure was approximately 74%; a stat worker had accumulated 538 seconds running and 853 seconds runnable but waiting. Both encoder processes had 48 threads, many sleeping. Thread count alone does not prove saturation or an optimal cap.

The irregular-axis native clip completed and its 390 frames were decoded and sampled. The first stat attempt was interrupted (terminal exit 143, incomplete 124-frame output) and is not a completed performance baseline. Its original 390 PNGs were preserved byte-for-byte in `/tmp/insert-binding-stat-original-frames-20260912`. The single unchanged retry completed: accepted-input write at 12:17:49.064 UTC, native WebM final modification at 12:25:17.554, evidence write at 12:25:20.280. These local file milestones bound approximately 448.5 seconds through render output and 451.2 seconds through review extraction. They are not isolated encoder timings or provider billing. The completed stat contains 390 frames / 13.008 seconds / 615,459 bytes with alpha; all nine samples passed independent visual inspection.

## Concrete alternatives

The independent read-only SHA-256 scan found:

| Original input sequence | Frames | Unique PNG hashes | Consecutive runs |
|---|---:|---:|---:|
| Stat | 390 | 93 | 386 |
| Irregular-axis chart | 390 | 91 | 91 |

Axis frames 67–360 inclusive are identical: 294 frames, or 9.8 seconds. A run-length hold representation would reduce its encoded inputs from 390 to 91 (76.7% fewer), **not a proven 76.7% time or cost saving**. Different PNG hashes alone would not prove different displayed pixels. A separate native RGBA decode of retained stat frames 120 and 121 confirms a real but tiny difference: 6 of 2,073,600 pixels differ, maximum channel difference 10/255, total absolute channel difference 127. Their decoded SHA-256 values are `1e07763e6174b27a78e0a0d50b82bae18f6d1a3eb9b8545f455e297ee2dea3a3` and `d507570e7f32aab2ef77878b9016214a1e3a240a9f9192b74d4f41321510c69a`. The cause is not yet established. Do not silently merge nearly identical frames or assume one static hold.

Two bounded comparisons are justified after the release renders finish:

- Compare native automatic threading against explicit output thread budgets 4 and 2 on the same 90-frame entry window. Keep every quality and media setting fixed. Measure wall time, CPU time, memory and decoded color/alpha; only qualify a winning candidate on the full sequence.
- Separately test run-length holds for the axis. Preserve every changing input and its exact duration. Validate final-frame duration, seek behavior and the production assembly path before claiming equivalence. Changing prediction and rate-control history can change decoded pixels even when source PNGs match.

## Research boundaries and acceptance

[FFmpeg documents `cpu-used`](https://ffmpeg.org/ffmpeg-codecs.html#libvpx) as a quality/speed tradeoff; increasing it is not an authorized quality-preserving fix. Explicitly adding the already-selected `good` deadline cannot explain an improvement. [Remotion's render API](https://www.remotion.dev/docs/renderer/render-media) distinguishes browser concurrency, rendered frames and encoded frames, so browser-worker changes must not be presented as native encoder-thread control. [FFmpeg's concat durations](https://ffmpeg.org/ffmpeg-formats.html#concat) can express held frames, but do not by themselves prove output timing or assembly compatibility.

Acceptance requires the same 390 displayed frames, preserved alpha and presentation timing, and actual final assembly over contrasting backgrounds. A matching CRF or a similar contact sheet is insufficient. No speedup, billing saving, VFR compatibility or production optimization is claimed yet. Do not weaken the current release gates to pursue this follow-up.
