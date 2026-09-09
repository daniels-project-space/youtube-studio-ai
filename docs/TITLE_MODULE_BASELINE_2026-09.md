# Title module baseline — September 2026

## Status and evidence boundary

Read-only source/fixture audit following `docs/MODULE_HARDENING_METHOD.md`. No live title generation, paid provider call, production mutation, or media render was performed for this baseline. No title source was changed. This document does not claim improved output quality, CTR, cost, or latency.

The audit used the existing Graphify graph, focused current-source inspection, the convergence/inertness audit scripts, local retained inventory, and a deterministic invocation of the current `lintTitle`. Serena tools were not available in this session. Repository HEAD when this record was saved: `ba9d389b58ae68712dffb3ecf3e7a9916b6e257d`; other agents had unrelated worktree edits, so findings describe inspected source, not a clean-commit benchmark.

**The eight proposed bindings below are not frozen full metadata inputs.** They identify real retained runs and preserve the exact locally available title/identity fields. Their narration, topic, hook, channel configuration, evidence, and model receipts still need to be recovered and frozen before a valid generation comparison. Some inventory entries are legacy; their titles are not current-engine quality scores or owner-approved golden video titles. Owner-approved thumbnail headlines are a separate artifact.

**Subsequent source capture:** [the source-availability report](TITLE_CORPUS_SOURCE_AVAILABILITY_2026-09.md) now records eight frozen real packets, including five full narrations and six competitor feeds. The initial inventory-only findings below remain historical audit context. Missing invocation/configuration evidence was not recovered or invented, so the packets support a declared current-identity experiment, not an exact historical replay. No live generation baseline has been run.

## Actual production chain

1. `src/trigger/planWeekAhead.ts` prepares scheduled plans; `src/trigger/runPipeline.ts` seeds the selected plan's `plannedTitle` into pipeline inputs.
2. `src/trigger/blocks/intelligenceBlocks.ts` → `metadataOptimized` builds metadata inputs from the topic, script, channel persona/configuration, planned title, and topic-bet title.
3. `src/lib/metacraft.ts` → `craftMetadata` researches evidence, generates candidates, applies `lintTitle`, judges survivors, and packages the winning title with description/tags/comment.
4. `src/lib/anthropic.ts` → `claudeJson` is a compatibility wrapper around `src/lib/openRouter.ts` → `openRouterJson`. Despite the historical name and stale comments, this is not a direct Anthropic route. Current default intelligence/creative routes are `google/gemini-3.7-flash`; approved configuration overrides must be recorded in benchmarks.
5. `intelligenceBlocks.ts` → `finishMetadata` cleans metadata and appends chapters/credits. The result flows into opening/package alignment, thumbnail generation, and release metadata. The thumbnail module is outside this title-change scope.
6. `src/trigger/titleCtrSwap.ts` consumes the alternate title later. It requires insights, explicit `approvedForMetadataChanges`, and appropriate YouTube scopes. The cron does not supply that approval. Its feedback is attributed CTR, not a native watch-time-share experiment.

## Current prompt and decision contract

### Primary metacraft path

- Evidence: `youtubeSuggest(seed)` always runs; `fetchCompetitorTitles` runs when `competitorTitles?.length` is falsy. The seed is approximately the topic's first five words. Suggestions have no explicit locale and are uncached. An explicitly supplied empty competitor result therefore causes another live lookup instead of freezing an authoritative empty result.
- Seven generator frames are mandatory: specific number, curiosity gap, contrarian, mechanism, stakes/warning, search-intent query, and direct verdict. Generator: `maxTokens: 2500`, temperature `0.85`. At most two candidate-generation attempts.
- Planned and topic-bet titles enter the primary candidate pool through `warmStartCandidates`; neither replaces the primary winner by precedence. Deduplication covers those warm starts, not all generated candidates or alternate titles.
- The computed lint grounding contains topic, cold open, hook loop, quote, and script excerpt. The generator prompt does **not** receive the script excerpt or quote; it receives the topic, cold open, hook loop and channel/evidence instructions. The production caller usually supplies only the first 800 narration characters, with headings as a fallback; it is not a full-script factual audit.
- The judge gets topic, competitor feed, about 350 characters of cold open, and candidates. It does not get the full script excerpt, quote, hook loop, explicit persona/language/formula/clickbait context, despite being asked to assess register and honesty. Judge: `maxTokens: 2500`, temperature `0.2`.
- Ranking requires click score ≥7 and directness ≥7, but the actual filter uses `(r.direct ?? 10)`, so a missing directness score qualifies. It checks numeric indexes without integer validation, lacks finite/upper-bound score checks and duplicate-index validation. Sorting treats missing directness as zero, inconsistent with admission. Requested `winner`/`runnerUp` fields are ignored in favor of rankings.
- A thrown judge call accepts the first lint survivor as `UNJUDGED`; warm starts are prepended. `CraftedMetadata.judged` and its nullable score are logged but are not preserved in the final block output as a decision receipt.
- The chosen title's description/tags are generated in a separate call (`maxTokens: 2500`, temperature `0.8`). A concurrent pinned-comment call (`maxTokens: 1200`, temperature `0.8`) soft-fails to an empty comment. Failure in description/tag packaging throws the entire `craftMetadata` result, losing a successfully selected title.

### Current deterministic title lint

`src/lib/metacraft.ts` → `lintTitle` applies a uniform 25–76-character gate while prompts target 40–70. It rejects certain filler starts, setup-colon patterns, hype, channel-name inclusion and music leakage. It checks numbers/proper-name tokens against source text and the position of a payoff number. ASCII casing heuristics stand down for some title-cased strings; a title-cased proper-name run can pass when any significant word appears in the source.

These checks are useful structural heuristics, **not semantic fact verification**. They cannot establish that a promised outcome follows from the script. Also, the caller's music-niche regex includes sleep/relax/study terms; actual format/capability should distinguish guided meditation from LoFi instead of relying on broad topic words.

### Contradictory live fallbacks

`intelligenceBlocks.ts` contains three materially different title paths:

| Path | Actual behavior | Problem |
| --- | --- | --- |
| Primary `craftMetadata` | Competes planned and bet titles with generated candidates | Correct precedence principle, but judge/input/receipt gaps remain |
| No-key degraded return | `title: plannedTitle || title`, repeated in thumbnail descriptor | Bypasses candidate quality and reinstates planned-title precedence |
| Legacy tournament/critique return | `title: plannedTitle || title`, repeated in thumbnail descriptor | Overwrites the title selected by fallback generation/judging |

Any primary exception, including a package failure after title selection, enters a five-package tournament. It generates five complete title/description/tag packages (`maxTokens: 2200`, temperature `0.85`), then judges them (`maxTokens: 1200`, temperature `0.3`). Its candidate filters use 25–100 title characters and description length, not the shared primary grounding gate. There is no minimum winner score; a tournament result prevents the later critique loop even if its score is poor.

If the tournament does not produce a result, `produceAndCritique` runs up to three producer/director rounds with threshold `0.8`. Its generic producer instruction explicitly asks for **60–90 characters, aiming long**, asserts that “70–100 char titles earn +10–14% CTR,” and encourages niche caps, suffixes, years and explained brackets. This unsupported uplift assertion conflicts with primary title-length guidance. `src/engine/critiqueLoop.ts` deliberately returns the best candidate even when none is accepted; the metadata caller consumes that value and logs acceptance rather than enforcing it.

Finally, `finishMetadata` removes channel names after judging without re-linting the mutated title. A selected title and the shipped title can therefore differ even apart from planned-title overrides.

## Deterministic counterexample: current gate

This is a synthetic adversarial **gate test**, not a real retained script and not a generation-quality result. Executed locally against the current exported function, with no provider invocation:

```ts
const grounding = "The bridge collapse killed 47 engineers. No engineers survived.";
lintTitle("47 Engineers Died in the Bridge Collapse", { grounding });
lintTitle("47 Engineers Survived the Bridge Collapse", { grounding });
```

Observed output:

```json
{"title":"47 Engineers Died in the Bridge Collapse","pass":true,"issues":[]}
{"title":"47 Engineers Survived the Bridge Collapse","pass":true,"issues":[]}
```

The contradictory survivor passes because source-token presence is not causal/semantic grounding. Future validation must reject the second promise without incorrectly rejecting the first; adding the word “survived” to a blacklist would not address the defect.

## Retained inventory: provenance and proposed eight cases

Source: existing local `/tmp/thumbnail-refresh-live.json`, collection `inventory`, read during this audit; no new live inventory/provider request was made. SHA-256 of the complete source file:

```text
036363e3468525891a813108f9380d01205547e6c984711796b3ecbc3b5d204f
```

The local snapshot contains 40 rows across nine channel IDs. Its acquisition time/current-live equivalence was not established in this audit. Counts use JavaScript string length: median title length 65, 14 above 76, one below 25, 23 containing a colon, 36 above 50. **These are legacy/mixed-inventory descriptive statistics, not scores of the current module, proof of failure for every title, or a target to optimize blindly.**

Exact extracted binding fields follow. `legacyCleanupAction` is the snapshot's classification, not authorization to delete or publish. All eight source rows had inventory `status: "ok"`; that is not title-quality approval. Channel slugs are retained exactly, including the historical Seaside Ghibli slug.

```json
[
  {
    "runId": "js76ghf4s44b4w5d97cs2f49bd89znxa",
    "channelId": "j97btry53hv0y363bwq6w69yx989wqr0",
    "channelName": "Inked Histories",
    "channelSlug": "inked-histories-1783204937695",
    "title": "7 Secrets of Battlefield Relic Preservation Revealed",
    "legacyCleanupAction": "keep"
  },
  {
    "runId": "js705md1etr1kr0mpbpvpqaz8x89znvt",
    "channelId": "j973233pdy3wbvs55jq1d4nsas89xraz",
    "channelName": "Chalk & Compound",
    "channelSlug": "chalk-compound-1783204937273",
    "title": "Taxation Isn't Complex: A Simple Framework",
    "legacyCleanupAction": "keep"
  },
  {
    "runId": "js72d9gty4nrqqq7wevv0m0hyd89xgk9",
    "channelId": "j97eadtp9nnhj5v2q7e6c93b2989w9gb",
    "channelName": "Gratitude Springs",
    "channelSlug": "gratitude-springs-1783204939314",
    "title": "Gratitude for the People Beside You Brings Deep Sleep",
    "legacyCleanupAction": "keep"
  },
  {
    "runId": "js7eh3rvdhjyqwkmnseb0qtvfh88mrq7",
    "channelId": "j97ax079vqhn58tkhg2yhdty9x87xaj5",
    "channelName": "The Quiet Stoic",
    "channelSlug": "the-quiet-stoic-1780409262742",
    "title": "Enduring Bad Behavior Is Self-Destruction, Not Stoicism",
    "legacyCleanupAction": "keep"
  },
  {
    "runId": "js72sy9xyvxtptvtbbg2z8aegs88ez4t",
    "channelId": "j973w7hx3s1g29w04ntfdja9ms88d7v6",
    "channelName": "Investory",
    "channelSlug": "investory-1781107671769",
    "title": "How Small Starts Build Real Wealth: The Silent Momentum",
    "legacyCleanupAction": "keep"
  },
  {
    "runId": "js743qy08vp7z2rb367cg8spgd88aaye",
    "channelId": "j978et30ex8mksrjs6kpyc7gad88ar0x",
    "channelName": "Seaside Ghibli Lofi",
    "channelSlug": "rainy-desk-lofi-1781024512939",
    "title": "Rainy Lighthouse Keeper's Desk Lofi ~ Cozy Ambience for Deep Focus & Study [3 HRS]",
    "legacyCleanupAction": "retire"
  },
  {
    "runId": "js71tzddw482bhs41tgw0gsztn88bhv7",
    "channelId": "j977t0zqt4e2xf99qgz7qfv7w18899st",
    "channelName": "Drift & Study",
    "channelSlug": "drift-study-1780962831581",
    "title": "Train Window Reflections: Your Quiet Journey for Late-Night Focus & Cozy Thoughts (LOFI)",
    "legacyCleanupAction": "retire"
  },
  {
    "runId": "js74bqgxfxpzak00v445ppdazx87tq2h",
    "channelId": "j975923e1vv0ve8ds1xbprekv987vpfy",
    "channelName": "Rainy Neon Lofi",
    "channelSlug": "rainy-neon-lofi-1780273017590",
    "title": "rainy neon rooftop at midnight — Lofi Beats to Relax / Study To 🎧 Rainy Neon Lofi",
    "legacyCleanupAction": "retire"
  }
]
```

The contrasts are historical explanation, finance education, guided meditation, behavioral argument, wealth-building explanation, and three differently positioned music/ambience channels. **Eight channels are not eight distinct format families.** The last three are historical regression sources, not release candidates. Add genuine retained Shorts, multilingual and narrative-fiction inputs when their full source packets are located; do not fabricate them and label them retained evidence.

### Missing full-fixture fields: required before generation

For each binding, recover the actual metadata-stage input/output and producing run configuration without rerunning modules. Freeze exact topic, channel identity/persona/niche, format/capabilities, language, script excerpt, cold open, hook loop, quote, planned/bet titles, formula, description structure, power words, clickbait/performance context, and competitor/suggestion evidence. Preserve omitted versus explicitly empty evidence. Record source run/stage IDs, input/config hashes, model/route/prompt versions and acquisition timestamps. Do not infer narration or fill absent source fields from the existing title. An unrecoverable case remains incomplete or is replaced with another provenance-backed run.

Keep benchmark reference judgments/approved outcomes separate from generator input. Historical fixture titles are baseline outputs, not instructions to reproduce those titles.

## Existing tests and cheapest real benchmark entry

| Surface | What it establishes | Gap |
| --- | --- | --- |
| `src/lib/__tests__/metacraftGates.test.ts` | Deterministic lint behaviors and source assertions | Judge threshold is checked as source text, including the permissive `direct ?? 10`; not malformed-response behavior |
| `metacraftWarmStart.test.ts` | Stubbed model winner selection through `craftMetadata` | Does not exercise `metadataOptimized` fallback; suggestions are not stubbed, so it is not completely network-isolated |
| `metacraftWarmStarts.test.ts` | Planned/bet deduplication and caller source checks | Does not prove downstream preservation or alternate uniqueness |
| `scripts/metadata-harness.ts` | Direct full-package `craftMetadata` calls | Requires absent `/tmp/ch.json` and `/tmp/cp.json`; lacks actual script/hook grounding, uses live evidence, and bypasses actual `finishMetadata` |
| `scripts/title-ab-harness.ts` | Plan-based before/after packaging | Plan description/scene seed substitute for narrated inputs; changing live evidence, no independent oracle or captured usage receipt |
| `scripts/metacraft-bet-title-value.ts` | Topic-bet nomination experiment | Four channel voices × two bets × three package conditions plus topic work; not a cheap title-only test; its own control results acknowledge nondeterminism |
| `scripts/meta-duel.mjs` | Nine checked-in historical cold-open fixtures | No run/manifest/hash provenance; old direct-Gemini route and top-level calls: extract literals only, do not execute as the benchmark |

The nine historical cold opens cover Stoic anger, Onin/Kyoto, Rome's fall, the dancing plague, a film-franchise story, speculative Rome, an AI board member, paparazzi, and Sackler/Louvre. They are useful secondary regression material but not substitutes for complete current-run fixtures.

The cheapest **existing** real entry is direct `craftMetadata` with one complete exact input packet, not a Trigger/full-video run. It still performs a full package and evidence lookup. A normal first-pass result is four model calls: candidates, judge, description/tags, and comment. A second title attempt adds two. Legacy tournament/critique recovery can add up to eight calls after primary failure. These are inspected call-path counts, not measured spend or expected savings.

`src/lib/modelUsage.ts` → `createModelUsageScope` already records calls, tokens, cache hits, cost and unpriced usage. Reuse this with monotonic elapsed time, actual resolved model/route, attempts and fixture hashes. No live baseline has been run yet, so no observed per-case cost/latency or quality delta is available.

## Next exact implementation slice

1. **Freeze and calibrate before paid comparison.** Recover complete packets for the eight bindings above, add supported contrasting formats, and preserve a baseline revision. Create factual-contradiction, identity-mismatch, truncation, malformed-judge and valid-edge-case fixtures. Calibrate the oracle to reject actual bad promises without rejecting valid creative titles. Do not feed approved answers to generators.
2. **Separate title decision from ancillary packaging.** Extract a typed production title-selection function used by `craftMetadata` and an isolated title-only harness. Preserve candidates, winning/alternate indexes, scores, grounded source identity, judged status and usage receipt. A description/tag/comment failure must not discard or replace an already validated title.
3. **Make decision admission strict and consistent.** Require finite bounded scores, explicit directness, integer unique indexes, distinct normalized alternate titles, and a valid winning candidate. Do not silently accept unjudged output or treat planned-title precedence as a quality fallback. Pass the same source/identity packet to generator and judge. Preserve bounded explicit retry behavior.
4. **Remove contradictory fallback title authority.** No-key/legacy paths must not reinstate `plannedTitle || title`, ship an unaccepted critique result, or overwrite a validated decision. Use the shared title decision contract or expose a recoverable incomplete state. Retire unsupported length-uplift and generic suffix instructions instead of adding another competing prompt layer. Re-lint any unavoidable post-selection title normalization.
5. **Run the cheapest controlled real benchmark.** Shared title selection normally needs two model calls per case, not four full-package calls. Freeze external evidence once; compare baseline/change on identical inputs and resolved routes, include repeated unchanged controls, and record factual violations, identity fit, blinded preference, valid-alternate rate, retries, latency and actual priced/unpriced cost. Judge preference is not measured virality; CTR/watch-time need a later authorized live experiment.
6. **Prove the real caller preserves the result.** Behavioral tests must execute `metadataOptimized` for no-key, judge failure, package failure, scheduled-title competition and post-processing cases. Then perform one low-cost actual metadata-block integration run with complete retained input and all normal gates; assert downstream opening/package metadata contains the selected title and receipt. No thumbnail/media render is needed for this slice. A later held-out novel-channel pipeline test remains separate goal work.

Acceptance evidence before claiming this slice complete: zero silently admitted malformed or unjudged decisions, zero winner overwrites after successful selection, no duplicated alternate, rejection of the contradictory collapse promise, measured benchmark quality/cost/latency with uncertainty, and actual caller integration proof. Do not claim cost savings merely because the fallback has fewer possible calls, or channel-general quality because legacy titles became shorter.
