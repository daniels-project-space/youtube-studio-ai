# Full390 native stat study — do not adopt the thread cap

12 September 2026. Decision-ready diagnostic for goal item158. **No application source, encoder-quality setting, provider, deployment or production behavior changed.** The original90-frame exact-identity experiment remains separately preserved and rejected at `/tmp/insert-binding-encoder-threads-20260912/README.md`.

## Decision

Do not apply the two-thread cap to production from this evidence. On one real retained stat fixture, it improves average source fidelity and uses less local CPU work, but some individual frames regress and the full-length wall-time difference is only about1.8%—smaller than the prior unchanged-run timing variation. This is not a general same-or-better-quality qualification, cloud-cost saving or completed assembly validation.

## Matched native input and timing

Both new390-frame encodes used the exact same preserved original browser PNGs, all SHA-verified. No browser pass, text, font, motion, palette, resolution or frame timing was regenerated. Four current renderer sources remain byte-unchanged from correctness baseline688e9ba; current capture HEAD9cbab32 and all hashes are in `input-manifest.json`.

The old completed retry could not serve as a matched baseline because its browser-PNG manifest was not retained. Rather than infer equality, one new unchanged-auto baseline was encoded from the same390 originals after the authorized two-thread candidate finished. The native binary is pinned Remotion4.0.506 FFmpeg n7.1; VP8, CRF9, yuva420p, auto-alt-ref0 and defaults were unchanged. Exact arguments and GNU time receipts are adjacent.

| Run | Wall seconds | User+system CPU seconds | Peak RSS KiB | Final bytes |
|---|---:|---:|---:|---:|
| unchanged auto, native silence/mux included | 160.102 | 1052.99 | 375296 | 587454 |
| 2-thread VP8 encoder-only | 157.165 | 312.68 | 371200 | 526179 |
| 2-thread native copy mux with stream metadata restored | +0.151 | not independently timed | not independently timed | 532222 |

These are local stitcher measurements, not actual Trigger billing. The two-thread encode omitted the native silent-audio work initially; the0.151-second native mux restores it separately without re-encoding video. The combined wall difference is about1.7%. Native copy timing is not a video-encoding speedup. The generic before/after decode JSON includes inapplicable elapsed-difference fields; do not use them as performance evidence.

## Full source fidelity: improved averages, real regressions

All390 decoded frames were compared with the actual original PNGs: 808,704,000 samples per R/G/B/A channel. Exact integer RGBA-over-black/white composites were also measured. `source-fidelity.json` records per-channel counts, maximum errors, mean absolute errors, RMSE, PSNR and per-frame measurements. The older missing-tag native-copy video used for those metrics is bound to the metadata-restored final copy by390 exact RGBA/alpha frame hashes in `source-fidelity-mux-binding.json`; no inference from a screenshot is involved.

| Fidelity against original PNGs | auto | 2 threads |
|---|---:|---:|
| Alpha RMSE /255 | 1.677 | 1.432 |
| Black-composite RGB PSNR | 48.11dB | 50.39dB |
| White-composite RGB PSNR | 44.10dB | 44.90dB |

Phase averages improve in entry, hold and exit, but they conceal individual regressions: the candidate is worse on86/390 black-composite frames and89/390 white-composite frames. White error at frame15 increases RMSE1.499→5.064/255. Black error at frame107 increases0.474→1.609. Candidate alpha maximum error against source is127 versus baseline123. These counterexamples prevent a blanket quality-pass claim.

Nine sampled native frames were independently inspected at0,15,23,66,107,262,300,377,389, including the worst entry/hold regressions and exit fade. See `full-native-visuals-static/`: columns original/auto/2, rows black/white. Native1920×1080 extracted PNGs remain in `full-native-visuals/`. Candidate frame23 is visibly cleaner around the text, but frame15 has a changed background alpha level and text/block contours; the hold regressions are more subtle. Both encodes retain loss from the PNG source. Final fading/text state is retained; this is not a temporal playback or production final-assembly pass.

An apparent omitted source tile in the viewing presentation was investigated and disproven: saved repeated source columns are exactly equal and contain text in both FFmpeg and deterministic-static sheets. The initial FFmpeg scheduling hypothesis is withdrawn. `presentation-check.json` retains the direct pixel evidence; no source/render defect is inferred.

## Actual native audio/mux contract and preserved failures

The production renderer's390 per-frame empty-media asset objects cause installed Remotion to generate native silent Opus. Using an empty assets array in the first encoder-only experiment skipped this branch. Therefore those files were honestly labeled visual-encoder-only, not complete renderer outputs.

For the full study, the baseline uses the actual390 empty-frame records and native silence→Opus branch. The completed candidate is passed through Remotion's real `preEncodedFileLocation` copy path, also with390 empty-frame records. That default copy path strips stream metadata under `-map_metadata -1`, removing the actual Matroska Video/AlphaMode element. The failed output and failing contract are retained as `candidate-muxed-*`; its alpha payload still decodes through explicit libvpx, but its metadata contract is not accepted.

A new diagnostic copy mux preserves only the validated input-video stream metadata with `-map_metadata:s:v:0 0:s:v:0`. Both video and native audio are copied, never re-encoded. `candidate-muxed-alpha-contract-v2.json` passes all11 checks: physical EBML AlphaMode=1, equivalent video/audio metadata, all390 video packet timestamps, all651 audio packet payloads/timestamps,624000 silent PCM samples/channel at48kHz stereo, and equal13.008-second final containers. The original and final candidate have identical390 RGBA and alpha frame hashes. `copy-mux-video-proof.json` consolidates that proof.

FFprobe writes the restored metadata key as uppercase `ALPHA_MODE`; initial lowercase-only JSON assertions failed. Those failures remain. The corrected diagnostic requires both case-insensitive metadata and independent physical EBML Video/AlphaMode parsing, not a weakened alpha gate. Baseline/original/restored physical flags are1; the unmodified copy's flag is absent.

## Final artifacts and open limits

- Matched baseline: `auto-baseline-390.webm`, SHA `c4567b35087a0bfca14c1197ff6d46c8c7ae2ada61d6261ca9adacde395d9bcd`.
- Native final candidate: `candidate-muxed-alpha-390.webm`, SHA `b783dafe1201bd8addab2c4c23005f05769184ba205266f7fc4f6f2187c3d674`.
- Source-fidelity JSON SHA `8367f72c60d9b70cfb36adfc7fe383c79995c57deec111d4d41ddeff36279357`.
- Original encoder-only candidate, failed metadata-copy output, initial strict-case failures and original90 results all remain untouched as distinct evidence.
- All native encoder and diagnostic handles finished. No provider calls, global test suite, application edits, graph update or deployment were performed by this subtask.

Still unqualified: actual final production assembly, temporal visual playback, other insert kinds/fonts/palettes/durations and real Trigger large-1x CPU quota/performance. The copy-mux metadata issue concerns this diagnostic reuse path, not the current non-parallel VP8 production encoder path. No new production fix is claimed. A future quality study needs frame-level/temporal acceptance across a representative corpus, not merely a better average PSNR.

The [FFmpeg n7.1 Matroska encoder](https://raw.githubusercontent.com/FFmpeg/FFmpeg/n7.1/libavformat/matroskaenc.c) writes the physical AlphaMode flag from alpha pixel format or metadata; [its decoder](https://raw.githubusercontent.com/FFmpeg/FFmpeg/n7.1/libavformat/matroskadec.c) exposes that flag as metadata. The byte-level proof here, rather than documentation alone, verifies the restored container. The footage-review workflow kept the candidate unapproved despite aggregate improvements.


## Retained numeric receipts

Selected input, source-fidelity and native-copy proof records are saved under `docs/evidence/insert-encoder-full-20260912/`. Original WebM/PNG files remain at `/tmp/insert-binding-encoder-quality-20260912`; these numeric receipts do not constitute a portable copy of every source pixel. Main review separately inspected native comparison sheets 15 and 107 and kept the optimization unapproved.

