# Title corpus — retained source availability

## Outcome

Eight real source packets are saved in `test-fixtures/title-baseline/`, with exact file/source/narration SHA-256 hashes in `manifest.json`. Five contain full retained narration. Six retain competitor title/view evidence. Three contain a separate `script.hook`, two contain `script.hookLoop`, and three contain a topic-bet provisional title.

**Zero cases are exact historical model-invocation replays.** None of the eight runs has a `pipelineInvocationSnapshot` or any `runArtifacts` row. The saved stage outputs are genuine observed persisted data, but no immutable input/configuration receipt proves the complete historical context passed to the model. Current channel identity is frozen separately and explicitly marked as current, not silently substituted for historical identity.

No title was generated, no model provider was called, and no Convex/R2 data was mutated. This step freezes source evidence; it does not establish improved title quality, cost, CTR, or virality. See `docs/TITLE_MODULE_BASELINE_2026-09.md` for the implementation defects and next title-engine slice.

## Access and provenance

- Canonical Convex deployment: `astute-camel-689`.
- Packet observation timestamp: `2026-09-08T23:43:45.441Z`.
- Convex access used the existing authenticated CLI session, explicitly authorized by the coordinating agent; no credential value was read into the transcript or fixture. Command flags: `--deployment astute-camel-689 --codegen disable --typecheck disable --inline-query`.
- `source-query.txt` preserves the exact read-only explicit projection. It is fixture documentation, not an executable production module. No full channel configuration, connection bundle, credential, environment dump, or signed URL was exported.
- R2 access used the vault's `cloudflare` credential mappings inside one trusted child process. Scoped list requests targeted only the eight run prefixes in bucket `youtube-studio-ai`; no media bytes were downloaded.
- All eight R2 run prefixes contained two objects and no `.json`, `.txt`, or `.md` source candidates. The associated Convex asset records point at final-video and thumbnail keys. The absence of text in those precise run prefixes does not prove that every historical source anywhere else is absent.
- These are projections of observed rows, not full raw documents. Missing JSON properties mean absent/undefined in the inspected projection. They do not establish that a historical model never received the field through another source.

## What was actually recovered

| Channel | Run | Narration characters | Separate hook / loop | Retained competitor videos | Topic-bet title |
| --- | --- | ---: | --- | ---: | --- |
| Inked Histories | `js76ghf4s44b4w5d97cs2f49bd89znxa` | 2,915 | Neither field recorded | 105 | Recorded |
| Chalk & Compound | `js705md1etr1kr0mpbpvpqaz8x89znvt` | 2,592 | Neither field recorded | 159 | Recorded |
| Gratitude Springs | `js72d9gty4nrqqq7wevv0m0hyd89xgk9` | 2,894 | Both recorded | Not recorded | Not recorded |
| The Quiet Stoic | `js7eh3rvdhjyqwkmnseb0qtvfh88mrq7` | 3,648 | Both recorded | 88 | Recorded |
| Investory | `js72sy9xyvxtptvtbbg2z8aegs88ez4t` | 10,040 | Hook only | 150 | Not recorded |
| Seaside Ghibli Lofi | `js743qy08vp7z2rb367cg8spgd88aaye` | Not recorded; music format | Neither field recorded | 144 | Not recorded |
| Drift & Study | `js71tzddw482bhs41tgw0gsztn88bhv7` | Not recorded; music format | Neither field recorded | 59 | Not recorded |
| Rainy Neon Lofi | `js74bqgxfxpzak00v445ppdazx87tq2h` | Not recorded; music format | Neither field recorded | Not recorded | Not recorded |

Counts use exact retained strings and projected competitor-video rows; no deduplication, factual approval, freshness, or independent retrieval-quality claim is implied. The current metadata caller sorts these retained competitor rows by views and takes 12. The fixture preserves the title/view evidence rather than pretending a newly researched feed is the old one.

Narration sources are `motion_comic.outputs.narrationText`, `whiteboard_scribe.outputs.narrationText`, or `script_gen.outputs.narrationText`. Where the script object also contains narration, the two retained strings were checked for exact equality. Hooks/loops/closing lines are copied only when recorded in the real script object. No first sentence was promoted into an invented hook; no description or scene seed was substituted for narration.

All eight retain a short `metadata.inputs.topic`; seven also have the topic producer's output. Those two sources are preserved separately. Rainy Neon only has the former in the inspected stage data. The runner currently summarizes stage `inputs` (strings over 300 characters and complex objects), and metadata declares only `topic` as a consumed input. A run-stage debug input is therefore not a full `MetaCraftArgs` snapshot. These eight short topic values are retained as observed; other context comes from actual upstream outputs, with its source stage ID and timestamps preserved.

The three retained provisional topic-bet titles are:

- Inked Histories: `How a Civil War Sword Survived a Century in Dirt`.
- Chalk & Compound: `How Do Taxes Work? A Visual Explanation`.
- The Quiet Stoic: `5 Things You Must Never Give Away (Even When Asked)`.

These are candidates, not approved factual promises or instructions to reuse them. The historical final title is stored only as an observed baseline output. It must not be smuggled into the writer prompt as an answer key.

## Current identity versus historical identity

Each packet's `source.currentChannel` contains an explicit title-relevant projection of today's channel: name/slug, persona, niche, language when recorded, family/content lane, selected program-brief fields when recorded, metadata language/clickbait parameters, and Style DNA title/description instructions. This is useful for a separately declared **new current-identity replay over retained content**. It is not evidence that those settings existed when the old video was created.

Some retained current instructions are themselves useful regression cases. Chalk & Compound's title formula includes its channel name while common lint rejects channel-name inclusion; Seaside's formula includes the channel name and longer scene/use-case structure. Preserve this contradiction in the baseline rather than editing the fixture to make the current engine pass. Any later normalization or repaired identity prompt must be explicitly versioned as the changed condition.

Unknown across all eight: the full historical identity/metadata parameter packet, historical resolved model and title-judge receipt, historical YouTube autocomplete response, historical performance-context string, and whether/value of any `plannedTitle` supplied outside retained stage outputs. Missing competitor evidence for Gratitude/Rainy Neon is **unknown**, not a frozen empty array. The current `competitorTitles?.length` behavior would refetch both omitted and empty evidence, so the isolated benchmark still needs explicit evidence injection before a controlled comparison.

## Search for stronger newer retained cases

A coordinated read-only discovery queried `runs.by_channel_started` descending, at most ten rows per selected channel: 50 rows total. It projected only run ID/status/timestamp, release-evidence state, presence of an invocation snapshot/video pointer, and thumbnail-source linkage. No inspected row had an invocation snapshot. Every non-null release-evidence state in that window was `not_ready` on thumbnail-refresh rows, not a qualified new master.

The newer September rows for Inked Histories, Chalk & Compound, and Gratitude Springs are thumbnail-only successors of the existing corpus videos. The Quiet Stoic's ten-row window is entirely thumbnail refreshes. Investory's newest three are refreshes; its latest original is already the chosen wealth-building case. Seaside and Drift each have two legacy OK rows without invocation snapshots. Rainy Neon's newest six inspected runs failed; its newest OK row is already the selected corpus case. Exact discovered bindings and counts are recorded in `manifest.json`.

Accordingly, no proposed source was replaced with a thumbnail job merely because it was newer. This is a bounded eight-channel discovery, **not a global claim that no stronger run exists elsewhere**. In particular, the Quiet Stoic window does not exhaust older original runs. An absent `run.videoAssetId` is only a missing pointer, not proof that retained assets are gone; the original sources have actual asset records.

## Hash and integrity contract

`manifest.json` records, for each case:

- `sha256`: SHA-256 of the exact UTF-8 fixture-file bytes.
- `sourceProjectionSha256`: SHA-256 of `JSON.stringify(parsedFixture.source)`, preserving the stored object order. This covers the saved explicit source projection, not unexported fields in the full Convex row.
- Narration hash: SHA-256 of the exact retained UTF-8 string, without whitespace/tag normalization.
- Source stage IDs, character counts and file byte count.

The case file is named by its real run ID. Run/channel bindings, duplicated script-versus-output narration, fixture/source hashes, absence of credential-shaped fields, and no runtime fixture import are checked before handoff. These are data-integrity checks, not model-quality tests. Keep the corpus out of application runtime/deployment inputs; the coordinating agent added `test-fixtures/` to `.vercelignore` for that boundary.

`src/lib/__tests__/titleBaselineCorpus.test.ts` is auto-discovered by the production-readiness suite. It independently verifies all eight byte/source hashes and five narration hashes, exact run/channel/stage bindings, file inventory, and the explicit zero-generation/zero-historical-replay claims. It also proves rejection of modified bytes, swapped channel bindings, altered source digests and altered narration digests. The direct test passed locally; these checks establish corpus integrity, not title quality.

## Next usable benchmark boundary

1. Keep these eight packets frozen as source-backed regression evidence. Do not mark them historical-replay-ready or silently synthesize missing fields.
2. Implement the shared typed title-decision/strict judge contract described in the baseline. It must accept explicit frozen external evidence and distinguish missing from empty input; do not write a harness that silently performs research between comparison conditions.
3. For a new current-identity experiment, explicitly bind this saved current identity, real retained narration/topic, and whichever hook/loop fields genuinely exist. Preserve the missing fields rather than inventing them. Freeze any newly retrieved non-model evidence once, with its own observation/version/hash, before both conditions run. It is new evidence, not recovered historical evidence.
4. Start with genuine narrated cases and declared unavailable optional context, then LoFi's real non-narrated contract. Add provenance-backed Shorts, multilingual and narrative-fiction cases to improve format coverage; eight channel names do not constitute eight different format families.
5. Run the isolated production title selector with usage/latency receipts and calibrated factual/identity judgments, followed by the actual metadata-block integration test. No live-generation result exists yet in this corpus.
