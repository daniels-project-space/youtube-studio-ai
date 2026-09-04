# Module hardening — what the thumbnail rebuild actually taught

Written after the thumbnail module went from "produces a card" to "produces a
card that survives its own gates on channels it has never seen". It is a
retrospective first and a checklist second, because the checklist is only
trustworthy if the failures that produced it are stated plainly.

## What the module was for

Not "make an image". A thumbnail is the click, paired with the title. The module
had to:

1. read a story and find what is *interesting* about it, not what is *in* it
2. render that at a quality that survives a 120px mobile browse row
3. do it for a channel it has never seen, without collapsing every channel into
   one house style
4. keep the owner's approved reference look as the target, not drift off it

Points 3 and 4 pull against each other, and nearly every defect found during the
rebuild lived in that tension.

## The false claims I made, and what caused each

These are recorded because the *causes* recur, and each one has a cheap
mechanical defence.

| Claim | Reality | Cause | Defence |
|---|---|---|---|
| "NB2 Lite is ~4× cheaper" | 27-35% cheaper on the production route | Priced the Gemini-direct rate, not the route actually used | Price the call site, never the vendor page |
| Per-image cost figures | Inflated | Billed `candidatesTokenCount`, which bundles thinking tokens, at the image rate | Split modality before costing anything |
| "The module reasoned its way to that headline" | The headline was hard-coded in `HEADLINE_LIFT` | I put the golden answer in the prompt and read the output back as independent reasoning | Never let a reference answer into the input of the thing being evaluated |
| "The judge was fixed by switching routes" | Route change explained nothing | Real cause was `maxTokens: 400` truncating the JSON | A fix that does not name a mechanism is not a fix |
| "Three-arm anatomy passes every gate" | The harness had removed the only gate that could see a body | My harness used deterministic-only critique | The harness must run the same gates production runs |
| "Plaques fixed" (twice) | Fixed downstream twice; root was one motif per family | Treated a symptom that reappeared | Two identical recurrences = stop and find the shared source |

## What the owner had to tell me that I should have found

- the amber/orange bias across renders — **measurable**: hue spread was 19-25°
  against the golden set's 107°
- "a hero can be centred" — I had written a rule banning it, which destroyed the
  symmetry of the render he had approved
- "the concrete theme is boring" — the module optimised for *depicting* the
  subject and had no notion of whether the subject was *interesting*
- "don't cheat, let the pipeline do the work" — twice

Every one of these was visible in the module's own output. The failure was not
having a measurement pointed at it.

## The six rules that came out of it

1. **Measure before prescribing.** Every durable improvement came from turning a
   complaint into a number (hue spread, seam energy, YHIGH−YLOW at 120px) and
   feeding the number back. Every prose rule I wrote instead ("never centre the
   hero") caused a regression.
2. **Calibrate every threshold against the approved reference.** A gate that
   rejects the golden set is broken, not strict. This overturned my first design
   four times: safe zones, saturation floor, flatness, perceptual-hash primacy.
3. **Close the loop.** Feed the failure back to the generator; do not describe
   the cure in the prompt.
4. **Audit for single-constant fallbacks.** `?? "#ffd400"`, `?? "left"`, one
   motif per family — each silently makes every channel that omits a field
   identical. This is the single most productive audit in the codebase.
5. **Audit for inertness.** Five thumbnail features were dead in production
   because the call site never passed their optional arguments. A capability
   with no caller is not a capability.
6. **Typecheck and smoke tests prove nothing about output quality.** They prove
   the code runs. Every module needs an *oracle* — something that can actually
   fail — and the oracle itself must be attacked before it is trusted.

## The validation standard for every remaining module

A module is not "done" until all of these hold:

- **An oracle exists** that can fail on bad output, is not the generator itself,
  and has been shown to fail on a deliberately bad input. An oracle that has
  never failed has not been tested.
- **The oracle is calibrated** against known-good output. If it rejects work the
  owner approved, the oracle is wrong.
- **Before/after is measured on real data**, not on fixtures chosen to flatter.
- **Every new capability has a caller**, verified mechanically, not by memory.
- **Legacy paths are removed or documented**, not left to rot beside the new one.
- **The golden reference is preserved**: a watercolour channel stays watercolour.
  Range means more options inside an identity, never a different identity.

## Mechanised

Two of the six rules do not need a human:

- `scripts/audit-convergence.ts` — single-constant fallbacks (rule 4)
- `scripts/audit-inertness.ts` — capabilities with no caller (rule 5)

Run both before touching any module, and again before calling it done.
