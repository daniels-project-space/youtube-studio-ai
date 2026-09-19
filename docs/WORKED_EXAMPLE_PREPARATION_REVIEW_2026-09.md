# Held worked-example arithmetic preparation — 9 September 2026

Status: provider-free preparation foundation only. Item 177 is **not complete**.
No ordinary archetype/designer, QA, TTS, renderer, portrait profile, catalog,
publishing policy or provider adapter was changed. No paid calls or deployment.

## Decision and existing boundary

The unit is one verified arithmetic derivation, not a separately generated image
or a paid critic request for every calculation. A closed deterministic domain
can establish exact mathematical correctness before spending on narration.
Unrestricted algebra, natural-language word-problem interpretation, floating
point and another LLM correctness judge lose here: they introduce uncertainty
that this first slice can avoid without weakening any existing quality gate.

The retained real-caller counterexample is
`src/engine/__tests__/workedExampleLearningBoundary.test.ts`. It reproduces the
audit's exact graph/request and output: `buildEpisodeGraph`, `buildLearningContract`,
`assertLearningContract` and `compileSceneManifest` accept the scene “Two plus
two equals five.” This is **not a broken promise of LearningContract**: its job
is objective/source/graph binding and review obligations, not mathematical proof.
The test also retains the generic visual schema stripping an unknown math field
and the unregistered `workedExample` key's opaque-artifact fallback.

That counterexample still passes unchanged after this addition. Ordinary lessons
are not forced into arithmetic. Selection requires the distinct typed
`workedExampleRequest` port with the literal `worked-example/integer-v1` policy.

## Contract and real caller

- `src/engine/workedExample.ts`: strict request, flat topologically ordered
  integer-expression DAG, reduction steps, replay verifier and canonical English
  display/speech projection. No eval, expression parser, provider or file I/O.
- `src/trigger/blocks/workedExampleBlocks.ts`: registered `worked_example_prepare`
  consumes only `workedExampleRequest`, produces only `workedExamplePreparation`.
  It checks owner/channel/run against the actual stage context and rejects
  nonempty configuration params. It never emits `script`, `narrationText` or
  `scriptApproved` and has no guessed private-context switch.
- Explicit additive schemas/ABI registration in `artifactSchemas.ts`,
  `moduleContracts.ts` and `blocks.ts`. Contract certification describes the ABI
  tests only; it is not Golden, catalog admission or capability qualification.

Requests contain owner/channel/run/request IDs, a bounded seed and one to eight
closed operations: add, subtract, multiply, exact division. Inputs do not accept
a hand-authored solution. Deterministic generation creates the problem and
candidate reductions; a separate BigInt implementation replays every result.

Limits: 31 DAG nodes, eight reductions, depth eight, literal magnitude at most
1,000,000, intermediate/answer magnitude at most 1,000,000,000,000. Numbers are
canonical integer strings, never JSON floats; strings are length-bounded before
BigInt parsing. Division rejects zero and any nonzero remainder before division.
BigInt division otherwise truncates, which is not an acceptable exact-integer
answer. [ECMAScript BigInt division](https://tc39.es/ecma262/multipage/ecmascript-data-types-and-values.html#sec-numeric-types-bigint-divide)

Every node ID is unique. Operands must already be resolved; self-cycles, forward
references, cycles and unbound operands fail. Every node must be reachable from
the operation root; disconnected calculations cannot masquerade as a complete
derivation. Steps must cover operations once, in order, and the final answer must
equal the independently computed root. Even a correct final answer cannot excuse
an incorrect intermediate result. DAG display/speech expansion is bounded too.

Projection version `worked-example-projection/en-v1` fixes grouping, signs,
operators and English integer words. Each line carries its exact operation ID.
There is no free-form explanatory equation or speech string from a model.
Artifact validation replays the math, checks that the expression belongs to the
seed/request, and compares every projection field before checking its checksum.

Request and preparation fingerprints bind the namespace, policy, seed,
operations, derivation and projection/version. They are **unkeyed integrity
linkage, not signatures or authorization**. A consumer must additionally call
`assertWorkedExamplePreparation(value, expectedRequest)` against its own trusted
request; a self-consistent artifact from another request is not sufficient.
This reuses the existing artifact persistence model, not a new journal/receipt
authorization system. There is no paid outcome or paid-cache replay here.

## Evidence and independent oracle

Evidence directory: `/tmp/ysa-worked-example-review-6yTSx6`.

| Evidence | Result |
| --- | --- |
| `counterexample-before.log`, `counterexample-after.log` | Exact retained real-caller output; byte-identical |
| `core-final.log` | 33 corruptions rejected; 256 generated examples independently checked; nine disabled guard mutations killed |
| `caller-final.log` | Actual registered runner + strict artifact consumer; request rejection; deterministic retry; zero network calls and $0 |
| `episode-graph.log`, `script-quality.log`, `story-spine.log` | Existing focused regressions pass |
| `module-contracts-final.log` | Existing ABI, production compiler and Golden promotion guard suite passes |
| `typecheck-final.log`, `eslint-final.log` | Typecheck and scoped lint pass; empty logs |
| `convergence-before.log`, `convergence-after.log` | Audit output byte-identical |
| `inertness-before.log`, `inertness-after.log` | Audit output byte-identical |

The existing registry-count assertion in `moduleContracts.test.ts` is updated
from 85 to 86, with explicit root authorization; no other assertion is changed.

The oracle includes independently authored results for carrying, grouping,
precedence, signed arithmetic, zero and exact division. The generated corpus uses
a separate Number-based evaluator, exact within the enforced integer domain
below 2^53. It checks the generated operands, every step and final answer, not
the producer's asserted answer against itself. Data attacks deliberately rehash
corrupt math/projections, proving rejection is not just checksum mismatch.

Mutation tests remove result, final-answer, reachability, unique-ID, step-binding,
exact-division, projection, generated-request and namespace guards one at a time.
The independent bad-input assertions fail for all nine disabled guards. Their
test-only in-memory source compilation is not a runtime input evaluator.

`workedExampleCaller.test.ts` runs the actual registered module through
`runPipeline`, its declared-artifact proxy, output validation and an instrumented
strict consumer. It proves invalid artifacts are refused before that consumer,
and a valid artifact paired with another request is rejected at binding.
Persistence is the existing runner interface with an in-memory sink; no Convex
or R2 call is represented as tested.

The compiler proof uses the unchanged real illustrated pipeline. Its TTS input
binds to `qa_script:scriptApproved`; removing/reordering QA fails, and seeding an
approval value still cannot replace the required QA capability. The preparation
port cannot satisfy TTS's narration input. Inserting the new block into the
production pipeline fails at the existing **no catalog binding** gate. That hold
is deliberate, not a bypass. All 12 ordinary family designs/compilations compare
equal with and without this additive registration; no archetype selects it.

Rerun from the repository with the project-local `tsx`:

```sh
./node_modules/.bin/tsx src/engine/__tests__/workedExampleLearningBoundary.test.ts
./node_modules/.bin/tsx src/engine/__tests__/workedExample.test.ts
./node_modules/.bin/tsx src/engine/__tests__/workedExampleCaller.test.ts
./node_modules/.bin/tsc --noEmit --incremental false
```

## Held resume correction and retained failing-before evidence

Independent review reproduced a cached-resume binding defect in the real runner
with `rehydrateOutputsWithStorage`: a self-consistent stale or foreign preparation
could bypass the block's current-request checks on restore. The unchanged before
oracle is `/tmp/ysa-worked-example-independent-OUkI5V/resume-repro.ts`. Replaying
it reproduced stale answer `401` accepted for the current request whose correct
answer is `-175`. Fresh-call proof above did not establish resume admission.

The correction adds the code-owned Block policy
`resumePolicy: "recompute_unpaid_deterministic"`. Only `worked_example_prepare`
selects it in the actual registry. The manifest reflects the explicit declaration;
serialized pipeline params and artifacts cannot opt another block into it.
Manifest and runtime admission reject mismatched/unknown policies, paid blocks
or paid manifests, and effects other than exactly `["none"]`. Runtime also
rejects remote execution of an opted-in block before sink reads or writes.
Determinism remains an audited code property, not something metadata can prove.
This block uses only bounded pure arithmetic; no provider or external effect is
introduced by opting it in.

On cached resume the runner does not restore, validate as accepted, merge or
persist the cached preparation. It takes the existing `cachedFallbackToLocalRun`
path, including targeted rehydration of any consumed upstream inputs, and runs
ordinary current-input admission, execution and strict output validation. A
foreign active owner/channel/run fails without a successful output. A stale,
foreign or corrupt cached output is harmless because the current trusted request
deterministically regenerates the preparation. Old cached objects are not mutated
or deleted. Existing stage/artifact upserts record the recomputed current result;
this is not a historical artifact store or a new journal. Omitted-policy blocks
retain their existing restore behavior, including paid costs and checkpoints.

Resume evidence: `/tmp/ysa-worked-example-resume-IBDb9D`.

| Evidence | Result |
| --- | --- |
| `reviewer-before-replay.log` | Unchanged independent before oracle reproduced the defect |
| `failing-before.log` | New actual-runner regression failed on stale `401` before the fix |
| `passing-after.log` | Current `-175`; foreign/corrupt cache recomputation; unchanged byte-equivalent output; invalid active namespace/policy refused |
| `resume-demand.log`, `rehydrate-demand.log`, `recovery-policy.log` | Existing resume, demand-driven hydration and recovery tests pass |
| `paid-inline-checkpoint.log`, `stage-budget.log`, `engine.log` | Existing paid receipt/checkpoint, budgeting and engine controls pass |
| `math-core.log`, `math-caller-compiler.log`, `module-contracts.log` | Arithmetic, registered caller, QA-before-TTS and compiler boundaries pass |
| `typecheck-first.log`, `eslint.log` | Typecheck and scoped lint pass; empty logs |
| `convergence-before.log`/`convergence-after.log`, `inertness-before.log`/`inertness-after.log` | Each before/after audit pair is byte-identical |

The focused test also proves paid and unpaid omitted-policy cache restoration,
manifest/runtime policy refusal before persistence, and the existing upstream
input-rehydration fallback without rerunning its paid source. Tests intercept
network and storage transports; all counters remain zero. Rerun:

```sh
./node_modules/.bin/tsx src/engine/__tests__/workedExampleResume.test.ts
```

Root reviewed the narrow six-file correction and independently reran the actual
resume test: `/tmp/ysa-worked-example-resume-root.log`, exit0. The independent
reviewer's inverse-before oracle also passes eight current/stale/foreign/fresh
controls at `/tmp/ysa-worked-example-independent-OUkI5V/resume-after.log`.
The correction remains held rather than production-admitted. This fixes this
opted-in producer's resume admission, not global cross-request provenance for every
upstream artifact. Future consumers still need their own trusted-request binding.
The fingerprints remain integrity linkage, not signed authorization.

The independent reviewer completed eight inverse resume cases and eight separate
safety/omitted-policy controls with unchanged frozen source hashes. Its separate
arithmetic oracle checked8,201 valid derivations, rejected8,201 incorrect steps
and2,203 invalid divisions, plus25 forged-projection/namespace/magnitude/DAG
cases. `arithmetic-counterexamples.log` and `resume-policy-counterexamples.log`
in the same independent evidence directory retain the results. No remaining
actionable defect was found in that bounded preparation slice; this is not
proof of the still-missing complete video capability.

## Deliberately open before capability admission

1. Explicit planner/route/catalog handoff, not automatic activation by a generic
   learning objective. The new module currently cannot compile into production.
2. Approved conversion of the preparation into existing script/narration ports,
   preserving independent editorial QA and route/episode binding. Never generate
   `scriptApproved` from the arithmetic verifier.
3. Post-TTS binding of every verified step to actual sentence IDs and measured
   timings, including operator-sensitive final-master transcript verification.
4. Typed propagation through Episode Graph/Scene Manifest and a dedicated math
   renderer. Do not squeeze derivations into clipped generic scene labels or
   infer arithmetic grammar from story beat kinds. Portrait ownership is separate.
5. Real visual/audio proof of signs, grouping, legibility, step reveals and answer
   timing, plus actionable UI controls, retained evidence and unfamiliar-channel
   private-video end-to-end validation. Existing child-supervision, duration,
   quality and publishing gates remain unchanged.

The seed generator currently produces small arithmetic chains, can divide by
one and can include zero/negative values. It is not a curriculum difficulty
planner or polished lesson author. Speech is explicit canonical English with
spoken grouping, not an auditioned presentation. No claim of learning effects,
channel-range readiness or whole-video cost savings follows from these tests.
Worked examples alongside independent problem solving and coordinated graphics
and verbal explanations are appropriate later design references, not proof of
this product's effectiveness. [IES practice guide](https://ies.ed.gov/ncee/wwc/PracticeGuide/1)

Measured here: zero provider calls and $0 preparation spend. Eventual cost per
accepted video must include QA, TTS, rendering, failed attempts, storage and
orchestration. The complete item remains held until those outcomes are measured.
