# Verified inline receipt admission

Status: **local implementation; title rollout remains held**. This continues the
[engine design](METADATA_PAID_ENGINE_DESIGN_2026-09.md) after the
[execution-lease slice](METADATA_INLINE_EXECUTION_LEASE_2026-09.md). No paid call,
GPU rental, production mutation, thumbnail change or publishing was performed.
All 151 items in the additive goal ledger remain present. Missing credits are
not a reason to stop the wider goal or silently downgrade a provider.

## What changed

`Block.inspectPaidInlineResume` is a code-owned read-only adapter, considered
only for sequential local **paid** execution. The actual metadata block points
to `inspectMetadataPaidInlineResume`, which runs the existing complete nine-key
metadata validator; the shared runner does not contain metadata-specific R2
paths or title rules. Metadata's production contract remains unpaid in this
draft until its separate request bound and migration are qualified.

The runner freezes the declared inputs and parameters, binds the proof to exact
owner/channel/run/prefix/module/version/input fingerprint, rejects changed
inputs, and requires a complete persisted resume snapshot and finite positive
budget/envelope. A serialized proof, callback presence alone, parameter flag,
foreign binding, ambiguous ledger or unreadable storage cannot grant credit.
The in-process proof identity is a guard against config/JSON injection, not a
replacement for the adapter's semantic checks or external purchase authority.

The receipt arithmetic independently validates exact IDs and finite amounts.
Let P be prior recorded stage spend, L the valid current ledger spend and M the
cost of exactly matching receipts already attributed to P. Newly recovered
spend N = L − M is added once. Equal dollars do not establish receipt identity.
Unattributed older spend cannot be guessed into a new receipt; it holds.

Newly discovered charges and receipt IDs must be persisted through the existing
fenced stage sink before further work. A persistence error permits no body,
claim or purchase. The failed result still reports verified recovered spend;
it does not claim a failed write became durable. On success, the receipt scope
is seeded from the corrected baseline so rereading R2 does not double-charge.
All unrelated historical spend stays carried; this is not a refund mechanism.

Same-ledger continuation reserves E − L from the declared total envelope E.
For $0.03 already received within a $0.05 envelope, $0.02 remains reserved.
Verified complete replay reserves no new work. The body's existing
`assertRemainingBudgetReservation` uses that same current-stage credit and
continues reserving uninspected future paid modules conservatively.

## Validation through actual callers

`inlineCheckpointAdmission.test.ts` exercises the real registry, manifest,
pipeline validation and runner, with deterministic module/persistence fixtures:

- Fresh, continuable, complete replay, missing-parent-summary and matched
  prior-summary cases; exact cost and remaining-reservation assertions.
- Forged/serialized/foreign proof, duplicate/changed receipt, invalid amount,
  over-envelope ledger, receipt-count union, unattributed old spend and
  same-dollar/different-receipt cases.
- Frozen declared inputs, rejected undeclared access/nested mutation, input
  drift during inspection, missing complete resume support, invalid budget,
  remote-only misconfiguration and parallel-group refusal.
- Recovered costs persist before the body; persistence failure allows zero
  purchases while preserving known spend in the failed result. Future work
  remains reserved without another checkpoint inspection.

`metadataExecutionLease.test.ts` additionally traverses the actual metadata
block, selector, HTTP JSON parser, token-cost accounting, immutable checkpoint
adapter, authenticated Convex query, production stage sink and stage mutation
handler. HTTP, R2 object storage and the database are fixtures. It deliberately
copies the real metadata block with `paid: true` and a **test-only $0.012
envelope for its fixed token responses**; that is not a proposed production cap.

- Four normal requests, or seven when both bounded retries are exercised.
- Worker-generation replacement after judgment/package/comment retains the
  received outcome but rejects stale stage writes; the new generation records
  recovered cost before buying only missing work. Both already-summarized and
  R2-only receipt variants preserve exact total cost.
- Completed R2 replay works with the model key and purchase callback removed,
  at a run budget equal to the already-spent amount; zero additional HTTP.
- Missing legacy ledger, unreadable R2, partial/held selection, invalid or
  insufficient budgets, and failed recovered-cost persistence make no new
  purchases. No repair fabricates creative module outputs.

Normal paid-fixture execution makes **18 fixed checkpoint reads**: nine for
engine inspection, nine for independent module revalidation. No bucket listing
is introduced. This duplicates reads intentionally at this intermediate stage;
it is not a storage-cost saving or an atomic multi-object snapshot. Do not
remove revalidation without proving a safe handoff of immutable evidence.

## Remaining gates

- Establish the real finite whole-sequence/request-input cost bound, including
  approved model/rates, output limits, reasoning and full-source inputs.
- Wire and test per-request remaining allowance, not only the execution lease.
- Version/admit the changed paid contract and handle old frozen invocations
  without rewriting their snapshots or silently adopting a new envelope.
- The proof binds the current executable adapter version; that alone does
  **not** durably bind an older R2 ledger to a newly changed spend contract.
- A fresh stage refused before dispatch currently becomes failed; without a
  ledger its subsequent automatic paid admission conservatively holds. A
  separately proven pre-dispatch state is needed before safely relaxing this.
- Cost-only reconciliation for a **held** ledger remains separate. If the old
  worker could not summarize a priced response, R2 retains it, but the inspector
  throws on a later unknown/held outcome before issuing an admission proof. The
  new runner therefore does not yet project that partial known cost into the
  parent summary. Preserve the hold and introduce separately typed cost-only
  evidence; never turn a known charge into permission to retry an unknown one.
- Resolve the existing `metadata.titleDecision` no-downstream-store-reader
  finding. Audit baseline remains unchanged; no fake consumer was added.
- Live R2/Convex concurrency, provider billing and production deployment remain
  separate qualification. The existing generic paid-reconciliation and remote
  reattachment paths have not been relaxed for unverified work.

## Final local gate

- **638/638 direct production-readiness test files passed**, including the real
  metadata integration above and existing generic/remote healer cost tests.
- The subsequent actual hermetic assembly passed: 31.021995 seconds,
  1920×1080 at 30 fps, four segments, 17,164.6 KiB, no assembly warnings. Output:
  `/tmp/assembly-smoke-u8P0S6/bk_smoke_2_loudnorm.mp4`. This is synthetic local
  regression media, not live provider or production-channel quality proof.
- Full TypeScript, scoped ESLint and Next.js production build passed; 51 static
  pages generated. No UI change or visual design improvement is claimed.
- Graphify refreshed after the final source edit: 21,461 code nodes, 52,499
  edges, 685 communities. Local AST only; graph remains excluded from runtime
  and deployment. The exact approved prompt/transport/66-call study source
  hashes remain unchanged from the preceding checkpoint.
- The exact production alias's read-only health endpoint returned HTTP 200 and
  revision `2c8e64a0e973808e11a5bb177543f0a3ebe0c632`. This draft was not deployed.

Logs: `/tmp/ysa-inline-admission-readiness.log`,
`/tmp/ysa-inline-admission-build.log`, `/tmp/ysa-inline-admission-typecheck.log`,
`/tmp/ysa-inline-admission-lint.log`, `/tmp/ysa-inline-admission-graph.log`.

The structural audit is **not green**: 68 inert-produced keys against baseline
67, the same prior title-draft finding. Other counts did not regress; the
unbounded-normalized count remains improved from two to one. Baseline unchanged.
Log: `/tmp/ysa-inline-admission-audit.log`. Do not describe the passing tests as
an entirely passing production release gate or enable the paid title rollout.
