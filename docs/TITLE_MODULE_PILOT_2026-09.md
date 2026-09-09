# Title pilot — real baseline and unchanged control

Recorded 9 September 2026. This is a small title-selection experiment, not a historical replay, a full metadata run, a production release, or evidence of improved CTR. It follows the [research protocol](TITLE_MODULE_RESEARCH_2026-09.md).

## Fixed conditions

- Exact retained Chalk & Compound episode: `js705md1etr1kr0mpbpvpqaz8x89znvt`.
- Same 2,592-character narration and frozen current channel identity in both conditions. The old production caller normally supplied only its first 800 characters; these experiments deliberately supply the same full source to the baseline library.
- No historical final title supplied as an answer. Retained topic-bet title remains an input, as documented in the source corpus. Missing historical autocomplete is explicitly withheld; retained competitors are fixed, not freshly researched.
- Actual unmodified baseline title source from `991b349`; package/comment calls are suppressed and their synthetic values excluded from measured outputs. Actual generator and judge calls use the approved OpenRouter Gemini Flash route and a vault-injected key.
- Each condition allows at most two paid calls and $0.15. Both completed within those limits; no extra retry was purchased. These deliberately small limits test the ordinary two-call path, not the baseline's entire retry envelope.
- Frozen harness SHA256: `f6a55e007fcb3c2bcf82d80621774bbbd76c23c409c0bd08a65748033bf69fb9`.
- Experiment input SHA256: `adf3dd7273bc282436924f2acacfb595abc1a078d44146ad587b77ba8acefa82`.
- Loaded production-code hash set SHA256: `cb8c4b80e2a78cd7d5004a5ef3f610eb3740226d0571e1a778a365b589f97dd8` in both runs. Full per-file hashes and raw requests/responses are retained in each receipt.

## Observed outputs

| Condition | Selected title | Alternate | Calls | Recorded cost | Selection time |
| --- | --- | --- | ---: | ---: | ---: |
| Baseline | Taxes Are Not Designed Just to Fund Government | How Taxes Work and Why Every Country Needs Them | 2 | $0.00939450 | 7.630 s |
| Unchanged baseline repeat | Misunderstanding Tax Brackets Costs You Real Money | How Taxes Work Explained in One Simple System | 2 | $0.00798975 | 6.102 s |

Combined recorded cost: **$0.01738425**, four paid calls, zero unpriced responses. Cost accounting uses the larger of the model-rate calculation and provider-reported charge for each response, then sums those amounts. They agree for these responses; this is a call receipt, not an invoice or a fleet cost-saving estimate. Timing excludes source-loader preparation but includes selection and local instrumentation.

Both generations used the same exact request bytes. Their generated candidates, subsequent judge request bytes, and selected titles differed. This is observed variation under unchanged conditions, not evidence that one implementation improved the other.

## Source-fidelity review

The supplied narration explicitly covers public services, income/consumption/property taxes, redistribution, behavioral incentives and economic friction. It supports the first winner's distinction between revenue and other functions of taxation.

The repeat winner promises that misunderstanding tax brackets causes a personal monetary loss. The narration mentions progressive income tax but does not explain bracket mechanics, bracket mistakes or a resulting loss. This is an **unsupported specific promise**, not proof that the proposition is false in the world. The old judge nevertheless marked it judged and selected it. A passing click score did not establish source fidelity.

The review is an engineering reading of the retained script, not independent verification of its financial assertions. No video was published or renamed by this experiment. No result is an owner preference label. The replacement selector and independent oracle still require matched testing; one source and two generations cannot establish reliability, creativity, virality or multilingual coverage.

## Raw evidence

- [Baseline receipt](../test-fixtures/title-pilot-2026-09/chalk-baseline.jsonl), SHA256 `760eb8a8469b7d530e3a8b36d5610745d8a08b9cc585312acfdcd5dc5d579351`.
- [Unchanged repeat receipt](../test-fixtures/title-pilot-2026-09/chalk-baseline-repeat.jsonl), SHA256 `16c41be13eb00d78593350c81e97d3a33ed4a7120facaff22f452510b5e00580`.

These are byte-identical copies of the generated append-only receipts, inspected for authorization headers and credential-like material before retention. Original local receipts remain unchanged. Production-code hashes are inside them; the exact instrumentation hash is recorded above because this first harness version did not include its own hash in the event envelope.
