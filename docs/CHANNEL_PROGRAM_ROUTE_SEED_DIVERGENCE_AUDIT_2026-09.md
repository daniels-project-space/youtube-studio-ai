# Existing Program Route seed declaration audit

Date: 2026-09-09. Independent reviewer: `/root/arithmetic_narration_review`.
Scope: read-only runtime analysis and zero-network executable proof; no provider,
storage, Git, deployment, catalog admission, or compiler exception changes.
This is a **before-repair** finding, separate from the held arithmetic request
producer audit and the completed arithmetic audio-cache binding review.

## Confirmed existing-route defect

The actual designer accepts three existing route-bearing pipelines that the
actual inception certifier and runtime validator subsequently reject. The
runtime's real fresh seed construction already supplies the missing input.
This is not a hypothetical worked-example route and does not require inventing
a producer or adding an arbitrary payload field.

| Family / existing route | Actual designer | Actual certifier and runtime validation | Same graph with actual runtime seed keys |
| --- | --- | --- | --- |
| whiteboard / `whiteboard/foundation/v1` | Compiles | Reject `self_contained_story_plan`, step 8, missing `channelProgramRoute` | Compiles |
| comic / `comic/foundation/v1` | Compiles | Reject `self_contained_story_plan`, step 7, missing `channelProgramRoute` | Compiles |
| loreshort / `loreshort/foundation/v1` | Compiles | Reject `self_contained_story_plan`, step 7, missing `channelProgramRoute` | Compiles |
| narrated_stock / `narrated-stock/foundation/v1` | Compiles | Passes; these selected entries do not require the route input | Compiles |

Each affected graph also includes the later required-route consumer
`self_contained_story`. The live registry additionally declares required route
consumption for `scenario_visual_treatment` and `quiz_short_release`; this audit
does not claim to have executed those other route variants.

For all four graphs, using only `contentLane` plus the actually present
`channelProgramRoute` produces exactly the same compilation as all keys from
the real seed object. No wider seed allowance is necessary for this defect.

## Exact pre-repair callers and ordering

- `src/engine/designerCore.ts:1359`: designer validation already declares
  `channelProgramRoute` when its verified route exists, in addition to the lane
  and existing supervised-children input contract.
- `src/trigger/designChannelInception.ts:1336`: actual non-exported
  `certifyChannelPipeline`; validation at line 1376 declares only the lane and
  children inputs. Its real callers are lines 3380 and 3507. The preceding
  `assertChannelShowProfilePipelineCompatibility` returns a validated profile
  that can provide the sealed route; it is currently called for its assertions.
- The inception caller first applies actual `completePipelineForPolicy` at
  line 3495. The independent oracle applies that same genuine normalizer before
  certification. Feeding the raw designer entries directly to the final
  certifier was a harness prerequisite error, not the seed counterexample;
  that earlier failed attempt is retained separately.
- `src/trigger/runPipeline.ts:1385`: the frozen route seed is parsed and matched
  against the immutable route receipt and identity before use.
- `src/trigger/runPipeline.ts:1454`: `programRoute` is deliberately **undefined
  for a durable retry**. Adding a conditional based solely on that variable
  would leave route-bearing retries broken.
- `src/trigger/runPipeline.ts:1622`: validation likewise declares only the lane
  and children inputs. Compilation and frozen-compilation comparison occur
  before choosing the actual seed store.
- `src/trigger/runPipeline.ts:1640`: durable seed selection; lines 1642 and 1652
  select private probe and benchmark contexts. Ordinary seed construction
  starts at 1661 and supplies the route at 1715. A weekly preparation overlay
  can replace ordinary seed fields at 1749.
- `src/trigger/runPipeline.ts:1769`: actual selected-store children, route, and
  narrative-selector guards run before credential bootstrap and provider work.
  The fresh route check at 1784 uses `assertChannelProgramRouteRunSeed`, not a
  presence-only assertion.

Seven independent executions of the **actual seed-selection statement** show:
ordinary and route-bearing frozen runs retain their route; historical
route-less frozen runs do not acquire a current channel route; private probes
and benchmarks use their own frozen route, and do not acquire a route from
current identity when their selected context omits it. These are isolated
seed-selection controls, not claims that missing private routes are admitted by
the surrounding task.

## Smallest truthful shared helper contract

Use a pure, narrow seed-declaration helper shared by the designer, certifier,
and runtime. Its inputs should be the resolved content lane and an optional
**actual admitted route run seed**. It should preserve the existing children
input declaration contract, parse any supplied route seed, require matching
lane/family, and add exactly `channelProgramRoute` when present and valid.

Do not derive availability from arbitrary `Object.keys(payload)` or
`Object.keys(seedStore)`, an operator Boolean, channel-name keywords, or an
unvalidated current identity. The full actual key set is diagnostic evidence
here, not the proposed production API. Do not add `workedExampleRequest` or
any other unproducible input, and do not change admission/compiler allowlists.

- Designer: derive the same actual seed using `channelProgramRouteRunSeed`
  from the already validated route and canonical brief.
- Certifier: retain the validated profile returned by the existing
  compatibility assertion; derive the seed from its sealed optional route and
  the same brief. Historical route-less profiles must stay route-less.
- Runtime: move the existing validation/compilation and frozen-compilation
  comparison after actual seed selection and existing children/route/selector
  admission, still before credentials, preflight, snapshot claims, or provider
  work. Pass the actual selected route seed. This handles ordinary, frozen,
  private, and weekly sources without reconstructing a second precedence tree.
- Preserve private-probe compilation policy and all immutable identity,
  invocation, owner, lane, and route fingerprint checks.

The compiler fingerprint record currently covers policy, capabilities,
modules, catalog flow, and video-render binding—not the validator's supplied
seed-name list (`pipelineCompiler.ts:807`). Nevertheless, compare actual old
and new ordinary compilations and frozen snapshots in regression tests; do not
use that source observation to waive replay testing.

## Evidence and repair acceptance

Directory: `/tmp/ysa-route-seed-independent-tvxmSa`.

- `route-seed-divergence.ts` before-repair SHA-256:
  `059334aa13235c2a0575689f670b62da7379a885de8b25d834a94f783d71fc14`.
- `route-seed-divergence-final.log` SHA-256:
  `cfd05eb94b107b21f788579ac8e8e7d7f86d0f68f4eea5188ff4984c27e0a0e9`.
- Expected exit 1: all case and branch assertions finish, then the explicit
  safety oracle fails because existing designed routes do not survive the
  actual later validators. Network call counter is zero.
- Eleven exact source hashes are recorded in the log and checked unchanged
  before/after execution. Main pre-repair source hashes:
  `designerCore.ts` = `5146a7c24f8d3e2d5288171bfdf7159dc1a14921881077ea921c361545c0615c`;
  `designChannelInception.ts` = `aeb55bbd34a44013ae35798e4ef47bdfa2a7c26cc83e0b1a10bba79acd24bca2`;
  `runPipeline.ts` = `e40e4f6a3996d6dd8afb8d714529b753bd70fbf816a18ee96c6ea5db767ce88b`.

The oracle evaluates the actual certifier body with its actual imported
implementations, actual runtime validator expression, and actual runtime seed
selection/object expressions extracted with TypeScript ASTs. Registration,
brief/route/profile creation, designer, policy completion, validation, and
compilation are genuine local implementations. It does not mock those
implementations, submit an externally prepared solution, run a provider-backed
module, or claim full Trigger/Convex execution.

Before accepting a repair, require independent replay of these actual callers;
valid fresh/frozen/private/weekly source controls; absent, malformed,
wrong-lane/family, and wrong-identity route rejection; preserved route-less
historical behavior; unchanged ordinary graph/config/fingerprint behavior;
children packet declaration/admission parity; and confirmation that the
unproducible-consumes inventory remains truthful. The held arithmetic request
producer remains unfinished and must not disappear from that inventory.

No production channel, render, or module is admitted by this audit.
