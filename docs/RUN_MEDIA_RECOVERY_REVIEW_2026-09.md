# Run Media retained-video recovery review — 2026-09-09

## Scope and provenance

`scripts/run-media-recovery-browser-proof.mts` bundles the actual `RunMediaWorkbench`, media helpers, asset-URL hook/cache, `SignedVideoPlayer`, current-thumbnail `MediaPreview`, and component CSS. Graphify identified the Run Media card/source relationship; direct inspection confirmed the run-detail page passes live assets and the selected video asset ID to this component. The graph predates the newly extracted content child, so current source and browser evidence take precedence over that older outline.

A small React host supplies normal asset/stage props and controlled same-ID asset-key updates. Only those props and signing/media HTTP transport are fixtures. There is no alternate player, fake recovery logic, synthetic native error, or dispatched media event.

The explicit retained local MP4 is `/tmp/assembly-smoke-frkUeC/bk_smoke_2_loudnorm.mp4`, SHA-256 `de7b07e460ee9c5e3fd4f5f7ad57e1b78a03aaaf7543ea9c21d2f06b1399d15c`. Actual Chromium duration is `31.021995` seconds. No new render, remote-media download, provider call, production mutation, publishing, Git operation, or deployment is performed by this proof.

```bash
PREVIEW_TEST_VIDEO=/tmp/assembly-smoke-frkUeC/bk_smoke_2_loudnorm.mp4 npx --no-install tsx scripts/run-media-recovery-browser-proof.mts
```

`PROOF_CASE` optionally selects one case. Baseline desktop/phone coverage comprises healthy playback, paused expiry, playing expiry, initial signing Retry, native-error Retry, same-ID/key change, delayed signing race, and exact source-link recovery. Four additional initial/native-error cases use a 32px root font at 390px and 320px widths. These 20 cases use the real native decoder and component CSS. Two subsequently added desktop/phone `file-sign-retry` cases exercise the actual newly exposed Retry link button and read back a small SRT response over HTTP. The script's complete default matrix now contains 22 cases.

## Failing before

`/tmp/ysa-run-media-proof-90m3c6/results.json` contains the source-hash-stable 20-case baseline: 16 cases failed intended unmet assertions; healthy playback and delayed-key isolation passed on both profiles. There were no unexpected browser runtime errors.

- At 8 seconds the actual video was decoded (`readyState=4`), with buffering ending near 8.7 seconds. Advancing fixture clocks by 3,601 seconds and seeking to unbuffered 25 seconds caused a real native Range request (`bytes=14385152-`) to receive HTTP 403. Native `error=2` occurred at 25 seconds; the parent `mediaFailed` flag then removed the video DOM element and replaced it with static text. No renewal or actionable Retry remained.
- Initial signing HTTP 503 also produced a static URL-unavailable state without Retry. Initial requests for same-key siblings were correctly coalesced; absence of recovery was in the consumer, not evidence that coalescing failed.
- Keeping asset `_id` unchanged while replacing `r2Key` changed the title/link to valid key B (HTTP 206), but retained key A's `mediaFailed` flag and prevented B from rendering a native video.
- After native expiry, Open source still referenced the expired generation-1 URL and returned HTTP 403. Source-link probes are explicitly labeled `source-receipt` in JSON, separate from native `media` requests, so a link check cannot satisfy the native-403 assertion.
- At 320px/200% text, the old native-error message was visibly cut after “This browser could not…”. At 390px its final text line also exceeded the frame. Initial URL-error text itself remained visible at 320px, but its padded status container exceeded the frame. Loading overflow was separately measured; at 320px its final text line exceeded the fixed-height preview.

## Repairs reviewed

The main agent owns all runtime repairs. The card is now a stable, programmatically focusable article containing an asset-ID/key/attempt-keyed content lifetime. Retrying initial signing replaces only that content and places focus on the surviving article first. A changed asset key clears the prior key's error and playback URL. The hook ignores stale signing resolution while retaining a reusable receipt only for its own key.

The video branch renders the shared `SignedVideoPlayer` without passing the old parent failure-unmount handler. Native recovery therefore preserves the video node. The source link receives the actual `currentSrc` from loaded metadata after renewal; this does not mutate the shared URL cache. Other media error behavior has not been generalized into video recovery.

Status/recovery content determines preview height instead of being clipped inside a fixed master aspect ratio. Native controls remain present. The first repaired run, `/tmp/ysa-run-media-proof-ZH0Men/results.json`, passed 19/20 cases but exposed a 244.0625px-wide initial-error status inside a 239.625px frame at 320px/200%. The scoped min-width/max-width/wrapping correction was verified without relaxing the bounds oracle.

## Passing after

Full result before the final padding-only refinement: `/tmp/ysa-run-media-proof-Geno8l/results.json`, all 20 original cases passed, `failures=[]`, `errors=[]`, with no tested source changes during bundling/execution. Targeted receipts are `/tmp/ysa-run-media-proof-pYcRok/results.json` for the two enlarged initial-error cases and `/tmp/ysa-run-media-proof-Cthbh2/results.json` for the two paused recovery cases. After changing only status padding to `clamp(12px,2vw,16px)`, the unchanged two enlarged initial-error cases passed again in `/tmp/ysa-run-media-proof-tJuoja/results.json`. No full matrix rerun after that padding-only change is claimed here; the main agent's isolated release gate will rerun it.

- Healthy native preview decodes the actual retained clip at 15 seconds.
- Actual expired Range403 recovers on the same native DOM element at 25 seconds. Paused cases stay paused; playing cases continue at approximately 25.26 seconds. Both profiles report `readyState=4`, `seeking=false`, `phase=ready`, and no media error. Volume 0.4, mute, and playback rate 1.25 are preserved.
- One fresh signing request renews only the failed key. Same-key and different-key siblings keep their sources, positions, and pause state.
- Initial503 and native403 each expose one actual Retry. Ordinary clicks work, each makes one additional signing request, and disappearing Retry retains focus inside the stable card (article for initial signing, native video for player retry).
- Same `_id` with new key B now renders B. Delayed key C signing cannot replace selected B; selecting C later reuses C's own receipt.
- In every recovered source-link case, the href is byte-identical to the actual native `currentSrc`, resolves to the original exact object key, and serves HTTP 206 for a local byte-range request. This checks real transport, not link presence alone.
- Status, text-line, and Retry bounds fit at 390px and 320px with a 32px root. Retry is scrolled into view and checked with a real pointer hit test before an ordinary click.

The two added file-signing cases passed on the final source in `/tmp/ysa-run-media-proof-Cp4zH6/results.json`. Each starts with real signing HTTP503 and no source link, clicks the actual Retry link button, keeps the same article and article focus, and makes exactly one additional signing request. The resulting href identifies the exact `captions.srt` key and generation 2; reading it returns HTTP200, `application/x-subrip`, and the exact SRT cue text served by the local fixture. No video/audio element is fabricated for a file. These two cases are additive; the original 20 video cases and their assertions remain intact.

### Native spinner and inspected pixels

The immediate paused screenshot is retained unchanged. Chromium can briefly display its native spinner over an already decoded paused frame. A separately named `-settled.png` is captured about three seconds later, before any play action: both profiles remain at 25 seconds, paused, same node, `readyState=4`, `networkState=1`, `seeking=false`, `phase=ready`, with clean decoded pixels. Only afterward does an explicit play→pause check advance the same element; those screenshots are separately named `-after-explicit-play-pause.png`. No native controls are hidden and no paused state is altered to manufacture the primary screenshot.

Full-run screenshots independently inspected include `desktop-healthy.png`, `phone-healthy.png`, desktop/phone `expired-paused-settled.png`, `phone-small-large-text-initial-error.png`, and `phone-small-large-text-native-error.png` under `/tmp/ysa-run-media-proof-Geno8l`. Error text and Retry are readable and reachable. That run revealed a minor 320px/200% typography issue: “unavailable” wrapped its final letter because of 1rem status padding. The final targeted `/tmp/ysa-run-media-proof-tJuoja/phone-small-large-text-initial-error.png` was independently inspected after the padding refinement: “unavailable” now stays on one line, the font size is preserved, and Retry is fully visible and clickable. The added file proof's desktop error and phone successful-link screenshots were also inspected.

## Source binding and checks

Full-run hashes before the final padding-only refinement:

- `RunMediaWorkbench.tsx`: `2f3cdfdf0c01e239b0ade68cb27771e6d7525e1d1ed9005291163e7795f336ad`
- `RunMediaWorkbench.module.css`: `e10cfa0036b4fb278430ec30c52b2fd4a33b2688d51f0a19f26463f6748273c5`
- Shared `SignedVideoPlayer.tsx`: `e71b6a62ab8ac5ff07c11ead9fcddb16dbb120e0d260cefe3a4106efe642a7a2` (unchanged)

Final targeted-run CSS hash: `54542561b24331d42e2072fce887d06fab051b4a31a9fe46ef12aa1a9e809730`. Component JavaScript and the shared player remained unchanged. Both the final padding and file-signing targeted runs verify stable source hashes throughout execution.

The JSON contains all eight tested source hashes. Full `tsc --noEmit --incremental false --pretty false`, scoped ESLint, and proof/document whitespace checks pass. The proof subtask owns only the new script and this review document; runtime source, graph maintenance, Git, deployment, and production verification remain with the main agent.

## Limits and remaining lifecycle boundary

This proves actual-component/local-native integration, not a deployed application or production asset's metadata/quality. Phone coverage is mobile Chromium emulation, not physical Safari/iOS. Expiry uses fixture clock advancement, not an hour of wall-clock playback. The signing server delays renewal by 120ms so the native expired Range reaches it before source replacement. The retained synthetic clip is not evidence of creative render quality or publication readiness.

The repaired source link follows an actively renewed player. An inactive source link left mounted beyond its own signing lifetime still has no click-time refresh; merely waiting does not renew it. That separate link lifecycle is not waived or claimed fixed by the active-player HTTP206 checks or initial file-signing Retry. Audio native-error recovery and image-error recovery remain outside this proof. Shared player retry deadlines and cancellation are covered by its existing focused proof; this consumer proof specifically checks initial-signing key races and sibling isolation.
