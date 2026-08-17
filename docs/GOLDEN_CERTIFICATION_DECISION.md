# Golden Certification: Decision Needed

Status: **awaiting Daniel's decision.** No code in this document; it exists to lay out two
options plainly, backed by what the codebase actually does today.

## The factual basis

`docs/GOLDEN_MODULE_AUDIT_2026-08.md` (a 7-agent read-only audit of the entire
`GOLDEN_SPINE`/`GOLDEN_MODULES` catalog) found, as its single most structurally
significant finding (Executive summary; also **P2-11** in the prioritized backlog):

> The entire Golden certification layer is inert: `GOLDEN_PROMOTION_PROOFS`
> (`goldenExecution.ts:182`) is a literal empty object, and the two functions that would
> enforce it (`compileGoldenExecutionFlow`, `selectGoldenProductionModules`) have zero
> production call sites — only the non-throwing `compileCatalogExecutionFlow` runs, and its
> output is attached to the pipeline record as descriptive metadata only
> (`pipelineCompiler.ts:485,493-503`).

That line number has since shifted with unrelated edits earlier in the file; as of this
writing `GOLDEN_PROMOTION_PROOFS` is at **`src/engine/goldenExecution.ts:238`**, still a
literal empty object:

```ts
export const GOLDEN_PROMOTION_PROOFS: Readonly<Partial<Record<string, GoldenPromotionProof>>> = {};
```

Confirmed still true today:

- `GoldenPromotionProofSchema` (`goldenExecution.ts:13-34`) is a real, well-specified Zod
  schema — `sourceCommitSha`, `artifactSha256`, `moduleVersions`, `verifiedAt`,
  `testCommand`, `operatorApproval.approved: true`, and a non-empty `gates[]` array of
  `{ gate, passed: true, evidence }`. The schema is not the problem; nothing ever
  populates it.
- `assessGoldenPromotion` (referenced at `goldenExecution.ts:321-327`) reads
  `GOLDEN_PROMOTION_PROOFS[catalogModule.key]`, which is always `undefined` for every key,
  for every module, always. It additionally requires `status === "reference"` before a
  proof could even matter, so any catalog module marked `status: "active"` can never be
  promoted regardless of proof content (audit P2-11).
- `selectGoldenProductionModules` (`goldenExecution.ts:544-547`) takes the same
  always-`undefined` lookup as its default `proof` argument.
- Both functions have **zero call sites in the executed pipeline path**. The only function
  that actually runs per pipeline design (`compileCatalogExecutionFlow`) never throws on an
  unpromoted module and never consults `GOLDEN_PROMOTION_PROOFS` at all — it just writes
  descriptive metadata onto the pipeline record.
- This is honestly self-tested: `goldenChannelFlow.test.ts:196-200` asserts that **zero**
  compiled steps are ever `goldenQualified`, i.e. the test suite already documents that no
  module is currently certified and expects none to be.

Net effect: `status: "active"` (or `"reference"`) on a `GOLDEN_MODULES` catalog entry is
purely an editorial label today. It carries no runtime meaning. A module actually runs (or
doesn't) based solely on whether its block is registered in `src/engine/blocks.ts` and
whatever its own `run()` throws on — never on anything `GOLDEN_PROMOTION_PROOFS` would
gate. The catalog's prose is, at present, the *only* description of module readiness, and
the same audit found that prose materially wrong in five separate places (BROKEN/NOT WIRED
verdicts — see the audit's consolidated module table).

## Why this needs a decision now, not later

This session's Phase 5 adds an **opt-in advisory layer** (`src/engine/creative/formatAdvisor.ts`,
`src/engine/creative/capabilityAdvisor.ts`) that can influence which format/capability gets
suggested to an operator. That advisory layer is deliberately built to fall back to today's
deterministic behavior on any doubt, and it never touches `GOLDEN_PROMOTION_PROOFS` or the
golden-promotion path at all — but its existence raises the same question the audit already
flagged: the codebase now has *two* separate "is this module actually trustworthy" concepts
(the deterministic `formatPreflight()`/`assertCreativeCapabilityPipelineObligations()` gates,
which are real and enforced; and the golden-promotion concept, which is not) and a reader
who sees `status: "active"` in the golden catalog has no way to know it means nothing at
runtime. Leaving that ambiguity in place while adding more advisory/intelligence surface
compounds the confusion the audit already called out.

## Option A — Give `GOLDEN_PROMOTION_PROOFS` real teeth

Wire it to require a genuine, completed audit/certification event before any module can
carry `status: "active"` at runtime.

What this would take:

1. **Produce real proofs.** For each module a maintainer wants certified, populate
   `GOLDEN_PROMOTION_PROOFS[catalogKey]` with a `GoldenPromotionProof` whose
   `sourceCommitSha`/`artifactSha256` are computed from the actual shipped code (not
   hand-typed), whose `testCommand` is a real, currently-passing command, and whose
   `operatorApproval` is a genuine human sign-off — not a synthetic default.
2. **Wire the two dead functions in.** `compileGoldenExecutionFlow` and
   `selectGoldenProductionModules` need at least one real production call site (most
   naturally inside `pipelineCompiler.ts`, replacing or gating the current
   `compileCatalogExecutionFlow` metadata-only call), so an unpromoted module's `"active"`
   catalog status stops being cosmetic.
3. **Drop, or explicitly re-justify, the `status === "reference"` requirement** in
   `assessGoldenPromotion` — as written today it makes certification structurally
   impossible for every `"active"` module, which is either a bug or an intentional
   "reference implementations only" scope that should be documented as such.
4. **Re-run `goldenChannelFlow.test.ts`** and update its now-15-line assertion that zero
   steps are ever `goldenQualified` (`:196-200`) to reflect the newly-certified set —
   this test is the one honest, currently-accurate description of the feature's state, so
   it must change in lockstep with any real wiring, not be left stale.
5. Decide who is authorized to author a proof, and how `sourceCommitSha`/`artifactSha256`
   get computed and checked in CI so a proof can't silently drift from the code it claims
   to certify.

Cost: **Large**, per the audit's own effort estimate for P2-11. It requires real
audit/certification work per module (not just code), a CI mechanism to keep proofs honest,
and a decision on the `"reference"`-only restriction before it can even begin.

Benefit: `status: "active"` would start meaning something a maintainer or operator could
trust at a glance, closing the gap the audit flagged as the single most significant finding
in the whole catalog.

## Option B — Formally retire the concept

Acknowledge that `GOLDEN_PROMOTION_PROOFS`/`compileGoldenExecutionFlow`/
`selectGoldenProductionModules` are dead, unused code paths that the rest of the system does
not depend on (confirmed: `compileCatalogExecutionFlow` — the function that actually runs —
never touches any of the three), and:

1. Delete `GOLDEN_PROMOTION_PROOFS`, `compileGoldenExecutionFlow`,
   `selectGoldenProductionModules`, `assessGoldenPromotion`, and `GoldenPromotionProofSchema`
   (or move them to a clearly-marked `//@deprecated`/archived location if there's a reason to
   keep the schema as reference).
2. Update `goldenChannelFlow.test.ts:196-200` to stop asserting on a concept that no longer
   exists, and confirm no other test or call site references the deleted symbols
   (`grep -rn "GOLDEN_PROMOTION_PROOFS\|compileGoldenExecutionFlow\|selectGoldenProductionModules\|assessGoldenPromotion"`).
3. Update the `GOLDEN_MODULES` catalog's own doc comments and any UI copy that currently
   implies `status: "active"` means "certified" or "promoted" to instead describe what it
   actually is today: an editorial/curation label, with real readiness governed entirely by
   block registration (`src/engine/blocks.ts`) plus each block's own fail-closed `run()`
   checks — which is the layer that is genuinely enforced.
4. Leave `formatPreflight()`'s `productionReady` and
   `assertCreativeCapabilityPipelineObligations()` as the sole, already-real readiness
   signals; they are unaffected either way and remain the correct place to look for "will
   this actually run."

Cost: **Small.** This is a deletion plus a doc-comment/UI-copy correction, not new
engineering.

Benefit: removes a currently-misleading concept (dead code that looks load-bearing) without
promising work that has no owner or timeline. Matches the audit's framing exactly: "decide:
give it teeth, or stop describing it as certification."

## Recommendation framing (not a decision)

The audit already did the diagnostic work; this document does not repeat a recommendation
beyond what the audit stated, because the right choice depends on a product decision only
Daniel can make: is per-module human certification (Option A) something this project
actually wants to operate going forward, or was it a good idea at design time that never got
staffed and should be named as such (Option B)? Either is a legitimate outcome — what is not
a legitimate outcome is leaving `status: "active"` silently meaning nothing while new
intelligence/advisory surface (this phase's `formatAdvisor.ts`/`capabilityAdvisor.ts`) keeps
getting added on top of the same catalog.
