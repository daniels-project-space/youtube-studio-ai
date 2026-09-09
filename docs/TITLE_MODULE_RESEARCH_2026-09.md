# Evidence-based title generation

## Assessment

A useful title communicates a specific reason to watch, in the channel's voice, which the actual video fulfills. Shortening every title or increasing a model's self-reported click score cannot establish that result. The title system needs a reliable decision boundary, a calibrated content check, and controlled comparisons on retained episodes before creative improvement can be claimed.

The inspected production baseline at `991b349` has three competing title authorities: the primary `metacraft` selector, a legacy full-metadata tournament/critique fallback, and a planned-title override. A failure while generating a description can discard an already selected title. A missing judge score can default to a passing value, and a judge failure can ship an unjudged candidate. The [source audit](TITLE_MODULE_BASELINE_2026-09.md) records these defects and a factual contradiction that the existing lexical lint accepts.

Eight [retained source packets](TITLE_CORPUS_SOURCE_AVAILABILITY_2026-09.md) provide a starting corpus, with five full narrations. None is an exact historical model-invocation replay. Current channel identity is recorded separately from old content; missing historical context remains unknown. These boundaries matter more than the number of tests: a carefully labelled current-identity experiment is defensible, while pretending to reproduce historical inputs is not.

This report separates published findings from engineering proposals. Sources were checked on 9 September 2026. Proposed thresholds and module changes below are not presented as measured engagement gains; experimental results belong in a separate, revision-bound report.

## Platform evidence

YouTube recommends accurate, succinct titles with important words near the beginning, and distinguishes searchable titles from curiosity-led titles. Audience and discovery surface should influence the choice. Its advice does not establish a universal ideal character count or a guaranteed uplift from longer titles.[^1]

The API's 100-character title limit is a storage constraint, not a quality score.[^2] Consequently, a 24-character title should not fail merely because an internal default begins at 25; nor should a 90-character title pass merely because the API accepts it. Changes to the current lint band need tests over actual language, identity, format and truncation—not a new arbitrary global band.

YouTube's native title/thumbnail experiment compares up to three alternatives and selects by watch time. Tests can be inconclusive, and eligibility excludes several formats and private content. The documented workflow is in desktop Studio; a public API integration is not established by this help page. Native tests are concurrent, whereas sequential title swaps can be confounded by changing audiences. Treat existing CTR-swap observations as observational evidence, not equivalent randomized experiments.[^3]

Recommendation and search performance are not determined by title text alone. YouTube describes matching viewers with content they are likely to value; tags mainly help with spelling variants. A model-generated tag count or predicted CTR is therefore a weak substitute for an episode's fulfilled promise.[^4]

The current spam policy also prohibits maliciously misleading metadata and repetitive automated mass-production. Originality, substantive variation and accurate packaging must survive weekly batching; changing titles on otherwise repetitive videos is not an originality mechanism.[^5]

## Experimental headline research

### Simplicity and clarity

Shulman, Markowitz and Rogers studied more than 30,000 news-headline field experiments and follow-up attention experiments. Readers generally preferred simpler wording; professional journalists did not show the same preference pattern. The work supports testing readable, familiar language rather than optimizing for the writer's impression of sophistication.[^6]

Transfer limitation: these are news-reading studies, not a causal estimate for this YouTube fleet. A lore audience may understand a character name that a generic readability metric penalizes. Preserve necessary names, domain terms and uncertainty qualifiers; remove avoidable decoding effort. A shorter title that loses the actual subject is worse, even if its readability score rises.

### Curiosity without vagueness

Aubin Le Quéré and Matias' registered report analyzed 8,977 headline experiments. The direction of the concreteness effect depended on the alternatives: adding information could help overly vague headlines and hurt overly concrete ones. Their analysis controlled headline comparisons for the accompanying image.[^7]

Transfer limitation: the source data came from Upworthy's 2013–2015 experiments. It does not prove an optimal concreteness score for modern video recommendations. The useful design inference is to compare meaningful alternatives: reveal the subject and stake while varying how much of the explanation or resolution is withheld. Do not mandate a curiosity gap, ban direct answers, or use the same missing-information template for every channel.

### Emotional language

Robertson and colleagues found a causal association between negative wording and clicks in randomized Upworthy headline tests.[^8] That does not imply that negative framing improves satisfaction, that its effect transfers to every audience, or that a meditation video benefits from threat language. Channel tone and factual support should constrain emotional framing before click appeal is compared. No fixed percentage uplift from this study should enter the production prompt.

These findings are compatible: simple language can communicate either a direct finding or an unresolved tension. Neither simplicity nor curiosity requires exaggeration. Conversely, all three can be misused if a judge rewards surface style without reading the source.

## Evaluation evidence and limits

LLM judges can approximate some human preferences, but published evaluations identify position, verbosity and self-preference biases, as well as reasoning limitations. Reported agreement on chat benchmarks is not a calibration result for titles.[^9] A title judge must therefore be tested with order reversals, indistinguishable candidates, obvious false claims and legitimate stylistic contrasts. A score of eight is model output, not an observed probability of a click.

FActScore decomposes generated content into claims and evaluates source support.[^10] For titles, the useful adaptation is an explicit claim check: who did what, to whom, with what quantity, outcome, time or certainty. This is an engineering inference from factual-evaluation work, not a claim that FActScore itself validates this pipeline.

The bridge example illustrates the distinction. Both “47 Engineers Died in the Bridge Collapse” and its “Survived” variant contain source words; only one matches a source stating that all 47 died. An effective oracle must distinguish their relationship to the source, including negation and uncertainty. A blacklist of “survived” would reject valid rescue stories and leave analogous contradictions untouched.

## Module design

### One title authority

Separate the title decision from descriptions, tags and optional comments. The decision must retain its exact text, candidate identities, source/evidence fingerprint, complete judge result and admitted alternate. A later module may consume it, but cannot silently replace it. Planned and topic-bet titles remain candidates, not higher-priority answers.

Description failures should retry only description work when the provider outcome permits a retry. Successful title work must remain reusable through the real runner's recovery mechanism, not just in a local variable that disappears when the task restarts. Unknown paid outcomes require reconciliation; a received but unusable response is a different condition with a recorded cost.

### Shared evidence with separate authority

Generator and judge need the same actual episode content and channel identity. Competitor titles and search suggestions are audience-language evidence, not factual evidence for this episode. An empty frozen result must stay empty; an unavailable result must remain explicitly unavailable instead of triggering a hidden lookup during a comparison.

Full available narration is preferable to a silently truncated opening for title factuality. When content exceeds the admitted context budget, record coverage and use a tested source-selection contract. Do not present an excerpt check as proof over the whole video. The title's promise should also be checked against the actual opening separately from full-script support.

### Strict admission, not stylistic uniformity

Reject malformed judge output: nonfinite/out-of-range scores, fractional or duplicate candidate indexes, missing required fields, unknown candidate references and unjudged winners. Require source support and identity fit independently of click appeal. A high appeal score cannot compensate for a false claim.

Preserve channel-specific variety inside those boundaries. Search-led education can name the explanation directly; narrated history can foreground a consequential event; meditation can promise an honest experience without guaranteed health outcomes; LoFi can identify its actual sound, setting and use. These are examples of audience intent, not a hard-coded catalog of allowed title formulas.

### Measurable improvements

| Intervention | Defect it addresses | Required evidence |
| --- | --- | --- |
| Typed title decision | Packaging can erase title work | Actual block keeps the identical title after package failure/recovery |
| Strict judge parsing | Missing/invalid fields can pass | Malformed-response mutation sweep rejects each defect |
| Semantic source admission | Token overlap accepts false outcomes | Supported/contradicted pairs, including valid uses of the same verbs |
| Shared identity packet | Judge lacks writer context | Real channel contrasts pass without one default house voice |
| Frozen evidence injection | Before/after research can differ | No network in replay; byte-identical experimental evidence |
| Candidate identity/deduplication | Alternate can duplicate the winner | Normalized distinctness plus meaningful-diversity review |
| No planned-title precedence | Scheduled text bypasses judging | Worse planned candidate loses through the actual production caller |
| No post-judge rewrite | Shipped text differs from approved text | Consumer output and decision receipt match exactly |
| Package-only recovery | Repeated paid title work | Provider call ledger and restart/replay tests, including failure costs |
| Format-aware future length policy | Global lint rejects valid contrasts | Calibrated multilingual/format corpus before replacing thresholds |

These are acceptance criteria, not claims that every row is implemented. Existing thumbnail generation, typography, imagery and model configuration remain outside this rewrite.

## Controlled comparison protocol

The first experiment should isolate title selection using exact baseline source from `991b349` and the changed production selector. Both conditions receive the same frozen current-identity packet and full retained narration. This is a new library-level experiment; the baseline production caller historically supplied a shorter excerpt, so the comparison is not a historical replay or a measurement of the caller-input change.

Suppress ancillary description/comment calls only in the baseline title-selection harness, documenting that intervention and excluding their synthetic outputs. Execute actual title-generation and judging logic. Separately exercise the real metadata block without bypassing its title, package or downstream contracts. This separates an economical creative comparison from an integration test instead of confusing them.

Preserve raw title requests/responses, source/model/code hashes, call purpose, accepted and rejected candidates, monotonic elapsed time, usage and partial-failure receipts. Never record authorization headers. Enforce call and spend ceilings before dispatch; an unpriced response is not zero-cost success. Include repeated unchanged controls so ordinary model variation is visible.

Review all selected titles against the source before interpreting blinded preference. Report output validity, unsupported promises, identity mismatches, alternate availability, order sensitivity, calls, latency and priced/unpriced cost separately. No average quality score may hide a false claim. Report sample size and channel coverage; five narrated channels do not establish reliability for Shorts, multilingual output or unfamiliar narrative formats.

Finally, validate the oracle in both directions. Corrupt the same real examples and verify rejection, then confirm legitimate alternatives survive. Keep owner-approved thumbnail headlines separate from approved video titles. A later genuinely unfamiliar automatically created channel must still prove the integrated system without hand-authored creative substitution.

## Decision

First remove competing title authority and make selection evidence durable and inspectable. Then use controlled output comparisons to refine creative framing and format behavior. Do not ship a narrower title style simply because it is easier for a deterministic test to accept, and do not call fewer potential model calls a cost saving until the actual ledger demonstrates it.

## Sources

[^1]: YouTube Help. [Thumbnail & title tips](https://support.google.com/youtube/answer/12340300). Undated; checked 9 September 2026.
[^2]: Google for Developers. [YouTube Data API: Videos resource](https://developers.google.com/youtube/v3/docs/videos), `snippet.title`. Checked 9 September 2026.
[^3]: YouTube Help. [A/B test titles & thumbnails](https://support.google.com/youtube/answer/16391400). Undated; checked 9 September 2026.
[^4]: YouTube Help. [YouTube performance FAQ & Troubleshooting](https://support.google.com/youtube/answer/141805). Undated; checked 9 September 2026.
[^5]: YouTube Help. [Spam Policy](https://support.google.com/youtube/answer/2801973). Undated; checked 9 September 2026.
[^6]: Shulman, H. C., Markowitz, D. M., and Rogers, T. [Reading dies in complexity: Online news consumers prefer simple writing](https://pmc.ncbi.nlm.nih.gov/articles/PMC11152133/). *Science Advances*, 10(23), eadn2555, 5 June 2024. DOI: 10.1126/sciadv.adn2555. Original article accessed through its PMC archive; publisher page returned HTTP 403.
[^7]: Aubin Le Quéré, M., and Matias, J. N. [When curiosity gaps backfire: effects of headline concreteness on information selection decisions](https://www.nature.com/articles/s41598-024-81575-9). *Scientific Reports*, 15, 994, 6 January 2025. DOI: 10.1038/s41598-024-81575-9.
[^8]: Robertson, C. E., et al. [Negativity drives online news consumption](https://www.nature.com/articles/s41562-023-01538-4). *Nature Human Behaviour*, 7, 812–822, 2023. DOI: 10.1038/s41562-023-01538-4.
[^9]: Zheng, L., et al. [Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena](https://arxiv.org/abs/2306.05685). 2023. arXiv:2306.05685.
[^10]: Min, S., et al. [FActScore: Fine-grained Atomic Evaluation of Factual Precision in Long Form Text Generation](https://aclanthology.org/2023.emnlp-main.741/). *EMNLP*, 2023, pp. 12076–12100. DOI: 10.18653/v1/2023.emnlp-main.741.
