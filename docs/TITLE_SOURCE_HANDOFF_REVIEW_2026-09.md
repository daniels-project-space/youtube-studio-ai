# Title module — complete source, adaptive angles and whole-promise review

12 September 2026. Partial title-module rework, not completion of the broader module phase.

## Root causes and changes

At baseline `d88654b`, production retained only 800 narration characters for metadata. The generator never received that excerpt, while the judge saw only the topic and at most 350 opening characters. It nevertheless scored factual grounding and channel identity. A source-coverage receipt could therefore describe text not actually shown to the judge.

The metadata block now passes exact complete narration (or script-owned narration when the top-level value is missing). Generator, judge, description and comment receive the same JSON source/channel brief. Planning/series continuity stays explicitly separate from narrated evidence. The finishing gate uses the same complete narration; the protected thumbnail descriptor remains bounded and its generation configuration is unchanged. Receipts accurately distinguish complete narration, an excerpt and topic-only input.

The seven candidate slots no longer force numbers, warnings or verbatim autocomplete queries. The model chooses appropriate distinct angles from the source and channel intent. Channel patterns remain identity guidance without forcing unsupported placeholders. The critic assesses the whole promise, including timing, certainty, scale, comparisons and conditions—not just topic overlap. Observed competitor views are no longer described as proof of headline effectiveness.

Unknown paid provider outcomes now escape the outer generation/judging retry loop. Existing deliberate repair of known unusable outputs remains separate; no model, token ceiling or precision downgrade was made.

The final caller check also reproduced loss of retry metadata in `metadataOptimized`: wrapping an ambiguous paid HTTP 503 in a plain Error let the engine's actual classifier consider it transient. The block now preserves the original structured provider error. The regression tests generator and judge failures through both the module and production block, asserting no further model call and `classifyExecutionError(...).retryable === false`.

## Research and interpretation

YouTube advises accurate, succinct titles, important words early, and both searchable and intriguing approaches depending on audience. This supports format-aware brevity and promise fidelity, not a universal headline template. [YouTube title guidance](https://support.google.com/youtube/answer/12340300?hl=en-GB)

Its native title/thumbnail comparison selects by watch-time share and requires sufficiently distinct alternatives. Therefore these generation and critic experiments cannot establish CTR or audience gains. [YouTube experiment guidance](https://support.google.com/youtube/answer/16391400?hl=en)

## Real comparison

Four fixed retained sources: Inked Histories (2,915 characters), Chalk & Compound (2,592), Gratitude Springs (2,894), Investory (10,040). This is a **current-identity experiment on saved narration**, not exact historical invocation replay. Frozen competitor data was reused; autocomplete was explicitly empty in every arm. No manually supplied creative answer was inserted into generation. All calls used the approved OpenRouter Gemini 3.7 Flash route through a scoped vault credential. No YouTube/database writes or media renders occurred.

| Arm | Calls | Reported cost | Mean title characters | Mean module time |
| --- | ---: | ---: | ---: | ---: |
| Original | 16 | $0.070809 | 53.00 | 14.40 s |
| Shared complete source | 16 | $0.091349 | 48.00 | 15.33 s |
| Adaptive angles | 16 | $0.087947 | 46.75 | 14.87 s |
| Whole-promise critic | 16 | $0.088610 | 50.25 | 15.14 s |

Final versus original: the same four calls per accepted package, approximately $0.00445 more per video for complete context, and 5.2% fewer title characters in this small sample. Timings include sequentially observed provider variation; they do not demonstrate a speed improvement. Two four-call critic challenges cost $0.041236 combined. Total investigation: **72 model calls, $0.37995075**, with usage recorded for every call.

Final selected examples (model-authored, not owner-approved goldens):

- Inked Histories: **How WW1 Trench Mud Kept a Fallen Soldier's Letter Intact**
- Chalk & Compound: **How Taxes Actually Work Across an Economy**
- Gratitude Springs: **Gratitude for the People Beside You | Sleep Meditation**
- Investory: **Why Starting with Little Beats Waiting for Capital**

These remain candidates, not changes to existing published video titles.

## Attacking the critic

Old and new selected/alternate titles were mixed in hash-determined order with neutral labels, then sent through captured production judge instructions and full source. The critic never saw which arm produced a title. This is a same-model-family challenge, **not an independent creative-quality oracle**.

Source inspection identified four concrete problems before the final challenge:

1. A **Civil War sword** was accepted for narration about a **WW1 leather satchel and letter**.
2. The taxation overview was packaged as an explanation of **marginal tax brackets and take-home pay**, which it never provides.
3. **Small portfolios beat big capital** collapsed the actual comparison of consistent contributions versus delayed/sporadic investing.
4. **Instant destruction** converted a conditional risk requiring stabilization into an unavoidable immediate outcome.

The first complete-source critic challenge rejected the first three but admitted number 4 while its own reason conceded exaggeration. That failed test caused the whole-promise reasoning change. The final challenge rejected all four, retained both final candidates for each channel, and additionally rejected the older definite “Restores Sleep” promise. This is one observed final challenge, not evidence of perfect stability or universal factual accuracy.

## Verification

- The actual metadata-block regression failed on the original caller with `Generator lost exact full narration at the production caller` before the repair.
- After repair it covers complete source in all four creative consumers, late-source quantities surviving lint/finishing, exact whitespace/Unicode, script-owned fallback, five retained narrations, truthful excerpt/topic-only coverage and no second purchase after ambiguous generation/judge outcomes.
- Sixteen real paid decisions replay through the production title-review UI adapter. Altering source coverage invalidates their sealed fingerprints.
- A structural audit initially reported a new silent-failure finding. Inspection showed its quote regex was reading executable code as a string after the short literal `"unknown"`. It now reads TypeScript literal/template nodes. The executable audit regression preserves actual silent failures and refuses to treat comments as diagnostics; the existing one-finding baseline remains unchanged.
- Local typecheck, targeted behavioral tests, production build, zero-error lint and structural audit passed. The full **677-test** production-readiness run passed, followed by actual hermetic assembly: 31.021995 seconds, 17,164.6 KiB, all four segments rendered, no warnings. The audit-parser regression added after discovery ran separately, as did the final caller retry-metadata extension. These are not live media-provider or publication tests. Deployment evidence is recorded separately when terminal.

Evidence is retained in `test-fixtures/title-source-comparison/results.json`: actual decisions, complete model usage, both challenges and SHA-256 bindings to raw local transport records. The eight original source packets and their hashes remain unchanged. Reproduction tools: `scripts/title-source-comparison.ts` and `scripts/title-source-judge-challenge.ts`; these are explicit paid operator experiments, never automatic CI purchases.

### Web release verification

Commit `13698350ee75a42f7eed0020a73f8de1baba3d08` was pushed to main. The Vercel provider API confirms `dpl_8sWdEh4rGQ8spggKCvmM89s8zvBD`, target `production`, state `READY`, with `youtube-studio-ai.vercel.app` in its alias list and that exact commit SHA. A fresh production-alias health response returns the same SHA. [Cloud CI 34686534856](https://github.com/daniels-project-space/youtube-studio-ai/actions/runs/34686534856) subsequently completed successfully: **678 direct tests**, actual 31.02-second hermetic assembly, unchanged audit gates, and production Convex deployment. Trigger version **20260912.19** deployed at 09:58:09 UTC; the runtime job completed successfully at 09:58:12 UTC. These are terminal release observations, not proof that the entire title/module rework is finished.

## Still open

- Creative sharpness and humanity: history still sometimes favors technical mechanism headlines over the human story; some variants use unnecessary “How”/“Actually” filler.
- Independent/owner-calibrated quality judging, repeated blind trials and positional-bias measurement; no causal watch-time or CTR claim.
- Every remaining format, especially non-narrated music, Shorts, unfamiliar channels and multilingual titles.
- Exact numerical/alias entailment and over-restrictive first-beat number checks. The lexical deduplication defect identified in this pass is addressed separately in `TITLE_CANDIDATE_ADMISSION_REVIEW_2026-09.md`; broader semantic-diversity calibration remains open.
- External factual evidence: narration support is not factual verification. The retained finance narration contains unverified study/statistical assertions; this change does not qualify them for publication.
- Consolidation of description/comment calls and complete cost admission/recovery accounting for long inputs. Full context costs more; removing it is not an acceptable cost optimization.
- Earlier thumbnail, UI, fleet, healer, retention and module backlog work remains active.
