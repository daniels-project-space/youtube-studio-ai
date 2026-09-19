# Metadata paid admission and verified recovery

Status: **title rollout hold**, not a blocker for the wider Studio goal. Do not promote the new paid metadata path as production-ready until the admission/recovery tests below pass. No new paid route, model purchase, production mutation or production-source change was made for this review.

## Current mechanism and defect

The new metadata checkpoint correctly makes a claimed, unknown operation non-replayable and retains successful title selection for package-only recovery. That does not establish permission to spend:

- `metadataOptimized` has no `paid: true` in `src/trigger/blocks/intelligenceBlocks.ts:350`, and its override has no cost envelope in `src/engine/moduleContracts.ts:503`.
- `manifestFromBlock` derives `costAndLatency.paid` directly from `block.paid` (`src/engine/moduleManifest.ts:126`). `configuredMaxCostUsd` returns zero for unpaid modules and rejects an unbounded paid module (`:163`).
- The engine reserves before work only when both paid and a maximum are present (`src/engine/runner.ts:888`). It sets `ctx.stageBudgetUsd` only from that reservation (`:1078`). Without this, the run's after-block ceiling (`:1288`) detects an overrun **after** the purchase.
- The current metadata request wrapper checks unpriced usage and calls an optional remote-child lease hook (`src/lib/metadataTitleCheckpoint.ts:60`). The inline engine context does not supply that remote-only hook (`src/engine/runner.ts:1068`); `StageContext` explicitly documents that absence (`src/engine/types.ts:78`). This is not a local per-call spend/lease fence.

Blindly adding `paid: true` is not a complete fix. The engine deliberately blocks an inline paid stage left `running`, or failed with the reconciliation marker, before entering its body (`src/engine/runner.ts:768`). It cannot yet distinguish a safely resumable immutable operation ledger from an ambiguous old paid stage.

There is a second recovery interaction. `executionCostBaseline` credits prior cost only for remote reattachment; inline work carries the previous charge as new-execution history and has `creditedCost = 0` (`src/engine/runner.ts:151`). The reservation subtracts only that credited amount (`:894`). A $0.03 previous charge plus the full $0.05 stage envelope reserves $0.08, even if a verified same-operation ledger could establish that at most $0.02 remains. Do not change all inline baselines: a genuine new heal must still pay for its earlier and replacement work.

## Deterministic pre-fix reproduction

Ran the **actual `runPipeline`** with its real manifest/validation logic and an in-memory sink, using a deterministic test block that reports $0.02. Its initial paid classification is read from the real `metadataOptimized` manifest. This is a runner-boundary reproduction, **not actual metadata generation, a real R2 recovery, or a model-quality result**. Provider calls: zero.

| Scenario | Observed result |
| --- | --- |
| Actual metadata classification; $0.01 budget | Body executes once with no stage budget and no remote lease hook; only afterward the engine fails at $0.02. |
| Paid, $0.05 envelope; fresh $0.04 budget | Body executes zero times; pre-work reservation rejects. |
| Paid, prior `running` / $0.03; $0.10 budget | Body executes zero times; `PAID_STAGE_RECONCILIATION_REQUIRED`. |
| Paid, prior `failed` / $0.03 without reconciliation marker; $0.05 budget | Body executes zero times; `$0.03 spent + $0.05 reserved > $0.05 budget`. |
| Paid, prior `ok` / $0.03 with rehydratable output; $0.05 budget | Restores successfully; body executes zero times and total remains $0.03. |

The temporary executable is `/tmp/ysa-metadata-paid-admission-repro.ts`; it asserts each result. Source fingerprints observed during the run:

```text
src/engine/runner.ts
fa92200b8644db5cc68b1264218b2cd0447f00ee418f88e5b8debe20d29f5ea7
src/lib/metadataTitleCheckpoint.ts
eb4b6c83bf7a4e020a454d40bf7b9f9598e5e729c05eb0f920125ac414fc4aa6
src/trigger/blocks/intelligenceBlocks.ts
cbd5a38cde61d9e58ee1dd278ecc8ed4b5cf628c8dc9cedfbc5c648d2ac8e3ef
```

## Narrow integration proposal

1. **Declare paid work and reserve its actual bounded scope.** Give metadata a finite compiler envelope and require an admitted stage budget before any new provider dispatch. Bound the whole sequence, including both selection attempts, both package attempts and the optional comment. Do not use `7 * PRICE.boundedTextPassUsd`: that constant explicitly describes sub-1,500-token passes (`src/engine/pricing.ts:97`), while metadata permits six 2,500-token responses plus one 1,200-token response. At the configured pinned $3.75/M output rate (`src/lib/modelUsage.ts:191`), 16,200 maximum output tokens alone are $0.06075, before repeated full-source inputs. Use the actual route, bounded request/input sizes and model limits; an unpriced route or request that cannot fit must stop **before** purchase, without silently trimming source or lowering quality.

2. **Add an explicit, code-owned verified inline-resume capability.** The default remains the current reconciliation fence. A narrowly registered module may provide a read-only resume inspector that establishes the exact immutable ledger and returns a typed admitted/held result, recognized receipt IDs and costs, and remaining bounded operations. Presence of a callback is not proof: the runner must require its successful validation before permitting recovery. Never use a block-name exception, channel parameter or generic `retryAndResume.durableCheckpoint` exemption; that existing boolean is true for every paid block (`src/engine/moduleManifest.ts:136`).

3. **Match the actual ledger before granting credit or work.** Validate owner, channel, run, key prefix, schema/protocol version, frozen input/source and performance packet, model, exact claim ID, expected operation slot, outcome status, cost receipt ID, priced finite cost, and the admitted title/decision receipt. A missing legacy ledger, invalid model/source binding, unreadable storage, claim without a terminal outcome, held/unpriced outcome, altered result or unrecognized receipt cannot authorize a fresh purchase. Completed selection may authorize only an unclaimed package operation; it cannot rearm selection. Verify the fixed operation graph, not arbitrary keys supplied by a result.

4. **Credit only the same recognized paid work.** Reconcile known receipt cost into the all-status run baseline, deduplicating exact IDs. Subtract only the validated portion already included in persisted spend from the remaining reservation. A new heal, changed input/model, unrecognized legacy cost or another run's receipt gets no credit. Missing historical cost must be added before admission, not treated as zero. Test both recognized receipts already in `runStages.cost` and receipts durable in R2 but not yet summarized by the parent.

5. **Recheck local authority and remaining cost at each outbound call.** Introduce a properly named runner-supplied paid-dispatch capability for inline execution, with active execution-generation validation and a short dispatch window, rather than relabeling the remote hook. Require it on new metadata purchases, including retries and comments; direct unauthenticated contexts fail closed. Restore-only operations require no new budget purchase. Recheck known usage plus the next bounded call against the remaining stage allowance, preserve receipts before proceeding, and continue to hold unknown/unpriced outcomes. The existing local lease heartbeat is a reference (`convex/runs.ts:1661`), not a drop-in remote replacement: it clears remote-wait state.

The durable-text precedent is the Show Bible flow, which separately validates claim identity, current authority, owner admission and dispatch state immediately before the provider boundary (`convex/learningGovernance.ts:695`, `:765`; production caller `src/trigger/learn.ts:189`). Reuse its **invariants**, not its channel-learning policy keys or owner-daily budget as metadata's run budget. A claim acknowledged ambiguously still cannot be retried automatically.

## Required real-engine tests before rollout

- Fresh metadata with no/insufficient stage or run allowance makes zero model calls and zero paid claims; exact sufficient allowance executes the actual metadata block and accounts every provider response.
- Actual `runPipeline` → `metadataOptimized` → `craftCheckpointedMetadata` resumes a durable selected title after process replacement, regenerating neither candidates nor judgment, and purchases only the still-unclaimed package/comment work.
- `running` stage plus valid matching ledger may resume; the same state with no legacy ledger, missing outcome, mismatched source/model/owner/run, corrupt receipt or storage outage holds with zero calls. Unrelated paid blocks retain the existing blanket running-stage fence.
- $0.03 recognized prior ledger cost and at most $0.02 remaining work fit an actual $0.05 stage/run budget; unrecognized prior spend or genuinely new $0.05 work does not. Verify missing-parent-summary and already-counted-receipt variants without cost loss or double credit.
- Known response rejection follows only the bounded operation graph. Transport-unknown, expired lease, pause/supersession, unpriced usage and model change block the next request, even if earlier title work exists.
- Pause between durable claim and outbound request, concurrent resume, ambiguous R2 writes and persisted-result failure never create a duplicate paid operation. Use the real lease/claim handlers with deterministic provider transports, not a test-only retry policy.
- Completed cached stages still restore without a new envelope; current generic paid-stage reconciliation, remote reattachment, new-heal cost and budget tests remain unchanged and passing.

Until these tests and the actual deployment prove the integration, fewer potential calls or immutable R2 files are not proof of budget-safe automatic recovery. Other goal work can continue while title rollout remains held.
