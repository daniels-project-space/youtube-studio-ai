# Orchestration Architecture Audit — youtube-studio-ai

**Date:** 2026-06-24 · **Scope:** read-only · **Purpose:** characterize the current orchestration "glue", coupling, per-account customization flow, and module-boundary cleanliness to inform a migration to a **Mastra tools-per-module + Director-orchestrator-agent** architecture.

> TL;DR — The system is **already cleanly two-layered**: a small typed engine core (`src/engine/`, ~6 KLOC across 33 files) drives a flat list of `Block`s, and the heavy creative work lives in **pure typed libs** (`src/lib/*.ts`) that take `args:{...}` and return values — *zero* `StageContext`/Convex coupling. The orchestration tangle is concentrated in the **block-wrapper files** (`src/trigger/blocks/*.ts`), not in the engines. This is a *favorable* starting point for a Mastra migration: the libs are nearly drop-in tool bodies; the wrappers are what get replaced by tool adapters + a Director agent.

---

## 0. System map (verified)

### Two block systems, ONE engine
- `src/lib/blocks.ts` is **NOT** the runner — it only exports `LOFI_BLOCK_IDS` for a UI page. The live engine is `src/engine/`.
- **Entry task:** `src/trigger/runPipeline.ts` → calls `registerAllBlocks()` (`src/engine/blocks.ts`), seeds the store, then `runPipeline(resolved, opts)` (`src/engine/runner.ts`).
- **Contract:** `src/engine/types.ts` — `Block { id, consumes[], produces[], paid?, run(ctx)->BlockPatch }`, `StageContext { ownerId, runId, channelId, keyPrefix, params, store, budgetUsd, log }`.
- **Registry:** `src/engine/registry.ts` (Map id→Block, loud on dup). `registerAllBlocks()` (`src/engine/blocks.ts:798`) registers ~10 block arrays.

### The Block inventory (consumes → produces)
| file | LOC | blocks |
|---|---|---|
| `narratedBlocks.ts` | **2056** | script_gen, hook_craft, qa_script, narration_tts(paid), stock_footage, entity_imagery, intro_card, quote_overlays, timeline_assemble, length_check, captions, qa_visual, qa_refine |
| `lofiBlocks.ts` | **1279** | topic_select, scene_planner, keyframes(paid), loop_clips(paid), upscale(paid), music(paid), assemble, upload_draft, notify, cleanup, shorts_spinoff |
| `intelligenceBlocks.ts` | **945** | competitor_research, metadata, thumbnail_gen(paid) |
| `insertBlocks.ts` | 269 | visual_inserts |
| `crewBlocks.ts` | 236 | director_brief, dp_brief, editor_brief, composer_brief, critic_spec |
| `genFootageBlocks.ts` | 178 | gen_footage |
| `complianceBlocks.ts` | 144 | originality_gate, compliance_check |
| `bundleBlocks.ts` | 105 | emit_bundle |
| `whiteboardScribeBlocks.ts` | 103 | whiteboard_scribe |
| `growthBlocks.ts` | 41 | crosspost |
| `echoBlocks.ts` | 41 | (dev/echo) |

### Pipeline construction (per-channel) — three layers
1. `src/engine/designer.ts::designPipeline(opts)` — family → `ARCHETYPES[fam.archetypeKey].pipeline` → splice/filter crew briefs, footage engine, whiteboard, captions, etc. → `validatePipeline()`. **Pure, deterministic, splice-based.**
2. `src/engine/creative/styleDNA.ts::synthStyleDNA()` + `buildQualityBar(family, dna)` — distil the channel's **Style DNA** + per-channel **Quality Bar** (rubric) at inception.
3. `src/engine/creative/architect.ts::architectPipeline()` (840 LOC) — an LLM "architect" that proposes plan deltas (`applyArchitectPlan`) on top of the designed pipeline (add/disable blocks, forge tools). Invoked from `designChannel.ts` (4 call sites incl. tune/fix loops).

---

## 1. GLUE / COUPLING HOTSPOTS

### 1a. The runner is the glue — and it is GOOD
`src/engine/runner.ts::runPipeline` (339 LOC) is a clean, single-responsibility scheduler:
- Sequential walk of `resolved.blocks`; `executeBlock()` writes runStage → runs block → `assertProduced()` (fail-loud, no silent null, `runner.ts:116`) → merges patch into `store` → persists.
- **Resume/idempotency:** `getCompleted(runId)` + `rehydrate()` restore completed blocks' R2-keyed outputs → skip re-run (no double-spend on paid blocks) (`runner.ts:152-206`).
- **Retry:** `runBlockWithRetry` retries only TRANSIENT errors (regex on 429/5xx/ECONNRESET/…) with exp backoff (`runner.ts:86-114`).
- **Budget ceiling:** `__costUsd` patch key extracted per block, accumulated, aborts before next paid block (`runner.ts:79,292`).
- **Parallelism:** *hardcoded* `PARALLEL_GROUPS` (`runner.ts:135`) — 3 manually-verified co-schedulable groups (crew briefs; QA gates; footage/music/intro). Comment explicitly states a general inferred-DAG scheduler "would be unsound here" because blocks read store keys **beyond their declared `consumes`**.
- **Remote dispatch:** `remoteBlocks`/`runRemoteBlock` send the memory-heavy render to a child task while the orchestrator suspends (`runner.ts:54-65,231`).

> **Migration implication:** This runner IS the Director-orchestrator embryo. A Mastra Director agent would replace the hardcoded `PARALLEL_GROUPS` + linear walk with reasoned scheduling — but must preserve assertProduced / resume / budget / retry, which are non-negotiable production safeguards.

### 1b. The REAL tangle: block wrappers, not engines
The coupling is **in the `Block.run` bodies**, which mix three concerns: (a) read store via `str()/opt()`, (b) call a pure lib, (c) write Convex assets via `recordAsset()` + upload R2. Evidence:

**Duplicated infra helpers copy-pasted across 8 block files** (no shared module):
- `convex()` — `bundleBlocks:17`, `crewBlocks:29`, `intelligenceBlocks:55`, `lofiBlocks:83`, `narratedBlocks:76`, `whiteboardScribeBlocks:28`
- `str(ctx,key)` / `opt(ctx,key)` — duplicated in `complianceBlocks:49`, `growthBlocks:12`, `intelligenceBlocks:61`, `lofiBlocks:89/97`, `narratedBlocks:136/143`
- `recordAsset(...)` — re-implemented in `intelligenceBlocks:70`, `lofiBlocks:167`, `narratedBlocks:82`, `whiteboardScribeBlocks:34` (varying signatures)
- `mapPool`, `splitSentences`, `bodySegSeconds` — `narratedBlocks` only.

### 1c. Is narratedBlocks.ts a god-file? YES.
2056 LOC, 13 blocks. Per-block LOC (measured):
| block | LOC |
|---|---|
| `qa_visual` | **334** |
| `timeline_assemble` | **269** (consumes 6 keys, produces ≥6, has a `finishFromComposed` helper at L1463 + surgical-heal branch) |
| `narration_tts` | **263** |
| `quote_overlays` | 233 |
| `stock_footage` | 172 |

`timeline_assemble` is the assembly **god-block**: it orchestrates footage+entity clips, narration audio, intro card, music, quote overlays AND visual inserts into the final video, plus a "surgical heal" path (`narratedBlocks.ts:1258-1277`). `qa_visual` (334 LOC) bundles structural probe + length-ratio gate + 3-frame vision + holistic full-timeline watch + optional audio QA.

### 1d. State passing between blocks
**Single shared mutable `store: Record<string,unknown>`** threaded through `ctx.store`. Blocks declare `consumes`/`produces` but the runner comment + the splice-based parallel groups confirm blocks **read undeclared keys** (e.g. `quote_overlays` reads `introSec`; `visual_inserts` reads quote windows; `qa_visual` reads `narrationDurationSec` though it consumes only 4 keys). This **undeclared-read coupling** is the single biggest correctness hazard for any DAG-based or agent-driven re-scheduling. Convex is the durable side-channel: `recordAsset()` writes assets, `upload_draft` reads `youtubeAuth.getForChannel`, the MV/runStages persist state.

### 1e. narratedBlocks vs lofiBlocks duplication
They are **different archetypes** (narrated stock-footage vs lofi loop), so most blocks differ. But the **terminal tail is conceptually duplicated**: both reimplement the ship/cleanup path. lofiBlocks owns `assemble / upload_draft / notify / cleanup / shorts_spinoff`; narratedBlocks owns `timeline_assemble` + relies on shared `upload_draft`? — NO: `upload_draft/notify/cleanup` live **only in lofiBlocks** and are registered globally, so narrated pipelines reuse lofiBlocks' `upload_draft`. The duplication is therefore: (1) the infra helpers (§1b), (2) `topic_select`/`script_gen` naming overlap (lofi `topic_select` produces `topic`; narrated `script_gen` consumes `topic`), and (3) two assembly engines (`assemble` vs `timeline_assemble`) with overlapping intro/duration logic. **Net: low block-level duplication, high helper-level duplication.**

---

## 2. PER-ACCOUNT (per-channel) CUSTOMIZATION FLOW

### How customization propagates today
Customization is **seeded into the store once at run start** and read ad-hoc by blocks. `src/trigger/runPipeline.ts` builds `seedStore` from the channel doc (`runPipeline.ts:979-1005`):
```
topicPool, styleGrammar, channelName, palette, persona, niche,
voiceId, bannedWords, channelAvatarKey,
scriptPlaybook,          // lab-distilled per-channel script rules
styleDNA,                // frozen Style DNA  (creative/styleDNA.ts)
qualityBar               // per-channel rubric (buildQualityBar)
```
Plus per-block `params` from the pipeline entry (`paramsByBlock`), and `reuse.*` seeds for render-group reuse.

**Three customization vectors:**
1. **Pipeline shape** — chosen at design time by `family` (`FAMILIES` in `engine/families.ts`) → archetype → `designPipeline()` splices. `FAMILY_CREW` maps family → crew roles; `CREW_ROLE_BLOCK` maps role → brief block id. The architect LLM (`architectPipeline`) can further mutate it.
2. **Style DNA + Quality Bar** — frozen objects in the store; "every block generates AGAINST these and the critic scores conformance TO them" (comment `runPipeline.ts:1000`). Read by `script_gen`, `thumbnail_gen` (derives style from DNA, `intelligenceBlocks:785`), crew briefs, qa.
3. **Per-block params** — e.g. `upload_draft` `publishMode`, `narration_tts` voice, `audioQa` flag.

### Parameterized vs hardcoded
- **Parameterized (good):** family/archetype selection, crew set, voiceId, palette, bannedWords, styleDNA, qualityBar, scriptPlaybook, thumbnailer, publishMode, footage engine.
- **Hardcoded / convention-bound (risk):** the `PARALLEL_GROUPS` in the runner; the splice anchors in `designer.ts` (find block by literal id, splice after `topic_select`); store key **names** (`introSec`, `healHints`, `narrationDurationSec`) are stringly-typed contracts shared across files; `FAMILY_CREW` defaults; the `familyKind()` narrated/loop fork in the architect (`architect.ts:439`).

### Where a single "Channel Profile" object would thread
Today the channel identity is **fanned out into ~14 discrete store keys** at `runPipeline.ts:979`. A migration should introduce a typed **`ChannelProfile`** ( `{ identity, styleDNA, qualityBar, scriptPlaybook, family, palette, voice, bannedWords, thumbnailer, publish }` ) that is:
- the **single seed** into the engine (replacing the 14 ad-hoc keys),
- passed as **typed Mastra tool runtime-context** to every tool (so tools stop reaching into a stringly-typed store),
- the input to `designPipeline` / `architectPipeline` / the Director agent.
This is the highest-leverage refactor: it collapses the per-account fan-out and removes the undeclared-store-read hazard for identity data.

---

## 3. MODULE BOUNDARIES — cleanliness scores (1=entangled, 5=clean standalone tool)

**Key measurement:** grep for `StageContext` / `ctx.` / `ConvexHttpClient` / `convex(` inside each `src/lib` engine:
```
voicecraft.ts:5  hookcraft.ts:0  scriptGen.ts:0  footagecraft.ts:0  ffmpeg.ts:0
remotionRender.ts:0  documotion.ts:0  geoCinema.ts:0  banana.ts:0  thumbnailLab.ts:0  youtube.ts:0
```
The engine libs are **already orchestration-free**. The score below reflects how much wrapper logic sits *between* the lib and a clean tool boundary.

| Module | Engine lib | Wrapper block | Score | Gap to a clean Mastra tool |
|---|---|---|---|---|
| **thumbnail / banana** | `banana.ts`, `thumbnailLab.ts`, `speechThumbnail.ts` (0 coupling) | `thumbnail_gen` (`intelligenceBlocks`, paid, ~280 LOC) | **3** | Lib is pure, but the block embeds a 4-way fallback ladder (gpt_image_2→Flux→playbook→DNA-direct), ref/mobile QA, healHints. Extract the ladder into the lib as `craftThumbnail(profile, title, hints)`; tool = thin adapter. |
| **script / hookcraft** | `scriptGen.ts`, `hookcraft.ts` (0) | `script_gen` (91 LOC), `hook_craft` (29) | **4** | Already small. Tool input = `{topic, styleDNA, scriptPlaybook, qualityBar}`, output = `{script, narrationText}`. Just drop `str()/opt()` reads for typed args. |
| **narration / voicecraft** | `tts.ts`, `voicecraft.ts` (5 hits — types/comments) | `narration_tts` (263 LOC, paid) | **3** | Block bundles sentence-splitting, segment timing (`bodySegSeconds`), gap concat, voice FX, R2 upload. Move timing/concat into the lib; tool returns `{audioKey, sentenceTimings, durationSec}`. |
| **visuals / footagecraft** | `footagecraft.ts` (0; clean `FootageBrief`→`castFootage`→`FootageCast`) | `stock_footage` (172), `entity_imagery` (90), `gen_footage` | **4** | Cleanest engine. `castFootage(args)` is already a typed call. Gap: block owns ledger de-dup (cross-video usedIds) + healHints + R2 upload. Push ledger into a tool dependency; otherwise near drop-in. |
| **inserts / DataInsert** | `remotionRender.renderDataInsert` (0) | `visual_inserts` (`insertBlocks`, 269) | **3** | Render fn is pure. Block plans inserts from spoken numbers + reads quote windows from store (undeclared). Tool needs explicit `{narrationText, timings, quoteWindows}` input. |
| **assemble / ffmpeg** | `ffmpeg.ts` (0; ~26 pure `args:{...}` fns) | `timeline_assemble` (269) + `assemble` (lofi) | **2** | ffmpeg lib is pristine but `timeline_assemble` is a god-block orchestrating 6 inputs + overlays + inserts + surgical heal + `finishFromComposed`. This is the hardest extraction: it IS mini-orchestration. Split into `composeBody` / `applyOverlays` / `finalize` tools the Director sequences. |
| **verify (qa)** | `audioQa.ts`, vision helpers (0) | `qa_script`(53), `qa_visual`(**334**), `compliance_check`, `originality_gate` | **2** | `qa_visual` is the 2nd god-block: structural probe + length gate + frame vision + holistic watch + audio QA inlined. Decompose into typed verifier tools (`structuralQa`, `lengthQa`, `visionWatch`, `audioQa`) returning a unified `{pass, report, healHints}`. |
| **ship** | `youtube.ts` (0; `uploadPrivateDraft`, `setVideoThumbnail`) | `upload_draft`(lofi), `notify`, `cleanup`, `crosspost` | **4** | Lib clean. Block reads per-channel YouTube token from Convex + qa gate. Tool = `ship(profile, video, metadata, publishMode)`; keep the qa-gate as a Director precondition. |
| **documotion** | `documotion.ts` (0; self-contained `craftDocuMotion`, own plan→assets→verify→refine loop) | (engine-internal; called by render path) | **5** | Already a self-contained engine with its own validate/heal loop. Wrap `craftDocuMotion(args)` directly as a tool. Reference-grade target. |
| **geoCinema** | `geoCinema.ts` (0; `renderGeoIntro` + vision-verify rounds) | (lib-level engine) | **5** | Self-contained, typed `args:{...}`, internal verify-and-fix rounds. Drop-in tool. (Needs vendored assets env `GEO_ASSETS_DIR`.) |

**Average:** engines that are leaf-libs (documotion, geoCinema, footagecraft, scriptGen, ship) score 4-5 and are **near-ready as tools**. The two **god-blocks** (`timeline_assemble`, `qa_visual`) score 2 and are the migration's critical path — they encode sequencing the Director should own.

---

## 4. FAIL-PROOFING — current mechanisms & GAPS

### Mechanisms (strong)
- **Fail-loud production check:** `assertProduced` rejects any declared-`produces` key returned null/undefined (`runner.ts:116`). "no silent fallbacks."
- **Validation + preflight:** `validate.ts::validatePipeline` topo-checks every `consumes` is produced upstream, rejects unknown blocks + duplicate produced keys; `preflight` asserts a budget exists when any paid block exists + required runtime keys present (fail before any spend).
- **Resume/idempotency:** completed blocks restored from Convex+R2 via `getCompleted`+`rehydrate`; paid blocks never re-spend on retry (`runner.ts:152-206`).
- **Transient-only retry:** exp backoff on network/5xx; deterministic gate failures fail fast (`runner.ts:86`).
- **Budget ceiling:** aborts before the next paid block once spend exceeds `budgetUsd`.
- **Self-heal:** `engine/healer.ts` matches failure text to a heal catalog, seeds `store.healHints[block]`, and **re-runs the minimal closure** (incl. small paid reruns). It explicitly refuses an "UNHEALABLE class" (length/duration → would re-spend generation) and "fails honestly" when no rule matches (`healer.ts:146-165`). Blocks consume hints: `stock_footage` (`narratedBlocks:691`), `thumbnail_gen` (`intelligenceBlocks:714`), `timeline_assemble` surgical heal (`narratedBlocks:1258`).
- **Per-channel ship safety:** `upload_draft` refuses to upload unless `qaPassed` (`lofiBlocks:988`), defaults to private draft.

### GAPS (for the migration to close)
1. **Undeclared store reads** (the #1 structural hazard). `consumes` arrays understate real dependencies (`qa_visual` reads `narrationDurationSec`; `quote_overlays` reads `introSec`; `visual_inserts` reads quote windows). This is *why* `PARALLEL_GROUPS` is hardcoded instead of inferred. → A DAG/agent scheduler is **unsound** until every block declares its true reads (or reads a typed `ChannelProfile`/typed prior outputs instead of a bag). **Must fix before the Director can reason about ordering.**
2. **Silent per-item skips inside blocks.** Many blocks "degrade gracefully" by `return {…, skipped}` or swallowing per-item `catch` (`entity_imagery` skips unverified images `narratedBlocks:837`; `quote_overlays` skips on no key `:958`; footage per-clip `catch`). These are **not surfaced as run-level signals** — a video can ship with 0 entity images / 0 overlays and still report `ok`. → Tools should emit structured **degradation reports** the Director/QA can gate on, not boolean skips.
3. **Un-validated lib boundaries.** Engine libs return rich objects but the *block* does the `assertProduced` mapping; inside a lib there's no schema on inputs. Migrating to Mastra tools should add **zod input/output schemas** at every tool edge (the codebase already imports `zod` in narratedBlocks and uses `agentJson` with schemas — pattern exists).
4. **Heal catalog is text-regex matched** (`healer.ts`) — brittle to phrasing changes; "no rule matches → fail honestly" means novel failures don't self-heal. → A Director agent could reason over the failure instead of regex-matching.
5. **Duplicated infra helpers** (§1b) mean a fix to `recordAsset`/`convex()` must be applied in 4-8 places. → Extract a shared `blockKit` (or fold into tool runtime context) before/while migrating.
6. **Two assembly + two QA surfaces** (`assemble` vs `timeline_assemble`; `qa_script`+`qa_visual` vs compliance gates) — drift risk; unify behind one `assemble`/`verify` tool family.

### Existing Mastra substrate (migration is NOT greenfield)
`src/agents/mastra.ts` already builds a `Mastra` instance with per-role `Agent`s (`AgentRole` enum), Langfuse observability, and a resilient `agentJson<T>()` entry point with REST fallback to Gemini/Anthropic. Blocks already call `agentJson({role,…})`. **The Director-orchestrator + tools-per-module migration extends this existing harness rather than introducing Mastra from scratch.**

---

## 5. Recommended migration sequencing (derived from the above)
1. **Introduce typed `ChannelProfile`** → single seed; thread as Mastra tool runtime context (kills the 14-key fan-out + identity store-reads). *Highest leverage.*
2. **Extract `blockKit`** (convex, str/opt, recordAsset, mapPool) — remove the 4-8× duplication.
3. **Declare true reads** on every block (close gap #1) so scheduling can be reasoned, not hardcoded.
4. **Wrap leaf engines as tools first** (documotion=5, geoCinema=5, footagecraft=4, scriptGen=4, ship=4) — low risk, proves the pattern.
5. **Decompose the two god-blocks** (`timeline_assemble`, `qa_visual`, score 2) into Director-sequenced tools — the critical path; preserve resume/assertProduced/budget/heal.
6. **Replace the linear walk + `PARALLEL_GROUPS`** with the Director agent, keeping the runner's safeguards (assertProduced, resume, budget ceiling, transient retry) as a non-LLM execution backstop.
