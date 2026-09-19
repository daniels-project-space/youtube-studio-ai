# Program Route seed repair — independent after review

Date: 2026-09-09. Reviewer: `/root/arithmetic_narration_review`.

Result: **bounded local repair verified**. The three retained existing-route
counterexamples now pass actual certification and runtime compilation. Missing,
foreign, malformed, or drifted route inputs remain rejected. This is not a new
channel admission, authenticated production run, provider render, or deployment
verification.

## What changed and why it addresses the defect

The new `channelPipelineValidationSeedKeys` projects only `contentLane`, the
existing supervised-children input contract, and an actually supplied valid
`channelProgramRoute` seed. It validates the seed and matching lane/family; it
does not manufacture a route, infer one from a name, accept arbitrary payload
keys, or add `workedExampleRequest`.

The designer derives that seed from its validated route and canonical brief.
The actual inception certifier retains the already validated ShowProfile and
uses its sealed optional route. Runtime compilation now follows actual seed
selection and the existing children, route, and narrative-selector guards,
while remaining before credential bootstrap and provider work. Consequently a
durable retry uses its frozen route, and a private or weekly execution uses its
actual selected seed store rather than current channel identity as a proxy.

## Executed evidence

The retained independent after oracle passed **41 cases**, exit 0, zero network
calls, with all eleven source hashes unchanged before/after:

- Four actual designs: whiteboard, comic, lore shorts, and ordinary narrated
  stock. Their real inception certification fingerprints match actual runtime
  compilation.
- Fresh seed selection, children/route/selector admission, validation,
  compilation, and actual invocation-candidate normalization.
- Actual frozen route/identity checks and frozen compilation comparison for
  all four designs; seed stores and compilation fingerprints match fresh runs.
- Private probe and benchmark context selection: valid route accepted; absent,
  malformed, and a valid same-family foreign-brief route rejected.
- Actual weekly seed overlay: correctly bound frozen data selected; foreign
  route replacement rejected before compilation.
- Immutable channel identity changes, frozen route fingerprint changes,
  retained fingerprint with missing seed, and compilation/policy drift rejected.
- Historical ordinary route-less snapshot still compiles without acquiring a
  current identity route. A route-dependent graph cannot invent its missing
  frozen route.
- Narrow helper behavior, wrong lane/family, unchanged children input
  declarations, and continued mandatory delivery of the children packet.
- An unrecognized arithmetic request is not carried into runtime seeding or
  declared available. In this held arithmetic worktree, the actual
  `worked_example_prepare` consumer remains unproducible. This last observation
  is intentionally absent from the portable test's registry assumptions.

An additional comparison against the exact before-audit designer fingerprints
passed for all four families. The repair changes acceptance of already seeded
routes, not those designed graph/configuration compilation fingerprints.

The new portable regression,
`src/engine/__tests__/channelPipelineSeedCallers.test.ts`, retains **33
caller-focused cases** from that evidence; it complements the parent's pure
helper/designer tests rather than duplicating all helper cases. These are not
74 distinct cases. It uses repository-relative imports, `process.cwd()`, exact
TypeScript AST caller extraction, genuine imported implementations, and a
network-denying fixture boundary. It does not require held arithmetic modules
to be registered and is suitable for the separately scoped existing-route
repair.

Portable execution and scoped ESLint passed. The full-worktree typecheck was
run and failed only in the concurrently authored
`src/trigger/blocks/__tests__/workedExampleSpeechQa.test.ts:68` (`unknown` passed
to the final-master transcript audit parameter). No errors were reported in
the new caller test or the reviewed seed repair. The parent was informed; this
report does not label the whole current worktree typecheck green.

## Exact artifacts and reviewed runtime hashes

Evidence directory: `/tmp/ysa-route-seed-independent-tvxmSa`.

- `route-seed-after.ts` SHA-256:
  `aff2f4df0e12c8d436293e787e1226872e834e29fafe9be470c1be5a01a0da5c`.
- `route-seed-after-second.log` SHA-256:
  `e12629a7b9ff93915a796641c6e5423b0c1cd74fcb619b7c6972b0117713c22f`.
- `design-before-after-parity.log`: exact four-family before/after compilation
  fingerprint comparison, exit 0.
- `portable-callers-final.log`: 33 caller cases, zero network, unchanged sources.
- `portable-lint-final.log`: exit 0.
- `portable-typecheck.log`: the separate concurrent speech-test error above.
- Portable caller regression SHA-256:
  `8ac912c0efc20f2a82f207cb0da294a4a3e3be6b3d63be31bcde141e5d25db48`.

Frozen runtime files reviewed and unchanged throughout:

| File | SHA-256 |
| --- | --- |
| `src/engine/channelPipelineSeedKeys.ts` | `1dec60d582888f582e8610a92f48a0c26a44bd2184ffa8d0d3fa0810d14d721a` |
| `src/engine/designerCore.ts` | `a00fd6110ba0088b763f0a63c0fc60ac98e1deea37dbd28e90ea6ab4468cbfc1` |
| `src/trigger/designChannelInception.ts` | `fe53f3e18b41d99e50e4817682b9ef5135b759eef7536244a353a973a9b6455a` |
| `src/trigger/runPipeline.ts` | `9368dac490729374d2131c945d6c37552dd386ababcc153e8ac10548c471e096` |

Before evidence remains unchanged in
`CHANNEL_PROGRAM_ROUTE_SEED_DIVERGENCE_AUDIT_2026-09.md` and its retained oracle.
The first after run stopped on a harness error-message regex: the genuine
schema refusal was `Required`, not text containing `route`. That log is retained;
the assertion was corrected without changing production source. The portable
test's initial lint-only local variable naming issue was corrected and rerun.

## Limits and release responsibilities

- The VM executes exact local caller sections with their genuine imports, not
  the entire authenticated Trigger task. Owner/channel/run admission before
  these sections, Convex persistence, external storage, paid stages, and final
  production alias behavior are not exercised here.
- Private fixtures cover selected seed contexts. They do not mint or validate
  a signed private-probe budget receipt or claim authenticated private
  execution. The production/private compilation-policy expression remains the
  actual source, not a replacement implementation.
- Weekly fixtures exercise actual selected-store precedence and subsequent
  binding. They do not simulate provider batching or claim verification of a
  remotely stored weekly manifest.
- This corrects an existing route connector only. It neither creates the
  unfinished arithmetic request producer nor qualifies critical-number speech,
  audio quality, a final video, or any new module/catalog route.
- The reviewed root `runPipeline.ts` includes pre-existing changes outside this
  repair. A separately prepared release must exclude unrelated held work and
  rerun the portable regression on its exact source; these root hashes do not
  automatically verify a different release worktree or production deployment.

No reviewer runtime edits, Git changes, provider calls, storage mutations,
deployment, or Graphify rebuild were performed. The parent owns the normal
graph update and any subsequent release verification.

## Standalone clean-source qualification

The same reviewer subsequently prepared this eight-file repair on exact local
UI base `0b2c16b20ad7a6c45604e199bf5cfdc495232983` in
`/tmp/ysa-seed-standalone-nExijH/source`, without moving the canonical workspace
HEAD or index. The three existing runtime files were patched against that
clean base; the dirty root runtime file was not copied.

Only the four approved runtime paths, both new seed tests, and the two route
audit/review documents are included. The held
`createInlinePaidExecutionLeaseCheck` import and its three-line
`assertInlinePaidExecutionLease` callback are absent. The clean
`runPipeline.ts` SHA-256 is
`8a7f1136fb6e146ec62bd9c1223bb8a944e71f895508c35004e53865ade21546`:
an executable exact-text comparison proves it equals the reviewed root source
after removing only those four unrelated held lease lines. The other three
runtime hashes match the reviewed table above exactly. No held arithmetic
runtime or other module changes enter this repair.

On that isolated source:

- All 36 selected test files pass, including the new helper test, 33-case
  actual caller test, route/brief/profile, inception, private/frozen invocation,
  weekly preparation, route qualification, and production module-contract
  checks. These run with process-level socket/TLS denial plus default fetch
  denial; test-owned transport fixtures remain local.
- Full nonincremental TypeScript checking passes, exit 0. The concurrent
  root-only speech-test error mentioned above is not in this clean release.
- Scoped ESLint on all six changed TypeScript files and `git diff --check`
  pass, exit 0.

Evidence is retained in `/tmp/ysa-seed-standalone-nExijH`: per-test logs,
`qualification-results.json`, `qualification.log`, `typecheck.log`, `lint.log`,
and `isolation-parity.log`. Canonical HEAD remains
`2c8e64a0e973808e11a5bb177543f0a3ebe0c632` and its index digest remains
`f3e8d3229ce162131585040daf3071c9050fe9c273934dcebb5243359407eda1`.
This is a local qualification and commit preparation, not a push or deployment.

## Isolated release and deployment completion

The repair was isolated onto final Library release `0b2c16b20ad7a6c45604e199bf5cfdc495232983`
as `d24a00e72835d102e8753783b1e83e7227d77111`. Only the four unrelated held inline
paid-execution-lease lines were excluded from the root runtime projection;
the released `runPipeline.ts` SHA-256 is
`8a7f1136fb6e146ec62bd9c1223bb8a944e71f895508c35004e53865ade21546`.
The actual selected-caller regression independently passed 33 cases, and the
complete isolated runner passed all 649 tests. Build/typecheck, full lint,
baseline audits and local FFmpeg assembly also passed. Root HEAD and index
were preserved; the exact reviewed release was pushed non-forcibly.

CI `34416314791` is successful for the exact released SHA. Convex completed
at 23:29:23 UTC; Trigger `20260909.30` at 23:31:24 UTC, worker
`worker_cmtuqf85oiweg0vof0nk8u5pp`, content hash
`c6cefee47f0154c864a90245f74c2c17`. Vercel
`dpl_9tygyAGsXQVY6QRwk9edJXMFaHLy` is READY on the canonical production alias,
and the health endpoint returned the exact SHA after the cloud deployment.
Evidence is retained in `/tmp/ysa-d24a00-production-1ckiQU/`.

This establishes deployment of the repaired existing connector, not an
authenticated paid inception/run, weekly provider execution, or admission of
the unfinished worked-example, portrait, or language-practice capabilities.
