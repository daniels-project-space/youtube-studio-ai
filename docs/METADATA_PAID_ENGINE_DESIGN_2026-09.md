# Metadata: paid admission through the actual engine

Status: read-only implementation design, 2026-09-09. **Not implemented or production-qualified.** The title rollout hold in `METADATA_PAID_ADMISSION_FOLLOWUP_2026-09.md` remains. No frozen title, transport, checkpoint or engine source was changed for this review; no provider calls, production mutations, deploys or graph updates were performed.

## Evidence and the integration point

Graphify was used for `runPipeline`, `configuredMaxCostUsd` and `assertPipelineInvocationCompilation`, followed by their targeted current callers. Serena was unavailable. Owner lock discovery returned no marker files. An independent reviewer traced the actual service authentication and lease handlers.

The existing `/tmp/ysa-metadata-paid-admission-repro.ts` was rerun successfully against the real `runPipeline` and current metadata manifest. It uses a deterministic reporting block, **not a real metadata/model execution**. Its five assertions still reproduce: metadata spends before the run ceiling; a fresh paid envelope rejects before the body; interrupted generic inline paid work holds; the same inline $0.03 charge plus an unreduced $0.05 envelope over-reserves; completed paid output restores without re-spend. Source hashes match the prior follow-up document. This is a boundary reproduction, not the integration acceptance test proposed below.

Existing `metadataTitleRecovery.test.ts` (actual metadata block, in-memory conditional-write fixture) and `runLease.test.ts` also passed independently during this review. These establish the unchanged seams, not implementation of the proposed admission capability. Frozen metacraft/Anthropic-adapter/OpenRouter and checkpoint/runner hashes were rechecked unchanged; `git diff --check` passed.

Current ordering in `src/engine/runner.ts`:

1. One `getResumeState` read loads every stage cost and completed output.
2. `executeBlock` computes the local/remote baseline and creates its receipt scope.
3. The interrupted-paid fence rejects before entering the module body.
4. Completed outputs rehydrate and return without a new reservation.
5. The compiler envelope is reserved, then the stage is marked running.
6. A declared-input `StageContext` is constructed and the module executes.

For a checkpoint-aware module, the new read-only inspection belongs **after the completed-output restore path and before interrupted-paid admission, reservation or a new running-stage write**. Generic blocks keep their existing behavior. No proof is needed to spend again when completed outputs restore, because that path spends nothing; missing completed paid outputs must continue to hold unless an explicit, separately verified reconstruction is admitted.

Two important constraints are easy to miss:

- The actual metadata arguments are assembled inside `metadataOptimized.run` (`src/trigger/blocks/intelligenceBlocks.ts:350`). An inspector cannot reconstruct them from the topic or a shortened source. It needs the exact same pure input builder.
- `configuredMaxCostUsd` requires a finite absolute contract, and a runtime resolver may only reduce it. Compiler/preflight callers have no artifact store (`src/engine/pipelineCompiler.ts:711`, `src/engine/validate.ts:151`). Full narration, continuity, identity, fetched evidence and performance text currently have no common request-size ceiling. A convenient small dollar constant is not a justified envelope.

## First safe implementation slice: inspect, do not authorize yet

Implement a read-only `inspectMetadataTitleCheckpoint` and extract one pure `metadataTitleArgsForStage` builder. Do **not** mark metadata paid, exempt it from the interrupted-stage fence, change model prompts, or enable a new production purchase in this first slice.

Suggested ownership/files:

- `src/trigger/blocks/intelligenceBlocks.ts`: move the existing argument construction unchanged into the shared pure builder; both production execution and inspection use it with the same declared store.
- `src/lib/metadataTitleCheckpoint.ts`: reuse, rather than duplicate, the binding/read/claim/outcome/decision validators in a read-only inspector. Preserve the existing create-only execution protocol.
- `src/lib/metadataTitleInputs.ts`, only if extraction materially simplifies the block: pure argument/identity construction; no storage, credentials, provider calls or fallback data.
- Focused inspector tests and an actual-block input parity test. No generic engine integration until these pass.

The builder must preserve all current distinctions: complete narration versus section fallback versus topic only; exact source coverage; serialized episode context; actual program-route family; channel persona/name/language; style-DNA title and description guidance; planned/bet candidates; clickbait level; optional competitor evidence `undefined` versus `[]`; and the same power-word extraction. Finishing-only inputs such as attribution/chapters/banned words stay finishing inputs, not invented title evidence. The inspection context should be restricted to identity, params, declared immutable store/artifact references, and a read-only checkpoint reader; it must not expose provider or write methods.

The bounded ledger contains only `manifest.json` and claim/outcome pairs for `selection`, `package-1`, `package-2`, `comment`: at most nine known-key reads, which can be batched without listing a bucket or probing arbitrary returned paths. Read the fixed slots even when the manifest is absent, so orphaned operation records do not become a false fresh start. This establishes the state of this versioned protocol, not absence of all possible historical work.

The inspection result should distinguish:

```ts
type MetadataCheckpointInspection =
  | { kind: 'fresh'; binding: ExactBinding; /* no manifest or operation records */ }
  | { kind: 'restorable'; proof: VerifiedMetadataCheckpoint; /* all required work complete */ }
  | { kind: 'continuable'; proof: VerifiedMetadataCheckpoint; remainingSlots: readonly OperationSlot[] }
  | { kind: 'held'; code: string; /* no spending authority */ };
```

`VerifiedMetadataCheckpoint` is constructed only after validation and carries the exact owner/channel/run/key prefix/input/model/protocol binding, frozen argument fingerprint, immutable claim IDs and outcome fingerprints, priced receipt IDs/amounts, and the legal next operation slots. The engine validates its expected binding and accounting again; a boolean, a callback's mere existence, a module name or `durableCheckpoint: true` never grants recovery. A TypeScript brand helps prevent accidental construction but is not a security boundary or substitute for runtime checks.

Validation requirements:

- Exact current binding plus frozen performance context and actual manifest argument payload; do not refresh performance/evidence during a resumed selection.
- Each outcome has the exact corresponding claim and `checkpointCostReceiptId(key, claimId)`, finite nonnegative cost and zero unpriced usage. Unknown status, changed amount, duplicate/foreign identity, orphan outcome or malformed JSON holds.
- Pending claim, held outcome or unreadable storage holds; only precise `NoSuchKey`/`NotFound` means absence. Missing legacy evidence plus prior running/paid history is not fresh.
- Successful selection passes the existing `assertTitleDecision`; successful packaging must match its title, alternate and decision fingerprint. No post-selection winner changes.
- Validate the operation graph, not just each row: no package/comment before selection; no package-2 after a successful package-1; no comment before a valid package; both rejected packages cannot continue. A rejected selection has already exhausted its internal bounded selection loop and does not authorize another selection.
- A comment rejection can produce the existing empty optional comment only when the outcome is fully received/priced. Unknown/unpriced comment work still holds.
- Explicit supersession/new inputs/model changes never silently reuse or delete this same ledger. Old valid work can be retained while a different execution requires separate admission.

## Engine capability and exact cost credit

After the first slice is proven, add a small optional **code-owned executable** capability on `Block`, not a manifest/channel-config flag. A possible shape is `inspectPaidInlineResume(readOnlyContext)`. The runner only invokes it for inline blocks and only admits a returned validated proof. Remote reattachment keeps its current path. The adapter owns semantic ledger validation; the engine owns expected identity, numeric validation, budget, state transition and receipt accounting.

Avoid importing metadata or R2 into `runner.ts`. Supply the registered adapter through the existing executable block object; the engine receives a normalized proof containing fixed receipt evidence and legal remaining work. Bind that proof to the same immutable inputs passed to the eventual body. Revalidate immutable records/claims at execution; the inspection is a snapshot, not a mutex.

Separate **cost accumulation** from **remaining reservation**. Do not alter `executionCostBaseline` for every local retry or copy remote `costBeforeExecution` semantics into local execution.

For one validated current ledger, let:

- `P`: persisted cumulative stage cost, including old failed/superseded work.
- `A`: the sum of all exact receipt identities already attributed in that stage.
- `L`: the sum of validated current-ledger receipts.
- `M`: current-ledger receipts whose exact IDs and amounts are already in the stage.

All amounts/sums must be finite and nonnegative; duplicate conflicting amounts and `A > P` reject. If `L > M` and `P > A`, attribution is ambiguous: the apparently missing receipt may already be inside the unlabelled stage cost. Hold rather than infer from equal amounts. Otherwise newly discovered durable spend is `N = L - M`, and the corrected cumulative baseline is `P' = P + N`. Persist its receipt union through the existing fenced monotonic stage sink **before any new claim or purchase**, then update the in-memory run total by `N`. Failure to persist stops spending.

The execution receipt scope must then be based on the corrected `P'` and union, so reading these same R2 outcomes during the module body does not charge `N` twice. New provider usage remains a separate non-creditable floor; mixed restored $0.20 plus fresh failed $0.10 must retain the new $0.10. Unrelated old stage charges remain in `P'` even when the current ledger has a smaller envelope.

For the simplest safe same-ledger reservation, subtract verified ledger spend only from that ledger's **unchanged admitted total envelope**: remaining allowance `E - L`; reject `L > E`. Existing total `P'` already includes `L`. The $0.03-known / $0.05-total example then reserves $0.02, not $0.05. A later refinement may reserve only the legal remaining slots' worst-case bound `W`, provided `L + W <= E`; never use `min(W, E - L)` while pretending the complete remaining plan fits. Completed slots, not equal dollar values or input similarity, eliminate future work.

`assertRemainingBudgetReservation` currently independently recomputes `executionCostBaseline` for each future paid block. Its current-block calculation must use the same verified credit as the initial admission, or it will reintroduce the over-reservation later. Do not fetch R2 for every future block: only apply proofs already obtained, reserve other uninspected work conservatively, and retain the existing required-future-block checks.

For generality, credits must not race with parallel reservations. Metadata is currently outside every parallel group, so the first enabled capability should explicitly require sequential execution. Test that capability-bearing blocks are rejected from a parallel group until a shared reservation ledger exists; do not silently claim the current per-block local arithmetic is cross-worker accounting.

## Local per-call authority: the real existing lease chain

The production identity chain is `StudioConvexHttpClient` service JWT → `leaseOwner = Trigger ctx.run.id` → `claimExecutionLease` → `{ leaseOwner, executionLeaseToken }` → `engineOpts.executionLease` → `StageContext.executionLease`.

Relevant symbols:

- `src/trigger/runPipeline.ts:1037`, `:1041`, `:1141`, `:1161`, `:2060`.
- `convex/runs.ts:1246`: a same live owner keeps its generation; a new/recovered execution increments it.
- `src/lib/runLease.ts:103`: `assertRunExecutionWriteFence` validates running status, exact owner/generation and unexpired lease.
- `convex/runStages.ts:51`: stage writes already reassert the server-time fence, but that earlier write does not protect a later provider request.
- `convex/studioFunctions.ts:55`: `requireStudioServiceIdentity` rejects public viewer/owner sessions as provider-evidence authority.

Add a tiny service-only query, preferably in a narrow `convex/runExecutionAdmission.ts`, accepting exact owner/channel/run plus generation. It loads and scopes the run (and channel if needed for scope validation), calls the existing fence with **server** `Date.now()`, and returns only validity/expiry. No stage scan, heartbeat write, credential material or provider configuration in the response.

Wire an explicitly named callback through `src/trigger/runPipeline.ts` → `RunPipelineOptions` → `StageContext`, e.g. `assertInlinePaidExecutionLease()`. New metadata claims and every runtime JSON request must require it, not optional-chain it. Direct production contexts without an admitted budget and callback fail closed. Completed immutable replay needs no provider dispatch and therefore no new purchase, although any durable engine writes still require their normal generation fence.

**Do not reuse `heartbeatExecutionLease`.** It calls `clearRemoteChildWaitPatch()` (`convex/runs.ts:1684`) and can invalidate a concurrently waiting remote child. Do not repurpose `updateRun({})` either: it still writes and is not an explicit channel-bound assertion. The new query must leave remote-wait state unchanged.

Authority semantics need to stay honest:

- The existing lease primitive does not inspect global automation, channel status or owner/module source locks. Source/config locks prevent modification, not execution of an already frozen pipeline; they are not bypassed by this feature.
- Channel “paused” currently changes scheduling eligibility; `channels.updateChannel` does not invalidate an active run generation. `STUDIO_AUTOPILOT` is a scheduler gate, not a manual/private-benchmark kill switch. Do not silently change those policies in this slice or claim a channel scheduling pause cancels an active render.
- A stale/recovered/terminal/expired run must block the next provider callback. An explicit future active-run cancellation policy can invalidate the generation, but needs its own user-visible semantics and tests.
- Check immediately before the outbound request, including each of the up to four internal selection calls. A separate Convex check cannot be atomic with an external HTTP acceptance. If the generation changes after a successful check, one already-admitted in-flight call can finish or become unknown; immutable claims prevent buying it twice. Do not claim instantaneous cancellation or exactly-once external execution.

## Budget sizing and per-call guard: decisions still required

The maximum currently permitted sequence is two generator calls, two judge calls, two package calls (each at 2,500 output tokens), plus a 1,200-token comment: 16,200 maximum output tokens. The pinned local pricing table currently gives $0.06075 for that output ceiling alone; this is **not the full cost reservation**. Inputs repeat the full shared packet and include schema and generated candidate framing; reasoning/provider billing semantics and input token bounds must be verified before defining a hard ceiling.

A bounded first integration should:

1. Establish a named/versioned absolute metadata reservation from documented model limits or a defensible request-input bound, approved output limits and the unchanged approved route. Reuse the existing pricing source rather than a second drifting price table. No cached-input discount for a worst case.
2. Reject an oversized/unpriceable request **before HTTP**, without truncating narration, deleting identity/evidence, lowering the model or pretending the title is qualified. Full-source support remains explicit; an excessive source becomes an honest budget/configuration hold.
3. Before each call, validate known monotonically increasing usage, zero unpriced usage, exact model/parameters/request bound, available stage allowance and the legal operation slot. Failed transport with unknown charge holds the existing claim. A fully received invalid response may use only the already bounded next slot.
4. Keep counters and known charges across the complete bounded selection operation. Its existing single durable claim intentionally spans several requests; a process loss inside that claim holds the selection rather than regenerating it. Package attempts already have independent durable claims.
5. Do not describe a byte/character heuristic as an authoritative tokenizer or billing guarantee. The numerical absolute ceiling remains a prerequisite to switching `paid: true`; this design deliberately does not guess it.

The simplest first per-call implementation can live in the current metadata runtime wrapper, reading runner-supplied remaining allowance and invoking the required local lease callback. Default shared transport callers should not gain extra database traffic. R2-completed replay does not invoke the wrapper. If actual response memoization avoids an HTTP request, a conservative pre-wrapper check may still happen; it must not record a provider charge for that check.

## Rollout sequence and frozen-run compatibility

1. **Read-only inspection/input parity** as above, including malformed state, legal graph and exact receipt tests. Keep rollout held.
2. **Service lease assertion + typed engine capability plumbing**, disabled for production metadata purchases. Test real Convex handler behavior and default paid-block invariants. No generic whitelist bypass.
3. **Verified baseline reconciliation/credit + request-bound admission**, tested through actual `runPipeline` → real metadata block → real checkpoint helper → actual JSON/parser/model-usage wrappers with deterministic HTTP/R2 boundaries. This is the first test that can establish the complete integration; the old reporting-block probe cannot.
4. **Enable paid contract and pinned provider profile only with a defensible finite envelope**, correct required-key admission, all regression tests and independent review. Recompile affected pipelines and inspect real per-video budget impact before production rollout.

Version this behavior intentionally. `pipelineCompiler`'s fingerprint currently includes module version/config/capabilities but **not the paid flag or cost envelope**. Merely flipping those fields would silently change the effective spend contract of an existing frozen invocation. A metadata contract version bump correctly triggers `assertPipelineInvocationCompilation` drift for old snapshots. Do not rewrite their frozen snapshot, suppress drift or purchase under a newly invented budget. Decide a bounded existing-run compatibility/reconciliation policy before activation; new invocations can use the newly admitted contract. The pure title calibration is independent of this rollout decision.

## Exact acceptance matrix

- Actual metadata fresh with zero/NaN/infinite/insufficient budget: zero HTTP calls and zero paid operation claims; no synthetic “success” fallback.
- Full-source/identity/frozen-empty argument parity between inspector and actual body, including section fallback and serialized continuity; undeclared store reads still throw.
- Inspector nine-key read bound; no writes, research calls, credentials, body execution or bucket listing. Fresh requires no ledger records; orphan/malformed/missing-manifest history holds.
- Valid selected title plus rejected package-1 resumes only package-2/comment across process replacement. Selected title, decision fingerprint and frozen performance bytes remain exact.
- Running/failed same-ledger recovery succeeds only with the proof; generic running paid stages and remote reconciliation markers still hold. Callback presence or forged JSON proof cannot admit work.
- Prior $0.03 exact receipts, total envelope $0.05: at most $0.02 new reservation, total cost preserved. Test already-counted receipts and R2-known/parent-missing receipts; sink failure before credit persistence makes zero new calls.
- Unlabelled prior charge plus unknown receipt holds; equal amounts/identical inputs do not deduplicate. Historical non-ledger spend remains cumulative. Restored $0.20 plus fresh failed $0.10 totals $0.30, not $0.20.
- Current-block remaining-budget assertion uses the same credit; future uninspected work stays reserved. Capability inside a parallel group is rejected until shared reservation handling is implemented.
- Actual service handler accepts only current owner/channel/run/generation, uses server time and performs zero writes; denies viewer, owner-session impersonation, stale token, wrong scope, expired/terminal run and read failure. Remote-wait fields remain byte-identical.
- Generation replacement between selection requests, between claim and request, and before package/comment blocks the next call. Existing scheduling pause semantics are not silently changed.
- Unknown transport/body or unpriced usage holds before all later spend. Each known-invalid response consumes only its bounded retry; a persisted package exhaustion never regenerates title selection.
- Completed R2 replay with removed provider key restores without new HTTP; completed stage rehydration remains the existing no-spend fast path. Concurrent claims and ambiguous persistence never produce two purchasers.
- Output token, input/request size, model/rate and counter boundaries reject before HTTP where knowable; real observed over-envelope response is retained as cost and stops subsequent calls, not hidden as zero.
- Versioned contract causes old frozen invocation drift rejection; no test “fixes” it by mutating the snapshot. New invocation compiler/preflight reservation and actual handler/worker admission agree.

Preserve existing `healerCostRecovery`, `stageBudget`, `remoteChildBudgetAdmission`, `remoteChildLeaseFence`, `runLease`, completed-cache recovery, invocation snapshot, metadata checkpoint, title-decision and actual HTTP memoization suites. Mock transport proves protocol/race handling, not model quality, actual Convex OCC or live R2 availability. Those remain separate validation layers.
