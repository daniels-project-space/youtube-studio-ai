# Run media query: production verification

Verified 9 September 2026. The run page now uses one viewer-scoped
`videos.getRunMediaPresentation` subscription instead of separate
`assets.listForRun` and full `videos.getVideoDetail` subscriptions.

## Released source

- Canonical Convex: `astute-camel-689`, backend revision
  `521dcce3309091e0bd7b8a3c9f1cf227ed72f7c3`; CI `34297651360` completed successfully
  including canonical Convex and Trigger deployment (release-coordinator evidence).
- Consumer: `94ee38ed1f2e7a2d52de130ac8259bd6a524fad1`.
- Consumer CI `34298764645` also completed successfully, including its full
  production-readiness gate and canonical Convex/Trigger deployment.
- Independently read `https://youtube-studio-ai.vercel.app/api/health` after browser
  verification: `ok: true` and that exact consumer revision.

`convex/videos.ts` shares `retainedRunMedia` between the combined query and
`getVideoDetail`. It retains the existing current-thumbnail selector, sealed
master lookup, LoFi source validation and original asset metadata. The Lightbox
keeps its full detail query; only the run-page consumer changed. No thumbnail
generation settings, provider calls, source assets or production records changed.

## Actual production API comparison

Read all three actual handlers using a production **viewer** token after the
canonical backend deployment. No passthrough, mock responses, admin identity or
mutations. For every row, the combined response exactly matched the full detail
handler's `thumbnailKey`, optional `thumbnailPresentation` and `videoKey`; its
raw asset rows deep-equalled `assets.listForRun`.

| Channel / run | Asset rows | Old assets JSON chars | Old detail JSON chars | Old total | New combined |
| --- | ---: | ---: | ---: | ---: | ---: |
| Inked Histories · `js76ghf4s44b4w5d97cs2f49bd89znxa` | 2 | 794 | 5,820 | 6,614 | 1,121 |
| Chalk & Compound · `js705md1etr1kr0mpbpvpqaz8x89znvt` | 2 | 798 | 5,595 | 6,393 | 1,123 |
| Gratitude Springs · `js72d9gty4nrqqq7wevv0m0hyd89xgk9` | 6 | 2,592 | 5,661 | 8,253 | 2,923 |
| The Quiet Stoic · `js7eh3rvdhjyqwkmnseb0qtvfh88mrq7` | 2 | 838 | 6,169 | 7,007 | 1,165 |
| Investory · `js72sy9xyvxtptvtbbg2z8aegs88ez4t` | 4 | 1,992 | 13,115 | 15,107 | 2,307 |
| **Total** | **16** | **7,014** | **36,360** | **43,374** | **8,639** |

This is an 80.1% reduction in these five responses' `JSON.stringify` character
count. It is **not** compressed network bytes, a fleet-wide sample, or a billing
measurement. All five are `current_golden_candidate` / `legacy_unverified`;
live sealed-master and LoFi coverage is not claimed.

The earlier bounded source/row audit counted 33 indexed reads for the old two
queries across these five runs (8, 7, 6, 6, 6). With their observed one-candidate
shape, the new source requires 15 (3 each): one original asset read, one refresh
candidate read and one candidate asset read. This is a source-derived logical
count, not Convex production telemetry. The old duplicate asset read covered 16
rows. Stage/script/SEO reads are absent from the combined query; the existing
sealed-master branch still adds its two required evidence reads when applicable.

## Direct production browser proof

Opened the exact production run URL for Chalk & Compound in fresh Playwright
contexts at 1440×1100 and 390×844. No request or WebSocket interception; passive
WebSocket observation only.

- Exactly one `videos:getRunMediaPresentation` subscription per context; zero
  `assets:listForRun` and zero `videos:getVideoDetail` subscriptions.
- Current **TAX DECODED** image loaded; its source button opened the exact image
  URL. The historical image was absent until its disclosure opened, then loaded
  the old run-bound source without replacing the current image.
- Both views had zero console/page errors and no horizontal overflow.
- Captured and visually inspected the current-thumbnail card at both sizes:
  `/tmp/ysa-ui-audit/run-combined-production-1440.png` and
  `/tmp/ysa-ui-audit/run-combined-production-390.png`.
  Both show the new image, readable current-thumbnail label and source control.
  These are local evidence files, not deployed or durable R2 artifacts.
- A second independent browser run checked the entire production page at
  1440×1000 and 390×844, and the Library's matching candidate. Full-viewport
  screenshots were visually inspected:
  `/tmp/ysa-ui-audit/run-chalk-94ee38e-production-desktop.png` and
  `/tmp/ysa-ui-audit/run-chalk-94ee38e-production-mobile.png`.
  Current-image requests, exact source-button navigation and lazy historical
  artwork passed again without console errors or horizontal overflow.

That whole-page review also caught an inherited misleading metric: “Verified”
counted successful **and skipped** execution stages, not master quality. The
separate correction below reports completed and skipped stages honestly. These
legacy videos have not acquired a quality certification from a thumbnail change
or from a passing stage count; the existing release-evidence status remains the
authority. This query fix is not a claim that the wider page redesign is complete.

## Stage progress correction: production verified

Commit `2c8e64a0e973808e11a5bb177543f0a3ebe0c632` replaces the redundant total-stage
and “Verified” metrics with **Completed stages** (only `ok`) and **Skipped**.
It preserves active/failed precedence and existing release-quality evidence.
Helper branch tests and actual component rendering cover loading, no stages,
pending, running, failed, all-completed, mixed and all-skipped runs. An all-skipped
16-stage run displays `0/16` completed and `16` skipped, never “Verified.”

CI `34299901554` passed its complete quality gate and deployed canonical Convex
at 01:50:01 UTC and Trigger version `20260909.4` at 01:51:57 UTC (deployment
`2og5gusj`). Vercel had not created a deployment for that push; the exact tested
Git SHA was subsequently deployed through the authenticated Vercel API, not
from the dirty local title worktree. Deployment `dpl_BFPBhL8rmAt9xzuqHvibhac9LVZX`
reported READY with the correct Git SHA and production alias.

The exact production `/api/health` revision was asserted before fresh desktop
and mobile browser runs. Both directly displayed `Completed stages 16/16`,
`Skipped 0`, `No active stage`, `Files 2` for the retained Chalk run. Current
thumbnail, source popup, lazy old artwork and desktop Library consistency all
passed again with no response adapters, page errors or horizontal overflow.
Visually inspected screenshots:

- `/tmp/ysa-ui-audit/run-chalk-2c8e64a-production-desktop.png`
- `/tmp/ysa-ui-audit/run-chalk-2c8e64a-production-mobile.png`
- `/tmp/ysa-ui-audit/run-progress-2c8e64a-production-mobile.png`

These prove the compact metric and thumbnail controls, not legacy video quality,
full playback, every page/subpanel, or the full visual-overhaul phase.

## Regression evidence and limits

`src/lib/__tests__/runCurrentThumbnail.test.ts` exercises the actual viewer
handlers and exact selector parity for current, rejected, running, failed,
unproven, missing and wrong-owner candidates; sealed masters with and without
matching asset rows; invalid seals; and LoFi old-source versus sealed-source
bindings. It verifies raw asset preservation and denied owner scope before reads.

The long-narration fixture's 143,198→619 character and 8→3 indexed-read comparison
is **synthetic**, separate from the production table above. It is a regression
guard against reintroducing script/SEO overfetch, not a live savings claim.

Focused suites passed: `runCurrentThumbnail.test.ts`,
`lofiLibraryThumbnail.test.ts`, `releaseEvidenceStatus.test.ts`,
`runMediaWorkbench.test.ts`, `MediaPreview.test.tsx` and
`libraryReleaseEvidence.test.ts`; scoped ESLint and TypeScript checks also passed.
The earlier local consumer check used an explicitly disclosed transport adapter
while the new backend was unavailable; it is superseded by the direct production
API/browser verification above.
