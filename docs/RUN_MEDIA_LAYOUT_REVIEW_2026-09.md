# Run media layout — 9 September 2026

## Confirmed problem

The actual production run `js74tws8jvgzc4tvat86htgv4h88ny68` places its captions in an empty media-preview card stretched to the video's height. A read-only browser regression against production `134f9e7` failed with `captions must not stretch to the video height`. Measured desktop geometry: captions and video both 576.23 px high, video 540.03 px wide; the media section is 999.16 px high. `/tmp/ysa-run-media-production-baseline.log` preserves the measurement and failure; screenshots are in `/tmp/ysa-run-media-layout-HZCfKO/`.

## Design and actual wiring

- Selected video first in visual, reading and keyboard order. Its label moves below the footage.
- Current accepted thumbnail beside the video; source fidelity and the separate collapsed historical thumbnails are unchanged.
- Captions/documents are compact file actions with real signed source links, metadata and keyboard-accessible storage disclosure. No fake image/video preview for a text file.
- Audio controls retain native playback and get a dark presentation without a duplicate heading. Supporting media stays in a bounded grid below the primary output.
- Larger, wrapping labels and source controls; smaller metadata footer; inactive explanatory filler removed. Narrow/enlarged-text layouts stack metadata rather than squeeze it into unreadable columns.

The existing combined media subscription, selected-master rules, 12-item initial cap, lazy historical signing, current-thumbnail selection and legacy evidence status are preserved. No query, signing or publishing authorization was broadened. This legacy failed run remains legacy and failed; a “selected master” is not a quality approval.

## Review passes and limits

1. Initial reorganization: real-component tests passed. Local screenshots with live production viewer data showed captions at 167.22 px; real video, two audio tracks and SRT source loaded. Evidence `/tmp/ysa-run-media-layout-nM32yy/`.
2. Metadata/footer and native-audio refinement: captions 130.28 px, video width 692.25 px and overall section 887.39 px. At this pass the existing section becomes about 11% shorter while the video is 28% wider and the captions card is 77% shorter. Evidence `/tmp/ysa-run-media-layout-kFViQy/`. Enlarged-text screenshots exposed squeezed metadata; this was not accepted as final.
3. Responsive refinement: one-column metadata/counts at narrow effective widths; thumbnail loading is explicitly awaited after scrolling the lazy image into view. Desktop/mobile/200% browser checks pass with no media-section horizontal clipping. Real SRT readback passes; storage disclosure works by keyboard; exactly one combined media subscription and no restored legacy asset subscriptions. Evidence `/tmp/ysa-run-media-layout-WMZVXf/`.
4. Final local simplification removes inactive filler and the duplicate “Output” label. Desktop section height is 869.27 px (about 13% shorter than production baseline, with the wider video retained). Desktop and mobile screenshots inspected at `/tmp/ysa-run-media-layout-t8QWDc/`.
5. Normal mobile retains two-column counts; enlarged text gets single-column reflow. A final browser pass additionally started real muted playback on all three media elements at desktop/mobile/200% text, retrieved actual SRT text, and exercised keyboard disclosure. `/tmp/ysa-run-media-playback-checked.log` records success with one combined subscription and no page errors. Full isolated release validation and deployment remain pending. These focused iterations do not complete the requested five whole-page/module review dimensions.

Local checks use an isolated checkout and the actual app components with the deployed public viewer-token and asset-signing endpoints. No owner token, fabricated record or CSS injection is used, except a 200% root-font setting to test accessibility. The original local dev server lacks its signing key and failed to load; it was not restarted or used as success evidence. Production-mode proof has no endpoint replacement. Current images, loaded media metadata, brief real playback and caption text were checked; this is not full-length playback, generated-video quality, OAuth lifecycle or a new thumbnail proof. The first stronger image-ready check timed out because its lazy image was outside the viewport; the proof now scrolls it into view before waiting. An initial playback helper failed browser serialization (`__name`); the corrected browser-native callback was rerun successfully, not counted as an application fix.

The full-page screenshots also preserve the existing fixed app navigation. Its enlarged-text crowding remains a wider shell issue, not resolved by this media-only pass. Other pages/subpanels and all five required review dimensions remain in the 151-item goal backlog. UI source is not yet a production release at this checkpoint.

Reproduction: `UI_PROOF_BASE=http://127.0.0.1:3312 npx tsx scripts/run-media-layout-browser-proof.mts` for the isolated dev build; omit the environment variable for the unmodified production alias. Component tests: `src/components/RunMediaWorkbench.test.tsx` and `src/components/MediaPreview.test.tsx`.

## Current release gate / continuation

Clean UI candidate: `1ded1d6686134d22c2058d1a51e2d3b5891f11e3`, branch `checkpoint/run-media-layout-contract-20260909`, based on the already-pushed backend `134f9e7` through initial UI checkpoint `399a6cc`. It excludes all held title-generation/Salad changes. Full validation runs in `/tmp/ysa-media-release-XXTt6b/repo`: logs `/tmp/ysa-media-release-full-tests.log`, `/tmp/ysa-media-release-typecheck.log`, `/tmp/ysa-media-release-lint.log`, `/tmp/ysa-media-release-build.log`, `/tmp/ysa-media-release-audits.log`, `/tmp/ysa-media-release-defect-proof.log`. Typecheck and unchanged audits/proofs have completed; the full test/build chain is still running. Do not publish until those complete successfully, then verify both provider releases and the exact production alias and rerun the production-mode browser proof.

Held combined work is safely checkpointed as `eea239a5ad7e0bfd095bcb75a587c8ec5a8292ab` on `checkpoint/run-media-layout-with-held-work-20260909`; the original main checkout HEAD/index were not moved. The local visual server at port 3312 belongs to this work in `/tmp/ysa-run-media-ui-M9cMl8/repo`; the unrelated existing port-3010 dev server was left alone. The backend release's cloud CI is separately `34342445181`; `/tmp/ysa-retention-authority-cloud-watch.log` tracks it. Its completion must not be confused with approval/deployment of this UI candidate.
