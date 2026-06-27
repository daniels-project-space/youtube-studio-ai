# Modular Architecture → Mastra Toolset

**Status:** design / scoping — no code yet.
**Baseline:** `origin/main` @ `29cacee`. Line numbers below are indicative as of that commit.
**Goal:** (1) make every module do *only* its one job — standalone, composable, customizable, able to read each other's information through a typed contract — and (2) turn the engine into a sophisticated **Mastra build** with the modules as a **toolset**. These are the *same* work: a Mastra tool *is* a single-responsibility module with declared input/output/config schemas.

---

## 0. TL;DR

- The **block engine is already strongly single-responsibility**: every block declares typed `consumes`/`produces`, the pipeline is validated as a DAG, and pipelines are pure data. Keep it.
- The **overlap is in the standalone visual libraries** (`lofi`, `loreshort`, `motionComic`, `whiteboardSync`): each runs its *own* internal pipeline and **bypasses the shared `banana` (image-gen) and `ffmpeg` engines**. Vision-QA is also fractured across three modules.
- The **"connect / customize / read each other" layer is half-formalized**: the good patterns (`CustomizationSurface`, `ChannelProfile`, `VideoBrief`) exist but only 2 of ~24 modules adopt them, and `buildChannelProfile()` isn't called at runtime yet.
- **Mastra today is a thin `agentJson()` wrapper** + 8 stateless Gemini agents. No tools, no workflows. A clean sheet to build on.
- The migration is **incremental and parity-safe**: finish the module contract → wrap modules as tools → run a workflow engine beside the existing runner at parity → let the Architect compose → cut over. `agentJson()` stays as the resilient fallback the whole way.

---

## 1. Current architecture (ground truth)

### 1.1 The block engine — the single-responsibility core (STRONG)

- **Block contract** — `src/engine/types.ts:42`:
  ```ts
  interface Block {
    id: string;
    consumes: string[];   // store keys required before run
    produces: string[];   // store keys guaranteed on success
    paid?: boolean;
    run: (ctx: StageContext) => Promise<BlockPatch>;
  }
  ```
  `StageContext` carries `params` (per-block customization), `store` (shared per-run cache), `ownerId/runId/channelId/keyPrefix/budgetUsd/log`.
- **Execution** — `src/engine/runner.ts`: sequential by default; **verified** parallel groups only (`PARALLEL_GROUPS`, `runner.ts:135`) — crew briefs, the guard gates, and the footage/imagery/music/intro group. The runner **asserts** every declared `produces` key is non-null (loud fail, no silent fallback) and enforces the budget ceiling.
- **Validation** — `validatePipeline()` topologically checks that every `consumes` is produced upstream and that each store key has a **single producer**.
- **Assembly** — `src/engine/designer.ts` turns a family/archetype + toggles into a `PipelineEntry[] = { block, params }[]`. **Pipelines are pure data, not code.**

**Verdict:** the block layer already embodies "each module does one part, declares its I/O, and composes." This is the foundation everything else should rise to.

### 1.2 The craft libraries — standalone engines (MIXED)

Each `craft*()` / `cast*()` engine in `src/lib/` owns one capability and exposes a `craftX()` + `hasX()` surface. The **clean** ones (no pipeline/Convex reach, pure input→judged-output):
`scriptcraft`/`scriptGen`/`hookcraft`, `voicecraft`, `metacraft`, `topicraft`, `banana` (thumbnails), `footagecraft`, `cinecraft`, `documotion`, `performance`, `outliers`, `ffmpeg`.

The **violators** bundle a whole internal pipeline and bypass the shared engines — see §2.2.

### 1.3 Creative direction, customization & shared context (HALF-FORMALIZED)

- **Shared context = three tiers:** per-run `ctx.store`; per-channel record (`convex/schema.ts` channels: `identity`, `styleDNA`, `pillars`, `moduleConfig`, `qaRubric`); and the **`VideoBrief`** authored by the crew.
- **Crew → VideoBrief slices** (`src/trigger/blocks/crewBlocks.ts:152-227`), each grounded in a Show-Bible doctrine + StyleDNA:
  | Role | Block | Produces | Consumed by |
  |---|---|---|---|
  | Director | `director_brief` | `structure` | assembly / intro |
  | Cinematographer | `dp_brief` | `visualBrief` | `stock_footage` (`footageQueries`), gen-footage |
  | Editor | `editor_brief` | `cutSheet` | `timeline_assemble` |
  | Composer | `composer_brief` | `musicBrief` | `music` |
  | Critic | `critic_spec` | `validationSpec` | QA |
  - **Gap:** these live as **scattered store keys**, not one typed `VideoBrief` object; every consumer does `ctx.store["x"] as T | undefined`.
- **CustomizationSurface** — `src/engine/customization.ts:27` (`{ capabilities, knobs, presets }`) with `validateKnobs` (`:62`) + `resolveKnobs` (`:81`). Declared by **only 2 modules**: `ASSEMBLY_SURFACE` (`src/lib/assembly/module.ts`, 11 knobs / 6 presets) and `CREW_SURFACE` (`src/lib/crew/module.ts`, 9 knobs / 6 presets), registered in `MODULE_REGISTRY` (`src/engine/moduleRegistry.ts:28`).
  - **Gap:** `MODULE_CATALOG` lists tunable params for the *other* blocks **client-side only** — no server-side surface or validation.
- **Channel config flow** — `runPipeline.ts` seeds the store with `styleDNA`, `qualityBar`, identity fields; blocks call typed resolvers (`resolveAssembleParams`, `resolveCrew`) that read `moduleConfig`.
  - **Gap:** `buildChannelProfile()` (`src/engine/channelProfile.ts:85`) is **designed but not called at runtime** — resolution is partial, and `styleDNA` reaches modules as *prompt text digests*, not declared typed inputs.

### 1.4 Mastra footprint today (THIN WRAPPER)

- **One entry point:** `agentJson()` (`src/agents/mastra.ts:235`) — tries a Mastra agent (zod-validated, Langfuse-traced) and **falls back to REST on any failure**. Resilient by design.
- **8 stateless agents** (producer, director, showrunner, crew_director, cinematographer, editor, composer, critic) — all **Gemini** (`google/gemini-2.5-flash`/`-pro`). Claude permanently removed (`src/lib/anthropic.ts` redirects to Gemini).
- **No `createTool`, no `createWorkflow`, no `createStep` anywhere.** ~20 `agentJson()` calls (crew + a few intelligence blocks); most LLM work goes **direct through `src/lib/gemini.ts`**.
- **Deps:** `@mastra/core ^1.37`, `@mastra/langfuse ^1.3`, `ai ^6`, `@ai-sdk/google ^3`. Marked external in `trigger.config.ts` for clean Linux bundling.

---

## 2. Single-responsibility audit

### 2.1 Already clean
The block engine (§1.1), the crew slice model, and the golden craft libs (`scriptcraft`, `voicecraft`, `metacraft`, `topicraft`, `banana`, `hookcraft`, `footagecraft`, `cinecraft`, `documotion`). Shared concerns correctly centralized: Gemini (`gemini.ts`), TTS (`tts.ts`), storage (`storage.ts`), secrets (`vault.ts`), doctrine (`engine/golden.ts`).

### 2.2 Violations (with evidence)

1. **Image generation duplicated 4×.** `lofi.ts:363`, `loreshort.ts:219`, `motionComic.ts` (`ART_MODEL = "gemini-3-pro-image-preview"`), `whiteboardSync.ts` each call the Gemini image REST endpoint directly instead of `banana.generateBananaImage()` (`banana.ts:145`), re-implementing model-fallback + retry + timeout.
2. **ffmpeg duplicated 3×.** `lofi.ts`, `loreshort.ts`, `motionComic.ts` `spawn("ffmpeg", …)` directly instead of `ffmpeg.ts` helpers (`concatClips`, `buildLoop`, `grabFrame`). `footagecraft`/`documotion` use the shared helpers correctly — proof the pattern works.
3. **Vision-QA fractured.** `banana.ts:223` (thumbnail judge), `videoVerifier.ts:54` (`evaluateThumbnail`) and `:79` (`evaluateFootage`), and `footagecraft` (internal relevance gate) overlap with different rubrics. `voicecraft` has two near-identical audio judges (`recruitVoice` `:412`, `judgeNarrationTake` `:655`).
4. **Overreaching blocks.** `stock_footage` (`narratedBlocks.ts`) hides a generated-signature-clips call (`generateSignatureClips`, `unshift`-ed into the stock body) — a second concern buried behind a param; should be its own block. `narration_tts` is a ~260-line dual-mode (chapter vs sentence) block — borderline; splitting into `chapter_tts` + `sentence_tts` would be cleaner.

**Root pattern:** the *visual format engines* each grew a private pipeline (image → i2v → upscale → encode → grade). That is exactly "each module builds an entire pipeline that overlaps with others." The fix is mostly **mechanical rerouting**, not redesign.

### 2.3 Contract gaps ("read each other / customize")
- VideoBrief scattered, not one typed object (§1.3).
- Only 2 modules declare a `CustomizationSurface`; the rest have no server contract.
- `buildChannelProfile()` not adopted at runtime.
- `styleDNA` consumed as prompt text, not a declared typed input.
- `MODULE_REGISTRY` has 6 entries → the Architect can't reason over most modules.

---

## 3. Target: the unified Module contract

Every module — block or craft engine — should satisfy one card:

```ts
interface ModuleContract<In, Out, Cfg> {
  id: string;
  responsibility: string;          // one sentence; if it needs "and", split it
  inputSchema: ZodSchema<In>;      // formalizes `consumes`
  outputSchema: ZodSchema<Out>;    // formalizes `produces`
  surface: CustomizationSurface;   // knobs + presets + capabilities (Cfg)
  reads?: ("channelProfile" | "videoBrief" | "styleDNA")[]; // declared shared-context deps
  run(input: In, cfg: Cfg, ctx: RunContext): Promise<Out>;
}
```

Rules:
1. **One responsibility.** No module both picks a topic *and* writes a script *and* renders. If two verbs, two modules.
2. **No bypassing shared engines.** Image-gen → `banana`. Encode → `ffmpeg.ts`. LLM → `gemini.ts`/`agentJson`. Vision-judge → one shared judge (module passes its rubric).
3. **Typed I/O.** `inputSchema`/`outputSchema` replace stringly-typed store keys.
4. **Declared customization.** Every tunable is a knob on the module's `surface`, validated server-side.
5. **Reads shared context explicitly.** A module that needs the channel look declares `reads: ["styleDNA"]` and receives it typed — never reaches into Convex itself.

This card is intentionally a near-superset of a Mastra `Tool` (§4).

---

## 4. Mastra mapping — modules as a toolset

| Today | Mastra primitive |
|---|---|
| `Block { consumes, produces, run }` + craft engine | `createTool({ id, inputSchema, outputSchema, execute })` — inputSchema from `consumes`, outputSchema from `produces` |
| `CustomizationSurface` (knobs/presets) | the tool's **config schema** (resolved per channel from `moduleConfig`) |
| `PipelineEntry[]` + `PARALLEL_GROUPS` | `createWorkflow().then()/.parallel()` — `designer.ts` becomes the workflow builder; verified parallel groups → `.parallel()` segments |
| `runner.ts` (sequential + assert + budget + resume) | Mastra **workflow run** (steps, suspend/resume, per-step tracing) |
| `architect.ts` | a Mastra **agent whose toolset is the module registry** → composes a workflow by reasoning over tool `responsibility` + `surface.capabilities` |
| `ctx.store` + `ChannelProfile` + `VideoBrief` | Mastra **RuntimeContext / typed workflow state** — typed, not stringly-keyed |
| crew agents + `agentJson()` | already Mastra agents; **keep `agentJson()` as the resilient fallback** so migration never breaks a render |
| Langfuse wiring (`mastra.ts`) | full **workflow-level traces** for free |

**Key insight:** because the block contract already declares I/O and the pipeline is already pure validated data, wrapping a block as a tool is mechanical, and turning a `PipelineEntry[]` into a workflow is a translation, not a rewrite. The Architect gains real power once the registry is complete: it can *assemble* a workflow from capabilities instead of choosing a fixed archetype.

---

## 5. Phased migration (parity-safe)

- **P0 — Tier-1 cleanup (prerequisite).** Reroute the 4 visual libs to shared `banana` + `ffmpeg`; unify vision-QA into one judge; extract `signature_clips` as its own block. No behavior change intended; existing renders stay identical. *This is what makes each module a clean tool.*
- **P1 — Contract (Tier-2).** Give every module a `CustomizationSurface` + zod I/O; unify the `VideoBrief` into one typed store object; call `buildChannelProfile()` once per run; make `styleDNA` a declared input. Still on the existing runner.
- **P2 — Tool wrappers.** `createTool` around each block's `run` (zod from the schemas in P1). Zero behavior change — tools call the same engines.
- **P3 — Workflow engine at parity.** A Mastra `createWorkflow` built from the same `PipelineEntry[]`, run **alongside** `runner.ts` behind a flag; assert byte/ífor-byte parity on a sample of channels before trusting it.
- **P4 — Architect composes + cutover.** The Architect agent composes workflows from the tool registry; retire the bespoke runner once parity holds. Keep `agentJson()` fallback indefinitely.

Each phase ships independently and is reversible.

---

## 6. Task list

### Tier 1 — stop the duplication (mechanical, safe, high-value)
- [ ] Route `lofi`, `loreshort`, `motionComic`, `whiteboardSync` image-gen → `banana.generateBananaImage()`.
- [ ] Route the same modules' ffmpeg calls → `ffmpeg.ts` helpers (add `concatAndEncode`/`grade` helpers if missing).
- [ ] One shared `visionJudge(image, rubric)`; fold `videoVerifier` + `banana` + `footagecraft` gates onto it (module supplies the rubric).
- [ ] Extract `signature_clips` from `stock_footage` into an explicit optional block; compose in pipeline order.
- [ ] (Optional) split `narration_tts` → `chapter_tts` + `sentence_tts`.

### Tier 2 — formalize the contract (read-each-other / customize)
- [ ] Add a `CustomizationSurface` + zod `inputSchema`/`outputSchema` for every block; register all in `MODULE_REGISTRY`.
- [ ] Collect the 5 crew slices into one typed `ctx.store.videoBrief`; update consumers to read the typed object.
- [ ] Call `buildChannelProfile()` once in `runPipeline`; blocks resolve config via `resolve(profile, blockId)` only.
- [ ] Make `styleDNA` a declared typed input for the modules that use it (thumbnail/footage/script), not just prompt text.

### Tier 3 — Mastra build
- [ ] `createTool` wrappers (P2). [ ] `createWorkflow` builder from `PipelineEntry[]` + parity harness (P3). [ ] Architect-as-composer over the registry (P4). [ ] Expand Langfuse to workflow traces.

---

## 7. Risks, non-goals, open questions

- **Non-goal:** changing render output. P0–P2 must be behavior-preserving; the parity harness in P3 is the gate.
- **Risk:** Mastra workflow ↔ Trigger.dev `maxDuration`/resume semantics. P3 must prove suspend/resume + budget-abort parity with `runner.ts`.
- **Risk:** zod schemas drifting from real store shapes. Mitigate by generating schemas from the existing `consumes`/`produces` and asserting at the seam during P2.
- **Open:** keep `agentJson()` as the LLM path inside tools, or let Mastra tools call models natively? Recommendation: keep `agentJson()` (single resilient, Gemini-only, traced path) and have tools call it — preserves the no-Claude doctrine and the fallback.
- **Open:** how far to push the Architect's compositional freedom vs. curated archetypes. Recommendation: Architect proposes, archetypes remain the validated safe set; gate composed workflows through `validatePipeline` before run.

---

*Companion docs: `MODULE_CUSTOMIZATION_STANDARD.md` (the knob/preset standard), `AUDIT_ORCHESTRATION.md` / `AUDIT_MODULES_RIGOR.md` (prior audits), `PIPELINE_V2_PLAN.md`.*
