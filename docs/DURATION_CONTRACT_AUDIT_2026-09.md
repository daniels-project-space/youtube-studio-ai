# Runtime contracts across video modules

Read-only current-source audit, 9 September. No creative render, metadata
backfill, paid-provider request, or publishing qualification was performed.
This extends the final-Motion-Comic duration correction; it does not claim the
remaining modules have already been repaired.

## Actual ownership

Motion Comic, Scene Compiler and narrated timeline assembly provide independent
narration duration to final QA. After the Motion Comic correction, its final
measurement does not replace that narration evidence. Scene Compiler also has
its stronger 0.12-second alignment check. Whiteboard reports a rounded renderer
timeline and independently measured narration.

LoFi assembly, Quiz, LoreShort and locked-beat DocuMotion currently supply a
plan/renderer summary through `videoDurationSec`. They do not supply a separate
duration target to generic QA. Therefore no ordinary current measured-master
self-comparison was established, but merely changing these producers to measured
seconds would introduce one: QA currently falls back from narration duration to
`videoDurationSec`.

## Confirmed gate counterexamples

1. **Length checks consume metadata rather than delivered runtime.** Executing
   the actual `lengthCheck.run` with planned/stored 59s and max 60 accepts, even
   when the delivered-master scenario is 61s. Stored 90s with min 80 also accepts
   a delivered-master scenario of 78s. Generic QA's 0.5–2.0 ratios admit both.
   These are gate-level counterexamples, not observations that those complete
   production releases passed every other gate. DocuMotion's locked shot
   durations and scene check both refer to its plan, so that check does not
   independently measure the final container either.
2. **Expected and measured durations share an ambiguous scalar contract.**
   `qa_visual` prefers narration, then falls back to `videoDurationSec`.
   Both use `DurationSeconds`; no source identity distinguishes a plan from a
   master measurement. LoreShort/DocuMotion advertise `narration.timed` but do
   not export corresponding generic narration duration/source evidence. Their
   own engines must expose that evidence; inserting another TTS step would
   duplicate ownership and potentially spend.
3. **Self-contained routes can lose the requested runtime gate.** The designer
   removes `length_check` for Comic/Whiteboard/LoreShort; Music Loop also has no
   such gate. Actual design/enforcement calls across all twelve families compile
   these four without `master.length_passed`. Its later length
   enforcement only adjusts gates still present. Narration and master can agree
   while both violate the requested runtime. Final quality capability and a
   model-authored critic do not guarantee a deterministic duration assertion.
4. **A cached final can regress to planned duration.** The operator-gated EDL
   `renderTimeline` fresh path probes its final, but its whole-video cache-hit
   path returned projected duration with no probe. The archived actual function
   returned 93s for a 93s plan while a supplied cache probe would report 45s;
   probe calls were zero. [The scoped cache correction](EDL_CACHED_MASTER_DURATION_REVIEW_2026-09.md)
   is implemented and locally tested separately, not yet released. It leaves
   the authored expectation and EDL enablement unchanged.

Replayed actual orchestration/gate evidence:
`/tmp/ysa-edl-cache-duration-ZcekQU/design-length-counterexamples.log` and
`cached-counterexample-before.log`. Fixed QuizYear's current 80–80-second gate,
DocuMotion's 20–60-second runtime gate versus 35–60-second authoring guidance,
and QA's inclusive half/double ratio require explicit policy decisions; do not
silently tighten or relax these while repairing measured metadata.

Focused sources: `src/trigger/blocks/narratedBlocks.ts` (`lengthCheck`, `qaVisual`),
`src/trigger/blocks/documentaryCollageShortBlocks.ts`, `src/lib/documotion.ts`,
`src/engine/documentaryCollageShort.ts`, `src/engine/artifactSchemas.ts`,
`src/engine/moduleContracts.ts`, `src/engine/pipelineCompiler.ts`,
`src/engine/designerCore.ts`, and `src/engine/creative/crew.ts`.

## Coherent next implementation and acceptance

- Preserve independent renderer-owned expectations: narration timeline for
  narrated formats, authored schedule for LoFi/Quiz, locked beat schedule for
  locked-beat formats. Type the origin, source identity and tolerance.
- Bind measured duration to the exact post-mux master. Metadata/UI consume
  measured duration, not an expectation or another asset's QA report.
- Enforce the admitted route's runtime envelope against that measurement,
  before spending on final visual review where possible. Do not add a second
  probe when an existing final probe can safely provide the bound evidence.
- Require real evidence and the applicable gate through compiler contracts.
  Test self-contained, narrated, short, long-form and hour-scale routes, plus
  custom composition, stale resume, missing evidence and source mismatch.
- Regression: preserve a 90s expectation when the actual master is 45s; never
  let a 45s measured value become its own expected target. Missing or malformed
  expectations must not become implicit approval.
- Regression: actual producer/final-mux transport through the real gate rejects
  measured runtime outside min/max even if the planned number fits. Keep Scene
  Compiler alignment and supervised QuizShort certificate checks unchanged.

The July Inked Histories row still stores 197s for a 200.551s master and remains
untouched. Its historical QA comparison was planned-versus-measured, not a
self-comparison. Metadata reconciliation and visual approval remain distinct.
