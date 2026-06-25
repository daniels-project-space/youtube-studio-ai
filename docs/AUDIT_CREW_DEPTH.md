# Crew Depth Audit — YouTube Studio AI

**Scope:** read-only audit of the per-video "film crew" (director, cinematographer, editor, composer, critic). Premise under test: each crew member is its own intricate, customizable sub-module producing a rich typed brief — but the recently-added `src/lib/crew/` only models crew *composition* (role on/off + doctrine pass-through + a few style knobs) and misses the real depth and wiring.

**Verdict up front:** premise is correct. The five `brief*` functions in `src/engine/creative/crew.ts` are the real intelligence, but each is a single shallow Gemini call with a hard-coded prompt and **no operator knobs**. A large fraction of each brief's typed output is **produced-and-ignored** downstream. And `src/lib/crew/resolveCrew` is a **parallel, unwired abstraction**: it has zero runtime callers — the pipeline bypasses it entirely.

---

## 1. The two disjoint "crew" layers

| Layer | File | What it is | Wired into a run? |
|---|---|---|---|
| **Runtime briefs** | `src/engine/creative/crew.ts` + `src/trigger/blocks/crewBlocks.ts` | 5 LLM brief functions → 5 Trigger blocks writing `ctx.store`. | **YES** — `CREW_BLOCKS` registered in `engine/blocks.ts:37`; pipeline injected by `refreshShowBible.ts:116`. |
| **Composition resolver** | `src/lib/crew/{roles,module,crewProfile}.ts` | `resolveCrew()` (pure) + `CREW_SURFACE` knobs + `CREW_MODULE` card. | **NO** — `resolveCrew` has **0 callers** (grep). Only `CREW_MODULE` (the *card*) is registered in `moduleRegistry.ts:26`; `golden.ts:608-621` describes it in prose. |

The brief blocks (`directorBriefBlock` … `criticSpecBlock`) call `briefDirector(bible, crewCtx)` etc. **directly**. They never consult `resolveCrew`, role toggles, presets, or any of the 8 `CREW_SURFACE` knobs. The two layers share only the `ShowBible` doctrine fields and the `VIDEO_CREW_ROLES` enum.

---

## 2. Per-member findings

### Director — `briefDirector` (crew.ts:57)

1. **PRODUCES** `StructureBrief` (types.ts:188): `hook: string`, `beats: {name, intentSec, note}[]`.
2. **INTELLIGENCE** one Gemini call (`role:crew_director`, temp 0.8, maxTokens 1200). Inputs: `header()` (positioning/vibe/iconicMotif/works/avoid + dnaDigest + topic + targetSeconds) + `directorDoctrine`. Asks for hook + ordered beat map summing to target length. Clamps `intentSec≥1`.
3. **WIRED vs DEAD** WIRED (partial). `structure` read at `narratedBlocks.ts:184`, passed to `synthScript`. `scriptGen.ts` consumes `hook` (661 `directorIdea`), `beats.name`+`beats.note` (486, 683). Also `whiteboardSync.ts:137,197`. **`intentSec` is DEAD** — dropped at the `narratedBlocks.ts:184-186` cast `{hook?, beats?:{name,note}[]}`; grep `intentSec` outside crew.ts = **0 hits**. So the director's pacing/duration intent is computed every run and silently discarded.
4. **CUSTOMIZATION TODAY** only `directorDoctrine` free-text in the ShowBible. The `directorStyle` enum (classical/kinetic/contemplative/bold) exists in `CREW_SURFACE` but never reaches `briefDirector`.
5. **MISSING / SHALLOW** no act/structure templates (3-act, listicle, problem-solution), no per-beat duration enforcement, no hook-style selector, no narrative-arc shape, no temperature/length knobs. `intentSec` should drive `bodySegSeconds`/timeline but is orphaned.
6. **LEVEL-UP** sub-module knobs: `structureTemplate`, `hookStyle`, `beatCount`, `arcShape`, `directorStyle` (wire the existing enum), `temperature`. **Wire `intentSec`** into `planTimeline`/`bodySegSeconds`.

### Cinematographer — `briefCinematographer` (crew.ts:95)

1. **PRODUCES** `VisualBrief` (types.ts:195): `footageQueries[]`, `promptStyle`, `palette[]` (hex), `motion`, `avoid[]`.
2. **INTELLIGENCE** one Gemini call (`role:cinematographer`, temp 0.8). Asks for 8-14 short (2-5 word) literal stock queries + a promptStyle clause + palette + motion + avoid. Filters queries to ≤16, validates hex, clamps `avoid` to 8.
3. **WIRED vs DEAD** PARTIAL. `footageQueries` WIRED in narrated path (`narratedBlocks.ts:702` → `dpQueries`, prepended to footage search). `promptStyle`+`motion` WIRED in lofi (`lofiBlocks.ts:133-134`). **`palette` and `avoid` are DEAD in the narrated path** (only `footageQueries` is read at :702). **`setting`/`world` read at `lofiBlocks.ts:385` do not exist on `VisualBrief`** — they're `undefined`, a latent bug. `genFootageBlocks.ts:96` reads a `look?` field that also isn't on the type.
4. **CUSTOMIZATION TODAY** only `dpDoctrine` free-text. `cinematographer` toggle exists in `CREW_SURFACE` but isn't honored by the block (block always runs if in pipeline).
5. **MISSING / SHALLOW** `palette`/`avoid` never bias selection or generation; no shot-grammar/lens/lighting/aspect knobs; type drift (`setting`/`world`/`look` read but undeclared); no per-section look variation.
6. **LEVEL-UP** knobs: `shotGrammar`, `lensLanguage`, `lighting`, `paletteBias` (enforce), `negativePrompt` (wire `avoid`), `queryCount`. Reconcile `VisualBrief` with the `setting`/`world`/`look` fields consumers expect.

### Editor — `briefEditor` (crew.ts:139)

1. **PRODUCES** `CutSheet` (types.ts:208): `sections:{name,cutsPerMin}[]`, `transitions`, `captionStyle`, `overlayRule`.
2. **INTELLIGENCE** one Gemini call (`role:editor`, temp 0.7). Asks for per-section cut cadence + transition language + caption + overlay rules, with explicit cutsPerMin calibration bands.
3. **WIRED vs DEAD** PARTIAL. Only `cutsPerMin` is WIRED: `narratedBlocks.ts:112,657` (`bodySegSeconds` averages section cadences → segment length). **`transitions`, `captionStyle`, `overlayRule` are all DEAD.** The `transitions` hits in `lib/assembly/planTimeline.ts` come from the *Assembly* module's own knob, not from this CutSheet. The `captionStyle` hits outside crew.ts are unrelated (`clipAnalysis.ts`, `designChannel.ts` echo). `overlayRule` = **0 consumers** anywhere.
4. **CUSTOMIZATION TODAY** only `editorDoctrine`. `editorCadence` enum exists in `CREW_SURFACE`, unwired (it's noted as "aligns with Assembly cutEnergy" but that lives in the Assembly module, not here).
5. **MISSING / SHALLOW** ¾ of the brief is decorative. No transition vocabulary applied at render, no caption styling applied, no overlay/quote-card placement engine. Editor is effectively a single-number (cuts/min) member.
6. **LEVEL-UP** knobs: `cadence` (wire the enum), `transitionStyle` → renderTimeline, `captionStyle` → caption renderer, `overlayPlacement` → a real overlay/quote-card block. Today only the scalar is honored.

### Composer — `briefComposer` (crew.ts:182)

1. **PRODUCES** `{ musicPrompt, audio: AudioBrief }`; `AudioBrief` (types.ts:219) = `duckDb`, `bedLufs`, `voiceFx?`.
2. **INTELLIGENCE** one Gemini call (`role:composer`, temp 0.8). Inputs include `composerDoctrine` + `dnaAudio` digest (genre/instrumentation/BPM/LUFS from Style DNA). Asks for a single music prompt + duck/bed/voiceFx. Defaults duckDb -12, bedLufs -22.
3. **WIRED vs DEAD** PARTIAL. `musicPrompt` WIRED (`lofiBlocks.ts:722` `composerPrompt`). `audio.voiceFx` WIRED (`narratedBlocks.ts:405`). **`duckDb` and `bedLufs` are DEAD — 0 consumers in the entire `src/` tree** (grep). So all loudness/duck targets fall back to whatever the mixer hard-codes; the composer's audio mix intent is discarded.
4. **CUSTOMIZATION TODAY** only `composerDoctrine` + indirectly the Style-DNA audio block.
5. **MISSING / SHALLOW** no BPM/key/section-arc knobs, no stems/layers, no per-section music change, no mix targets honored (`duckDb`/`bedLufs` dead). voiceFx is a 1-bit "radio"/off.
6. **LEVEL-UP** knobs: `provider`, `bpmLock`, `moodArc`, `voiceFxMenu`, `mixProfile`. **Wire `duckDb`/`bedLufs`** into the audio-mix/duck stage (the single highest-value fix here).

### Critic — `briefCritic` (crew.ts:240)

1. **PRODUCES** `ValidationSpec` (types.ts:258): `assertions:{id, description, check(deterministic|vision), metric?, op?, threshold?, severity(block|warn)}[]`.
2. **INTELLIGENCE** one Gemini call (`role:critic`, temp 0.5, ≤12 assertions). Constrains deterministic metrics to a fixed `KNOWN_METRICS` whitelist (durationSec, captionCoveragePct, overlapSec, loopSeamDiff, bedLufs, footageRepeatMaxRun) with detailed unit/calibration guidance; format-aware (`ctx.family`).
3. **WIRED vs DEAD** WIRED — the most genuinely consumed member. `validationSpec` read at `narratedBlocks.ts:1901` → `runValidationSpec(spec,{metrics,visionJudge})`. Split verdict: deterministic block-severity assertions **block** QA; vision assertions are **advisory** only.
4. **CUSTOMIZATION TODAY** only `criticDoctrine`. `criticStrictness` (lenient/standard/strict) and `marketAwareCritic` exist in `CREW_SURFACE` but **never reach `briefCritic`** — strictness/op-thresholds are not modulated, and there is no market-aware/competitor-comparison code path (only prose in `golden.ts:616`).
5. **MISSING / SHALLOW** strictness knob unwired; `marketAwareCritic` is vaporware; `bedLufs` metric is offered to the critic but the composer's bedLufs is itself dead, so a bedLufs assertion can only check the mixer default; vision assertions are advisory (can't actually gate).
6. **LEVEL-UP** knobs: `strictness` (scale thresholds/severities), `maxAssertions`, `marketAwareCritic` (real competitor compare), `visionGating` (let high-confidence vision checks block). Expand `KNOWN_METRICS` so more deterministic checks are computable.

---

## 3. Dead / unwired outputs (ranked)

1. **`AudioBrief.duckDb` + `AudioBrief.bedLufs`** (composer) — 0 consumers. Whole mix-intent surface dead.
2. **`CutSheet.transitions` + `.captionStyle` + `.overlayRule`** (editor) — 0 consumers. ¾ of the cut sheet decorative.
3. **`StructureBrief.beats[].intentSec`** (director) — 0 consumers; dropped at the narratedBlocks cast.
4. **`VisualBrief.palette` + `.avoid`** (cinematographer) — 0 consumers in the narrated path.
5. **The entire `lib/crew/resolveCrew` + 8 `CREW_SURFACE` knobs** — 0 runtime callers. `criticStrictness`, `marketAwareCritic`, `directorStyle`, `editorCadence`, and all 5 role toggles are inert w.r.t. the actual brief blocks.
6. **Type drift:** `lofiBlocks.ts:385` (`setting`/`world`), `genFootageBlocks.ts:96` (`look`) read fields not declared on `VisualBrief` → always `undefined`.

## 4. Top 5 customization gaps

1. **Role toggles don't gate execution.** A run's pipeline is the set of `_brief` blocks injected by `refreshShowBible`; the block always runs the agent regardless of `CREW_SURFACE` `director/cinematographer/...` booleans. `resolveCrew`'s opt-in logic is never consulted.
2. **No per-member knobs reach the LLM.** Every brief gets only free-text `*Doctrine`. The enums (`directorStyle`, `editorCadence`, `criticStrictness`) are defined but never injected into prompts or post-processing.
3. **Mix targets uncustomizable & dead** (`duckDb`/`bedLufs`).
4. **Editor transition/caption/overlay direction uncustomizable & dead.**
5. **`marketAwareCritic` is documented but unimplemented** — no competitor-comparison path exists.

## 5. Recommended structure: crew = 5 sub-modules

Make each member a real module with its own `CustomizationSurface`, mirroring the existing module pattern (`CREW_MODULE` card → resolver → block that *honors* the resolved knobs):

- **Per-member CustomizationSurface** (knobs above) resolved via the existing `resolveKnobs`/`moduleParams` machinery, then **injected into the brief prompt + post-processing** (e.g. strictness scales critic thresholds; directorStyle prepends a stance clause).
- **Wire `resolveCrew` into `crewBlocks`:** each block calls `resolveCrew(profile, bible)`, skips when its role toggle is off (replacing the always-run behavior), and passes its `ResolvedCrewMember.doctrine` + member knobs into `crewCtx`.
- **Close the dead loops:** route `intentSec`→timeline, `palette`/`avoid`→footage/keyframe selection + negative prompts, `transitions`/`captionStyle`/`overlayRule`→`renderTimeline`/caption/overlay stages, `duckDb`/`bedLufs`→audio-mix stage.
- **Reconcile the `VisualBrief` type** with the `setting`/`world`/`look` fields consumers already read.
- **Implement `marketAwareCritic`** or delete the claim from `module.ts`/`golden.ts`.

**Bottom line on `resolveCrew`:** it captures *composition only* (which roles, doctrine string, 8 style hints) and is not even wired in. It omits entirely: the five brief functions, every typed brief field (the actual feature surface), per-member knobs, and all downstream consumption — i.e. everything that makes a crew member "intricate."
