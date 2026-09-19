# Title judge: second pass and sealed holdout, 9 September 2026

## Outcome

The second pass corrected the observed schema, metaphor and minimum-identity failures in the previously seen calibration set. A separate sealed holdout accepted appropriate figurative titles without accepting the paired invented facts or false quantities. **One evidence-subtype defect remains in each stratum:** an unproven claim is sometimes labeled `contradicted` instead of `insufficient`. Both claims were rejected, but safe rejection is not an exact-label success.

This is an English, source-fidelity and channel-compatibility evaluation of a judge, not a title-generation benchmark, audience test, external fact-check, virality result or new-channel end-to-end validation. Neither broader production admission nor audience appeal is established. The seen and held-out results below are deliberately not pooled into an overall accuracy score.

## Frozen evidence and independent audit

All 36 operations finished before this report. The immutable receipts are in `test-fixtures/title-pilot-2026-09/oracle-v2/`: `c01`–`c12` and `h01`–`h06`, each in original and reversed order. Every operation used one paid request maximum, a $0.05 cap, and no purchased retry. The main agent performed these authorized calls; this report used read-only inspection.

Frozen sources recorded by every receipt:

| Source | SHA-256 |
| --- | --- |
| `src/lib/metacraft.ts` | `1b385a6267eeaf592c165591b4024b7ddf78951fd006117cee48ede56fcee857` |
| `src/lib/anthropic.ts` | `d3bcbbc1e3923fa2556e04aba92ff51e39c1b41f8c3e464fefaf1ddc52bc0994` |
| `src/lib/openRouter.ts` | `555134df10d149a77298528bf113d280f0fa6d7de78ba65123ad5d6345aa8f1e` |
| `scripts/title-quality-benchmark.ts` | `fe8c33ea83f2dce6d2d8821948d0b8a00ee62f611bf719f3a0983f1e4b532866` |
| Combined production dependency map | `39a3cd652db0f904fb96248558f0b99bfaebfa4829218cc3999380070c4cc31a` |

Fixture bindings remained unchanged:

- Seen calibration: `test-fixtures/title-oracle-calibration.json`, version `title-oracle-calibration/v1`, SHA-256 `73123e875e0c5c8c339cc216d437f27300d1ecea92dff3d0f63798aa6f46cffd`.
- Sealed holdout: `test-fixtures/title-oracle-holdout.json`, version `title-oracle-holdout/v1`, SHA-256 `69d5f205d6a1c850cc681602269f405c2242084c1bf1fe972b0f2fd921ce82a3`.

The holdout was prepared by a separate coding agent from reported failure classes without its author inspecting the revised prompt; its exact cases and labels were withheld from the prompt editor until the revised source was frozen. It consists of six synthetic source/identity pairs, not retained production videos or human/owner preference ratings. See `docs/TITLE_ORACLE_HOLDOUT_NOTES_2026-09.md` and the authorship correction in `test-fixtures/title-oracle-provenance-errata.md`. These cases are now observed; further tuning against them would require a new independent holdout before another generalization claim.

Independent verification completed for all 36 receipts:

- Exactly one experiment, source archive, code snapshot, request, raw response, final result and calibration event per file; all results `completed`, with no held, failed, partial or unpriced operation.
- All **144 source-archive entries** match their actual text SHA-256 and UTF-8 byte count, the frozen hashes above, and the executed code/harness hashes. Each four-file archive precedes its provider request. Only the allowlisted source files are archived; no interpolated environment values or request headers are included.
- Every experiment packet matches its frozen fixture's arguments and order-specific candidates. Packet, narration, label-free input and fixture hashes agree. All 24 seen operation packets are byte-for-byte structurally identical to their first-pass counterparts.
- Every request-body hash and raw-response hash was recomputed, and request/response references matched. Parsed raw ranking values equal the recorded decisions. Candidate completeness, unique indexes, allowed grounding values and finite scores were checked independently.
- Every calibration row was recomputed from the frozen expectations and original-index mapping, including identity threshold and null/unasserted identity labels. The saved scoring events agree; no invalid output was normalized or selectively omitted.
- Every request used `google/gemini-3.7-flash`, `temperature: 0.2`, `max_tokens: 2500`, and strict `json_schema` with the three allowed grounding values. The pinned provider list and `require_parameters: true` remained intact. Every raw response reports the same model and `Google AI Studio` through OpenRouter.
- Actual prompts contain the intended source and candidates, not fixture expectations, expected grounding labels, holdout protocol, provenance hashes or source-archive metadata.
- All costs are finite and independently reconcile through the existing `priceModelUsage` function, taking the per-call maximum of model-rate and provider-reported cost. Raw provider costs, accounted costs and usage-recorder costs each sum to **$0.10511400**. There were 36 paid calls and zero unpriced calls.

The first current implementation's source archive remains unavailable; its hashes and full provider prompts are retained, as disclosed in `docs/TITLE_ORACLE_RESULTS_2026-09.md`. These new source archives close the gap prospectively, not retroactively.

## Previously seen calibration: 12 pairs, 24 calls

These cases informed the revision and therefore measure regression correction, not held-out generalization.

| Measure | First pass | Second pass |
| --- | ---: | ---: |
| Schema-valid operations | 23/24 | 24/24 |
| Valid candidate judgments | 46 | 48 |
| Exact three-way factual labels | 40/46 | **46/48** |
| Unsupported claims labeled supported | 0/19 | **0/20** |
| Supported claims rejected factually | 3/27 | **0/28** |
| Labeled identity checks matching | 24/27 | **28/28** |
| Grounding/identity order differences | 1/22 comparable candidates | **0/24** |
| Paid cost, including failures | $0.05711850 | **$0.06954825** |
| Median selection latency | 1.932 s | **2.407 s** |

The different first-pass denominator is explicit: c03-original failed its schema and its two candidates were not semantically scored. The same 24 operations were purchased in each pass.

Second-pass factual confusion matrix, expected rows and actual columns:

| Expected | Supported | Contradicted | Insufficient |
| --- | ---: | ---: | ---: |
| Supported | 28 | 0 | 0 |
| Contradicted | 0 | 16 | 0 |
| Insufficient | 0 | 2 | 2 |

Identity checks comprised 26 expected-compatible judgments and two expected-incompatible judgments; all matched. Identity compatibility is a separate dimension from the production selector's click-score and directness thresholds.

### Corrections observed

- **c03, meditation:** both responses now return valid `insufficient` verdicts for the universal insomnia-cure claim. The original schema failure and reversed-order subtype error did not recur. The gentle gratitude title remained supported and compatible.
- **c11, calm classroom:** the tax-monster metaphor is now factually supported but identity-incompatible in both orders. This correctly separates recognizable figurative framing from the channel's explicit rejection of villainous/theatrical presentation.
- **c12, playful theatre:** the same metaphor is now supported and compatible in both orders, rather than changing its factual/identity verdict with order. The direct title's identity score rose from 6 in both first-pass draws to 7 and 7.5, recognizing it as suitable without requiring maximal theatricality.
- The negation, physical-preservation, tax-basis, compounding, death/survival, acquittal and duration controls retained their correct factual rejection/acceptance patterns.

c11-original's returned `reason` makes the distinction explicit:

> While the metaphor of a 'Tax Monster' is recognizable figurative framing rather than a factual contradiction, introducing a villainous fear cue directly violates the channel's calm, non-adversarial, non-theatrical classroom persona.

**Do not interpret the c12 identity correction as full title admission.** The direct title's click scores were 6.8 and 6.5, below the production selector's separate minimum of 7. The fixture mandates neither a particular click score nor a winning title. This test establishes a corrected compatibility judgment, not higher creative appeal or guaranteed admission.

### Remaining seen error: c08, unresolved betrayal

Both orders still label the asserted betrayal `contradicted`; the frozen expectation is `insufficient`. The source contains conflicting chronicles and leaves the event unproven. Original-order `reason`:

> The title presupposes as a factual certainty that the Ash King betrayed the Silver Gate, directly contradicting the source which states the betrayal is unresolved and presented as two conflicting accounts.

The title is appropriately rejected, but the source's uncertainty does not establish the opposite event as fact. Both judgments remain exact-label failures. Rewriting them as successes would hide a repair-relevant distinction.

### Cost and speed

The seen second pass cost $0.01242975 more than the first, approximately 21.8%, and its observed median selection latency increased approximately 24.6%. Second-pass selection latency ranged from 1.751 to 4.909 seconds. Usage was 20,376 input and 14,471 output tokens. These small samples with changed prompts and variable completions do not isolate the cause of the increase, but they do not demonstrate cost or speed savings.

## Sealed holdout: six pairs, 12 calls

Report this stratum separately: it was unseen by the prompt editor before the source freeze, and all its source facts and channel identities are explicitly synthetic.

| Measure | Held-out result |
| --- | ---: |
| Schema-valid operations | **12/12** |
| Exact three-way factual labels | **22/24** |
| Unsupported claims labeled supported | **0/12** |
| Supported claims rejected factually | **0/12** |
| Expected-compatible identity checks matching | **12/12** |
| Expected-incompatible identity examples | **Not present; specificity unmeasured** |
| Grounding/identity order differences | **0/12 paired candidates** |
| Paid cost | **$0.03556575** |
| Median selection latency / range | **2.833 s / 2.453–3.398 s** |

Held-out factual confusion matrix:

| Expected | Supported | Contradicted | Insufficient |
| --- | ---: | ---: | ---: |
| Supported | 12 | 0 | 0 |
| Contradicted | 0 | 8 | 0 |
| Insufficient | 0 | 2 | 2 |

Usage was 9,726 input and 7,539 output tokens. Five of six source pairs matched every factual label in both orders. h05 was wrong in both orders; two repetitions of one error are not two independent source failures.

### What transferred to new cases

- **h01, Ice Ledger:** accepted a glacier's “diary” metaphor while distinguishing 37 winters from an unrelated 370-metre measurement.
- **h02, Seedbench:** accepted seeds “hitting the snooze button” while rejecting extinction/resurrection claims contradicted by living, non-extinct dormant seeds.
- **h03, Bench and Bow:** accepted a repaired cello “finding its voice” while rejecting a lost-tape/father story absent from the workshop source as `insufficient`.
- **h04, Friday Patch:** accepted a bug “eating our weekend” while rejecting erased customer data explicitly contradicted by unchanged stored records.
- **h06, Margins Archive:** preserved both a proven forgery and uncertainty about its author, rejecting the asserted genuine letter.

These are source-fidelity outcomes for supplied adversarial candidates, not newly generated production titles or evidence of greater creativity.

### Remaining unseen error: h05, undetermined fish die-off

The source compares low-oxygen and pesticide hypotheses. It does not establish whether oxygen fell before the deaths, and no retained sample establishes pesticides reached the marsh. The cause remains unknown. Both orders correctly accepted `The Unsolved Marsh Fish Die-Off`, but rejected `Pesticides Caused the Marsh Fish Die-Off` using `contradicted` instead of `insufficient`.

Original-order `reason`:

> The source states that no sample established pesticides reached the marsh and the cause remains undetermined. Claiming pesticides definitively caused the die-off directly contradicts the source findings and violates the channel persona of distinguishing causal conclusions from unverified reports.

No supporting sample is not evidence that pesticides could not have caused the event. The claim is inadmissible, but the judge still confuses an unsupported causal conclusion with a disproven one. This is the same unresolved-evidence failure class as c08, now observed on a previously unseen case.

## Interpretation and remaining gates

Both the semantic prompt and opt-in provider schema changed, and the current transport was deliberately updated to carry that schema; baseline source was not changed. Consequently these results do not attribute any improvement solely to schema enforcement or solely to a prompt clause. Both-order agreement in these draws also does not prove universal order independence or eliminate sampling variance. Numerical scores varied even when factual/identity verdicts agreed.

The useful measured improvement is narrower: valid schema output in all second-pass draws, corrected seen metaphor/identity distinctions, and no unsupported factual admission or valid factual rejection in either reported stratum. The remaining contradiction-versus-insufficiency error is visible in both strata and must not be normalized, relabeled after measurement, or hidden behind a binary safety score.

The next validation boundary is not another claim of universal success. Evidence-subtype handling still needs a bounded correction and fresh independent examples if changed. Matched real-source title generation, independent creative review, cost/latency comparisons, production caller wiring, paid-admission/recovery behavior, other languages and music formats remain separate gates. See `docs/TITLE_ORACLE_RESULTS_2026-09.md` and `docs/METADATA_PAID_ADMISSION_FOLLOWUP_2026-09.md`.

Only this report was added during the second-pass analysis. No prompt, harness, fixture, original receipt, provider configuration or production state was changed, and no additional provider call was made by the reviewing agent.
