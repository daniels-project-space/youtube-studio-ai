# Title review inspection — 9 September 2026

Status: validated local UI slice; not a title-generator release.

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
- Full typecheck, scoped lint and the initial production build passed. Final
  build and full production-readiness regression results are recorded below
  when complete; they must not be inferred from the focused checks.

## Scope retained

The title generation draft still needs a qualified whole-sequence cost envelope,
per-call allowance and frozen-contract migration before production promotion.
This UI does not enable it, generate missing historical receipts, change a
video's title, touch thumbnail configuration, rent GPUs or bypass owner locks.
All 151 items in the additive goal ledger remain in scope.
