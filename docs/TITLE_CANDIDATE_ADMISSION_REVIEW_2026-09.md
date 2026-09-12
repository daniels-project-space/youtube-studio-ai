# Title candidates — review before variant filtering

12 September 2026. Follow-up to the complete-source title repair. No paid calls, uploads or provider configuration changes.

## Reproduced failure

At `1369835`, the title engine prepended provisional titles and ran a bag-of-words near-duplicate filter before lint or semantic review. A provisional title containing an unsupported number could remove the otherwise valid generated version. The engine then bought another generation and repeated the failure.

The real-module regression used the saved Inked Histories winner, with `999999` appended only to its provisional competitor. It failed with `both attempts failed the gate (ungrounded number "999999" — not in the script)`. The valid model-authored version never reached the judge. This was not a missing provider response or a weak generated title.

The same ordering also hid distinctions that only semantic review could resolve, such as a conditional preservation story being promoted into a claim that a letter lasts forever. Moving fuzzy filtering only after lint would leave that second defect intact.

## Repair

1. Exact duplicate strings are still removed before spending on review.
2. Every remaining candidate gets the normal length, source and opening checks.
3. All lint survivors reach the source-aware judge; no provisional title has priority merely because it arrived first.
4. The winner is selected by the existing admission thresholds and ranking.
5. Filler-only variants are filtered only among passing, ranked options when choosing a distinct alternate. All reviewed options and their reasons remain in the decision receipt.

The lexical comparison no longer treats a bag of shared words as semantic equivalence. It preserves numbers, negation, conditions and token order, and recognizes only normalized/filler-only variants. This deliberately leaves genuinely paraphrased word-order alternatives to semantic evaluation. It does not claim a calibrated semantic-distance model or solve all experiment diversity requirements.

## Evidence

`src/lib/__tests__/metacraftCandidateAdmission.test.ts` executes the actual title module with controlled provider responses:

- All four final model-authored titles from the retained-source comparison survive an invalid provisional competitor with one generation and one review request each.
- A mechanically valid but semantically rejected provisional title cannot hide the valid generated claim.
- A passing filler-only variant does not displace the best-scored winner or crowd out a distinct alternate; all three reviews remain inspectable.
- Different quantities, negation, reversed actors and before/after conditions remain distinct.
- A genuine filler-only variant still compares as equivalent.

These are falsifiable orchestration and candidate-preservation checks, not new model-quality, audience or cost measurements. In the reproduced failure they avoid an unnecessary second generation; sending previously hidden candidates to a judge may increase its input/output tokens. No blanket cost-saving percentage is asserted.

The complete-source, warm-start, title-quality, finishing and receipt behavior remain covered by their existing tests. Local typecheck, production build, changed-file lint, all targeted title suites and the full structural audit passed; no audit regressed. The cloud CI/deployment outcome remains a separate release gate. Earlier title, module, comic, fleet and UI backlog work remains open.
