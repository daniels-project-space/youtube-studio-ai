# YuE2 selection through the real designer

## Baseline defect

The executable versions existed separately, but `designPipeline` had no complete
YuE2 selection. The first real selected-design test also reproduced a compiler
failure: `module "music" uses crew artifact "musicBrief" without declaring it`.
The candidate renderer correctly consumes the accepted arrangement, not the raw
composer brief; adding a fake unused brief input would hide this ownership gap.

## Changes

The existing executable designer accepts an explicit supervised `yue2Music`
selection with required role, source duration, playback and the source module's
bounded configuration. It resolves:

1. `composer_brief@3.0.0-yue2-score`, retaining declared channel context and intent.
2. `music_arrangement_plan`, positioned between composer and generation.
3. `music@3.0.0-yue2-candidate`, with the validated seed, personal-use
   acknowledgement, stage ceiling and exact execution-supervision policy.
4. The corresponding reviewed repeat or play-once assembly version.

The real production compiler validates and fingerprints that exact graph and
reserves its configured cost. A declared required intermediate artifact can now
satisfy the composer handoff only when its producer is after the crew producer,
before the consumer, and requires the original crew artifact. Both sides of
this mediation must be required; an optional or missing input is not enough.
Ordinary direct crew bindings remain unchanged.

Selection refuses competing pinned versions, contradictory explicit composer
intent, duplicate/missing owners, bad order, unsupported consumers, unbounded
source configuration, ambiguous legacy music overrides, and play-once music in
the loop-only assembler. It is idempotent and does not mutate its input graph.
Browser-only structural previews cannot claim executable-version validation.

This is a supervised designer API, not a new public browser authority or a
default migration. Its result explicitly reports `productionReady: false` and
the remaining YuE2 qualification requirement. Existing calls without this option
retain their original pipeline. No listening decision or publication authority
is manufactured by selecting an implementation.

## Verification

`src/engine/__tests__/yue2PipelineSelection.test.ts` exercises the actual designer,
registry, graph validation and compiler for five cases across four families:
Lo-Fi repeat, sleep/meditation repeat, sleep/meditation once, Shorts once, and
narrated-stock background once. It verifies exact versions and artifact bindings,
finite reservations, changed-seed fingerprints, a precisely $0.04 reservation
increase when the source ceiling rises by $0.04, repeated-selection parity and
unchanged legacy designs. No provider is called.

Negative cases cover malformed/missing source controls, inadequate allocation,
foreign provider configuration, missing playback, incompatible consumers,
conflicting pinned modules, missing/reordered acceptance, and required inputs
changed to optional or disconnected. The original compiler failure is the
before-state; the selected graphs now compile without pretending the source
renderer consumes another module's raw input.

The new suite, existing designer parameter-authority suite, and architect version
transport suite pass. Typecheck, focused lint, production build and local code
graph update pass. No thumbnail module test or generation was run.

## Remaining MVP Work

Actual creator/UI admission, automatic qualified selection, exact-duration
background generation, listener-approved channel fit and voice masking, complete
final-media QA and production promotion remain unproven. This batch changes no
channel records, starts no GPU, performs no publishing, and does not complete the
broader module or UI backlog.
