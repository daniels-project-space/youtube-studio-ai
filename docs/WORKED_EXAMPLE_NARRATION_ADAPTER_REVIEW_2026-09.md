# Worked-example narration adapter — held, 9 September 2026

This extends item177's arithmetic preparation into a real registered script
producer and the existing editorial/voice boundaries. It is **not** an admitted
learning-video pipeline or an auditioned, polished lesson. No live provider,
storage, publication or deployment was used for these tests.

## Structural decision

One verified derivation should own its equations, display and exact spoken
numbers. Sending each step to a model to re-solve or paraphrase would introduce
both unnecessary calls and opportunities to corrupt signs/grouping. Reuse the
existing verifier's English projection and existing script/TTS modules instead
of adding another voice engine, math critic or image generator.

The new `worked_example_script` is an **alternative** to `script_gen`, not an
additional writer. It consumes the request and preparation, checks active
owner/channel/run, emits only `script` and `narrationText`, and costs zero
provider calls. The original preparation producer still emits only preparation.
Both small deterministic blocks use the already-reviewed unpaid recompute
policy on resume. The new adapter cannot consume a hand-authored solution.

`workedExampleNarration.ts` derives the script's problem, ordered step sections
and answer directly from the independently verified projection. The duration is
explicitly an estimate; it never substitutes for TTS/assembly measurement.
New version and preparation-fingerprint fields identify this script branch.
These are integrity links, not signatures, authorization or editorial approval.

## Real consumer boundaries

Both `qa_script` and `narration_tts` bind the complete script and narration to the
current trusted request/preparation before a provider call. Altering an answer,
section, hook, version, duration estimate or fingerprint cannot silently become
a different approved arithmetic lesson. Partial proof inputs and marked scripts
without their preparation fail; ordinary unmarked scripts retain their path.

Math correctness does not clear the independent editorial critic. Its existing
model, prompt, token ceiling, criteria and explicit pass/fail behavior remain
unchanged. Only an actual positive critic response emits the optional typed
`workedExampleEditorialApproval`: exact preparation and script fingerprints.
Voice synthesis requires that matching approval. A cached legacy Boolean or an
older script's approval stops before paid speech; it does not silently spend on
new narration or automatically buy another critic pass. Ordinary QA output stays
`{scriptApproved:true}` without the arithmetic artifact.

The declared optional inputs/outputs use the shared artifact/manifest machinery.
No second persistence journal, provider permission or new per-video judge was
introduced. The adapter remains absent from every ordinary catalog/archetype.
The compiler's existing production requirements still reject a bare adapter
pair; the existing preparation caller test also proves the no-catalog-binding
fence in a complete ordinary pipeline. Duplicate script producers and omitted
QA are rejected by the actual pipeline validator.

## Retained evidence

- `/tmp/ysa-worked-example-narration-before.ts` reproduces the pre-fix actual
  `qaScript.run` accepting an unrelated wrong equation alongside a verified
  preparation when the transport fixture returned a positive critic verdict.
  Before: `/tmp/ysa-worked-example-narration-before.log`, missing expected
  rejection. After: `/tmp/ysa-worked-example-narration-after.log`, exit0 and
  zero critic requests. This exposes an unimplemented connector, not a claim
  that the original generic editorial critic promised mathematical proof.
- `src/engine/__tests__/workedExampleNarration.test.ts` uses the actual registered
  runner, producer, QA decoder and TTS entry. Fifteen corruption/namespace cases
  fail before either consumer's provider call. Known-good prepared speech reaches
  the unchanged critic; its explicit rejection prevents TTS. Fresh matching
  approval reaches the unchanged TTS provider-selection guard. The provider
  sentinel then refuses: no generated audio is claimed.
- Real adapter resume replaces stale narration with the current request's
  derivation. A real cached-QA resume containing only `scriptApproved:true`
  fails at the new exact approval binding before TTS. No earlier evidence is
  deleted and no new paid retry is authorized.
- `/tmp/ysa-worked-example-script-caller.log`, `resume-regression.log` and
  `preparation-regression.log` use the common `/tmp/ysa-worked-example-script-`
  prefix and pass. The contract suite, both existing script-critic caller
  suites, non-incremental typecheck and scoped lint pass with the same prefix.
  The registry count moves86→87; the existing resume-policy list adds only the
  new unpaid adapter. Other test assertions are unchanged.

The critic responses are HTTP fixtures. Passing these tests establishes wiring,
rejection, ownership and preservation, **not** creative quality or real audio.
An independent adversarial review and wider release gates are still required.

**Independent review found a further release blocker:** completed-stage restore
skips both block bodies. The actual runner accepted current answer−175 alongside
retained speech for401, including with a current QA approval. Shape validation
then re-persisted the old outputs with current input references. Fresh-call
binding and a cached-QA-only test do not prove completed speech is current.
The independent executable and failing safety oracle are retained at
`/tmp/ysa-arithmetic-narration-independent-jIV7IE/review.ts` and
`review-before.log`. Twenty-eight independent fresh mutation-consumer checks
passed; this resume defect still prevents admission. The correction needs
read-only validation before restored-output persistence and actual speech-source
binding; never fix it by rerunning a paid producer or inventing audio evidence.

The complete audit currently **fails** `audit-unproducible-consumes`3→5:
`worked_example_prepare` and `worked_example_script` both require a request
that the production payload/planner does not supply yet. This is a genuine
unfinished automatic-creation connector. No audit baseline or guessed seed
allowlist was changed to hide it. A lower normalization finding elsewhere in
the mixed working tree cannot offset this hold or establish a measured quality
gain; the isolated Qwen/UI release retains all its baseline audit counts.

## Presentation and capability work still required

Canonical speech explicitly says grouping and repeats each step. That is a safe
engineering baseline, not yet attractive teaching. The general critic may quite
properly reject it as mechanical; no fixture pass waives that requirement.

The IES practice guide recommends alternating worked solutions with independent
problem solving, and coordinating graphics with verbal explanations. Those are
design references, not evidence of our product's effectiveness. Our inference:
the next presentation should highlight the exact current reduction, offer a
deliberate response interval, and only reveal its result when the explanation
reaches it. Do not infer timing from word-count estimates or display an answer
early through captions. [IES practice guide](https://ies.ed.gov/ncee/wwc/PracticeGuide/1)

Still open: purposeful difficulty/operation selection; concise, natural speech
without losing exact arithmetic; measured sentence/critical-word alignment;
topic-bound equation rendering; answer/reveal timing; real pronunciation and
complete footage review; planner/catalog/route ownership; Golden presentation
and actionable controls; batch/recovery integration; unfamiliar automatic test
channel and verified production release. No existing child-policy, source,
thumbnail, portrait-admission or publishing gate was relaxed.
