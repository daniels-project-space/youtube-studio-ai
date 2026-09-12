# Native opening-reveal baseline

The unchanged `scripts/mc_page_render.py` rendered `baseline.mp4` at **1920×1080, 30 fps, 392 frames / 13.066667 seconds** on 12 September 2026. SHA-256: `20058b361f39626695bd7e379acd4a8a9f36a2b708f1b5017ed842d9b1137d9a`. The renderer hash and source hash are in `evidence.json`.

**This is mechanical reveal evidence, not a qualified comic.** All four inputs deliberately repeat the existing `src/assets/whiteboard/history_ref.png`. No art was generated, no narration synthesized, and no channel run, visual-model review or paid provider was invoked. Source-image text is pre-existing, not newly composited thumbnail text. This fixture cannot prove story originality, identity continuity, character conditioning, comic style or audio alignment.

Main-agent visual inspection covered all 20 samples in `contact-sheet.png`, row-major order:

`0, 0.3, 1.0, 1.8, 2.5, 3.4, 4.2, 4.7, 5.1, 5.9, 6.5, 7.1, 7.5, 8.2, 8.8, 9.4, 9.8, 10.5, 11.4, 12.8` seconds.

- **Confirmed blocker:** the complete first image is present from time zero and stays prepainted through its entire 1.7–4.0-second panel interval. There is no opening hand reveal in the inspected samples; the source explicitly bypasses it. Later panels show partial masks and a hand at 4.7/5.1, 7.1/7.5 and 9.4/9.8 seconds. This violates the requested all-panels-drawn grammar.
- **Repair target:** reveal the opening with the hand from the start, keep useful visible artwork arriving promptly, preserve its narration start and the downstream schedule. Do not restore a long empty-template opener or fully expose later panels early.
- **Further inspection needed:** this short single-page fixture does not test page turns, speech bubbles, real narration, long/dense content or mobile legibility. It is a baseline for the next reveal change, not evidence that change has been implemented.

Reproduce by copying that existing source to `panel_0.png` through `panel_3.png` inside a new temporary directory, copying `timeline.json` there, then running the actual native command:

```sh
python3 scripts/mc_page_render.py <temp>/timeline.json <temp> <temp>/baseline.mp4 src/assets/whiteboard/hand.png
```

`evidence.json` records the original temporary paths and frame hashes. The retained video permits re-extraction at those times; the contact sheet holds the reviewed samples. Native codec/preset/CRF, geometry, timing, masks and camera were not changed for this baseline. The recorded `visualVerdict: unreviewed` was emitted before inspection; this README supplies the subsequent human-facing **repair** verdict rather than rewriting the original receipt.

## Isolated candidate — not promoted

`candidate/renderer.patch` is a tested experiment against that frozen renderer, **not an applied production change**. The zero-context patch passes `git apply --check --unidiff-zero -p0`; it is retained without applying it to the runtime. It removes the opening prepaint and uses one mask/hand helper in both the intro and later panels. The intro camera moves toward the first art box; its hand starts on frame zero and completes the opening during the existing 1.7-second preroll. Narration timing and total duration are unchanged. This applies the animation guidance's precomputed path/timing and matched camera handoff principles without replacing the native pipeline with HyperFrames.

The candidate renderer SHA-256 is `8df6c002528b030dad6d421f553f8138a081a517d0753e7baecf34aef85df132`. Its native output is retained in `candidate/baseline.mp4` using the diagnostic runner's original filename; the candidate receipt distinguishes its source. All 20 matching timestamps were inspected. The first panel now visibly draws at 0, 0.3 and 1.0 seconds, settles before the 1.8-second sample, and later panels still visibly draw. Both outputs have 392 frames, 1920×1080 resolution, 30 fps and 13.066667 seconds; no provider spend or new raster generation occurred.

**Still held for repair/qualification:** the hand is partly clipped at the opening's right edge, and the wide first panel still leaves empty later boxes in view. Test a better source-aware opening frame and hand clearance, zero/short preroll, real comic art without this fixture's embedded whiteboard frame, page turns, speech bubbles and complete narrated output before adopting it. Source pixel preservation and actual full-frame/cue parity outside the changed opening still need an independent comparison. This experiment does not close items 154–157 or establish a new Golden example.
