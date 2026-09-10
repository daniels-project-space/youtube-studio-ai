# Title judge admission review — 10 September 2026

This is a bounded implementation pass on the title module. It changes the
model-response admission boundary only; it does not generate titles, call a
paid provider, mutate production data, or claim a CTR/virality improvement.

## Root cause

`craftMetadata` previously filtered judge rows with permissive checks: an
omitted `direct` score defaulted to `10`, indexes could be fractional or
duplicated, scores were not required to be finite and within 1–10, and a
partial ranking could influence the winner. That made incomplete model output
look like a judged decision.

## Change

`validateTitleJudgeResponse` in `src/lib/metacraft.ts` is now the deterministic
admission boundary. It requires:

- a ranking for every survivor, exactly once;
- integer indexes inside the survivor range;
- finite click and direct scores in the inclusive 1–10 range;
- an explicit direct score (missing is a rejection, never a pass).

Any violation enters the existing two-attempt repair loop. If the second
response is still malformed, `craftMetadata` fails closed before buying the
winner's description/tag package. Valid responses keep the existing ≥7 click
and ≥7 direct gate and deterministic tie-break.

## Evidence

- `src/lib/__tests__/metacraftGates.test.ts` exercises valid complete rankings,
  missing directness, duplicate/fractional/out-of-range indexes and scores, and
  incomplete coverage.
- `src/lib/__tests__/metacraftWarmStart.test.ts` runs the actual
  `craftMetadata` caller seam with a malformed-first/valid-second recovery and
  a permanently malformed judge, proving retry and fail-closed packaging.
- Focused tests, scoped ESLint, and TypeScript pass. The existing full
  production-readiness gate remains required for release.

The same seam now preserves a validated title when the later description/tag
package call fails. `CraftedMetadata.packageFallback` is explicit and the
module emits a deterministic, factual package instead of throwing into the
legacy title tournament. `metacraftWarmStart.test.ts` exercises that failure
after selection and verifies the selected title remains intact. This is a
reliability safeguard, not a claim that the degraded package is equivalent to
the normal SEO package.

This improves decision truthfulness and prevents accidental bad admissions; a
held-out title corpus and authorized watch-time/CTR experiment are still
required before claiming output-quality or business gains.
