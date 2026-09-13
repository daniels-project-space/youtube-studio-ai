# Title experiments: native-test grounding review

Date: 12 September 2026
Scope: `src/lib/titleCtrSwap.ts`, `src/trigger/titleCtrSwap.ts`, and the performance ledger. This is a behaviour and evidence correction, not a claim of a deployed YouTube experiment connector.

## Finding

The prior worker called `videos.update` to replace a weak-CTR title with one stored alternate, then evaluated the two different time windows from CTR. That is a sequential metadata edit, not an A/B test. It could create a valid owner-requested rename, but it could not establish that the alternate won, and treating it as a learned result would make the title module learn from audience/time-window drift.

## Authoritative platform constraints

- [YouTube Help: A/B test titles and thumbnails](https://support.google.com/youtube/answer/16391400?hl=en) says Studio can test up to three titles and/or thumbnails concurrently; its winner is determined by watch-time share. The feature is desktop-only and eligibility excludes Shorts, scheduled Lives, Premieres before conversion, private videos, made-for-kids content, mature content, and accounts without advanced features.
- [YouTube Help: performance FAQ](https://support.google.com/youtube/answer/141805?hl=en) says titles and thumbnails should accurately represent the content and warns against deceptive, misleading, sensational, or “loud” packaging. It also says tags are primarily for common misspellings, not a main discovery lever.
- [YouTube Help: how Search works](https://support.google.com/youtube/answer/16090438?hl=en) describes relevance, engagement, and quality; title, description and video-content match all inform relevance. This supports the existing source-grounding and format-profile work, not a CTR-only title rule.
- [YouTube Help: description guidance](https://support.google.com/youtube/answer/12948449?hl=en-GB) recommends one or two main terms in both title and description, unique descriptions, and viewing the result in search/watch/mobile contexts.

## Implemented correction

1. `titleCtrSwap` still identifies a sufficiently observed, channel-relative underperformer and retains the judged alternate. It now creates a **native-test proposal**, not a write plan.
2. The Trigger worker no longer imports or calls the YouTube metadata-update path. Even its explicitly approved manual invocation emits an auditable proposal and explains that approval cannot turn a sequential CTR edit into a native experiment.
3. Existing historical swap receipts are sealed as `not_experiment` with a reason rather than labeled `alternate_won` or `original_won`. No historical sequential result can train the package selector.
4. The performance-ledger type now records the distinction between `legacy_sequential` and a future `native_ab` receipt. A native result must include the platform verdict and per-variant watch-time evidence before it can affect title learning.
5. The legacy `contentExperiments` table is now stamped `single_variant_observation` for an ordinary published package. The learning refresh records that as creative context only and refuses to attach ordinary Analytics snapshots to a future `youtube_native_ab` row.
6. The proposal type itself now says `propose_native_test`, not `swap`; the old CTR-delta verdict helper is replaced by an uncalled fail-closed native-result admission that requires a platform receipt and two consistent watch-time-share values. This does not create an ingestion connector.
7. **Three-variant contract repair (13 September):** the admission contract now accepts an exact, de-duplicated two- or three-title slate. It requires the platform's named winner, checks that title belongs to that slate and has strictly greater supplied watch-time share, and records its exact index. A third winner is represented as `variant_won`; legacy two-title evidence retains `original_won`/`alternate_won` for compatibility. It still does not invent a platform receipt, dispatch a test, or provide an ingestion connector.

## Verification

- `pnpm exec tsx src/lib/__tests__/titleCtrSwap.test.ts` — passed.
- `pnpm exec tsx src/lib/__tests__/titleSwapAttribution.test.ts` — passed.
- `pnpm exec tsx src/lib/__tests__/contentExperimentMeasurement.test.ts` — passed.
- `pnpm exec tsx src/lib/__tests__/contentExperimentMeasurementWiring.test.ts` — passed.
- `pnpm exec tsx src/lib/__tests__/titleNativeTestProposalWiring.test.ts` — passed.
- `pnpm exec tsc --noEmit --pretty false` — passed.

## Still deliberately open

- The app does not yet ingest a native Studio test receipt, its eligibility state, variant package IDs, thumbnail pairing, or watch-time-share outcome. There is no truthful API-based claim that it starts native tests.
- Title/thumbnail experiment packages are not yet immutable paired packages; the current alternate is title-only. That remains backlog items 11 and 24–26.
- The current generator/judge is source-aware and fail-closed, but has not yet been calibrated against held-out owner choices or actual native test outcomes. The existing frozen corpus is source material, not historical model invocation replay evidence.
