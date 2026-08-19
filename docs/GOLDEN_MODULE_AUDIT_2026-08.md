# Golden Module Catalog Audit — August 2026

Repo: `/home/ubuntu/youtube-studio-ai`
Catalog source: `src/engine/golden.ts` (`GOLDEN_SPINE` L46, `GOLDEN_MODULES` L503)
Execution binding map: `src/engine/goldenExecution.ts` (`CATALOG_EXECUTION_BINDINGS` L118-176)
Method: 7 parallel read-only agents, one per spine-stage group plus one quality-loop call-graph trace. No source was modified in this pass.

---

## Executive summary

27 catalog modules were audited across all 12 `GOLDEN_SPINE` stages. **18 (67%) are genuinely WORKING** — engine code exists, is registered into the real block registry (`src/engine/blocks.ts` → `registerAllBlocks()` → `src/engine/runner.ts:208 block.run(ctx)` → `src/trigger/runPipeline.ts:727,769`), and at least the majority of their declared gates are enforced as real fail-closed code. **5 (18%) are BROKEN** — the catalog's `engine`/`gates` prose describes code that either does not exist at all (`quiz`), is never reachable from the executed path (`imagecraft-novita`, `videocraft-novita`, `assemble`), or claims a safety gate with zero implementation (`ship`'s "budget alert"). **4 (15%) are NOT WIRED** — real library code exists but has no pipeline call site (`loreshort`, `cinematic`, `motioncraft`, `speech-tv`), and three of those four honestly self-declare `kind: "catalog-only"` in the bindings table. Of the 18 WORKING, only 11 are clean; 7 carry material caveats (advisory-only gates, dead "engine" files whose live replacement was never re-verified, or unverified gate internals). The single most structurally significant finding is that the entire Golden certification layer is inert: `GOLDEN_PROMOTION_PROOFS` (`goldenExecution.ts:182`) is a literal empty object, and the two functions that would enforce it (`compileGoldenExecutionFlow`, `selectGoldenProductionModules`) have **zero production call sites** — only the non-throwing `compileCatalogExecutionFlow` runs, and its output is attached to the pipeline record as descriptive metadata only (`pipelineCompiler.ts:485,493-503`). So `status: "active"` / `"reference"` in the catalog is an editorial label with no runtime meaning; execution is gated solely by block registration plus whatever each block's own `run()` throws on. That is honest and tested (`goldenChannelFlow.test.ts:196-200` asserts zero steps are ever `goldenQualified`) — but it means the catalog's prose is the *only* description of these modules, and this audit found it materially wrong in 5 places.

Verdict counts: **WORKING 18 · BROKEN 5 · NOT WIRED 4 · (of WORKING, 7 caveated / 11 clean)**.
Note: one prior agent counted 28 entries in the `GOLDEN_MODULES` array vs the 27 stage-attributed rows below — see P2-8.

---

## Consolidated module table (all 12 stages)

| stage | module key | title | verdict | evidence (file:line) |
|---|---|---|---|---|
| intel | `topic-intel` | Topic Intel — Topicraft | **WORKING** | `golden.ts:662-678`; engine `src/lib/topicraft.ts`; blocks `intelligenceBlocks.ts:143`, `lofiBlocks.ts:221`; gates `topicraft.ts:213-282,318-355,526` |
| brief | `show-bible` | Show Bible + Crew | **WORKING (caveat)** — runs, but catalog's stated engine `resolveCrew` is orphaned | `golden.ts:680-711`; blocks `crewBlocks.ts:174,191,216,234,252`, `storySpineBlocks.ts:8`; orphan `crewProfile.ts:45` (zero non-test callers); live per-role resolvers `crewBlocks.ts:82-102`; critic→verify wiring `crewBlocks.ts:28,261` |
| write | `script` | Script + Hook | **WORKING (caveat)** — 3/5 gates hard, 2/5 advisory | `golden.ts:707-726`; `src/lib/hookcraft.ts:137,246,278-286,316`; blocks `narratedBlocks.ts:179,272` |
| guard | `guard` | Guard Gates | **WORKING (caveat)** — 2/3 gates real; craft QA is advisory | `golden.ts:727-737`; `complianceBlocks.ts:80-84,119-123,170-174` (hard); `narratedBlocks.ts:6,304,311` (soft); parallel group `runner.ts:355` |
| voice | `narration` | Narration — Voicecraft | **WORKING** | `golden.ts:738-753`; `src/lib/voicecraft.ts:253-437,500+`; block `narratedBlocks.ts:359`, cold-open gate `:447-492`; policy `qualityPolicy.ts:69-94` |
| sound | `music` | Music — Scorecraft | **WORKING** | `golden.ts:757-767`; block inline `lofiBlocks.ts:774-946`; gates `lofiBlocks.ts:834,899-910,940-946` |
| visual | `loreshort` | Lore Short — Loreshort Engine | **NOT WIRED** | `golden.ts:523-530`; `src/lib/loreshort.ts` (420 L, no pipeline importer); `goldenExecution.ts:129` `kind:"catalog-only"` |
| visual | `novita-render-farm` | Novita Render Farm | **WORKING** | `src/lib/novitaRenderFarm.ts:398-501,480-481,502-503`; block `novitaRenderBlocks.ts:39`; binding `goldenExecution.ts:129` |
| visual | `imagecraft-novita` | Imagecraft (Novita Z-Image) | **BROKEN** — catalog claims execution via render farm; no import chain exists | `src/lib/imagecraft-novita.ts` (101 L); false claim `goldenExecution.ts:130` |
| visual | `videocraft-novita` | Videocraft (legacy renderer) | **RETIRED** — superseded by the direct LTX 2.5 render path | `src/lib/novitaRenderFarm.ts` |
| visual | `lofi` | Lofi Loop — Seaside Engine | **WORKING (caveat)** — pipeline runs, but cited engine `src/lib/lofi.ts` is dead code | `src/lib/lofi.ts` (509 L, zero importers repo-wide); live logic `lofiBlocks.ts:41,53` via `ffmpeg.ts`/`novitaMedia.ts`; binding `goldenExecution.ts:132` |
| visual | `quiz` | Quiz — Quizcraft | **BROKEN** — no engine source exists anywhere | `goldenExecution.ts:133` (`catalog-only`, empty `executableIds`); only artifacts are `public/golden/quiz/*.{jpg,mp4}` |
| visual | `visuals` | Visuals | **WORKING** | `src/lib/footagecraft.ts:284-334` (watermark/relevance gate); imported by `narratedBlocks.ts`; binding `goldenExecution.ts:141` |
| visual | `cinematic` | Cinematic — Cinecraft | **NOT WIRED** — only a type import survives | `src/lib/cinecraft.ts` (480 L); type-only use `crew/cinematographer.ts:16`; real family runs generic chain `families.ts:132-142`, `goldenExecution.ts:150-154` |
| visual | `documotion` | Documentary — Documotion | **WORKING** | `src/lib/documotion.ts` (1733 L) imported `documentaryCollageShortBlocks.ts:23`; block id `:231`; binding `goldenExecution.ts:154-158` |
| visual | `motioncraft` | Motion Graphics — Motioncraft | **NOT WIRED** | `src/lib/motioncraft.ts` (246 L, no pipeline importer); `goldenExecution.ts:157` `catalog-only`, subset owned by Inserts |
| visual | `speech-tv` | Motivation Speech — Speechcraft | **NOT WIRED** | `renderMotivationalSpeech` at `src/lib/remotionRender.ts:360` has zero callers; `goldenExecution.ts:158` `catalog-only` |
| visual | `inserts` | Data-Viz Inserts | **WORKING** | `insertBlocks.ts:22,72,107` (verbatim-number integrity gate); binding `goldenExecution.ts:159` |
| visual | `whiteboard` | Whiteboard — Drawn Cinema | **WORKING** | `src/lib/whiteboardSync.ts:403`; block `whiteboardScribeBlocks.ts:14-16,34`; Whisper force-align confirmed |
| visual | `comic` | Comic — Motion-Comic Page Engine | **WORKING** | `src/lib/motionComic.ts` (1582 L) + `scripts/mc_page_render.py`; block `motionComicBlocks.ts`; `visualReview.test.ts` PASS |
| visual | `shorts` | Shorts (vertical) | **WORKING (caveat)** — catalog prose and binding name two different engines | prose cites nonexistent `shorts_cuts` block; family `families.ts:93-101`; binding `goldenExecution.ts:170-175` → `shorts_spinoff`/`documentary_short_candidates`; one gate self-marked PENDING |
| layer | `layer` | Captions + Overlays | **WORKING** | `src/lib/ffmpeg.ts:772-842,1610-1712`; block `narratedBlocks.ts:1354-1420`; binding `goldenExecution.ts:160`; orphan twin `src/lib/assembly/overlays.ts` unused |
| build | `assemble` | Assembly — EDL Engine | **BROKEN** — documented engine, gates and passing test all describe code the pipeline never calls | catalog `golden.ts:891-916`; orphan engine `src/lib/assembly/*` (wired only to settings-UI registry `moduleRegistry.ts:1-7,31`); real block `narratedBlocks.ts:1353-1354,2663` using `renderWatch.ts:112` + `renderValidate.ts`; orphan test `scripts/assembly-smoke.ts:22-25` |
| package | `thumbnail` | Thumbnail — Banana Engine | **WORKING** | `golden.ts:648-661`; `src/lib/thumbnailLab.ts:375-390`; block `intelligenceBlocks.ts:689-690,866`; asserted by `goldenChannelFlow.test.ts:150-156` |
| package | `metadata` | SEO Metadata | **WORKING (caveat)** — wiring real, gate internals unverified, no dedicated test | `golden.ts:918-932`; `src/lib/metacraft.ts` `craftMetadata` via `intelligenceBlocks.ts:46,286-288,401-422`; fallback `:437-439` |
| verify | `verify` | Verify + Heal | **WORKING (caveat)** — real fail-closed throws, but 3 named catalog gates not traceable 1:1 | `golden.ts:933-944`; blocks `novitaRenderBlocks.ts:579,856`, `documentaryCollageShortBlocks.ts:331`, `narratedBlocks.ts:1895,1959`; throw sites `narratedBlocks.ts:2002-2212` |
| ship | `ship` | Ship | **BROKEN** — declared "budget alert" gate has zero implementation | `golden.ts:978-989` (claim at `:985,987`); real gates `lofiBlocks.ts:1162-1167` (PRIVATE default), `channelPublishPolicy.ts:38-60,156-183`, ordering enforcement `runPipeline.ts:503,526-534` |

---

## Watch / Critique / Rework reliability

Traced files: `src/engine/critiqueLoop.ts`, `src/lib/renderWatch.ts`, `src/lib/renderValidate.ts`, `src/engine/healer.ts`, `src/trigger/pipelineDoctor.ts`.

**Q1 — Does every real run invoke a post-render watch + validate?**
Partly, and the premise needs correcting. The mandatory holistic visual gate is **`reviewRender()` in `src/lib/visualReview.ts:763`**, not `renderWatch.ts`. It is called unconditionally at `narratedBlocks.ts:2169` inside `qa_visual`, which every one of the 7 archetypes in `src/engine/archetypes.ts` includes, and which `runPipeline.ts:526-533` fails closed on if missing or ordered after `upload_draft`. A `fail` verdict lands in the hard-gate `critical[]` array. `validateRender()` (`renderValidate.ts:29`) is also unconditional (`narratedBlocks.ts:2313-2323`). By contrast `nativeWatchRender` (`renderWatch.ts:112`) only runs when `ctx.params["nativeWatch"] === true` (`narratedBlocks.ts:2184-2186`) — no archetype sets it — and its low scores are logged advisory-only, never gating. `watchRender` (`renderWatch.ts:216`) is dead code with zero call sites.

**Q2 — Does QA failure auto-trigger the healer?**
Yes, reliably and in-run. `runPipeline.ts:35` imports `planHeal`; the loop at `runPipeline.ts:727-777` re-runs up to `MAX_HEALS = 2` cycles with `healHints` injected into the seed store before the run is marked failed. `pipelineDoctor.ts` is unrelated — a nightly `schedules.task` (`:455`) doing cross-run trend analysis on past `qa_visual` output (`:245`); it never calls `planHeal`.

**Q3 — Is `produceAndCritique` used everywhere it should be?**
Only 4 real callers: `styleDNA.ts:317`, `intelligenceBlocks.ts:537` (metadata), `lofiBlocks.ts:496` (keyframes), `channelArt.ts:299`. Ten generative blocks have no critique/regenerate loop of any kind, and two more hand-rolled their own.

**Q4 — Are the loop primitives tailored per channel (`identity` / `creativeBrief` / `contentLane`)?**
No. All four traced files return zero hits for those fields — `critiqueLoop.ts` by explicit design (`:1-23`), `renderWatch.ts` and `renderValidate.ts` take generic intents/paths, `healer.ts:199-203` matches regex rules against error strings and the block graph only. Some *callers* thread `identity` in (`lofiBlocks.ts:257,528-539`; `channelArt.ts:280,330,438,469`; `narratedBlocks.ts:2063,2130` derives a `channelWorld` string), but `creativeBrief.criticDoctrine` — the schema field literally named for grounding a critic (`convex/schema.ts:187`) — is read by **nothing** in the quality loop; its only consumer is the architecturally separate show-bible crew system (`src/engine/creative/crew.ts:268`). `contentLane` (`schema.ts:111`) is never consulted for any quality decision, only for pipeline-shape validation.

### Gaps list

1. `watchRender` (`renderWatch.ts:216`) — dead code, zero call sites.
2. `nativeWatchRender` (`renderWatch.ts:112`) — opt-in via an unset param and advisory-only when it does run.
3. `thumbnail_gen` (`intelligenceBlocks.ts:689-999`) — no produce→critique→regenerate loop; only a post-hoc one-shot grade inside `qa_visual`.
4. Nine blocks with zero critique/judge: `entity_imagery` (`narratedBlocks.ts:915`), `hook_craft` (`:273`), `gen_footage` (`genFootageBlocks.ts:129`), `signature_clips` (`:270`), `novita_render_images` (`novitaRenderBlocks.ts:519`), `novita_render_video` (`:776`), `motion_comic` (`motionComicBlocks.ts:71`), `documotion_short` (`documentaryCollageShortBlocks.ts:231`), `whiteboard_scribe` (`whiteboardScribeBlocks.ts:75`).
5. `script_gen` (`narratedBlocks.ts:229-258`) and `narration_tts` (`voicecraft.ts:658`) reimplement bespoke single-shot loops instead of the shared primitive — tuning drift risk.
6. `creativeBrief.criticDoctrine` never reaches any critique/watch/heal decision.
7. `contentLane` never tunes quality thresholds — a lofi loop and a narrated essay get identical generic checks.

---

## PRIORITIZED FIX BACKLOG

### P0 — ship-blocking

| # | Issue | Where | Why it matters | Effort |
|---|---|---|---|---|
| P0-1 | `assemble` build stage: documented engine, its three gates (content-addressed idempotency, heal-from-checkpoint, validate-before-spend) and its only passing test all target `src/lib/assembly/*`, which the pipeline never calls. The executed path is `timeline_assemble` → `renderWatch.ts` `nativeWatchRender`, which greps clean for `idempoten\|content-addressed\|healFrom\|checkpoint` and has **zero test coverage**. | `narratedBlocks.ts:1353-1354`; `renderWatch.ts:112`; orphan `src/lib/assembly/*` + `moduleRegistry.ts:31`; orphan test `scripts/assembly-smoke.ts:22-25` | The final video-composition step can silently double-render (spend) or emit a broken timeline with no idempotency guarantee and no test guarding it. Highest silent-breakage surface in the spine. | Large |
| P0-2 | Convex publish authorization (`api.channelPublishPolicies.authorize`) was never audited — it lives outside `src/` and is the *final* gate for public/scheduled YouTube publish and crosspost. | `channelPublishPolicy.ts:156-183` → `convex/channelPublishPolicies.ts` | Until read, no honest claim can be made that "autopilot only goes public when the operator flips Active" (`golden.ts:984`). Client plumbing is real and tested; the decision itself is unverified. | Small (audit) |
| P0-3 | Convex schema push is **globally blocked**: `planBatchUsage` has a live document with an undeclared `reconciliationEvidence` field, so `convex dev --once` fails schema validation for any change, including the new `projectGoals` table. | `convex/schema.ts` (`planBatchUsage` validator) | No backend/schema change can be deployed at all until fixed. Blocks every downstream fix in this backlog that touches Convex. | Small |
| P0-4 | `ship`'s declared "budget alert" gate has zero implementation anywhere in `src/` — `grep -rl "budget.alert\|budgetAlert\|BUDGET_ALERT" src/` matches only `golden.ts` itself. The `notify` block sends a Telegram draft-ready message, not a spend alert. | claim `golden.ts:985,987`; `notify` at `lofiBlocks.ts:1313-1324` | A documented ship-stage spend-safety signal that does not exist. Publish gating itself (PRIVATE-first, `qa_visual`→`upload_draft` ordering) is real, so this is a spend-visibility hole, not a publish hole — but the catalog currently lies about it. | Small (implement or delete the claim) |
| P0-5 | `qa_script` craft gate is advisory: `golden.ts:732-734` claims "three gates between script and spend", but `scriptApproved` has zero downstream consumers repo-wide and the block's own comment admits nothing hard-gates on it. | `narratedBlocks.ts:6,311`; catalog `golden.ts:727-737` | A script that fails craft QA proceeds to full render spend and can reach ship. Downstream visual gates catch broken *renders*, not incoherent *writing*. | Medium |

### P1 — quality-affecting

| # | Issue | Where | Why it matters | Effort |
|---|---|---|---|---|
| P1-1 | `creativeBrief.criticDoctrine` is never read by any critique/watch/heal path — the field purpose-built for per-channel critique grounding is inert. | `convex/schema.ts:187`; only consumer `src/engine/creative/crew.ts:268` | Directly contradicts the stated project goal that the quality loop be "tailored to that channel's identity/creative brief". Every channel gets identical generic critique. | Medium |
| P1-2 | `nativeWatchRender` is opt-in (`nativeWatch` param unset by all archetypes) and advisory-only when run. | `narratedBlocks.ts:2184-2186`; `renderWatch.ts:112` | The "holistic watch the whole film" capability exists but never gates. `reviewRender` covers holistic gating, so this is redundancy loss rather than a hole — but it's maintained code doing nothing. | Small |
| P1-3 | `thumbnail_gen` has no produce→critique→regenerate loop. | `intelligenceBlocks.ts:689-999` | Highest-CTR-leverage asset is generated once, graded post-hoc with no feedback cycle. | Medium |
| P1-4 | Nine generative blocks have zero critique/judge mechanism. | see Watch/Critique gap #4 for the file:line list | Uneven quality floor across visual engines; failures only surface at `qa_visual`, after spend. | Large |
| P1-5 | `imagecraft-novita` — catalog claims it "is executed through the Novita render-farm module"; no import chain connects them. | `src/lib/imagecraft-novita.ts`; false claim `goldenExecution.ts:130` | Actual image rendering runs through the wired-and-gated `novitaRenderFarm.ts`, so output is not at risk — but a maintainer editing this file changes nothing. Fix by wiring or by correcting the binding note. | Small (doc) / Medium (wire) |
| P1-6 | `videocraft-novita` — identical false execution claim. | `src/lib/videocraft-novita.ts`; `goldenExecution.ts:131` | Same as P1-5. | Small / Medium |
| P1-7 | `quiz` — catalog prose describes a complete Quizcraft engine (trivia / flag-guess / music-guess, Remotion-rendered); no source exists anywhere, only static proof media. | `goldenExecution.ts:133`; `public/golden/quiz/*` | The bindings table self-declares `catalog-only` so it cannot be silently selected, but the catalog page advertises a capability that does not exist. Build it or mark it clearly unbuilt. | Large (build) / Small (relabel) |
| P1-8 | `show-bible` — the catalog's headline engine `resolveCrew` (single pure resolver, typed per-role doctrine warnings) has zero non-test call sites; production runs five per-role `resolve*Config` branches with coarse whole-Bible fallback. | orphan `crewProfile.ts:45`; live `crewBlocks.ts:82-102` | "No silent gaps (role without doctrine → typed warning)" is tested but unreachable; production silently falls back to a Style-DNA pseudo-bible. | Medium |
| P1-9 | `lofi` — cited engine `src/lib/lofi.ts` (509 L) has zero importers repo-wide; live loop logic is inline in `lofiBlocks.ts`. The six documented gates (seamless 2×15s loop, static-camera lock, temporal de-warble, no baked-in upscale) were never re-verified against the code that runs. | `src/lib/lofi.ts`; live `lofiBlocks.ts:41,53` | An entire archetype's quality guarantees are unverified, and 509 lines of dead code invite wrong-file edits. | Medium |
| P1-10 | `cinematic` — `cinecraft.ts` (480 L, hero-anchor consistency logic) is used only for a `ShotSpec` type import; the same-named family runs the generic Novita chain instead. | `src/lib/cinecraft.ts`; `crew/cinematographer.ts:16`; `families.ts:132-142` | Cinematic channels get generic rendering without the anchor-consistency logic the catalog promises. | Medium |
| P1-11 | `motioncraft` NOT WIRED — self-declared `catalog-only`; production data-viz subset reimplemented in `insertBlocks.ts`. | `src/lib/motioncraft.ts`; `goldenExecution.ts:157` | Duplicate implementations; 246 L dead. | Small |
| P1-12 | `speech-tv` NOT WIRED — `renderMotivationalSpeech` has zero callers; reachable only via Remotion CLI. | `src/lib/remotionRender.ts:360`; `goldenExecution.ts:158` | Advertised format cannot be produced by the pipeline. | Medium |
| P1-13 | `loreshort` NOT WIRED — "pipeline adapter pending" per its own binding note; only a static proof gallery. | `src/lib/loreshort.ts`; `goldenExecution.ts:129`; `src/app/(app)/loreshort/page.tsx` | Advertised format cannot be produced. Honest self-declaration, but still a capability gap. | Medium |
| P1-14 | `script` — 2 of 5 declared gates ("loop payoff verified by qa_script", "midpoint re-hook verified") are checked but never enforced, because they route through the advisory `qa_script`. | `hookcraft.ts:278-286` (enforced 3); `narratedBlocks.ts:311` (advisory 2) | Structural script-craft failures pass through. Ties to P0-5. | Medium |
| P1-15 | `script_gen` and `narration_tts` maintain bespoke critique loops instead of `critiqueLoop.ts`. | `narratedBlocks.ts:229-258`; `voicecraft.ts:658` | Improvements to the shared primitive never reach the two highest-volume producers. | Medium |
| P1-16 | `shorts` — catalog prose cites a `shorts_cuts` assembly engine that does not exist as a block; the binding instead maps to ship-stage repurposer blocks; one gate is self-marked `PENDING golden`. | prose in `golden.ts`; `families.ts:93-101`; `goldenExecution.ts:170-175` | Two materially different capabilities share one catalog key — a reader cannot tell which one runs. | Small (doc) |
| P1-17 | `contentLane` never tunes quality thresholds or prompts. | `convex/schema.ts:111`; consumers only in `runPipeline.ts`, `engine/contentLane.ts` | No lane-specific calibration is possible without editing callers. Arguably correct for deterministic ffmpeg checks; wrong for model-graded ones. | Medium |

### P2 — cleanup / unverified

| # | Issue | Where | Why it matters | Effort |
|---|---|---|---|---|
| P2-1 | `metadata` gate internals unverified (clickScore ≥7, payoff-in-50-chars, claims-grounding lint) and no dedicated test exists. | `src/lib/metacraft.ts`; block `intelligenceBlocks.ts:401-422` | Wiring is confirmed real; the thresholds may be aspirational. Read + add one unit test. | Small |
| P2-2 | `verify`'s three named catalog gates ("ValidationSpec", "mobile-size legibility", "reference comparison") are paraphrases, not traceable 1:1 to throw sites. | `golden.ts:942`; throws `narratedBlocks.ts:2002-2212` | Real fail-closed checks exist; the catalog naming just can't be verified mechanically. Reconcile names. | Small |
| P2-3 | `documotion` and `comic` numeric gate thresholds (still-verifier ≥7, keep-clear overlap = 0-or-fail) not traced into the block files. | `documentaryCollageShortBlocks.ts:231`; `motionComicBlocks.ts` | Core libraries confirmed genuinely invoked; only the thresholds are unconfirmed. | Small |
| P2-4 | `layer` timing-sync gate inferred from Whisper/TTS caption-cue machinery, never asserted by a test. | `src/lib/ffmpeg.ts:1610-1712` | Caption drift would ship silently. Add one assertion. | Small |
| P2-5 | Six WORKING modules were never test-run directly: `visuals`, `documotion`, `layer`, `whiteboard`, `comic` (fixture only), `inserts`. | — | Coverage relies on broad `test:production-readiness` globbing. | Medium |
| P2-6 | `topic-intel` has no dedicated unit test for `topicraft.ts`'s citation/dedupe/judge logic — only `scripts/topicraft-ab.ts`, a comparison script. | `src/lib/topicraft.ts:213-282,318-355,526` | Gates verified by inspection only. | Small |
| P2-7 | Orphaned/dead files to delete or wire: `src/lib/assembly/overlays.ts`, `src/lib/lofi.ts`, `renderWatch.ts:216 watchRender`, plus the `catalog-only` libraries above. | see rows | Wrong-file edits, misleading greps. | Small |
| P2-8 | Catalog count discrepancy: 27 stage-attributed rows here vs a prior count of 28 entries in the `GOLDEN_MODULES` array (`golden.ts:503`, which spreads in 10 `CHANNEL_INCEPTION_CATALOG_MODULES` at `:507`). | `golden.ts:503-507` | One entry may be unaudited. Re-enumerate mechanically. | Small |
| P2-9 | `GOLDEN_SPINE`'s `ship` row over-lists `shorts_spinoff` / `documentary_short_candidates`, which `CATALOG_EXECUTION_BINDINGS` assigns to the `shorts` module (stage `visual`). | `golden.ts:58` vs `goldenExecution.ts:170-175` | Documentation-only; misleads anyone auditing "what ships". | Small |
| P2-10 | Spine block id `"assemble"` (lofi loop-assembly) has no `GOLDEN_MODULES` row — it is folded into `lofi`'s `executableIds`. | `golden.ts:55-56`; `goldenExecution.ts:134` | Catalog-completeness gap; distinct from catalog key `assemble`, and the name collision is itself confusing. | Small |
| P2-11 | The entire Golden promotion layer is inert: empty `GOLDEN_PROMOTION_PROOFS`, and `compileGoldenExecutionFlow` / `selectGoldenProductionModules` have zero production call sites. `assessGoldenPromotion` additionally requires `status === "reference"`, so any `"active"` module can never pass regardless of proof. | `goldenExecution.ts:182,307-322,415-417,488-499`; production path `pipelineCompiler.ts:485` | Intentional and honestly tested (`goldenChannelFlow.test.ts:196-200`), but it means the catalog prose is the only spec — and this audit found it wrong in five places. Decide: give it teeth, or stop describing it as certification. | Large |
| P2-12 | `music` provider-receipt accounting (`acceptedUnits` / `billedGenerations`) was never reconciled against real provider billing. | `lofiBlocks.ts:899-910` | Out of scope for static audit; flagged for an ops check. | Small |

---

## Related, non-audit

A new Convex `projectGoals` table (`convex/schema.ts:1197-1207`) and `convex/goals.ts` (`getCurrentGoal` query + `setGoal` mutation) were added in the same wave. `npm run typecheck` passes and `api.d.ts` regenerated cleanly, but the table is **not deployed and not seeded** — blocked by P0-3 (`planBatchUsage` schema drift blocking all pushes to `astute-camel-689`).
