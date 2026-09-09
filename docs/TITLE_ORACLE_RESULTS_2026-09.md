# Title judge: live calibration, 9 September 2026

## Decision

**Not ready to claim a reliable universal quality gate.** The judge rejected all 19 schema-valid negative factual examples, but one response failed its schema, metaphor was confused with literal falsehood, and a valid direct title was rejected for insufficient theatricality. One creative verdict changed when candidate order reversed. These are measured defects, not reasons to relax factual admission or silently normalize invalid responses.

This is a source-fidelity and identity calibration, not audience testing, external fact-checking, historical replay, an owner preference score, or evidence of CTR/virality improvement. The 12 pairs include five excerpts from retained narration and seven explicitly synthetic packets. Labels were frozen before these calls; they are expectations authored by a separate coding agent, especially subjective for metaphor/identity, not human ratings. No labels, case IDs, fixture provenance or expected winners entered the judge prompt. No historical final title was an answer key.

## Evidence and exact scope

- Raw append-only receipts: `test-fixtures/title-pilot-2026-09/oracle/c01-original.jsonl` through `c12-reversed.jsonl` (24 files).
- Input corpus: `test-fixtures/title-oracle-calibration.json`; schema/provenance explanation: `docs/TITLE_ORACLE_CALIBRATION_NOTES_2026-09.md`.
- Each pair ran once in original order and once reversed, with one provider call maximum and a $0.05 per-operation cap. The batch stopped on its fifth operation's schema failure. The remaining 19 independent operations then ran once each; the failure was not retried.
- Actual route in all 24 requests: `google/gemini-3.7-flash`; all raw responses report `Google AI Studio` through OpenRouter. No image, package, comment, publication, or production database calls were part of this calibration.
- Harness SHA-256: `f75d1f3349c3a91e3f0a9d745c196d19e359d4fe6bab0464f3d308e782ca3cd8`.
- Evaluated `src/lib/metacraft.ts` SHA-256: `513146341a5c963ea5fd1899f4759e577225696d71ab08502b5448cd708f43d8`.
- Combined recorded production-code SHA-256: `d6c1bb7593fc85ed4226eff344939745e54c5eca14899934464cf5881f05cea3`.
- Frozen oracle fixture SHA-256: `73123e875e0c5c8c339cc216d437f27300d1ecea92dff3d0f63798aa6f46cffd`.
- Read-only integrity verification recomputed every request-body hash, response-body hash and request/response binding: 24/24 passed. Every file has one request, one raw response and one final result. Exact source/harness/model hashes are shared across all operations; original/reversed input hashes intentionally differ.

**Reproduction limit:** these first current-selector receipts contain source hashes and full provider prompts, not source-file text. No archive of the uncommitted `513146…` metacraft bytes was found in the known scoped pilot directory; exact source replay of that current implementation is therefore not established. The unchanged baseline is reconstructible from git 991b349 and its two recorded requests replay byte-for-byte. Later receipts add a separate allowlisted source-text archive; they do not retroactively repair the first revision's archive gap.

The analysis below uses validated `result.decision` and remapped `oracle_calibration` events. Invalid JSON/schema output remains failed, not partially scored. Quotes are only from the returned public `reason` fields, not provider reasoning traces.

## Counts, cost and latency

| Measure | Observed result |
| --- | --- |
| Independent judge operations / paid calls | 24 / 24 |
| Schema-valid operations | 23/24 (95.8%) |
| Failed / incomplete / purchased retries | 1 / 0 / 0 |
| Valid candidate judgments | 46 of 48 intended |
| Exact three-way factual labels | 40/46 (87.0%) |
| Unsupported factual promises incorrectly accepted | 0/19 valid negative judgments |
| Supported candidates incorrectly rejected factually | 3/27 valid supported judgments |
| Insufficient evidence mislabeled contradicted | 3/3 valid insufficient judgments |
| Labeled identity checks | 24/27 match (88.9%) |
| Identity false acceptance / false rejection | 0/2 / 3/25 |
| Fully paired schema-valid cases | 11/12 (22 candidate comparisons) |
| Changed factual/identity verdict on reversal | 1/22 paired candidates, in c12 |
| Accounted cost = provider-reported cost | **$0.05711850** |
| Unpriced responses / unknown spend holds | 0 / 0 |
| Selection latency, median / range | 1.932 s / 1.376–3.681 s |

Cost includes the failed operation's $0.00232950. Summing the raw provider usage costs independently matches the reconciled receipt total. Per-operation accounting uses the maximum of model-rate charge and provider-reported charge, then sums; it does not offset undercounts across calls. Selection elapsed time includes the judge operation; preparation/loading is recorded separately. Latency here is descriptive, not a production throughput or speedup claim.

Three-way factual confusion matrix (expected rows, actual columns; only schema-valid responses):

| Expected | Supported | Contradicted | Insufficient |
| --- | ---: | ---: | ---: |
| Supported | 24 | 3 | 0 |
| Contradicted | 0 | 16 | 0 |
| Insufficient | 0 | 3 | 0 |

The 19/19 rejection figure includes all 16 contradicted examples and three insufficient examples. It must not be presented as 100% overall accuracy: two intended candidate judgments were unscorable, three supported judgments were wrongly rejected, and three negative subtypes were wrong. The 48 judgments are also not 48 independent source cases: each of 24 candidates was requested twice.

## What worked

Both orders correctly distinguished mud preserving a letter from air destroying it (c01); spending versus income taxation (c02); explicit Stoic negation (c04); starting compounding earlier versus later (c05); deaths versus survival under two different incident sources (c06/c07); acquittal versus conviction (c09); and a 12-minute lesson versus a two-hour claim (c10). The valid c03 response rejected the universal insomnia-cure promise; both c08 responses rejected a settled betrayal claim when the source remained unresolved. No negative factual example was rescued by a high click score.

For calm classroom identity c11, the direct title was accepted and the adversarial creature framing rejected in both orders. The identity outcome was correct there, even though the factual reason was not.

## Failures and relevant reasons

### c03: strict schema failed, then evidence subtype was wrong

`c03-original.jsonl` returned `grounding: "unsupported"`, which is not one of the contract's `supported | contradicted | insufficient` values. The whole operation failed with `metacraft: malformed, duplicate or incomplete judge ranking`. Its reason was sensible but does not repair the invalid contract:

> The claim that gratitude 'cures insomnia for every listener' is completely unsubstantiated by the source text, introduces an unbacked medical promise, and violates the channel's understated register.

No result or cost was discarded and no alias normalization was applied. In reversed order, the response was valid but used `contradicted` rather than the frozen `insufficient` label: absence of a medical cure claim is not itself proof of the opposite. This was a safe rejection with an incorrect evidence subtype. Original/reversed semantic stability cannot be scored for c03 because the original schema failed.

### c08: unresolved evidence treated as contradiction

The lore candidate asserts that the Ash King betrayed the Silver Gate. Both orders rejected it as `contradicted`; the frozen expectation is `insufficient` because the supplied chronicles disagree and neither answer is established. Original-order reason:

> Asserts as a settled fact that the Ash King committed betrayal, contradicting the source packet which explicitly leaves the question unresolved between two conflicting chronicles.

The title must remain inadmissible, but the explanation should distinguish an unsupported conclusion from a proven false conclusion. This matters to repair instructions: inventing a confident opposite would not fix the missing evidence.

### c11/c12: metaphor, identity and factual grounding conflated

These cases deliberately share exact source and candidate bytes. Only identity and format change. The source describes income, spending and property taxes, and says it makes no claim that a literal monster exists. That is not a claim forbidding obvious personification. The two titles are:

- `How Taxes Apply to Income, Spending and Property`
- `Income, Spending, Property: Meet the Tax Monster`

c11's classroom persona explicitly rejects villains, fear cues and theatricality. The metaphor therefore fails this channel's identity test, not the underlying three-tax-bases factual test. Both orders instead labeled it `contradicted`. Original-order reason:

> Contradicts the source's explicit instruction that no monster exists and directly violates the channel persona by introducing an adversarial, fear-based villain trope.

The quoted source is data, not an instruction; the model also changed “contains no claim that a literal monster exists” into “no monster exists.” The final channel rejection was appropriate, but this attribution is wrong.

c12 explicitly permits obvious creature personification in a warm stage-comedy identity. In original order the metaphor received `contradicted`, identity 4, click 4. Reason:

> The source explicitly clarifies that the episode contains no claim that a literal monster exists and only uses the wallet as a metaphor, making 'Meet the Tax Monster' an ungrounded and contradicted framing.

Reversing candidate order changed that same candidate to `supported`, identity 9, click 8. Reason:

> Accurately lists the three tax bases (income, spending, property) while leveraging the channel's established theatrical creature-personification style to introduce the lesson playfully.

This is the one factual/identity verdict change among 22 valid paired candidate comparisons. It is an observed order-conditioned difference, not proof that position alone caused it: one draw per order cannot separate order bias from model sampling variability.

The direct c12 title stayed `supported` but received identity 6 and click 6 in both orders, failing the production threshold of 7. Reversed-order reason:

> Fully supported by the source explanation of how taxes apply across earnings, purchases, and ownership, though phrased more like a dry textbook lesson than a theatrical comedy piece.

The frozen label intentionally allows a clear searchable title even when a more theatrical alternative exists. “Not the strongest style match” is being treated as “unacceptable for the channel.” It is not correct to force all viable titles into the same rhetorical style.

### Prompt/source interpretation, not a claimed causal diagnosis

`sharedTitleContext` currently sends the explicit persona and format alongside a niche-derived `voice`. `resolveVoiceDoctrine` matches both c11 and c12 on finance and supplies `teacher-advisor`; it also sets the default clickbait direction to level 1. The full finance doctrine's tone paragraph is **not** sent to this judge: the actual packet contains its voice label and the selected clickbait direction. The prompt does not state which should prevail if explicit channel identity and this generic niche label disagree.

This is a plausible ambiguity to remove, not a proven sole cause. The direct-title rejection also follows from the model over-enforcing c12's explicit theatrical persona, while the metaphor rejection over-literalizes source text. Fixing only generic finance doctrine would not establish that both failure classes are solved.

## Matched Chalk title-selection pilot

The adjacent `chalk-baseline.jsonl`, `chalk-baseline-repeat.jsonl` and `chalk-current.jsonl` are a small title-selection experiment, separate from the labeled oracle. All use identical input SHA-256 `adf3dd7273bc282436924f2acacfb595abc1a078d44146ad587b77ba8acefa82`, including the full 2,592-character retained narration and currently observed identity. This is not historical invocation replay. The actual baseline production caller used an 800-character excerpt; that input-wiring difference is intentionally excluded from this library-level comparison.

| Condition | Selected title | Calls | Cost | Selection time |
| --- | --- | ---: | ---: | ---: |
| Baseline 991b349 | Taxes Are Not Designed Just to Fund Government | 2 | $0.00939450 | 7.630 s |
| Baseline repeat | Misunderstanding Tax Brackets Costs You Real Money | 2 | $0.00798975 | 6.102 s |
| Current selector | How the Modern Tax System Actually Works | 2 | $0.00993975 | 6.760 s |

The baseline source/dependency hash is `cb8c4b80e2a78cd7d5004a5ef3f610eb3740226d0571e1a778a365b589f97dd8`. Its two runs used the earlier harness SHA `f6a55e007fcb3c2bcf82d80621774bbbd76c23c409c0bd08a65748033bf69fb9`, independently archived before/after invocation; the new oracle adapter did not change the frozen Chalk input. The current run used the code and harness hashes recorded above. Baseline package/comment operations were explicitly suppressed; their synthetic ancillary values are not quality-scored. Integrated metadata-block behavior is a separate test.

The current title and its alternate (`Taxes Aren’t Just for Raising Government Revenue`) follow the actual narration's introductory mechanisms and its redistribution/behavior-steering sections. It judged five lexically retained candidates, admitted the selected title with a complete source/identity receipt and did not overwrite it with the planned title. The first baseline title is also source-supported. The repeat's tax-brackets/money-loss promise is not taught by the narration: the source mentions progressive rates but does not explain bracket misunderstanding or resulting personal loss. This is a concrete unsupported baseline promise, not an owner rating of wording quality.

All conditions receive the same retained top-12 competitor input, but unchanged baseline logic resolves only ten while current logic retains twelve; the actual prompts are therefore not identical beyond the selector change. The feed also contains unrelated high-view finance-adjacent titles, which is evidence for a later evidence-selection experiment, not permission to rewrite this comparison. The baseline repeat demonstrates variation under the same input, so one current result cannot establish consistent superiority. No cost or latency improvement is established; the current selection cost is slightly higher than either baseline draw. All three pilot runs cost $0.02732400 combined; oracle plus pilot cost is $0.08444250 across 30 paid calls, all priced.

## Next bounded slice and release gate

1. Keep the raw receipts, source hashes and frozen labels unchanged. Record any revised implementation as a new condition, not an overwrite or retroactive relabeling.
2. Make the judge's exact three-value schema and definitions unambiguous: unsupported evidence belongs to `insufficient`; `contradicted` requires source evidence of an incompatible claim. Retain fail-closed validation and explicit accounting; do not silently convert arbitrary enum values.
3. Separate material factual promises from recognizable rhetorical devices. Metaphor may be allowed by the specific identity; it must not create unsupported entities, events or outcomes. Explicit persona/format should govern register; niche doctrine is a fallback, not an unqualified override.
4. Separate minimum identity acceptability from relative creative preference. A straightforward title can be acceptable without beating a theatrical one. Do not lower all thresholds to make these examples pass.
5. Rerun the frozen failed/ambiguous cases in both orders after a bounded prompt/contract change; retain successful negation, rescue, tax and duration controls. Use fresh held-out metaphor/uncertainty examples before claiming generality; repeated tuning on these 12 pairs alone is not validation.
6. Run matched title selection across the actual eight-case source corpus, with baseline-repeat controls and independent output review, before making claims about quality consistency, shorter stronger titles, cost or speed. Keep missing historical context explicit. Non-English and music-format behavior remain unmeasured here.
7. Validate the real metadata caller, paid-admission/recovery fences and package continuation independently before rollout. See `docs/METADATA_PAID_ADMISSION_FOLLOWUP_2026-09.md`; this isolated judge test does not certify those production boundaries.

No implementation, fixture, provider setting, thumbnail module configuration or production state was changed during this analysis. The main agent performed the authorized paid calls; this report was produced by read-only receipt/source inspection.
