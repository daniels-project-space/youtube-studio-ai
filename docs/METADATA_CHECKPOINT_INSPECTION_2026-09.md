# Metadata recovery inspection — 9 September 2026

Status: implemented in the local title draft; production admission remains held.
This advances the first slice of [the engine design](METADATA_PAID_ENGINE_DESIGN_2026-09.md), not the entire paid-admission rollout.

## Actual changes

- `metadataTitleArgsForStage` is the pure builder used by the real metadata block. Its input type exposes only the declared store, parameters and run identity. It preserves complete narration, fallback sections, source coverage, channel/route/persona/language, frozen-empty versus absent competitor evidence, serialized continuity, warm candidates and existing guidance. Finishing-only inputs do not become title facts.
- `inspectMetadataTitleCheckpoint` reads exactly nine known keys: the manifest and four claim/outcome pairs. It has no provider, write, listing, performance-fetch or cost-accounting callback. It returns fresh, continuable, restorable or held evidence; **none of those results authorizes spending**. Supplying prior running/failed/completed or paid history prevents an absent ledger from being described as a fresh execution.
- The actual checkpoint executor now runs the same full-ledger validation before writes, research or paid work, then reuses those reads. Its create-only claims still decide who can purchase; inspection is not a lock. A manifest-create race performs one additional targeted read after the existing conditional-write conflict.
- Existing and new execution share manifest, claim/outcome and package validators. The inspector checks exact identity/input/model binding, decision integrity, frozen performance, priced receipt identity/amount shape, source/evidence continuity and legal operation ordering. A successful first package forbids a second; an exhausted selection or both rejected packages do not become a new attempt. An unknown/unpriced optional comment still holds; a fully received rejected optional comment can restore as empty.
- Valid saved receipts remain visible to execution cost accounting before a later record holds. The read-only inspection itself never attributes or charges them. New proof records carry claim IDs, outcome hashes, exact priced receipts and the frozen argument hash; future engine admission must independently validate identity and reconcile historical attribution.

## Bounded storage work, not a free optimization claim

The previous ordinary first-package path read seven records; the complete-ledger check reads nine, including the otherwise unvisited second-package pair. Those two reads are necessary to detect an impossible or orphaned second attempt. They execute in a bounded parallel batch, and execution does not repeat the inspection reads. A path that uses both package attempts still reads nine. No bucket listing or new Convex call is introduced.

Concurrent object reads are **not an atomic multi-object snapshot**. If another execution is writing, a partially observed state can conservatively hold; create-only claims continue to prevent a second purchase after a stale missing-record observation. No automatic retry of an unknown claim was added.

The storage boundary uses the application's direct S3 adapter, not a cached public image URL. Cloudflare documents strong read-after-write behavior for direct R2 operations, but that is not a multi-key transaction. Only precise missing-object errors count as absence; access denial, missing bucket, generic 404 and a contradictory 503/NotFound hold. [R2 consistency](https://developers.cloudflare.com/r2/reference/consistency/), [S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/).

## Verification scope

- New inspection tests use the real title selector, packaging and checkpoint executor with deterministic JSON responses and an in-memory create-only storage boundary. Fresh execution and complete replay each issue nine reads. Complete replay issues zero additional provider calls or performance fetches. A saved rejected first package executes only the remaining package/comment.
- Twenty-six corrupted/invalid state cases test both the read-only result and actual execution refusal before further provider work. These include orphan records, pending claims, missing/foreign claims, wrong receipts, negative/unpriced usage, changed source/performance/winner/evidence, invalid output shapes, impossible ordering, exhausted attempts and duplicate claim identity across slots.
- Input tests compare the exact former argument shape/fingerprint, full source tail, fallback precedence, topic-only coverage, route-owned music identity, absent/empty evidence, competitor sorting and limits without mutating upstream artifacts. The actual metadata block's saved manifest is compared against the shared builder. A real serialized episode fixture also rejects a foreign run binding.
- The existing actual-block recovery suite still tests unknown responses, failed claim/outcome persistence, removed credentials, exact restored charge credit and concurrent purchasers. No live provider, GPU rental, publishing operation or production storage mutation was used in this slice.

Full regression: **634/634 direct production-readiness tests passed**, including the new input/inspection tests and existing recovery/concurrency suites. The final Next.js production build compiled, passed TypeScript and generated all 51 static pages. Scoped ESLint and `git diff --check` passed. The initial TypeScript check found fixture-only typing errors, which were corrected before the final passing build; no failure is omitted from the validation history. Deterministic fixtures establish protocol behavior, not live R2 race qualification, actual model quality or safe production budget admission.

Local logs: `/tmp/ysa-metadata-inspector-readiness.log` and `/tmp/ysa-metadata-inspector-final-build.log`. Graphify was updated after the final source changes: 21,390 code nodes and 52,292 edges, with no model calls. Its large graph uses a community-level visualization and remains excluded from deployment. The exact production alias's health endpoint still returned `2c8e64a0e973808e11a5bb177543f0a3ebe0c632`; this draft was not deployed.

The full test command also completed its actual hermetic video assembly: four segments, 1920×1080 at 30 fps, 31.021995 seconds, 17,164.6 KiB, no reported assembly warnings. Local output: `/tmp/assembly-smoke-k4AvT4/bk_smoke_2_loudnorm.mp4`. This is generated synthetic media without R2 credentials, not a live channel render or a visual-quality approval.

### Direct before/after defect reproduction

An additional diagnostic loads the actual checkpoint implementation from local commit `b1a23e1b1198616c84f80a38e92aa361480994f3` and the current implementation against the **same** deterministic provider and corrupted in-memory object set. With only an orphaned comment pair, the previous code recreated its missing manifest and made three new provider calls; the current code held before any call. With a manifest/comment but missing selection/package history, the old code again made three calls and returned success, while the current code held before any call. Simulated charges were $0.03 versus $0.00 in each case, not actual provider spend.

This demonstrates a concrete previously accepted defect, not just newly invented assertions that happen to pass the new code. Local diagnostic: `/tmp/ysa-metadata-inspector-before-after.ts`; preserved old implementation: `/tmp/ysa-metadata-checkpoint-before-inspector.ts`. The old source also remains reproducible from the checkpoint commit. The generic-engine five-scenario probe was rerun and still reproduces the separate admission/reservation failures; this change does not claim to fix those.

## Still required before release

The generic engine must gain verified historical-receipt reconciliation and remaining reservation, local execution-generation checks immediately before each paid request, a defensible finite request envelope, and a versioned frozen-invocation migration policy. This implementation does not mark metadata paid, change compiler budgets, bypass the interrupted-stage fence, alter prompts/models, or enable a paid route. Source/module owner locks are unchanged.

The existing 66-call title study remains frozen evidence for the unchanged title/model prompts; it is not a live test of this new storage inspector. Unavailable provider credits do not block this work or other open goal items.
