# Title draft: validation checkpoint, 9 September 2026

Status: **tested draft; production admission remains held**. Production remains
at the separately verified UI commit `2c8e64a0e973808e11a5bb177543f0a3ebe0c632`.

## Saved work

Local branch `checkpoint/title-admission-20260909` records the implementation,
tests, frozen inputs, raw provider receipts, research and backend findings. Its
first checkpoint is `f7f5288ea11ef374a86fe7d9d171da5898635c05`, parented by the
released UI commit. All 95 checkpointed files were independently compared with
their working-file Git hashes and matched. This branch was not pushed or
deployed; `main`, its index and the working files were left unchanged.

## Tests actually run

- Initial full run: 631/632 direct tests passed. The sole failure was the old
  exact-string assertion for a pinned-comment warning, whose wording changed
  in the refactor. This was not presented as a passing full suite.
- Updated that assertion and added behavior checks through real `craftMetadata`
  with deterministic provider boundaries: a known invalid optional comment logs
  its reason, retains the admitted title and makes no replacement-package call;
  a lost/unknown comment outcome throws and does not repurchase earlier work.
  Both focused tests passed.
- Full rerun: **632/632 direct production-readiness tests passed**, followed by
  successful actual assembly of a 31.02-second 1920×1080 synthetic fixture,
  with four segments and no reported assembly warnings. This was hermetic local
  media with no R2 credentials, not live GPU/provider qualification or a
  production channel-quality render.
- Full TypeScript check and scoped ESLint passed. The earlier schema wrapper,
  default-routing, real HTTP/parser/memo/usage boundary, actual metadata-block
  recovery and source/receipt benchmark suites passed independently too.
- Graphify was refreshed after the final test-source edit: 21,336 code nodes,
  52,163 edges. It used local AST extraction, no model requests. Generated graph
  and test fixtures remain excluded from Vercel deployment inputs.

Local full-rerun log: `/tmp/ysa-production-readiness-title-v2.log`.
Local assembly output: `/tmp/assembly-smoke-wW7J1c/bk_smoke_2_loudnorm.mp4`.
These local files are supporting evidence, not durable R2 release artifacts.

## Real-model evidence is separate

[Three matched title-selection runs](TITLE_ORACLE_RESULTS_2026-09.md)
and both judge passes total **66 priced provider requests, $0.18955650**.
The [second-pass report](TITLE_ORACLE_SECOND_PASS_RESULTS_2026-09.md) separates
previously seen calibration from six unseen synthetic topics. No unsupported
factual title was accepted in either second-pass stratum, and the measured
schema/metaphor/identity defects improved. The unresolved-claim evidence subtype
still fails in both strata. Observed cost and latency increased; no efficiency,
audience/CTR, virality or universal-quality gain is asserted.

Expectations were authored by a separate coding agent, not a human panel or the
owner. See the [frozen-fixture provenance erratum](../test-fixtures/title-oracle-provenance-errata.md).
All paid tests were isolated, capped and vault-authenticated. No production
video was renamed, no thumbnail module was changed, and no GPU was rented.

## Gates deliberately still open

The [actual-engine admission probe](METADATA_PAID_ADMISSION_FOLLOWUP_2026-09.md)
and [integration design](METADATA_PAID_ENGINE_DESIGN_2026-09.md) establish why
metadata cannot simply be marked paid and released. A verified immutable-ledger
inspector, exact historical receipt credit, a defensible whole-sequence cost
envelope, per-call local execution-generation checks and frozen-run migration
still need implementation and actual engine integration tests.

The draft has not had a separate full Next.js production build or been deployed.
The exact deployed UI revision has its own passing CI, Vercel build, canonical
Convex/Trigger release and direct desktop/mobile proof in
[the run-media report](RUN_MEDIA_QUERY_EFFICIENCY_2026-09.md). Neither that UI
release nor these tests qualify the wider title draft for production spending.

All 151 numbered items in [the additive goal ledger](GOAL_MODULE_AND_UI_HARDENING_BACKLOG_2026-09.md)
remain present. The broader UI, other modules, automatic unfamiliar-channel
test and [weekly Salad integration](SALAD_BULK_WIRING_AUDIT_2026-09-09.md) are
not replaced or marked complete by this checkpoint.
