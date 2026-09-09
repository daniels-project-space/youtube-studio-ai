# Held metadata runs: preserve charges without permitting retry

Status: **local draft, not production-qualified**. Continues
[verified inline admission](METADATA_INLINE_RECEIPT_ADMISSION_2026-09.md).
No paid provider call, GPU rental, thumbnail change or production mutation.

## Reproduced defect

The actual metadata/HTTP/accounting/Convex-handler fixture loses its worker
generation after the generator response. R2 correctly retains a held selection
outcome with a known $0.0015 charge; the old worker cannot summarize it through
the fenced stage sink. On the next worker, the whole-ledger inspector holds
before issuing an admission proof. The engine therefore reported $0 instead of
the retained known charge. The added assertion failed against the prior code:
`actual transport accounting 0 != durable receipts 0.0015`.

Before log: `/tmp/ysa-held-cost-before.log`. The amount comes from the test's
fixed HTTP token response and the real accounting wrapper, **not live spend**.

## Implemented distinction

- `VerifiedInlineCostEvidence` is a separate `cost_only` result. It carries
  immutable exact-scope receipt identities and a hold reason, not permission to
  execute. `reconcileInlineCheckpoint` explicitly rejects it even when cast or
  presented with a large budget. Serialized/foreign proofs are still rejected.
- `reconcileInlineCheckpointCosts` validates known monetary evidence before
  affordability/admission. This preserves already-incurred costs even when the
  current budget is zero, invalid or below the known total. Such a budget still
  cannot authorize a body, claim or purchase. Unattributed old spend cannot be
  guessed into a receipt; matching IDs cannot change amount.
- The metadata inspector scans all individually valid claim/outcome pairs,
  including valid receipts after a held slot. It validates the manifest,
  owner/channel/run/input/model binding, exact slot receipt ID and finite cost.
  Reused claim IDs are ambiguous: neither copy is credited. Missing or invalid
  scope evidence credits nothing. A valid known component of unpriced usage may
  be recorded, but the operation remains held; unknown usage is not called free.
- The same nine fixed parallel reads now retain successful responses alongside
  explicit read failures. Failed reads are **never** treated as absent objects.
  Any read failure prevents operation admission. Readable independent receipts
  can still provide cost-only evidence; an unavailable manifest cannot.
- The runner writes known cost, receipt IDs and `failed` status together through
  the actual fenced sink. It does not first mark a cost-only run as running and
  never calls its body. Repeated recovery is exactly deduplicated. If the write
  fails, the result retains known cost but does not pretend the summary is
  durable; the next valid worker can record it without buying anything.

This is a known-cost floor, not proof that all provider billing is reconciled.
Unreadable, unmatched or unpriced components remain unresolved. A recovered R2
read may later reveal the complete valid immutable graph and permit no-spend
restoration. A genuinely held/unknown paid operation does not become retryable
merely because its known charges were recorded.

## Real caller validation

Tests use the actual runner, metadata block, selector, HTTP parser, token
accounting, checkpoint functions, authenticated query, production stage sink
and stage mutation handler. Only HTTP/R2/database boundaries are fixtures;
the paid metadata contract uses the existing explicitly test-only envelope.

- Held generator response: cost is recorded after stale-parent rejection;
  three more recoveries with the model key/callback removed and zero budget
  neither add cost nor issue another provider request.
- Lost acknowledgment after creating a package claim: the selected title's
  known cost is recorded, the unknown package remains held, zero replacement
  requests and no rewritten immutable data.
- Partial R2 outage: selection/package costs are retained while comment is
  unreadable; once that exact read recovers, complete replay records its cost
  once and restores without another model request.
- Failed and stale held-cost summary writes cannot grant execution; a later
  valid writer saves the exact charge. Known cost remains in the failed result
  even if its first summary write did not become durable.
- Pure engine cases verify no reservation credit/body for cost-only evidence
  across zero, insufficient, sufficient, infinite and NaN budgets. Inspector
  cases verify all-slot evidence, duplicate claims, malformed JSON, partial
  read failures and foreign manifests without writes or observer side effects.

Source tracing also verifies the unchanged production control flow: Trigger's
self-heal loop checks `PAID_STAGE_RECONCILIATION_MARKER` before making a heal
plan; both ordinary and scheduled failure paths pass `result.costTotal` to
their existing fenced mutations. This is caller inspection, not a live Trigger
execution or proof of Convex concurrency. Existing handler/engine regressions
remain part of the full gate.

## Verification and remaining work

Focused behavior tests and **638/638 direct production-readiness test files
passed**. The subsequent actual hermetic assembly passed: 31.021995 seconds,
1920×1080 at 30 fps, four segments, 17,164.6 KiB, no assembly warnings. Output:
`/tmp/assembly-smoke-GmY0bt/bk_smoke_2_loudnorm.mp4`. This is synthetic local
regression media, not live GPU/R2 or production-channel quality proof.

Full TypeScript, scoped ESLint and Next.js build passed (51 static pages).
Graphify refreshed after the final source edits: 21,481 code nodes, 52,548 edges,
700 communities; local AST only, excluded from runtime/deployment inputs.
The approved prompt, shared transport and frozen 66-call study source hashes
remain unchanged. The exact production alias's read-only health endpoint
returned HTTP 200 at `2c8e64a0e973808e11a5bb177543f0a3ebe0c632`; this draft
was not deployed. All 151 numbered open backlog items were checked intact.

The structural audit still flags the preceding draft's
`metadata.titleDecision` store output: 68 inert-produced keys against baseline
67, with no new audit count regression from this slice. Baseline unchanged.

Logs: `/tmp/ysa-held-cost-targeted.log`, `/tmp/ysa-held-cost-typecheck.log`,
`/tmp/ysa-held-cost-lint.log`, `/tmp/ysa-held-cost-build.log`,
`/tmp/ysa-held-cost-audit.log`, `/tmp/ysa-held-cost-readiness.log`,
`/tmp/ysa-held-cost-graph.log`.

Production metadata's paid flag is still unchanged. Finite real request/input
bounds, per-request allowance, frozen-contract migration, the output audit and
live qualification remain open. All 151 goal items remain tracked; this slice
does not replace UI, bulk Salad, retention or other module work. Missing credits
do not stop those other actionable tasks.
