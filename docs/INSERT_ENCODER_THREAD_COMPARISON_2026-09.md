# Native insert encoder thread comparison — rejected for exact-output preservation

12 September 2026. No application source, quality flag, provider, deployment or assembly code changed. This is a bounded local experiment for goal item 158, not a qualified optimization.

## Binding and method

- Repository HEAD at capture: `9cbab32b161a067de80afcacec6db25129459bba`. The four render source files are byte-unchanged from the accepted `688e9ba` baseline. Full source hashes, native binary hash, dependency version and all 390 PNG hashes are in `input-manifest.json`.
- All 390 retained stat browser PNGs were SHA-256 checked against the preserved original directory. They have 93 unique PNG hashes but 386 consecutive runs; nonconsecutive or merely near-identical stat frames cannot be collapsed.
- Encode the identical first 90 PNGs through actual Remotion 4.0.506 `stitchFramesToVideo()`, which is the native encoder stage used by `renderDataInsert()`. VP8 does not use Remotion's parallel pre-stitcher in this installed version.
- Exact generated arguments are recorded in each `<mode>-90.json`. Only candidate output `-threads:v 4` or `-threads:v 2` is inserted. Resolution 1920×1080, 30fps, `libvpx`, `yuva420p`, `auto-alt-ref=0`, CRF9 and all other codec defaults remain unchanged. Browser rendering, fonts and frame inputs are not regenerated.
- Sequential runs: unchanged auto, 4 threads, 2 threads, unchanged auto repeat. Only one encoder ran at a time. The repeat checks deterministic displayed output and exposes timing variance.
- Native encoding uses the bundled Remotion FFmpeg n7.1. Its reduced build has neither framehash nor rawvideo muxers, so the exact decoder comparison uses the same installed `/usr/bin/ffmpeg` with explicit `-c:v libvpx` for every WebM. It verifies nonopaque and fully transparent pixels really survive decoding. Every decoded RGBA frame and separate alpha plane is SHA-256 hashed; `ffprobe` packet PTS/duration is checked independently.

## Results

| Mode | Stitcher wall seconds | GNU time user+system CPU seconds | Peak RSS KiB | Bytes | Exact decoded RGBA/alpha vs auto |
|---|---:|---:|---:|---:|---|
| auto | 50.202 | 331.31 | 375108 | 196082 | baseline |
| 4 | 23.963 | 89.47 | 371964 | 192375 | FAIL: 83/90 frames differ |
| 2 | 29.016 | 57.84 | 370812 | 163621 | FAIL: 83/90 frames differ |
| auto repeat | 39.601 | 259.30 | 374520 | 196082 | PASS: all 90 exactly equal |

Wall measures the actual stitcher API; GNU time includes the small Node/setup overhead plus its children. All four outputs have 90 frames, 3.000 seconds and equal presentation timing. The two auto containers have different file hashes but all decoded pixels, alpha and timestamps match. Baseline timing variance is material: the repeated auto run is 21.1% faster without a changed codec option. No benchmark-based cloud saving is claimed.

Both thread caps differ from baseline on frames 7–89. For each RGBA channel the comparison contains 186,624,000 samples:

| Difference vs auto | Alpha differing samples | Alpha maximum /255 | Alpha mean absolute difference | Alpha RMSE | White-composite RGB PSNR |
|---|---:|---:|---:|---:|---:|
| 4 threads | 21442266 | 109 | 0.2002 | 1.1202 | 45.94 dB |
| 2 threads | 90818434 | 126 | 1.1282 | 2.6130 | 40.13 dB |

These are not solely ±1 rounding differences. Detailed R/G/B/A counts, maxima, means, squares, RMSE and PSNR, plus each frame's metrics, are retained in `source-fidelity.json`.

## Source fidelity is distinct from output identity

Against the actual original PNGs, the two-thread output is more faithful on this one clip: alpha RMSE 2.351 vs auto's 2.933; neutral black/white composite RGB PSNR 46.38/41.00 dB vs auto's 43.59/39.98 dB. Four threads is slightly worse: alpha RMSE 2.948 and black/white 43.42/39.93 dB. This does not establish universal quality, production speed or an authorization to replace the current output. Both candidates remain rejected under the exact-pixel contract.

The sampled diagnostic sheets in `visual-pairs/` show the highest two-thread differences at frames 10, 18 and 23. `visual-four-thread/` shows the highest four-thread differences at frames 46 and 47. Columns are **original PNG / auto / 4 / 2**, rows are **black / white** backgrounds. Matching full-resolution decoded PNGs and their SHA receipts are adjacent. Sheets 18, 23 and 47 were visually inspected: the unchanged auto and 4-thread variants show low-opacity block/streak patterns around the text on white that are absent from the original PNG. The 2-thread variant looks cleaner in these particular samples. These are diagnostic composites, not production finishing output or a quality pass.

## Limits and next decision

- No full 390-frame candidate or production assembly comparison was run because exact parity already failed at the bounded 90-frame gate.
- Only the retained big-stat entry window was encoded. No other insert kind, exit fade, long hold, text/font variant, Trigger machine or channel is thereby qualified.
- The local cgroup reports no quota and allowed CPUs 0–127; this is not the actual Trigger `runPipelineTask` `large-1x` CPU allocation. Inserts do not use the GPU render-block path. Target cgroup/quota must be measured before proposing production savings.
- The axis's previous 294-frame identical hold remains an untested separate possibility. Its original PNG directory was unavailable. VFR encoding can change predictive codec output and assembly seeking/timing; exact source PNG identity alone is insufficient.
- The current scope permits no source changes. If exact decoded pixels must be preserved, retain the existing renderer. Any study accepting a different but demonstrably more faithful codec output requires a separately agreed quality contract and a wider corpus plus actual assembly validation.

## Reproducibility files

The source/input manifest, quantitative fidelity results and four native encode receipts are retained under [docs/evidence/insert-encoder-threads-20260912](evidence/insert-encoder-threads-20260912/input-manifest.json). The original local media and scripts listed below remain available for the ongoing full-length study; these numeric receipts alone are not a portable copy of all source pixels.

The isolated scripts were created with `apply_patch`, outside application source:

- `/tmp/insert-encoder-thread-experiment-20260912.cjs` — actual Remotion stitcher and source/input binding; SHA `72fcc654966ff35fe21d78f5b5a55ff92706746a5ee0e7c6825b7e9884fb9557`.
- `/tmp/insert-encoder-thread-compare-20260912.cjs` — exact RGBA/alpha and timing comparison; SHA `faa60f62ddcee869089abad331da96b8812fd36f43b4bd9b3cf9bff1c7a31f38`.
- `/tmp/insert-encoder-thread-fidelity-20260912.py` — original PNG fidelity, quantitative diagnostics only; SHA `8fedde51b846e3a424ad2793e498821680de7f53ff1e1b4209c62e3499542f00`.
- `/tmp/insert-encoder-thread-visuals-20260912.cjs` — native PNG extraction and diagnostic neutral composites; SHA `c6f8f4c63aa7ab2765ed268a6a3396d9314b08c0695c075236175baefd1db96f`.

Input-manifest file SHA: `59b34b005e455092fa17a3b65aa95ca6380a2932489ddc5513bc6f3c3af77ecc`.
Source-fidelity JSON SHA: `cb6b539bbefce200df33ce6822b95de456e4a574d99fb0a2a803e2fd5c718221`.

## Primary references

[Remotion's renderer API](https://www.remotion.dev/docs/renderer/render-media) distinguishes the override's encoder/stitcher stages; the actual installed source determines the VP8 path here. [FFmpeg's codec documentation](https://ffmpeg.org/ffmpeg-codecs.html#libvpx) documents threading and the quality/speed nature of `cpu-used`; no `cpu-used` change was made. [FFmpeg n7.1's libvpx wrapper](https://raw.githubusercontent.com/FFmpeg/FFmpeg/n7.1/libavcodec/libvpxenc.c) maps the selected thread count into the encoder configuration. The experiment, not the documentation, establishes the observed exact-pixel failure.

## Subsequent study — not a changed verdict

The main agent separately inspected the frame 18 and 23 black/white sheets and confirmed the visible block/streak difference. A full-length, source-fidelity study is now underway: one two-thread 390-frame candidate and one unchanged-auto baseline use the exact same preserved original PNGs. The completed historical retry cannot be reused as its pixel baseline because its browser PNGs have no retained full hash binding.

The initial stitcher-only experiment has no audio. The actual full module's per-frame empty asset records cause Remotion to add silent Opus; the complete study must preserve that real audio/mux path and compare its streams/duration, not present encoder-only output as the full module. The candidate's video may be reused through Remotion's own pre-encoded video-copy path if decoded video/alpha/timestamps are proven unchanged by muxing. No application codec/thread setting has changed. Multiple insert types and actual final assembly remain required before production adoption.
