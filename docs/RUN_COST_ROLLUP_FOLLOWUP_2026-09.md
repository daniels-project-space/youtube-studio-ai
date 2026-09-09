# Run cost rollup follow-up — 8 September 2026

Status: bounded projection fix implemented and locally validated on 9 September 2026, then committed as `d7642ef` and deployed by the parent in release `9caa54c`. [Release evidence](GOAL_MODULE_AND_UI_HARDENING_BACKLOG_2026-09.md#current-evidence-not-whole-phase-completion) records the 626-test CI gate, canonical Convex/Trigger deployment and live read-only compatibility check. The original read-only audit below was against `2792c0e`. Reproductions invoke real Convex handlers against an in-memory database and the real engine runner, not a live Convex deployment. No paid provider call or production test mutation was used. See the implementation/remaining-scope section at the end.

## Finding

`runStages.cost` now preserves cumulative known charges, but `runs.costTotal` can still be overwritten with a stale, lower caller total. The stage receipt survives; the run summary and analytics underreport it until a later successful reconciliation. A parent can encounter this after a child commits its charge but the parent's `remoteChildCosts.getForDispatch` read fails.

The lower-total write behavior is **pre-existing**: inspection of `45f8763^:convex/runs.ts` and `45f8763^:convex/contentPlan.ts` found the same direct assignments at the same locations. The new child receipt transport makes the authoritative stage charge durable despite that outage; it did not introduce the unguarded run-total assignments.

## Exact reproduction

Executed with `pnpm exec tsx -e` using imports of the production mutations and engine. The fixture supplies a valid service identity, matching owner/channel, current execution lease, and current child dispatch fence. It implements database reads, indexed queries and writes in memory; no provider adapter executes.

1. Register a paid remote block with a $0.50 envelope and run the real `runPipeline` with the real `upsertRunStage` mutation as its stage sink.
2. In its remote dispatch callback, call actual `remoteChildCosts.begin` and `finish` handlers: a failed child records a complete, known $0.50 charge.
3. Simulate the unavailable parent summary read by calling the same production `remoteChildFailureWithEvidence(message)` fallback used by `src/trigger/runPipeline.ts:2129`. It returns the reconciliation-required marker with observed cost zero, not a fabricated charge.
4. The actual engine fails with `result.costTotal === 0`, while the durable stage still has `cost === 0.5`.
5. Call actual `runs.updateRun` with that returned result, just as the Trigger failure path does. The run becomes failed with `costTotal === 0`.
6. Give the fixture a renewed valid lease and resume the actual engine. It loads all-stage costs, returns $0.50, and refuses another ambiguous paid dispatch. Dispatch count remains one.

Observed output:

```json
{"phase":"actual engine -> child receipt -> unknown parent summary -> actual run mutation","resultCost":0,"stageCost":0.5,"runCost":0,"paidDispatchCalls":1,"errorHeld":true}
{"phase":"resume reads all-stage cost and refuses ambiguous paid replay","resultCost":0.5,"stageCost":0.5,"paidDispatchCalls":1,"errorHeld":true}
```

A separate actual-handler fixture checked every requested terminal/deferral mutation. Each fixture first committed the $0.50 child receipt. Completion fixtures used successful stage status and matching frozen plan fields; failure fixtures used failed status. Each supplied stale caller cost zero and then called actual `analytics.overview`.

| Actual mutation | Resulting run status | Durable stage cost | Run total | Analytics total | Plan item |
| --- | --- | ---: | ---: | ---: | --- |
| `runs.updateRun` | failed | $0.50 | $0.00 | $0.00 | ready |
| `runs.completeRun` | ok | $0.50 | $0.00 | $0.00 | ready |
| `runs.deferSerializedProgramEpisodeRetry` | queued | $0.50 | $0.00 | $0.00 | ready |
| `contentPlan.failClaimedPlanRun` | failed | $0.50 | $0.00 | $0.00 | ready |
| `contentPlan.completeClaimedPlanRun` | ok | $0.50 | $0.00 | $0.00 | used |

All assertions passed. The exact missing-summary outage reaches failure writes, **not successful completion**; the completion and deferral rows separately prove their server-side invariant is missing when a caller supplies a stale total. This does not claim the outage itself marks a failed run successful.

The parent agent additionally inspected five retained non-LoFi production runs read-only: Inked Histories (`js76…`), Chalk & Compound (`js705…`), Gratitude Springs (`js72d9…`), The Quiet Stoic (`js7eh…`) and Investory (`js72sy…`). Their run totals matched their stage sums respectively: $0.50, $1.18, $0.39728, $0.071888 and $0.16024. Their 99 stage rows had no duplicate block identities, malformed/negative/nonfinite costs or owner mismatches. No rows were modified. This small healthy compatibility sample is not evidence that the outage path cannot occur.

## Call sites and impact

- `convex/runs.ts:1442`, `:2867`, `:2916`: deferral and completion assign caller cost directly; generic update copies it without a finite/nonnegative check beyond the argument type.
- `convex/contentPlan.ts:2513`, `:2566`: scheduled completion/failure assign caller cost. Completion already reads all stages at `:2465`, but uses them only to check success. Its replay comparison at `:2479` compares against the raw caller total, so a corrected-total implementation must also adjust replay semantics.
- `src/trigger/runPipeline.ts:2123`: parent child-cost lookup falls back to an unknown-cost hold if its read fails. Failure writes are at `:2407`, `:2418`, `:2576`, `:2587`; completion at `:2519`/`:2529`; serialized deferral at `:2362`.
- `convex/remoteChildCosts.ts:77` and `:94`: child finishes retain the cumulative stage cost and receipts, but do not update the run total.
- `convex/factualReviewCheckpoints.ts:379`, `:412`: the awaiting-review boundary has the same caller-total assignment. Include this existing writer in a coherent run-rollup guard; do not change its source-authority or review gates.
- `convex/thumbnailRefresh.ts:645`: the evidence-bound ERNIE batch import records a run cost without normal pipeline stage rows. Preserve this legitimate non-stage cost; never replace run total with only a stage sum. The import is separately approval/evidence fenced, not a demonstrated trigger of this outage.

User-visible impact is real: `analytics.overview`/`channelSummary` sum run rows (`convex/analytics.ts:84`, `:125`). Run detail and list, channel spend, recent-spend cards, overview spend and historical charts consume those values (`src/app/(app)/runs/[runId]/page.tsx:170`, `src/app/(app)/runs/page.tsx:42`, `src/app/(app)/channels/[slug]/page.tsx:339`, `src/lib/channelCardProjection.ts:15`, `src/lib/studioOverviewModel.ts:241`, `src/lib/runStats.ts:40`). The handler reproduction verified the analytics undercount directly.

No additional paid-budget bypass was demonstrated by this rollup gap. The current runner resumes from **all stage costs**, not `runs.costTotal` (`src/engine/runner.ts:486`–`:539`); the child budget admission also sums all stage costs (`src/lib/remoteChildBudgetAdmission.ts:90`). The exact outage reproduction retained the reconciliation hold and prevented paid replay. Channel budget is a frozen per-run ceiling, not an observed account-wide spend cap. Do not describe this as a proven daily-cap bypass.

## Implementation design

Introduce one Convex-side helper for **known run cost floors**, invoked inside the existing authorized/fenced mutations, not through a new network call:

```text
effectiveKnownCost = max(existing run cost, supplied caller cost if any, sum of durable stage costs)
```

- Validate every supplied/persisted amount as finite and nonnegative. Missing optional legacy stage cost is zero; malformed amounts must not quietly become zero. Preserve a clear integrity error instead.
- Index the per-run stage read with `by_run`. Allow callers that already loaded the stages, notably scheduled completion and factual review where applicable, to pass them to the helper. Avoid a fleet scan and avoid a new Trigger-to-Convex round trip.
- Apply it to `completeRun`, serialized deferral, scheduled completion/failure, awaiting factual review, and `updateRun` whenever it changes a cost or enters a terminal state. Leave metadata-only or heartbeat-only writes on their current cheap path.
- Do not let a missing optional caller cost suppress reconciliation at a terminal failure. Do not let lower caller cost, missing stages or later archival reduce the existing run total.
- Store the original caller amount in an optional scheduled-completion receipt. Compare an idempotent replay against that original amount, while checking that the effective durable floor still matches the completed run total. Comparing only normalized amounts would incorrectly accept changed caller amounts below the floor. Legacy rows without the receipt retain their original raw-total replay contract. Keep all identity, success, publish and lease checks unchanged.
- Prefer returning the effective total from completion/deferral responses if the Trigger completion result and advisory budget notification must reflect it immediately. Database/UI correction alone should not be mislabeled as correcting every in-memory worker return value.

### What to sum, and what not to sum

The normal write contract has one canonical `(runId, block)` stage row: `upsertRunStage` uses an indexed `.unique()` read before writing. Its `cost` is cumulative across failed attempts and healed generations. `advanceSelfHealGeneration` changes status to superseded without refunding or copying cost (`convex/runs.ts:1743`–`:1773`). Therefore sum each canonical stage's **cost once, across all statuses**. Do not add `costBeforeExecution`, `remoteChildCostAttempts` or `checkpointCostReceipts` on top: those are components/evidence already represented by the stage cost. Do not deduplicate equal dollar amounts or input hashes: distinct paid attempts may cost the same amount.

Historical duplicate rows for the same block cannot be safely repaired by choosing max, summing blindly, or deduplicating by price. The healer currently tolerates multiple historical rows when marking them superseded, although ordinary writes expect uniqueness. A helper should detect duplicate block identity and report/fence ambiguous accounting for explicit reconciliation; it must not invent which row is a duplicate charge. Likewise, an identical checkpoint receipt assigned to different block ledgers would be an integrity issue to investigate, not permission to silently subtract it. The current production adapters scope checkpoint identities to their module/checkpoint purpose.

The run total should remain monotonic even if stages are removed. Current normal healer/retention work does not delete stage cost rows; the inspected channel-delete path removes stages together with the whole run (`convex/channels.ts:1036`). If a future workflow archives a stage while retaining a runnable run, a max-only floor preserves already recorded spend but is **not enough** to add new spend after archival (old floor $0.50 plus a new $0.10 stage could otherwise remain $0.50). That future workflow needs an explicit archived-cost subtotal or transactional stage-cost-delta ledger, and must establish the run floor before deleting accounting rows. It is not justification to lower totals now.

Optional subsequent slice, not necessary for the bounded terminal fix: update the run's known-cost projection atomically when a stage charge increases, including `remoteChildCosts.finish`, to improve live display and survive a parent that never returns. Use exact stage-cost deltas and a reconciled historical baseline; do not add a child's cumulative receipt total on each finish. Avoid an all-stage read on every progress/heartbeat write just for visual freshness.

## Validation matrix

1. Preserve the exact real-engine/child-receipt/missing-summary reproduction: terminal run and analytics must both become $0.50; paid dispatch count stays one.
2. Exercise all five actual handlers above plus awaiting factual review; run totals must include failed and superseded stage costs, not just successful outputs.
3. Higher existing run total survives a stale caller, no stage rows, missing optional caller cost, and a smaller retained stage set.
4. Higher genuine caller total is retained for non-stage/imported accounting; never add it a second time to stage sums.
5. Failed attempt plus successful attempt in one cumulative stage is counted once at the cumulative amount. Baseline, child attempts and checkpoint arrays are not added again.
6. Equal-price distinct paid attempts remain separate charges; exact receipt replays remain idempotent.
7. Scheduled success replay with the original stale caller amount succeeds only for the same completed plan/run identity and does not write again or duplicate topic memory. Changed lower and higher caller amounts reject; malformed persisted replay amounts reject; old rows without the new optional receipt retain their legacy behavior.
8. Wrong owner/channel, stale lease, changed immutable plan, incomplete stages, and protected publish fences still reject without a write.
9. Reject negative, NaN and infinite totals and malformed stage data; detect duplicate block rows rather than guessing their charge identity.
10. Concurrent child-finish and parent-terminal transactions cannot leave a run below an already-committed stage floor. Child work that loses the execution fence must still stop, not regain authority through rollup accounting.
11. Metadata/heartbeat-only update paths do not perform new stage reads; completion reuses already-loaded stages. Assert query counts with the handler fixture.
12. Rerun the healer/remote-cost/checkpoint, scheduled-plan, factual-review, publish-continuation and authorization suites, then full tests/typecheck/build. After authorized deployment, sample exact production run totals versus stages and UI, without rendering new paid work merely to test arithmetic.

## Implemented checkpoint — 9 September 2026

- Added `convex/runCostAccounting.ts`: shared finite/nonnegative validation, exact canonical all-status stage sum, duplicate/invalid block rejection, owner/run binding for preloaded rows, overflow rejection, and monotonic max floor. Missing `undefined` legacy stage cost alone means zero; explicit `null` is rejected.
- Wired the existing `completeRun`, serialized deferral, scheduled completion/failure, explicit-cost or terminal `updateRun` writes, and valid `createAwaiting` transitions. Scheduled completion and factual review reuse their existing stage reads. Metadata/liveness-only updates add no stage query; other covered boundaries add one indexed per-run query within their existing mutation, not another worker RPC.
- Added optional `runs.scheduledCompletionCallerCostTotal`, set only on the first successful scheduled completion. Original stale-zero replay succeeds without any write; changed $0.20/$0.60 replays reject. A malformed stored receipt, including null/NaN/Infinity/negative values, rejects before comparison. Original finished-at tolerance is unchanged.
- Added `src/lib/__tests__/runCostAccounting.test.ts`, covering the real engine/child outage and actual terminal/analytics handlers, all covered boundaries, factual-review artifact binding, query counts, owner/lease/plan/publish fences and the arithmetic/replay cases above. Existing publish-continuation and authorization test fixtures were minimally extended to support the real `.collect()` stage query; their assertions were preserved.
- Independent review reran the new suite and found no remaining actionable issue in this bounded slice. Eleven targeted suites passed: run cost accounting, scheduled plan runtime, factual review lease recovery, factual review resume, publish continuation state, Convex authorization, healer cost recovery, remote child cost transport, remote child budget admission, thumbnail checkpoints and recovery policy. Typecheck passed; touched-file ESLint has zero errors (three pre-existing unused-variable warnings in the authorization test fixture). Full combined build/release validation remains with the parent agent.

Corrected regression result: the intentionally stale in-memory worker result remains $0.00, but `updateRun` now persists $0.50 and the actual `analytics.overview` query returns $0.50. Engine resume reads $0.50 and preserves the ambiguous-paid-work hold; dispatch count remains one.

Remaining scope is explicit:

1. Worker return contracts and their notification values were not changed. This is a durable run/UI projection fix, not a claim that every in-memory worker result now contains reconciled charges.
2. Child-cost writes do not yet refresh run totals while the parent remains active or never reaches a covered boundary. The optional stage-delta projection described above remains future work.
3. Factual-review source, artifact, invocation and immutable-checkpoint integrity failures still execute `blockCheckpoint` before accounting. Those protective transitions may retain an older run summary; malformed accounting or a failed accounting read must never prevent their safety block. Tests deliberately combine malformed accounting with invalid invocation/checkpoint identity and verify `factual_review_blocked` still persists. A later change should separate nonthrowing known-cost projection from blocking and record explicit reconciliation state, not weaken these gates.
4. Other specialized writers/import workflows and historical rows were not globally rewritten or backfilled. Existing queued deferral replay remains a no-write receipt return. The five-run/99-stage production sample was read-only compatibility evidence, not a production deployment test of the new implementation.
5. The concurrency fixture proves both serial orderings (child charge first versus parent terminal fence first), not live Convex optimistic-concurrency execution. Parent and child transactions read/write intersecting run/stage data; actual contention retry remains a platform behavior to verify in the authorized release workflow.
