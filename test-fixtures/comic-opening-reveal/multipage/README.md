# Native two-page comparison

Both retained clips are actual native Python → FFmpeg outputs, **1920×1080 / 30 fps / 639 frames / 21.3 seconds**, with seven panels, two pages, one page turn and seven runtime-placed bubble cues. No image generation, speech synthesis, cloud rendering, storage upload or publishing was performed.

The source is the retained `public/golden/comic/comic3d.jpg` poster, deliberately repeated seven times. Despite its directory name it is legacy context, not a qualified Golden. Its embedded page and speech bubble make it unsuitable as new production artwork; these tests do not prove originality, identity conditioning, story quality or actual narration alignment.

## Results

- Baseline renderer: `b537b219400b638b288171cd48afdd23f5c8746fb98ad4e0282c875cf4e43e31`.
- Candidate renderer: `8df6c002528b030dad6d421f553f8138a081a517d0753e7baecf34aef85df132`, the original isolated `../candidate/renderer.patch`, not the later edge-case revisions.
- Baseline native video: `bfd9e4d40fd6f363638870f640f302c80797ffab6e47460e0a2286d8792d4239`.
- Candidate native video: `6a4050a4d8c8d32c6a45a71d3426dee4f4114040efa17b213a2fc4e0e88c5c35`.
- **All 519 non-opening raw frames match exactly**, including later panels, the page turn and the ending. Raw hashes were taken from the actual RGB bytes sent to the actual encoder, not a reimplementation or a lossy-video similarity score.
- Segment arrays, seven bubble receipts, output dimensions, fps, frame count and duration match.
- The candidate opening has a visible hand and 4.40% source-pixel coverage at frame zero; full source-pixel coverage arrives at frame 50 / 1.6667 seconds. The baseline opening is prepainted.

## Visual review

Main-agent inspection covered **all 44 samples in each contact sheet**: every 0.5 seconds from 0 through 21, plus final frame 638 / 21.2667 seconds (88 samples, maximum gap 0.5 seconds). Frame 90 / 3 seconds was also inspected at full resolution.

The opening now draws; later drawing, page turn and bubbles remain visible. This is **not a channel-quality pass**: the fixture's embedded speech text is cropped by the existing cover-fit layout, blank neighboring boxes occupy substantial space, and drawing/reading original complete-page art still needs its own geometry contract. The test intentionally retains these defects rather than disguising them with different inputs.

## Independent edge findings and next revision

An independent actual-loop/PIL test found the original candidate still skips a visible hand with a sub-frame preroll and starts late with zero preroll. A continuous opening clock and camera resolve those cases in the isolated v3 candidate; 7,362 non-opening synthetic-page frames remain identical across 16 configurations.

More importantly, testing all seven panels at the caller's valid one-second minimum found a **pre-existing completion defect**: later panels end only 92–97.65% drawn because the continuous reveal endpoint falls outside the final sampled panel frame. Equality with the old renderer would conceal that defect. The v4 experiment caps the reveal span to leave an actual completed frame, while preserving ordinary-duration timing. Edge tests and a new native short-duration render must qualify that revision separately; the media above must not be attributed to it.

`evidence.json` files retain the actual temporary input paths, every raw-frame hash, per-frame opening coverage/hand observations, exact source hashes and bubble schedule. The two native videos permit independent re-extraction. No renderer change has been promoted on the strength of this comparison alone.

## Final local runtime — complete reveal plus exact-order tracing

The final local renderer `c0fb69bfa7bd457a0ec0d674aa62428eaa42b7db2c17dd4ff80d87ac7a6d8eb6` combines the tested opening/cutoff repairs with the separately measured exact-order spatial-index stroke calculation. It has now run both native cases through the unchanged real encoder:

- Default 1.7-second preroll, seven 2.3-second panels, 30 fps: **all 639 raw frames and the complete encoded MP4 are byte-identical to the reviewed original candidate**. `final-default-evidence.json` identifies the final source. Reuse `candidate/native.mp4` by its exact hash instead of storing a duplicate video.
- 0.01-second preroll, seven 1.01-second panels, 24 fps: **all 253 raw frames and the encoded MP4 match the separately rendered slower v4 timing candidate**. Final video SHA256 `b44169661979c9dd38d17c3237202ca6617138d581580af9c5c5dde97a834862`, duration 10.541667 seconds, in `final-short/`. The first frame has visible hand pixels and 11.95% source coverage; the opening completes at frame 10 / 0.4167 seconds.
- All 22 short-case contact-sheet samples were visually inspected (0–10.5 seconds at 0.5-second intervals, 24 fps). Final source-media identity binds this review to the final output; the pre-existing fixture/layout limitations above remain explicit.

The permanent production-readiness regression executes actual renderer opening statements, frame functions, schedule and frame loop over **30 cases / 210 panels**, checking full source-pixel coverage on each panel's actual last sampled frame, frame-zero partial art with visible hand pixels, real missing-opening rejection, and 7,311 unchanged ordinary non-opening frames. Frozen legacy source still fails both opening and short-panel requirements. Its tiny synthetic page geometry is distinct from the native media evidence above.

`observe_native.py.txt` preserves the actual diagnostic observer. Run it from the repository root with renderer path, a new temporary output directory, preroll seconds, panel count, optional duration and optional fps. It observes the real encoder input; it does not replace image processing, frame construction or encoding. All 687 direct tests, actual assembly and full local build/typecheck/lint/audit/proof gates passed. Exact deployment verification remains pending; this is not yet a deployed reveal revision or a qualified new channel.
