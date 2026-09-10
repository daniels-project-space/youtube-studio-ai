# Channel header: full text and real navigation

## Scope and source

Isolated candidate based exactly on `c49039c431d28c6c6eb2e75510a758159b8340f5`.
Only the channel-room page and its CSS module change at runtime. The shared
ChannelBanner, shell, media lookups, owner controls, data queries, paid actions,
and all subpanel interiors are unchanged. No production writes or deployment
were performed for this review.

The existing `ChannelBanner.className` hook allows this room's content to size
the banner naturally without changing image/scrim behavior elsewhere. The full
channel name, niche, actual publication count/cadence/language and art warning
remain readable. The ornamental channel/primary kicker and duplicate next-video
box are removed. Status is retained in the operating summary.

Four compact summary links use real existing views:

- Status → Settings, where channel state and release settings live.
- Next → Week ahead with the exact current plan ID; its details open and focus.
- Setup → Settings, including release/schedule and existing Channel system
  controls for identity/voice/modules. The summary names missing setup domains.
- Pipeline → the actual channel pipeline view; module count and starting module
  stay visible, with the complete existing path available in that view.

The same page-owned URL factory serves tabs and links. It preserves unrelated
query parameters, clears stale plan selection, and binds a plan only for Next.
No new render or configuration write is implied by these navigation links.

## Reproduced production defects

Exact c490 production, no overlay or data fixtures:
`/tmp/ysa-channel-header-proof-SKuxAA/results.json`.

All six profiles completed: 320, 390 and 1440px, each at 100% and 200% root text.
The before oracle recorded 69 failed assertions (not 69 separate bugs): clipped
or ellipsized header/summary text, hidden overflowing tab labels, four inert
summary regions, and lost tab focus. It made zero HTTP/Convex writes and recorded
zero application errors.

The loading defect was independently observable on the actual application:
Home from Content to Overview, ArrowRight from Setup to Overview, and ArrowLeft
from Setup to Performance removed the entire header while the existing run
subscription loaded. All 18 such transitions lost focus across six profiles.
The other 12 tested transitions kept focus.

The approved fix keeps the header mounted once its own genuine inputs are
available. The unchanged run subscription predicate remains lazy; only the
dependent view shows the existing skeleton and `aria-busy` while runs are
undefined. Overview/Analytics are not rendered with invented zero metrics while
loading. Initial missing/undefined channel and header data gates remain intact.

## Visual and interaction passes

1. Natural header size, complete summary values and actionable links. Real local
   markup against read-only live Convex data exposed the same focus defect.
   All 24 summary-link navigations already worked.
2. Balanced phone tabs were preferable to the first 3+1 wrapping layout. The
   first equal-width refinement itself proved too narrow at 200%; that failed
   candidate and screenshots were retained, not accepted.
3. The scoped run-loading boundary fixed all 30 keyboard transitions. The
   remaining enlarged-text tab defects remained explicitly failing.
4. Text-relative container breakpoints now use four, two or one columns as
   space permits. Full labels and existing font sizes are preserved; no clipped
   navigation, horizontal hiding, or reduced-font workaround was introduced.
5. Independent root screenshot review identified the legacy art-warning pill's
   tiny, top-aligned text. It now uses centered inline-flex alignment,
   `0.68rem/1.2` type, and a minimum 44px touch target. Its actual Identity link
   remains unchanged. The earlier proof is retained below rather than being
   relabeled as evidence for this final polish.

Final real local candidate evidence:
`/tmp/ysa-channel-header-proof-qX6UMF/results.json`, terminal **0**.

- Six of six profiles completed; full words fit header, summaries and tab targets.
- 30/30 Home/End/wrap/adjacent-key transitions kept both the original header DOM
  and the selected destination tab's focus after the real view loaded.
- 24/24 summary links reached the expected real view; all six Next controls
  opened and focused their exact existing plan row.
- All six captures recorded successfully loaded actual channel banner/avatar.
- Zero HTTP writes, Convex Mutation/Action frames, or application errors.

Reviewed screenshots include normal/enlarged phone and desktop loaded views,
full header, complete operating summary and all four visible tab targets. The
200% narrow screen is intentionally taller: readable enlarged content scrolls
vertically rather than being hidden. This is an actual local candidate, **not**
a deployed change or a CSS/markup overlay on production.

Final polished development replay:
`/tmp/ysa-channel-header-proof-CQzrJb/results.json`, terminal **0**.
Final production-compiled local replay (actual `next start`, no CSS/data overlay):
`/tmp/ysa-channel-header-proof-k9vxth/results.json`, terminal **0**.
Both repeat all six profiles successfully. The compiled replay additionally
clicks the art-warning link in all six profiles, reaches Identity each time,
and verifies its complete text, 44px-or-larger target and actual 10.88/21.76px
normal/enlarged typography. The 30 tab transitions and 24 summary links still
pass; actual banner/avatar are loaded in every profile; errors and writes are
both zero. Compiled normal/enlarged phone and desktop screenshots were inspected.

## Automated checks

`channelHeaderNavigation.test.ts` extracts the real page's URL function and
query maps with the TypeScript AST, then runs all eight views and exact-plan
encoding/query-preservation checks. Its 18 contracts also protect genuine
Settings destinations, retained setup domains and the lazy loading boundary.
Source-shape checks are supplementary, not substitutes for the live browser.

Passed: focused 18-contract test, `uiReleaseContracts.test.ts`,
`operatorVisualConsistency.test.ts`, `Navigation.test.tsx`, nonincremental
project TypeScript, scoped lint, the portable browser script's strict TypeScript
check, and the full optimized Next production build. The final build is
`/tmp/ysa-channel-room-header-6C9FSF/build-final.log` (exit 0); post-polish
nonincremental typecheck is `typecheck-art-final.log` (exit 0) in that same
evidence directory. `build.log` is the successful prior pre-art-polish build,
not the final build. `compiled-server.log` records the actual `next start`
server used by the final replay.

## Harness corrections and limits

The initial proof had an invalid mixed XPath/CSS ancestor selector; its failed
logs were retained separately. A second harness version confused an unclipped
font em rectangle with actual vertical clipping, and overwrote the profile
label with a name measurement. The corrected oracle checks actual clipping
ancestors while keeping strict full-word and horizontal containment checks.
It captures the complete hero instead of attempting to screenshot a clipped
baseline h1. These were harness defects, not product regressions.

The focused test initially omitted the source-derived reverse query map and
used too-broad CSS matching and unsupported `/s` flags for the repository's TS
target; these were corrected without changing runtime behavior.

No claim is made about whole-page accessibility, arbitrary localization,
subpanel interior design, owner editing, YouTube OAuth completion, rendering,
publishing, or every channel identity/art quality. Actual live data and media
may change between runs. This proof intentionally validates the header and
navigation boundary without modifying any channel or media record.
