# Arithmetic speech meaning — admission gap

Status: reproduced with actual deterministic assessment/receipt/timing code and
synthetic transcriber output. No speech was generated, no ASR model was run, no
provider/storage/publication call was made, and no production threshold changed.
This is a required next arithmetic-module gate, not a claim of listened audio.

## Concrete counterexample

The registered arithmetic preparation and script adapter generated a four-step
signed-integer lesson whose correct final answer is **−961**. Replacing its final
spoken sentence with **“The answer is seven.”** still passes both existing
general transcript-fidelity and cue-timing checks:

- Word error rate: 0.05319, within the existing 0.18 maximum.
- Lexical recall: 0.94681, above the existing 0.92 minimum.
- Missing numeric terms: empty, because the canonical narration spells numbers
  out while the diagnostic currently only collects tokens containing digits.
- Matched cue-token ratio: 0.9468, above the existing 0.68 minimum.

Duplicating the final answer's negative sign also passes both checks. A changed
operator and a removed earlier negative sign pass general fidelity but **fail**
the existing greedy cue alignment in this fixture. Do not claim those two cases
pass the entire combined gate. The unchanged control passes both.

The executable `/tmp/ysa-arithmetic-critical-speech-iK80uv/audit.ts` calls the
current generator and adapter, imports the actual Python token/edit-distance/
recall functions, and passes the resulting metrics through the actual TypeScript
receipt and cue-timing validators. `audit-complete.log` retains all five cases.
The initial `audit.log` stops at the already-rejected operator; the completed
diagnostic retains that rejection instead of dropping the case or changing its
threshold. Timing uses one deliberately broad synthetic cue, not a genuine TTS
sentence schedule; this establishes a metric-level counterexample, not an
observed bad production lesson or a complete `qa_visual` execution.

## Why a different check is needed

A global error allowance cannot express that an answer, sign or operator is
essential while punctuation is not. Lowering general WER globally would change
every channel's qualification behavior and still would not explain critical
meaning. Source/audio hashes establish identity; they cannot establish that the
sound says the intended result.

The official Whisper model card also documents that recognized text can differ
from the actual audio. Therefore a transcript-based arithmetic gate is useful
independent evidence, not infallible pronunciation proof. The engineering choice
below is an inference from our counterexample and this documented limitation,
not a published benchmark of our selected local model.
[Official model card](https://github.com/openai/whisper/blob/main/model-card.md).

## Smallest intended correction

Reuse the source and final-master transcripts already produced by `qa_visual`;
do not add another paid judge or rerun transcription solely for arithmetic.
Condition the additional gate on the current independently verified arithmetic
script and actual submitted speech binding. Compare all ordered, step-bound
operands, signs, operators and results, including the final answer, rather than
checking that each number occurs somewhere in the whole transcript.

Normalization must be a bounded, explicit arithmetic contract. Test ASR numeral
versus written-number output, negative signs, parentheses, headings, repeated
values and digit grouping. Do not silently strip decimals, fractions, unknown
symbols or meaningful extra words until a malformed answer equals the expected
one. An uncertain alignment is held for review; it is not authorization to buy
speech again. Keep the original generic thresholds and ordinary routes intact.

Tests must reuse the actual `qa_visual` consumer for both pristine narration and
the assembled master, with unchanged good controls and deliberately wrong
answers/steps. A detached helper that rejects the diagnostic above is not a
wired fix. Independently audition real matched takes before admitting the new
lesson route; synthetic ASR fixtures establish logic, not voice quality.

The completed-output/audio-source binding repair is a separate stage. It must
still stop old or corrupt speech from being restored under a new calculation.
Neither stage replaces the other. Planner intent, useful problem progression,
content-bound visual reveals, measured timing, UI controls and an automatically
created unfamiliar channel remain required before this module is ready.
