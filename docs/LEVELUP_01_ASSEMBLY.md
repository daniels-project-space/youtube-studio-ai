# Level-up 01 — Assembly (→ golden)

Bar: "level-up THEN golden". This is the design spec; implement only after green-light.

## As-is (the god-block)
`timeline_assemble` — `src/trigger/blocks/narratedBlocks.ts:1185–1453` (269 LOC). Fuses ~6 responsibilities:
1. footage⇄entity interleave (the edit decision)
2. pre-render length gate (`minSeconds`/`maxSeconds` + TOL)
3. surgical-heal routing (re-finish from `pre_overlay.mp4` vs full rebuild)
4. body cut — `assembleBeatBody` (beat-aligned) **or** `assembleStructuredBody` (chapter mode) + renders chapter cards
5. music bed download + duck + `composeWithIntro`
6. outro card render + `patchSegment` crossfade, then `finishFromComposed` (captions/quotes/inserts finishing)

### Why it violates the rubric
- **Glue / unsound DAG**: declares `consumes:[footageClips, entityClips, narrationLocalPath, narrationDurationSec, introCardPath, musicUrl]` (6) but reads 9+ undeclared `ctx.store` keys: `introSec, sentenceTimings, cutSheet, chapterPlan, channelAvatarKey, script, channelName, musicKey, healHints`. ~10 ad-hoc `params`.
- **Fail-proofing**: silent graceful-degrades (chapter card fail → footage; outro fail → plain tail) are logged only, not contractual. Heal routing is a regex on `healHints` (`/overlay|caption|quote|insert|.../`). No schema validation at the boundary.
- **Not standalone**: edit decisions + rendering + finishing + heal are entangled; can't unit-test without the full `ctx`/Trigger/Convex stack.
- **Duplication**: `lofiBlocks.ts` has its own assembly path (`composeMusicLoopDeblur` etc.) — parallel logic, no shared model.

The `src/lib/ffmpeg.ts` primitives it calls (`assembleBeatBody`, `assembleStructuredBody`, `composeWithIntro`, `patchSegment`, `masterAudio`, `concatScaled`, `finishFromComposed`) are already mostly pure "hands" — they are fine to keep.

## Target — split BRAIN (EDL) from HANDS (renderer)
The core move: assembly stops being imperative and becomes **a declarative Timeline (EDL) + a pure renderer**.

### 1. `Timeline` (typed EDL) — the data contract
```
Timeline = {
  format: { w, h, fps }                      // from ChannelProfile (16:9 / 9:16)
  segments: Segment[]                        // ordered body: {kind:'footage'|'entity'|'card', src, inSec, durSec, heading?}
  audio: { narrationSrc, musicSrc, duck: { introVol, bodyVol, rampSec } }
  overlays: Overlay[]                        // {kind:'caption'|'quote'|'insert', src, startSec, endSec}
  intro?: { cardSrc, durSec }
  outro?: { title, subtitle, durSec, bgSrc }
  lengthBand: { minSec, maxSec }
  checkpoints: { preOverlaySec }             // declared heal point — no regex
}
```
Validated by zod. A Timeline is pure data → unit-testable, hashable, loggable.

### 2. `planTimeline(inputs, profile) -> Timeline` — the intelligence (pure)
Absorbs interleave, cut cadence (`cutSheet`), chapter placement (`chapterPlan`), intro/outro, length projection. **All per-account behavior (pacing, aspect, intro/outro style, duck levels) comes from the `ChannelProfile` argument** — zero hardcoded channel defaults (kills the "Master your mind."/stoic-bust leaks). Deterministic: same inputs+profile → same Timeline.

### 3. `renderTimeline(Timeline) -> { videoKey, durationSec, receipt }` — pure renderer (hands)
Thin orchestration over the existing ffmpeg primitives. Contract:
- **Validate the EDL before spending compute**: length band, footage coverage ≥ body, no-black guard, every overlay window inside duration. (The pre-render length gate becomes EDL validation.)
- **Idempotent**: cache key = content-hash(Timeline). Re-run returns the same `videoKey`.
- **Heal = re-render from `checkpoints.preOverlaySec`** (a declared point), not a regex on hints. Overlay-class defects → finish-only; body defects → full.
- **No silent skips**: a dropped card/overlay is a typed `receipt.warnings[]` the verify stage can gate on, not a swallowed log line.

## Rubric fit
1 job ✓ (plan ‖ render, each single-purpose) · typed contract ✓ (Timeline zod, receipt out) · self-describing ✓ · per-account ✓ (ChannelProfile → Timeline) · fail-proof ✓ (validate + idempotent + loud + typed warnings) · less glue ✓ (Timeline replaces 9 implicit store reads; one model for narrated AND lofi) · standalone ✓ (Timeline is data → test without Trigger/Convex).

## Mastra-later (free, once split)
- Tool `assemble_timeline(Timeline) -> receipt` — heavy render runs as a Trigger `triggerAndWait` durable task; `planTimeline` is a deterministic step the Pipeline Architect composes. No rework.

## Implementation steps (one at a time, behavior-preserving)
1. Define `Timeline` + `Segment`/`Overlay`/`Receipt` zod schemas (`src/lib/assembly/timeline.ts`).
2. Extract `planTimeline()` (pure) from the god-block's decision logic; add a unit test (sample inputs → expected EDL).
3. Wrap existing ffmpeg fns in `renderTimeline()` + the EDL validator + content-hash idempotency.
4. Make `timeline_assemble` a thin adapter: `planTimeline → renderTimeline`. Prove **parity** on one real narrated run + one lofi run (same output length/structure).
5. Fold `lofiBlocks` assembly onto the same `renderTimeline`. Delete the duplicate path.
6. Promote `assemble` → golden with a proof (EDL + rendered clip).
```
```
