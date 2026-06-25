# Adversarial Audit — Assembly / Crew / Engine NEW modules

Scope: `src/lib/assembly/{timeline,planTimeline,renderTimeline,ffmpegBackend,overlays,module}.ts`,
`src/engine/{customization,moduleRegistry,channelProfile}.ts`, `src/lib/crew/{roles,crewProfile,module,editor}.ts`.
Baseline: 8/8 tsx tests pass, tsc clean. This audit finds what the happy-path tests MISS, what is
declared-but-DEAD, and what is not wired end-to-end. All findings reproduced with `./node_modules/.bin/tsx`.
Probe scripts: `/tmp/probe_assembly.ts`, `/tmp/probe_hash.ts` (read-only on src).

---

## 0. EXECUTIVE VERDICT

The whole Assembly+Crew+engine stack is **CORRECT IN ISOLATION but DEAD IN PROD.** The live narrated
pipeline (`src/trigger/blocks/narratedBlocks.ts`, the 1185-line `timeline_assemble` god-block) does **not
import a single symbol** from `src/lib/assembly` or `src/lib/crew`. The new modules are a parallel, fully
unused path exercised only by `scripts/assembly-smoke*.ts` and the `__tests__`. This is the exact "carried-
but-not-applied" failure the task warns about, at the module-graph level — not just at the knob level.

Two real correctness bugs hide under the green tests:
- **`hashTimeline` is non-deterministic across serialization** → idempotency/cache guarantee is false the
  moment a Timeline is stored and reloaded (Convex/R2). (§1, §2)
- **`planTimeline` has no input-number guard** → `narrationDurationSec = Infinity` (or any huge value)
  OOM-crashes the process via an unbounded `fillBody` loop. (§1)

And two headline capabilities the module ADVERTISES are not applied end-to-end:
- **`audio.targetLufs` (LUFS loudness normalize)** — `composeWithIntro` has no `targetLufs`/`loudnorm`
  arg; `ffmpegBackend.composeIntro` never passes it. CARRIED-BUT-NOT-APPLIED. (§2)
- **`renderHints.captionStyle`** and **editor `overlayDensity`** — produced, validated, carried; never read
  by any renderer. DEAD. (§2)

---

## 1. EDGE-CASE / ADVERSARIAL findings

### CRASHES (real)

| Case | Result | Cause | Guarded? |
|------|--------|-------|----------|
| `narrationDurationSec = Infinity` | **OOM, process SIGABRT** | `fillBody` loops `while (filled+0.001 < target)` with `target=Infinity`; `dur=min(seg, Infinity)=seg`, never terminates, allocates segments until heap death. `planTimeline.ts:173`. No upstream guard. | **NO** |
| `narrationDurationSec = 1e7` | OOM (same loop, ~1e6 segments) | same | **NO** |
| `narrationDurationSec` negative | throws ZodError `audio.bodySec >= 0` | `TimelineSchema.parse` at `planTimeline.ts:249` | Loud (thrown, not returned) |
| `narrationDurationSec = NaN` | throws ZodError `bodySec` + `checkpoints.preOverlaySec` invalid_type | same | Loud (thrown) |

The negative/NaN cases "fail loud" but via a raw thrown `ZodError`, not the module's own
`{ok,errors}` contract — callers expecting `validateTimeline`-style soft errors get an exception. The
Infinity/huge case is a **hard DoS**: a single bad `narrationDurationSec` (e.g. a mis-probed audio
duration) kills the render worker before `validateTimeline` ever runs. `validateTimeline`'s length-band
would have caught the *length*, but `planTimeline` builds the segment array BEFORE any validation.

### SAFELY GUARDED (verified OK)

- `0 footage clips` → builds 7 body segments **with empty `src:""`** (see hole below), proj=63s, no throw.
- `narration = 0` → 2 segments (intro? no — outro card + ...), proj=3s, OK.
- `narration > 600` → per-clip 25s cadence applied (parity), OK.
- `intro card present but introSec=0` (`introStyle:'none'`) → intro card collapsed, 8 segs, OK.
- `chapterPlan = []` → falls through to beat body, OK.
- `chapterPlan` single card only → 2 segs (card + outro), no footage — OK but thin.
- editor `cutsPerMin` = 0 / negative / NaN → all fall back to legacy 10s cadence. `0 ?? x` keeps `0`
  (`planTimeline.ts:195`), but then `cpm ? {sections…} : undefined` (`:198`) treats `0` as falsy →
  `undefined` → legacy. Negative/NaN survive `??`, become a section, then `bodySegSeconds`'s `c > 0`
  filter (`:90`) drops them → 10s. Net: safe (two different guards happen to cover it).
- `cutsPerMin = 1000` → `60/1000` rounded, clamped to `Math.max(4,...)` = 4s cuts. Clamped, OK.
- invalid `transitions`/`captionStyle` raw string → normalized to `hardcut` / dropped (TRANSITION_HINTS /
  CAPTION_STYLE_HINTS gate at `planTimeline.ts:269-271`). OK.
- `tailSec < 2` → outro card suppressed (`params.outroCard && tailSec >= 2`). OK.

### validateTimeline (verified)

- overlay endSec **exactly at runtime** → `ok=true` (boundary inclusive).
- overlay endSec = runtime **+0.5** → `ok=true` (the hardcoded `+0.5` slop at `timeline.ts:162`).
- overlay endSec = runtime **+0.6** → `ok=false` (correctly rejected).
- `startSec==endSec` → `ok=false` (`endSec <= startSec`). OK.
- NaN/negative `bodySec` injected raw → `ok=false` (zod). OK.
- `0 segments` → `ok=false` (`min(1)`). OK.

### HOLE: dead-air passes "no dead-air" validation
`0 footage clips` → `fillBody` emits 7 segments with `src:""` (`clips.length ? ... : ""` at
`planTimeline.ts:175`). `validateTimeline` coverage check sums `durSec` only (`timeline.ts:166-167`), so
empty-source clips "cover" the body and validation passes. The render backend then resolves `""` →
fetch/ffmpeg garbage or dead-air, NOT a loud abort. The module's "never render a dead-air video" promise
has a gap: **coverage by duration ≠ coverage by real media.**

### hashTimeline determinism (CRITICAL)
- Same in-memory plan twice → **equal** (good).
- Salt changes hash → yes (good).
- **`hashTimeline(plan)` ≠ `hashTimeline(JSON.parse(JSON.stringify(plan)))`** → `f40f94a7…` vs `d2917e67…`.
  Root cause confirmed: `planTimeline` emits keys with `undefined` values (`segments[N].bgSrc` when no
  `cardBgSrc`; `audio.targetLufs` when unset). `canonical()` (`renderTimeline.ts:78-83`) iterates
  `Object.keys` and emits `"bgSrc":undefined`-ish entries for them; a JSON round-trip DROPS those keys, so
  the reloaded object hashes differently. **Impact:** any flow that persists a Timeline (Convex doc / R2
  json) and reloads it before render gets a **different content-address → cache miss → double render / no
  heal reuse.** The "idempotent, content-addressed" headline guarantee is false across the serialization
  boundary the real pipeline will use. One-line fix: skip `undefined` values in `canonical`.

---

## 2. WIRING REALITY (WIRED / CARRIED / DEAD)

Evidence: `grep -rn 'lib/assembly|lib/crew|resolveAssembleParams|buildChannelProfile|renderTimeline'
src scripts` → only `scripts/assembly-smoke*.ts`, `__tests__`, `moduleRegistry.ts`, and prose strings in
`golden.ts`. `narratedBlocks.ts` imports `@/lib/assemblyai` (captions, unrelated), NOT `@/lib/assembly`.

| Thing | Verdict | Evidence |
|-------|---------|----------|
| Assembly module (planTimeline/renderTimeline/ffmpegBackend) called by live `timeline_assemble`? | **DEAD in prod** (parallel unused module) | `narratedBlocks.ts:1185` `id:"timeline_assemble"` runs its OWN inline `bodySegSeconds` (`:108`), `assembleBeatBody`/`assembleStructuredBody`/`composeWithIntro`/`finishFromComposed` (`:1357,1346,1388,1463`). Zero import of `@/lib/assembly`. New module imported only by `scripts/assembly-smoke.ts:22-25` + tests. |
| `buildChannelProfile(channel.moduleConfig)` in the live run? | **DEAD in prod** | Only callers: `config.test.ts`, `crew.test.ts`, `editor.test.ts`, `__fetch`/smoke. No `src/**` (non-test) caller. The whole `ChannelProfile → resolveX → plan` chain is unused by prod; the live block still reads `ctx.store`. |
| editor `captionStyle` → renderHints → applied at render? | **CARRIED-BUT-NOT-APPLIED** | `planTimeline.ts:271` writes `renderHints.captionStyle`; `editor.test.ts:47` asserts it lands. But `ffmpegBackend.applyOverlays` (`:214`) calls `overlaysToCuesAndSpecs` (no style param) → `writeCaptionsAss(cues, tmp, {width,height})` with a FIXED style (`ffmpeg.ts:1303,1317` hardcoded `DejaVu Sans`, fixed colours, no karaoke `\k`). `karaoke`/`bold`/`minimal` produce identical caption output. |
| editor `overlayDensity` consumed anywhere? | **DEAD** | grep `overlayDensity` → only `editor.ts` (declared in surface, presets, EditorConfig, returns string). NOT in `EditorDirectives` (`editor.ts:72-80` omits it), never read by planTimeline or any renderer. |
| Assembly `targetLufs` → loudness-normalize? | **CARRIED-BUT-NOT-APPLIED** | Knob (`module.ts:26`, -23..-12 def -14) → `resolveAssembleParams.ts:147` → `audio.targetLufs` (`planTimeline.ts:261`). But `composeWithIntro` (`ffmpeg.ts:593`) arg block has NO `targetLufs`/`loudnorm`; `ffmpegBackend.composeIntro` (`:167-203`) never passes it. `loudnorm` exists only in a SEPARATE helper (`ffmpeg.ts:952`), not on the compose path. Video ships at uncontrolled loudness. Capability card claims "LUFS loudness normalize" (`module.ts:16`). |
| renderHints `transitions`: crossfade vs dip_to_black | **Identical** (collapsed) | `crossfadeSecFromHints` (`renderTimeline.ts:98-101`): both `crossfade` and `dip_to_black` → `0.8`. No dip-to-black (fade-through-black) treatment exists; a dip looks the same as a crossfade. `crossfadeSec` IS plumbed to `composeWithIntro` (`ffmpeg.ts:610` accepts it) so crossfade-vs-hardcut is real; dip-vs-crossfade is not. |
| reframe `subject_track` vs `center` | **Identical** (both center-crop) | `ffmpegBackend.reframe` (`:263-280`) calls `makeVerticalClip` (center-crop) for both; `subject_track` only appends a "not yet implemented" warning. Honestly flagged, but functionally the knob has 1 real value. |
| captions toggle OFF honored at RENDER end-to-end? | **WIRED** (via plan) | `planTimeline.ts:264` drops caption overlays when `params.captions===false`; by render time there are none to burn. `config.test.ts:55` proves plan side. End-to-end holds because render only burns what the plan carries. |
| MODULE_REGISTRY entries read by anything but golden + tests? | **DEAD (no UI)** | Readers: `moduleRegistry.ts` self, `golden.ts` prose strings (`:608,617,817`), `config.test.ts`. The advertised "onboarding + settings UI renders toggles" consumer DOES NOT EXIST — there is no `app/` dir (`grep app` → "No such file or directory"). `configurableModules()` has no real caller. |

**Net:** the modules are internally consistent and the *intra-module* wires the tests assert (editor→plan
renderHints) are real — but the *inter-module* and *module→ffmpeg* wires that deliver value (profile→prod,
hint→pixels) are absent. `captionStyle`, `overlayDensity`, `targetLufs`, `dip_to_black`, `subject_track`
all stop at the data layer.

---

## 3. CUSTOMIZATION GAPS / IMPROVEMENTS (prioritized)

P0 — correctness/safety:
1. **Guard `planTimeline` inputs before the fill loop.** Reject non-finite / negative
   `narrationDurationSec` and clamp/cap segment count (e.g. `if (!Number.isFinite(n)||n<0) throw`; cap
   `fillBody` iterations). Prevents the OOM DoS. (`planTimeline.ts:188`, `fillBody:173`)
2. **Make `canonical()` skip `undefined` values** (and prefer omitting absent optionals in `planTimeline`)
   so `hashTimeline` survives a JSON round-trip. Restores the idempotency guarantee. (`renderTimeline.ts:78`)
3. **Close the dead-air hole**: in `planTimeline`/`validateTimeline`, error when body coverage is composed
   of empty-`src` segments (0 footage + no chapter cards). (`planTimeline.ts:175`, `timeline.ts:166`)

P1 — finish the advertised knobs:
4. **Apply `targetLufs`**: add `targetLufs?` to `composeWithIntro` (or a final `loudnorm` pass in
   `ffmpegBackend`) and pass `t.audio.targetLufs`. Without it the "LUFS normalize" capability is a lie.
5. **Apply `captionStyle`**: thread it through `overlaysToCuesAndSpecs` → `writeCaptionsAss` to vary
   font/colour/`\k` karaoke. Today all 4 styles render identically.
6. **Differentiate `dip_to_black`** from `crossfade` (fade-through-black transition), or drop the enum value.
7. **Wire `overlayDensity`** into overlay selection (cap/scale quote/insert count) or remove it from the
   surface — currently pure dead config.

P2 — real wiring (the whole point):
8. **Actually adopt the module in `narratedBlocks.ts`** (or behind a flag): build a `ChannelProfile`,
   `resolveAssembleParams`+`resolveEditorConfig`→`editorDirectives`→`planTimeline`→`renderTimeline(... ,
   createFfmpegBackend())`. Until then every knob/preset is unreachable in prod.
9. **`aspect:'1:1'`** is offered by the surface (`module.ts:20`) but silently downgraded to `16:9` by
   `resolveAssembleParams` (`:136` only checks `9:16`) and `AssembleParams.aspect` is typed `16:9|9:16`.
   Either support 1:1 (Timeline.reframe already allows it) or remove it from the knob values.
10. Legacy `creative/crew.ts` (the live LLM crew) still emits cutSheet JSON and does NOT use
    `resolveEditorConfig`/`editorDirectives` — the "dead loop closed" claim is true only in tests.

---

## 4. MISSING RIGOROUS TESTS (per module)

planTimeline / timeline:
- **`narrationDurationSec = Infinity / 1e9` must NOT OOM** (assert throws/clamps) — the missing test that
  would have caught the DoS.
- negative / NaN narration asserts a typed error path (not a raw ZodError leak).
- 0-footage + no chapters → assert validateTimeline FAILS (dead-air), once the hole is closed.
- overlay at exact runtime boundary and at `+0.5`/`+0.6` slop (lock the tolerance behavior).
- `cutsPerMin` extremes 0/negative/NaN/1000 → assert clamp to `[4,30]` and fallback semantics.
- `aspect:'1:1'` → assert intended behavior (support or explicit reject), not silent 16:9.

renderTimeline:
- **`hashTimeline` stability across `JSON.parse(JSON.stringify(plan))`** (serialization idempotency).
- assert `crossfadeSec` actually differs hardcut(0) vs crossfade(0.8) AND that dip_to_black ≠ crossfade
  (will fail today — documents the gap).
- reframe: assert `subject_track` is NOT center-identical (will fail today) OR assert the warning contract.
- `targetLufs` reaches the backend compose call (will fail today).

ffmpegBackend (integration, can be a fake-spy):
- assert `composeIntro` is called WITH a loudness target when `audio.targetLufs` set.
- assert `applyOverlays` receives/uses `captionStyle` (will fail today).
- empty-`src` body segment → assert a warning or abort, not silent.

crew / editor:
- `editorDirectives` carries `overlayDensity` (will fail — proves it's dead) OR delete the knob.
- crew with all roles off → 0 members + warning (have a near-miss in probe; add as a locked test).
- `resolveCrew`/`resolveEditorConfig`/`resolveAssembleParams` unknown-preset and out-of-range-knob all
  throw with a precise message (partly covered for assemble; add for crew/editor).

engine:
- `resolveKnobs` with a preset whose VALUE is invalid → fails loud (verified in probe; add locked test).
- `resolveKnobs` preset with an unknown knob key → error (verified; add locked test).
- `buildChannelProfile` is invoked by SOMETHING in `src/**` (integration-enforcer style assertion) — would
  immediately flag the prod-wiring gap.

---

## Repro
```
cd /home/ubuntu/youtube-studio-ai
./node_modules/.bin/tsx /tmp/probe_assembly.ts   # edge cases (Infinity case commented — it OOMs)
./node_modules/.bin/tsx /tmp/probe_hash.ts       # hash non-determinism + dead-air + segment counts
```
