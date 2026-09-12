# Stage reuse: original inputs, original identity

Date: 12 September 2026. Status: local implementation validated through the frozen gate; rollout remains pending. Not deployed.

## Verified defect

`scripts/replay-stage-reuse-regression.ts` loads the exact runner at `f2a345b` and compares it with the current runner. Both use the production `qa_script`/`narration_tts` ABIs and actual storage rehydrator. Provider execution is replaced with a hard sentinel; storage and persistence transports are controlled. This is an engine-admission proof, not a claim about spoken audio or a published video.

| Same requested input | Original runner | Replacement |
| --- | --- | --- |
| “White moves the pawn from e2 to e4.” | Accepts cached transcript “Black castles on the opposite side.” | Refuses the unproven cached approval before adoption |
| Rewritten artifact-lineage batches | 2 | 0 |
| Storage HEADs in this rejected case | 1 | 0 |
| Provider entries | 0 | 0 |
| Retained synthetic recorded cost | $0.21 | $0.21 |

Original runner SHA256: `fa92200b8644db5cc68b1264218b2cd0447f00ee418f88e5b8debe20d29f5ea7`. The exact reproduction log is `/tmp/stage-reuse-baseline-replay-20260912.log`.

## Implementation and boundaries

- Every successful runner stage seals `stage-reuse/v1` alongside its exact persisted outputs. Identity covers owner/channel/run/storage scope, module version, declared contracts, parameters, provider profiles, and every required/optional input, including absence. The run budget is still an execution envelope, not a reason to repurchase an unchanged artifact.
- Cache adoption validates that receipt before rehydration, then checks that rehydration changed only supported worker-local media addresses. Text, captions, timing, key order and durable storage keys remain bound. Original output references and durable output rows are preserved, not re-stamped with current lineage or temporary paths.
- Valid unchanged retries keep completed work and cumulative spend. Missing/corrupt receipts, changed inputs/configuration/outputs, or input mutation cause a reconciliation hold. A second attempt cannot turn that hold into fresh work. The healer cannot automatically supersede it.
- Remote workers use the same boundary for every preceding successful stage. They reject missing/failed/malformed upstream rows and select the receipt's original artifact identities, eliminating the historical last-row-wins artifact query. A post-execution mutation hold retains the cost transaction already observed by the real remote cost transport.
- The Convex receipt uses the existing successful stage write and existing resume read. It is omitted from slim browser queries. A new running execution or an unsealed output replacement clears the old success receipt; a pure cached status update and a reconciliation hold retain it.
- Explicit, audited per-block projections preserve unrelated repairs: `stock_footage` reads only its own `healHints` entry; `timeline_assemble` reads its own `healHints`/`healClasses`. Legacy whole string/array hints remain meaningful. Other modules default to full input identity.
- Large projected outputs retain a portable content identity and an explicit producer-sealed deferred flag. Completed consumers can reuse their existing result without downloading the omitted inline certificate. Fresh execution requires an explicitly declared durable loader. Only the three inspected certificate consumers (`upload_draft`, `cleanup`, `shorts_spinoff`) opt in; their existing parser, content-addressed namespace and full evidence checks remain intact.

This is provenance/integrity of execution inputs and stored records, not a substitute for independent semantic QA or checksums of every R2 object. A durable key is not proof that its bytes have never changed. Module versions must still be maintained when implementation semantics change. No provider/model/thumbnail configuration is changed.

## Rejecting tests and corrections

- 71 receipt-level cases cover required/optional inputs, scope/configuration/contracts, reference changes, tampering, relocation and JSON persistence.
- 13 actual-runner lifecycle cases cover unchanged repeated resume, stale approval/audio, malformed completed rows, nested mutation, original lineage, retained costs, and refusal before replacement work.
- 12 actual-remote-worker cases use isolated external transports but real admission, budget, checkpoint and cost-transport code: unchanged restoration, ten pre-spend refusals, and post-execution mutation with recorded cost preserved.
- Six actual-runner projected-certificate cases use the real QA projection and certificate/reference validators. They cover cached/fresh consumers, absent-payload semantics, changed inline/reference content and a produced-input mutation that remains held across a second invocation.
- Actual Convex mutation/query handlers and the production sink verify receipt persistence, same-query restoration, slim response exclusion, invalidation and preserved spend against an isolated database transport.
- Existing demand-planning, recovery, factual review and cost-recovery tests retain their behavioral assertions. Synthetic completed fixtures now obtain receipts through private cloned blocks executed by the real runner; this helper is test-only, never a legacy migration.

Independent rejecting probes found and corrected: marker-shaped objects aliasing media strings; overbroad normalization of nested non-media paths; false misses after JSON omits `undefined`; omitted large QA certificates invalidating valid resumes; fresh consumers silently treating deferred input as absent; and mutation errors missing the durable hold marker.

The first full sweep ran 694 direct tests and found one failing old QA-cache fixture. Adapting that fixture exposed a real retry-compatibility mistake: existing typed source-read errors may safely retry storage without buying compute. Only the new cache-identity hold now overrides retry metadata; the existing bounded storage retry protocol is preserved. The final focused check and frozen full sweep are tracked below rather than treating the initial sweep as passing.

## Release gate / remaining work

- The frozen local gate passed: 695 direct production-readiness tests and the actual 31.021995-second hermetic assembly, production build, TypeScript check and scoped lint all completed successfully. Structural audits did not regress; one pre-existing unbounded-normalization audit improved from two findings to one, without saving a new baseline. Graphify was refreshed after the source changes.
- Current local proof logs: `/tmp/stage-reuse-frozen-readiness-20260912.log`, `/tmp/stage-reuse-qa-preflight-final-20260912.log`, `/tmp/stage-reuse-frozen-typecheck-20260912.log`, `/tmp/stage-reuse-frozen-build-20260912.log`, `/tmp/stage-reuse-frozen-lint-20260912.log`, `/tmp/stage-reuse-final-structural-audit-20260912.log`, and `/tmp/stage-reuse-graph-update-20260912.log`.
- Before release, inspect active production resumptions. Existing completed rows without a receipt are deliberately held, not backfilled from summarized inputs, deleted or regenerated. Stage inputs previously retained only summaries and do not establish exact configuration/provenance; a fabricated migration would recreate the defect.
- Verify the actual Convex/Trigger/Vercel release and a new receipt-bearing workflow before claiming production readiness. No production mutation, paid render, GPU allocation or upload occurred in this work.
- Source-bound expressive chess narration, exact pre-TTS approval, narration/board timing, and the full 163-item module/UI/fleet backlog remain open. This repair is a prerequisite, not completion of those requirements.
