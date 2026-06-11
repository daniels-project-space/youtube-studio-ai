# Film Crew Intelligence — design plan

The creative-direction layer that sits above the mechanical block pipeline. Turns a
channel's *essence and vibe* into concrete production decisions (music prompt, cut
rhythm, structure, look) and per-video validation, run by a modular crew of agents.

---

## 1. The core idea: two creative moments, one crew

The system already separates **channel creation** (`synthChannelConcept`, once) from
**per-video runs** (blocks, every time). The crew uses the same split:

| Moment | Who | Output | Where it lives |
|---|---|---|---|
| Channel creation (once) | **Showrunner** convenes the crew | **Show Bible** (durable creative brief) | `channels.identity.creativeBrief` |
| Per video (every run) | crew "brief" blocks | **Video Brief** (structure, music prompt, cut sheet, visual brief, validation spec) | `ctx.store.videoBrief` |

The Show Bible is the channel's "essence/vibe" intelligence: positioning, the
what-works / what-doesn't doctrine for the space, the iconic visual motif, and the
*defaults* each crew role works from. The Video Brief is the Bible applied to one
topic. Downstream mechanical blocks (script_gen, music, stock_footage, keyframes,
timeline_assemble, captions, qa_*) become **executors** of the Video Brief instead of
carrying generic hardcoded behavior.

---

## 2. The crew roster

Each role is a **stable function** (it always does the same thing) with a
**channel-custom goal** (its brief differs per Bible). Implemented as new `AgentRole`s
in `src/agents/mastra.ts`, each with persistent instructions; they reuse `agentJson` +
`produceAndCritique` unchanged.

| Role | Owns | Produces (per video) | Consumed by |
|---|---|---|---|
| **Showrunner** | Positioning, what-works/what-doesn't, role selection, iconic motif | (creation-time) the Show Bible | the other agents + designer |
| **Director** | Narrative structure, beat/act map, hook doctrine, emotional arc, pacing intent | `structure` (beats + per-beat intent + hook) | script_gen, timeline_assemble |
| **Cinematographer (DP)** | The look: shot types, footage/keyframe selection criteria, color/mood, motion grammar | `visualBrief` (footage queries, scene/keyframe prompt style, palette, motion) | stock_footage, keyframes, scene_planner, channel art |
| **Editor** | Cuts & rhythm: cuts/min by section, transitions, caption style, overlay placement, breath/silence | `cutSheet` (cadence per section, transition language, caption + overlay rules) | timeline_assemble, captions, quote_overlays |
| **Composer / Sound** | Music doctrine: genre, instrumentation, dynamics, BPM band, what to avoid; ducking, voice-fx | `musicPrompt` + `audioBrief` | music, narration_tts |
| **Critic / QA Director** | The **validation spec**: what *this* video must satisfy | `validationSpec` (typed assertions + severity + thresholds) | qa_visual, qa_refine, length_check |

**Family-awareness (the Showrunner's job).** Not every channel needs every role. The
Showrunner activates the right subset per family/niche:

- `music_loop` / `sleep`: DP + Composer + Critic (loop-seam). No Editor cut sheet, no Director beats.
- `narrated_stock`: Director + Editor + Composer + Critic strongly; DP for footage criteria.
- `shorts`: Director (hook) + Editor (fast cuts) + Critic (hook-in-2s).
- `cinematic`: all five.
- `whiteboard`: Director + Editor + Composer + Critic.

"Same thing, custom goals" is literal: every crew brief is one call —
`brief(role, showBible, videoContext) -> roleBrief` — same signature, same critique
loop, same JSON contract. Only the agent *instructions* and the *Bible* differ.

---

## 3. How Mastra fits (honest assessment)

The repo's own stated philosophy is a "hybrid seam": Mastra authors agent calls, the
block engine owns the DAG, Trigger runs it. Keep that. Concretely:

**Use Mastra for:**
- **Agent registry + instructions.** The crew is a natural `Record<role, Agent>` with
  durable per-role instructions. Direct extension of the existing `producer`/`director`
  pair in `mastra.ts`. Strong fit.
- **Observability.** Langfuse tracing is already wired. A multi-agent crew is exactly
  where per-agent traces earn their keep (which agent's brief caused a bad render).
- **(Phase 2, optional) Agent tools.** Mastra tool-calling could let the DP agent
  actually *run* a footage search to test queries, or the Critic *call* the frame
  reader during judging, instead of only emitting JSON. This is the one place Mastra
  adds capability beyond today's pattern. Defer until the JSON crew is proven.
- **(Optional) Mastra memory** for cross-run recall of briefs/performance. We already
  have `loadPerformanceContext` (the performance ledger), so this is redundant for now.

**Do NOT use Mastra for:**
- **Orchestration / workflows.** The block DAG + `critiqueLoop` already own produce →
  critique → regenerate and fan-out. Wrapping the crew in Mastra workflows duplicates
  that and splits the orchestration brain. The crew convenes *inside* a block.

Net: Mastra = agents + instructions + tracing (tools/memory later). Orchestration stays
in the block engine. No regression risk: `agentJson` already falls back to REST.

---

## 4. Data model

Extend `convex/schema.ts` `channels.identity` with an optional `creativeBrief` (all
optional → back-compat). Stored once at creation, refreshed by `learn`.

```ts
creativeBrief: v.optional(v.object({
  positioning: v.string(),              // one-paragraph "what this channel IS"
  vibe: v.string(),                     // the emotional/tonal signature
  iconicMotif: v.string(),             // the recurring visual signature (avatar + thumb + intro share it)
  worksInSpace: v.array(v.string()),   // proven patterns to lean into
  avoidInSpace: v.array(v.string()),   // anti-patterns to NEVER do (the "what doesn't work")
  activeCrew: v.array(v.string()),     // which roles are on for this channel
  directorDoctrine: v.optional(v.string()),     // default structure + hook stance
  dpDoctrine: v.optional(v.string()),           // default look + footage/keyframe stance
  editorDoctrine: v.optional(v.string()),       // default cut cadence + caption/overlay stance
  composerDoctrine: v.optional(v.string()),     // default music genre/instrumentation/avoid
  criticDoctrine: v.optional(v.string()),       // default must-haves + dealbreakers
  refreshedAt: v.number(),
})),
```

Per-video `videoBrief` (in `ctx.store`, not persisted unless we want a record). Shapes
live in a new `src/engine/creative/types.ts`:

```ts
interface VideoBrief {
  structure?:  { beats: { name: string; intentSec: number; note: string }[]; hook: string };
  visualBrief?: { footageQueries: string[]; promptStyle: string; palette: string[]; motion: string; avoid: string[] };
  cutSheet?:   { sections: { name: string; cutsPerMin: number }[]; transitions: string; captionStyle: string; overlayRule: string };
  musicPrompt?: string;
  audioBrief?: { duckDb: number; voiceFx?: string; bedLufs: number };
  validationSpec?: ValidationSpec;   // see §6
}
```

---

## 5. Where it slots into the pipeline

**At creation** (`designChannel.ts`): replace/extend `synthChannelConcept` with
`synthShowBible` (Showrunner) which reuses the competitor data already gathered by
auto-SEO to write `worksInSpace` / `avoidInSpace`, picks `activeCrew`, and sets the
doctrines + iconic motif. Persisted to `identity.creativeBrief`.

**Per video** — new crew "brief" blocks, each individually addable (per the request),
inserted after `topic_select`, before the producers. Each is a registered block with a
`MODULE_CATALOG` entry so it shows in the Advanced editor:

```
topic_select
  → director_brief    (produces structure)
  → dp_brief          (produces visualBrief)
  → editor_brief      (produces cutSheet)
  → composer_brief    (produces musicPrompt + audioBrief)
  → critic_spec       (produces validationSpec)
  → [existing producers: script_gen / keyframes / music / stock_footage / assemble / qa_*]
```

The designer adds only the crew blocks in `activeCrew` (family-aware). Each brief block
is thin: it loads the Bible from the channel doc, calls its role agent through
`agentJson` inside a `produceAndCritique` loop, writes its slice of `videoBrief` to the
store. Downstream blocks read their slice and degrade gracefully if absent (so old
channels with no Bible still run).

**Wiring downstream (the "implement each part" detail):**
- `script_gen`: consume `structure.beats` → use as the section outline + `hook` instead of generic planning. (Today `synthLongScript` invents its own outline; have it honor the Director's beats when present.)
- `stock_footage`: consume `visualBrief.footageQueries` + `avoid` → replace the generic nature query pool when the DP has spoken.
- `keyframes` / `scene_planner`: consume `visualBrief.promptStyle` + `motion` → feed `composeFluxPrompt` / `composeKlingPrompt` styleGrammar/characterStyle.
- `music`: use `musicPrompt` verbatim (overrides the archetype's static prompt).
- `narration_tts`: consume `audioBrief.voiceFx`.
- `timeline_assemble`: consume `cutSheet` (cut cadence, transitions) + `structure` (act timing) + `audioBrief.duckDb`/`bedLufs`.
- `captions` / `quote_overlays`: consume `cutSheet.captionStyle` / `overlayRule`.

---

## 6. Custom error validation (the Critic)

Today QA is hardcoded. New model: the **Critic agent writes a `validationSpec` per
video**, and `qa_visual` / `qa_refine` / `length_check` become **executors** of it.

```ts
interface ValidationAssertion {
  id: string;                    // "loop_seam", "caption_coverage", "hook_2s", "no_overlap", "quotes_present"
  description: string;
  check: "deterministic" | "vision";   // computed in code vs. judged by Critic/DP via frames
  metric?: string;               // e.g. "seamDiff", "captionCoveragePct", "lufs", "overlapSec"
  op?: "<" | "<=" | ">" | ">=" | "==";
  threshold?: number;
  severity: "block" | "warn";    // block fails the run / triggers refine; warn logs
}
interface ValidationSpec { assertions: ValidationAssertion[]; }
```

- **Deterministic** assertions run in code (cheap, trustworthy): loop seam frame-diff,
  caption coverage %, duration band, quote↔chapter overlap seconds, audio LUFS,
  text-over-face detection on thumbnail. We already have most of these primitives in
  `ffmpeg.ts` / `videoVerifier.ts` / `thumbnailFormula.ts`.
- **Vision** assertions go to the Critic/Director with sampled frames: hook strength,
  pacing feel, visual cohesion, "does it match the vibe."
- The spec is **generated from the Bible + family**, so it is automatically correct per
  content type:
  - `music_loop`: seam continuity diff < ε; zero camera drift; runtime in band.
  - `narrated_stock`: ≥2 attributed quotes present; caption coverage ≥ 95%; no
    quote/chapter overlap; chapter cards legible; no footage repeat within N min.
  - `shorts`: hook in first 2s; ≤ 60s; caption pace; vertical safe-area.
  - `cinematic`: scene continuity; score presence; act structure followed.
- A failed **block** assertion either hard-fails the run or feeds the existing
  `qa_refine` editor loop with the specific fix; **warn** is logged to the run report.

This is "custom validation based on what the video needs": the checklist is authored
for *this* video, not the archetype.

---

## 7. Killer profile image

Current `channelArt.avatarPrompt` is a single un-critiqued Flux shot. Upgrade:

1. **DP art-directs** the avatar from the Bible's `iconicMotif` + `vibe` + palette →
   a strong, specific prompt (one bold subject, the recurring motif, lighting, contrast).
2. Generate via the **premium path** (fal FLUX1.1 [pro], or Ideogram for a text-mark)
   at 1:1, optionally **3 candidates**.
3. **Critic loop** (reuse `produceAndCritique`, maxIters 2-3): render → downscale to
   48×48 → vision-judge "instantly recognizable, high contrast, distinct from
   competitors, on-vibe?" → regenerate with notes, or pick the best of the panel.
4. The Bible's `iconicMotif` is shared by avatar + thumbnails + intro card, so the
   channel has one coherent visual signature. (For The Quiet Stoic: the hooded stoic
   statue motif the operator already liked is recorded as `iconicMotif`.)

---

## 8. Files

**New**
- `src/engine/creative/types.ts` — `ShowBible`, `VideoBrief`, `ValidationSpec` shapes.
- `src/engine/creative/showBible.ts` — `synthShowBible` (Showrunner; reuses competitor data).
- `src/engine/creative/crew.ts` — `briefRole(role, bible, ctx)` helpers per crew agent.
- `src/engine/creative/validate.ts` — `runValidationSpec(spec, artifacts)` executor (deterministic checks + vision dispatch).
- `src/trigger/blocks/crewBlocks.ts` — `director_brief`, `dp_brief`, `editor_brief`, `composer_brief`, `critic_spec` blocks.

**Changed**
- `src/agents/mastra.ts` — add crew `AgentRole`s + instructions.
- `convex/schema.ts` — `identity.creativeBrief`.
- `src/engine/designer.ts` + `families.ts` — add active-crew blocks per family.
- `src/engine/moduleCatalog.ts` — catalog entries for the crew blocks (Advanced editor).
- `src/trigger/designChannel.ts` — call `synthShowBible`, persist brief.
- `src/lib/channelArt.ts` — DP art-direction + Critic loop, premium generator.
- `src/trigger/blocks/{narratedBlocks,lofiBlocks,intelligenceBlocks}.ts` — downstream
  blocks consume their `videoBrief` slice; `qa_visual`/`qa_refine` execute the spec.

---

## 9. Phasing

- **P0 Foundation:** data model + crew roles/instructions + `creative/types.ts` + `crew.ts` skeleton. No behavior change yet.
- **P1 Show Bible:** `synthShowBible` at creation incl. what-works/what-doesn't from competitor data; persist; surface in channel UI.
- **P2 Per-video crew blocks:** the five brief blocks + downstream consumption (music prompt, structure, footage, cuts). Biggest creative payoff.
- **P3 Custom validation:** `critic_spec` + `runValidationSpec` executor; convert `qa_visual`/`qa_refine` to spec-driven.
- **P4 Killer avatar:** DP art-direction + Critic loop.
- **P5 Mastra deepening:** per-agent tracing dashboards; optional agent tools (DP runs footage search, Critic reads frames).

Each phase ships independently and degrades gracefully (no Bible → current behavior).

---

## IMPLEMENTED (2026-06-05)

All phases P0–P5 shipped.

- **P0** `src/engine/creative/types.ts` (ShowBible/VideoBrief/ValidationSpec/CREW_ROLES); `src/agents/mastra.ts` extended to 8 named agents (producer, director, showrunner, crew_director, cinematographer, editor, composer, critic) via a ROLE_CONFIG table (Gemini for generation, Claude for showrunner + the strategist director); `agentJson` REST fallback routes by each role's provider. `convex/schema.ts` + `convex/channels.ts` identity.creativeBrief.
- **P1** `src/engine/creative/showBible.ts` `synthShowBible` (Showrunner, grounded in competitor signals; family-aware activeCrew). Persisted in `designChannel.ts` (auto-SEO → Bible → art ordering).
- **P2** `src/engine/creative/crew.ts` (briefDirector/Cinematographer/Editor/Composer/Critic) + `src/trigger/blocks/crewBlocks.ts` (5 individually-addable blocks). Designer inserts the family crew after topic_select (`FAMILY_CREW` + `CREW_ROLE_BLOCK` in families.ts). Downstream wired: music prompt, stock_footage queries, keyframe/scene styleGrammar, script structure (hook+beats), narration voiceFx. Catalog + labels updated; wizard preview mirrors.
- **P3** `src/engine/creative/validate.ts` `runValidationSpec` (deterministic metrics + vision judge; unmeasurable = skipped, never a silent block). `qa_visual` executes the Critic's spec (durationSec/captionCoveragePct/overlapSec metrics + gemini-vision judge on sampled frames).
- **P4** `src/lib/channelArt.ts` rewritten: DP-art-directed avatar around the iconic motif → fal FLUX1.1 [pro] → Critic loop (downscale to 48px → vision-judge recognizability/contrast/vibe → regenerate, max 3).
- **P5** Crew agents are real Mastra agents → auto-traced in Langfuse. `src/trigger/refreshShowBible.ts` backfills existing channels (Bible + crew pipeline + avatar). Show Bible surfaced in the channel Identity tab.

Degrade-safe throughout: no Bible / no key → empty-but-shaped briefs and current behavior.
