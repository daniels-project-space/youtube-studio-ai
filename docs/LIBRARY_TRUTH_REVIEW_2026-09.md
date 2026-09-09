# Library metadata truth and reflow review — September 2026

## Scope and provenance

The reviewed UI removes `estimatedViews` from VideoCard, Lightbox, and ArtifactWorkRail, and replaces Library's estimate-based sort with Newest/Oldest by persisted `createdAt`. The source estimate is not this video's analytics: `convex/seo.ts:viewEstimate` weights competitor views by matching tags among the top 20 matches, with a niche median/average fallback. That producer, stored records, queries, provider choices, and scoring are unchanged.

Independent review found one related pagination defect: after choosing Oldest and expanding the actual page, “Latest 8” still collapsed to the oldest eight. The source owner changed this to neutral “Show fewer.” Subsequent enlarged-text review found baseline-present layout defects, independently confirmed in the actual production shell, and the source owner repaired the scoped Library/card/rail layouts. This review does not claim that removing an estimate creates analytics, that a fixture badge certifies media quality, or that a local result proves deployment.

## Actual-caller browser proof

`scripts/library-truth-browser-proof.mts` bundles the real Library page, VideoCard, Lightbox, VideoPlayer, SignedVideoPlayer, MediaPreview, shared URL hook, and ArtifactWorkRail. It uses the real component CSS and compiled application global CSS/fonts. Only GET data/media transport is substituted; mutations and external requests are refused. The wrapper does not implement page sorting, filtering, pagination, player recovery, or gallery behavior.

The explicit retained diagnostic input is `/tmp/assembly-smoke-DanWJe/bk_smoke_2_loudnorm.mp4`, SHA-256 `de7b07e460ee9c5e3fd4f5f7ad57e1b78a03aaaf7543ea9c21d2f06b1399d15c`. Native duration is 31.021995 seconds. The local server supplies real MP4 byte ranges (206). This is not a downloaded or newly rendered production master.

Five profiles cover 1440/100%, 390/100%, and 320/390/1440 at 200% root font size. The 21 loaded rows include 18 active and 3 archived records, with deliberately unsorted query order and creation dates that disagree with record IDs and varying competitor estimates. The actual newest card/Lightbox and first rail card each receive an explicit 28,000,000 estimate and `estimatedViewsSource: "tag_overlap"`.

Checks cover:

- Estimate removal in all three real consumers, while the exact loaded records remain unchanged.
- Both date-sort directions, actual expand and “Show fewer” clicks in each direction, channel/status/search/inclusive-date filters, archive/active switching, and no extra list query during these interactions.
- Real native play/pause/seek to 15 seconds, correct keyed sources through Next/Previous, native ArrowRight ownership, Escape, returned focus, and restored body scrolling.
- All 30 exact saved SEO tag strings with rendered text bounds; modal bounds and native playback remain checked at enlarged text.
- Page element and rendered text bounds before and after expansion; all three legacy/incomplete/recorded evidence labels in actual cards and rail.
- Lazy rail images are scrolled into view and must reach actual `data-preview-source="r2"`, ready state, and the exact fixture thumbnail identity. Two visible source/status badges are required, including historical “R2 preview” or current “Saved”; their text, frame containment, and non-overlap are checked. An absent badge cannot pass.

Source files, stylesheet, fixture, and proof script are hashed; the run rejects source/script changes during execution. Closed `<details>` non-summary content is recorded separately because Chromium Range can report layout boxes for that unrendered content. Visible text bounds are not relaxed. The carousel's deliberate horizontal scrolling is separate from clipping within each card.

## Retained before evidence

- Exact old release `478c897acabb2db23d61198bfb2cbbe4788b9479`: `/tmp/ysa-library-truth-proof-tVhBYc/results.json`, exit 1. Twenty intended old-behavior failures (three estimate displays plus absent Oldest across five profiles), and two baseline-present page-width failures. This and the corresponding 4544 run use the same earlier proof hash `53df2b6ff99fe0e100f69da6f1addf8b99488fe5bc7db73b263ba0f60673a301`.
- Intermediate 2707 pagination counterexample: `/tmp/ysa-library-truth-proof-Sq22Cl/results.json` and `desktop-oldest-expanded.png`; actual collapse returned oldest rows despite “Latest 8.”
- Exact `4544e1f1f54df3720301eee81f93e937790917f7`: `/tmp/ysa-library-truth-proof-EoJFkJ/results.json`, exit 1 only for the two baseline page-width checks. The earlier proof expanded Newest but reset through filtering/tabs; the final proof additionally clicks its collapse button explicitly.
- Strengthened exact-script inverse on 4544 at 320/200%: `/tmp/ysa-library-truth-proof-axnj4l/results.json`, exit 1 with five named layout failures, including 91 actual page/text overflow observations and loaded rail badge clipping. No assertion was removed to accept the repair.
- Intermediate 81ff: `/tmp/ysa-library-truth-proof-xYbrUu/results.json`, exit 1 only for vertical clipping of the wrapped Saved rail badge at 320/390 enlarged text. Page/text/expanded bounds and all requested actions pass. The source owner was given the native screenshot rather than a blanket success claim.

Actual canonical production at 478 independently reproduced the pre-existing page defect: `/tmp/ysa-478c897-production-vVYwrP/library-page-large-diagnostic.json` and `library-page-{320,390}-200pct.png`. The shell's document width equalled the viewport, yet the collection bar extended to x486.06 and card evidence text overflowed internally. Root scroll width alone was therefore insufficient. Both production screenshots were inspected. This separate production observation is not fixture metadata accuracy proof.

## Final qualification

The unchanged full five-profile proof passed, terminal exit **0**, against exact frozen runtime `1f43c6f9623f7b72bc196f194c5c3cce31175474` at `/tmp/ysa-library-verified-release-TbbRVq/repo`. Results: `/tmp/ysa-library-truth-proof-hgtJKa/results.json`; full log: `/tmp/ysa-478c897-production-vVYwrP/library-truth-verified-after.log`. The same final proof hash used by the strengthened 4544 inverse is `42de3e69cf7fb48839cdd466313f7a82e27331d43d8ec11a2329eff5c0f674de`.

All five profiles have zero initial/expanded page element or text violations; all evidence and loaded source/status badge bounds pass. The final rail uses top-left status and bottom-right source corners, not increased thumbnail height or changed cropping. Its image geometry stays 16:9. Saved source labels no longer hard-code a model/provider. Standard text and enlarged labels remain readable without shrinking fonts, deleting evidence text, or using additional clipping to conceal overflow.

Both Library-card and rail-opened native playback report, in every profile: `currentTime: 15`, `paused: true`, `seeking: false`, `readyState: 4`, `duration: 31.021995`, and `error: null`, with the exact respective `run_10`/`run_01` asset paths. All requested sort/filter/paging/modal checks complete; browser errors and external requests are empty. Source/script hashes are unchanged at completion.

Independent pixel inspection covered all five final `*-player.png` files, normal desktop rail, both enlarged-phone rails and page tops, all three 320px evidence-status card screenshots, and 320px expanded pagination. The corner badge that failed at 81ff is visibly complete at 1f43. Horizontal rail continuation beyond the viewport is intentional scrolling; each card was brought into view before its loaded badges were checked.

Focused ESLint and strict standalone script TypeScript checks both exited 0; logs are `/tmp/ysa-478c897-production-vVYwrP/library-truth-final-lint.log` and `library-truth-final-typecheck.log`. TypeScript uses `ES2022,DOM,DOM.Iterable`; an earlier invocation without DOM.Iterable failed on native DOM iteration and was corrected without changing assertions.

Reproduction:

```bash
LIBRARY_PROOF_SOURCE_ROOT=/tmp/ysa-library-verified-release-TbbRVq/repo \
LIBRARY_PROOF_STATIC_ROOT=/tmp/ysa-library-reflow-release-TWcUXH/repo/.next/static \
PREVIEW_TEST_VIDEO=/tmp/assembly-smoke-DanWJe/bk_smoke_2_loudnorm.mp4 \
./node_modules/.bin/tsx scripts/library-truth-browser-proof.mts
```

The compiled globals/fonts come from the completed 6fd build; final source has identical `globals.css` SHA-256 `af735037fd4a89efb3ae11f99faeb44a6d78f764766871ef9e706c81b0a127cf`. Actual final module CSS is bundled from 1f43. Compiled stylesheet receipt: `39r_4k3y_jyvb.css`, SHA-256 `9333543838cc0fca3aba24ab2c3168f6bbe78cd912ea1bb3467e71ea0ce606ad`.

This freezes only the owned proof and review document. The result is a local actual-component/native-media qualification, not a whole-video quality approval, production data mutation, comprehensive accessibility audit, paid rendering test, or deployment claim. Full application gates, Git, graph maintenance, deployment, and final canonical-production verification remain owned by the coordinating task.

## Coordinating regression follow-up

The full 647-test run on intermediate 81ff found one stale source assertion in
`mediaPreviewContracts.test.ts`: it required the literal `Reviewed ERNIE` even
though a reviewed thumbnail URL does not establish a provider. The correction
requires all four current source labels (`Reviewed`, `Saved`, `YouTube`,
`Public`) and explicitly forbids that ungrounded provider label. The existing
actual-source/readiness, release-evidence binding, fallback and accessibility
assertions remain. This is an intentional contract update, not removal of a
failing product-behavior check. The unchanged five-profile native browser proof
also checks visible ready-state source badges and persisted evidence separately.
The final isolated release must rerun the complete suite with this correction.
