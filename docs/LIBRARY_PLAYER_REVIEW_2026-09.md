# Library saved-master playback review — 2026-09-09

## Scope and provenance

The proof bundles the actual `Lightbox`, `VideoPlayer`, `SignedVideoPlayer`, asset-URL hook/cache, and their production component CSS. Graph-based caller tracing confirmed that Library and channel Library use this shared Lightbox path. Only Convex data delivery, signing responses, and local media HTTP transport are fixtures. A small React host owns ordinary modal/index props; it does not implement player or recovery logic.

The explicitly supplied retained fixture is `/tmp/assembly-smoke-frkUeC/bk_smoke_2_loudnorm.mp4`, SHA-256 `de7b07e460ee9c5e3fd4f5f7ad57e1b78a03aaaf7543ea9c21d2f06b1399d15c`. Chromium measures its duration as `31.021995` seconds. No new render, remote-media download, production data mutation, publishing, or paid provider call is involved.

Run from the repository root:

```bash
PREVIEW_TEST_VIDEO=/tmp/assembly-smoke-frkUeC/bk_smoke_2_loudnorm.mp4 npx --no-install tsx scripts/library-player-browser-proof.mts
```

`PROOF_CASE` selects one named case. `VIDEO_PLAYER_SOURCE_REF=9795d2a PROOF_CASE=precedence` bundles that revision's exact player source in memory via read-only `git show`; no checkout or protected worktree is modified. That oracle replaces only VideoPlayer, not the entire historical application.

## Failing-before evidence

- Saved-key plus YouTube ID: `/tmp/ysa-library-player-proof-nx3yJK/results.json`. Both desktop and phone selected one iframe, zero native videos, and zero video signing requests with the historical player. The saved-master precedence assertion failed on both.
- Native ArrowRight interception: `/tmp/ysa-library-player-proof-ldPmiz/results.json`. Both profiles started at index 0, native `a.mp4` at 8 seconds, `readyState=4`, paused, and VIDEO focused. ArrowRight changed selection to index 1 / `b.mp4` at zero, replaced the native element, and left BODY focused outside the dialog. After the main agent's Lightbox fix, the unchanged oracle passed in `/tmp/ysa-library-player-proof-mQjy87/results.json`.
- Initial-error clipping at 200% root font: `/tmp/ysa-library-player-proof-aSbKUX/results.json`. At 390px, the frame was 249.219×140.172px and the error text/retry exceeded its top and bottom. At 320px, the frame was 179.219×100.797px; Retry was visibly clipped out. The explicit loading message fit both sizes.
- Native-error clipping at 200% root font: `/tmp/ysa-library-player-proof-fVnoru/results.json`. The real recovery notice measured 257.969px high inside a 140.172px frame at 390px, and 380.359px inside a 100.797px frame at 320px. Retry lay outside the frame. Screenshots were independently inspected, not inferred from rectangles alone.
- Follow-on navigation/text collision after making the error panel intrinsic-height: `/tmp/ysa-library-player-proof-LioGve/results.json`. Gallery arrows were still positioned at 50% of the entire expanded player wrapper. Rendered text-line rectangles overlapped each arrow by 76.641px² at 390px and approximately 336px² at 320px. The notice and Retry fit their frame, but the arrows visibly covered text. The regression checks actual `Range.getClientRects()` for text, not the padded notice rectangle.

## Native recovery and modal coverage

The 20 baseline desktop/phone cases passed in `/tmp/ysa-library-player-proof-ChFnM2/results.json`. Viewports were 1280×900 and 390×844. The full proof also includes four large-root-font cases at 390px and 320px; those are separate from the baseline count above.

- Saved master wins when both keys exist; the actual native clip decodes at 15 seconds with `readyState=4`, paused, and no media error. YouTube remains an explicit external link.
- Initial signing failure and native media failure expose real manual Retry. Each retry makes one new signing request, preserves the modal, and keeps focus inside while the temporary button disappears. Loading is not mislabeled as missing media.
- An expired, unbuffered native seek receives real HTTP 403 Range responses. The same video DOM element is renewed with one `cache:no-store` signing request and restored at 25 seconds, preserving paused/playing intent, volume 0.4, mute, and rate 1.25.
- Same-key and different-key sibling players retain source, position, and paused state. Player-local renewal does not replace the shared cache receipt: reopening independently re-signs the expired cache, while four ordinary open/close cycles reuse a valid receipt.
- A delayed initial signature cannot replace a newly selected master; its result is reusable only when its own key is selected again. Navigating away during renewal cancels the old recovery without changing the new source.
- Native ArrowRight remains on the current element/source and advances native playback from 8 to 8.310219 seconds. Once focus belongs to the gallery, right/left still select the next/previous item.
- Missing-source and YouTube-only branches remain distinct. Both Tab boundaries, Escape, opener-focus return, and restoration of an existing nonempty body-overflow value are checked.

### Bounded native-spinner observation

Chromium could briefly retain its native loading spinner after the recovered paused element already reported decoded media. `/tmp/ysa-library-player-proof-9l9w20/results.json` records native events and phase mutations on both profiles. While `seeking=true`, loaded-data/can-play observations remained in `recovering`; transition to `ready` was observed with `readyState=4` and `seeking=false`. Three seconds later, the element remained at 25 seconds, paused, `networkState=1`, and error-free; screenshots were clean before any play action. An additional explicit play→pause advanced to approximately 25.314 seconds on the same element.

This did not reproduce premature recovery completion. No controls were hidden and no user state was changed to manufacture the primary paused screenshot. The subsequent play→pause screenshots are separately named.

## Limits

This is an actual-component/native-decoder integration proof, not a production-data or deployment verification. The root font is explicitly set to 32px (200% of the fixture's ordinary 16px root); this is not an OS accessibility setting. Phone coverage is mobile Chromium emulation, not physical Safari/iOS. YouTube transport is locally intercepted without contacting YouTube, so its fallback test proves URL selection and modal tabindex behavior, not remote authentication or playback. The retained synthetic clip demonstrates playback behavior, not creative render quality or publication readiness.

Expiry is exercised by advancing the fixture server's clock and Chromium's wall clock by 3,601 seconds; this is not an hour-long production playback claim. The server intentionally delays renewed signing responses by 120ms so the native expired Range reaches the local server before the fresh source replaces it. It never synthesizes media errors or media events. Expected fixture 403/503 responses are recorded separately from unexpected browser runtime errors.
