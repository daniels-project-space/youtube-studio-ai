# Title review inspection — 9 September 2026

Status: UI and enlarged-text correction released and browser-verified. Not a title-generator release.

## Actual wiring

The existing run route subscribes to `runStages.listRunStages` in slim mode,
passes each persisted stage into `LivePipeline`, and opens `StageRow` on demand.
`StageRow` now reads `outputs.titleDecision` through a browser-safe presentation
adapter. It displays the saved selection, source coverage, model rationale,
three model ratings and the actual alternate/candidate pool. Comparison and
raw technical data are native, keyboard-operable disclosures. There is no new
route, query, subscription, provider call or mutation.

This resolves the draft's inert `metadata.titleDecision` output with an actual
human-facing reader. The full R2 receipt and the pipeline's validation remain
unchanged. The structural audit returns to 67 inert outputs against its existing
67 baseline; the baseline was not raised or rewritten.

This is a **presentation adapter**, not another admission oracle. It checks
version, bounded shape, indexed rank/candidate pairing, source coverage and
selection/alternate consistency. It does not rerun the judge, verify a
fingerprint or certify facts. The UI explicitly calls the ratings a model
assessment, not a fact-check or audience-performance measurement. A package
title that differs from the saved selection gets a visible warning. This
comparison is against the persisted package, not a live YouTube API read.

Legacy stages without this receipt keep their normal raw output. Unsupported
or incomplete receipts display a warning and retain the technical-data path;
they do not acquire invented scores or a green quality badge. The slim response
can truncate rationale text; the underlying immutable record remains canonical.
Empty input columns are no longer shown when the slim response omits inputs.

## Validation evidence

- Presentation tests cover shuffled rankings, a rejected higher-click candidate,
  alternate mapping, full/excerpt/topic-only sources, unchanged input objects,
  legacy absence, title changes, malformed indexes/numbers/versions/coverage and
  incomplete candidate pools.
- Actual metadata-block and real engine/transport/recovery tests now feed their
  completed outputs into the same presentation adapter. Restoring the saved
  decision produces the same review without another purchase. Provider, storage
  and database boundaries remain controlled fixtures in those tests.
- Browser replay uses the **saved real-model Chalk decision** from
  `test-fixtures/title-pilot-2026-09/chalk-current.jsonl`, through the real
  `LivePipeline -> StageRow -> TitleReview` components and compiled project
  styles/font classes. The surrounding run row is an explicit local fixture,
  not a new or existing production run.
- Desktop 1440px, mobile 390px and mobile at 200% root text size exercised phase
  selection, stage expansion, keyboard candidate disclosure, technical data,
  missing/unsupported receipts and package-title drift. No external requests or
  page errors. This uses no paid credits.
- The first enlarged-text check failed with a 398px document on a 390px viewport.
  The root pipeline grid inherited a content-based minimum; it now has an
  explicit shrinkable track, and the metrics/inspection header can wrap.
  Recheck: document and viewport both 390px, no overflowing descendants; every
  new disclosure target is at least 44px high. Overflow was not hidden.
- Passing replay evidence: `/tmp/ysa-title-review-browser-9HmGgC/results.json`
  and its desktop/mobile/state screenshots. Desktop and mobile selected-title
  screenshots were visually inspected. These are local evidence, not durable
  R2 release artifacts or proof of a production data migration.
- Full typecheck, scoped lint and the final production build passed. All **639
  direct production-readiness test files** passed, followed by actual hermetic
  assembly: 31.021995 seconds, 1920×1080 at 30 fps, four segments, no reported
  assembly warnings. Output:
  `/tmp/assembly-smoke-ZMzC6o/bk_smoke_2_loudnorm.mp4`. This is synthetic local
  media, not live GPU/R2/channel-quality qualification.
- A final same-input browser replay after the build passed again at
  `/tmp/ysa-title-review-browser-rA6eVv/`; the 200% text viewport was visually
  inspected, with wrapping metrics/headers and no horizontal overflow.
- Graphify refreshed locally to 21,519 nodes and 52,603 edges, without model
  calls. Its generated index stays outside runtime/deployment inputs.

## Isolated release candidate

`84c1478b7a7752de4c4088828ab1f574f992bde9` contains only six UI/test source files
and this report, parented directly by production `2c8e64a`. An isolated clean
checkout independently passed typecheck, scoped lint, the new presentation test
and the full production build. Its working tree stayed clean. It excludes all
unreleased title-generation, engine and Convex changes.

The candidate was pushed to `main` for the existing CI/deployment gates.
Vercel independently reported `dpl_CT5wtoA25XhZ3U5FEXEs834QfKGK` READY for that
exact SHA; the canonical `/api/health` returned HTTP 200 and `84c1478...`.
CI run `34323708501` was still executing its separate regression gate when the
frontend became live. Vercel readiness is not a claim that CI/Convex/Trigger
completed or that those deployments are ordered behind that CI job.

## Actual production browser verification and follow-up

No authentication fixtures, response/WebSocket interception or mutations were
used. Fresh browser contexts opened retained Chalk run
`js705md1etr1kr0mpbpvpqaz8x89znvt` at 1440px, 390px and 390px with 200% root text.
Phase/stage expansion worked, real persisted metadata remained readable, the
empty Inputs column was absent and no title-review scores were invented for
that legacy row. Passive observation counted exactly one
`videos:getRunMediaPresentation` subscription per context, no previous duplicate
media/detail subscriptions, and no page errors. Initial screenshots:
`/tmp/ysa-title-review-production-AQYmUl/`.

The initial document-width check was **not sufficient** at 200% text. Visual
inspection and a stricter element-boundary assertion exposed clipping by an
ancestor: the inspector's right edge was 413.40625px despite a 390px viewport
and a reported 390px document. The new assertion correctly fails on `84c1478`.
This corrects the earlier narrow "no horizontal overflow" result; it was not a
full accessibility pass.

The fix is a shrinkable column on the run page's outer grid, not hidden overflow.
A clearly labeled browser-only CSS preview on the real page moved that right
edge to 361.203125px, with the stage/button/pre also entirely inside the viewport;
the desktop and normal mobile geometry stayed unchanged. Preview evidence:
`/tmp/ysa-title-review-production-dduHMI/`. It is a diagnostic preview, **not**
production deployment proof of the correction.

Follow-up candidate `f7e954bfa5f99aff2967a7b32df2f63b19b7f31d` changes only the
run page's grid track, parented by `84c1478`. Its clean release build and
presentation test passed. Vercel deployment `dpl_9moshFib7oZhGcfCmQm16aFuJGP9`
reported READY with that exact Git SHA; the canonical health endpoint confirmed it.

The stricter production proof then passed **without the CSS preview or any
request interception** at all three sizes. Inspector right edge at 200%:
361.203125px; all checked stage/card/button/pre elements also fit. Desktop and
normal-mobile geometry were unchanged. Exact release screenshots, including
the final 200% inspector, were visually reviewed. Evidence:
`/tmp/ysa-title-review-production-u3rVpX/results.json` and screenshots there.
`previewPageTrack: false` is explicitly recorded.

CI `34323708501` completed successfully: full quality gate, canonical Convex
deployment and Trigger deployment. Its cloud-runtime job completed at
07:37:18 UTC. The CSS-follow-up CI `34324519037` was still running its full
regression tests at the latest check; its final status must be checked separately.
No completion of that pending cloud-release job is implied by the verified
Vercel/browser result.
Final local code graph: 21,529 nodes, 52,611 edges; generated outputs stay excluded.

## Scope retained

The title generation draft still needs a qualified whole-sequence cost envelope,
per-call allowance and frozen-contract migration before production promotion.
This UI does not enable it, generate missing historical receipts, change a
video's title, touch thumbnail configuration, rent GPUs or bypass owner locks.
All 151 items in the additive goal ledger remain in scope.
