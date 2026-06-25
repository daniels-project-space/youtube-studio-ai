# Research — Advanced, Intelligent Editor Module

**Date:** 2026-06-25 · **Scope:** make `src/lib/crew/editor.ts` + `src/lib/assembly/*` far smarter, grounded in real auto-editing repos. Implementation-ready.

---

## NOW

**Editor (`src/lib/crew/editor.ts`)** — deterministic, shallow:
- Knobs: `cadence` (enum → ONE global cuts/min via `CADENCE_CPM`), `transitions`, `captionStyle`, `overlayDensity`.
- `resolveEditorConfig` → `EditorConfig` → `editorDirectives()` → `EditorDirectives { transitions, cutsPerMin, captionStyle, overlayDensity }`.

**Creative brief (`src/engine/creative/crew.ts` `briefEditor` → `CutSheet`)** — RICHER than what's consumed:
- `CutSheet { sections: {name,cutsPerMin}[]; transitions; captionStyle; overlayRule }` (`types.ts:208`). LLM is told to calibrate cutsPerMin (documentary 2-5, standard 8, hype 15).
- **PER-SECTION cadence already produced.**

**Assembly (`src/lib/assembly/`)** — collapses it:
- `planTimeline.ts` `bodySegSeconds(narrationSec, cutSheet)` **averages** all `sections[].cutsPerMin` → ONE `seg` seconds. Per-section cadence is thrown away.
- `Timeline` (`timeline.ts`) = `{ segments: Segment[], audio:{introSec,bodySec,tailSec,targetLufs?}, overlays: Overlay[], checkpoints:{preOverlaySec?} }`. `Segment = { kind:"footage"|"entity"|card, src, durSec, onBeat }`.
- `layClips()` lays clips **end-to-end** at uniform `seg` sec, cycling the pool. No shot-awareness, no J/L, no per-section pacing.
- `input.sentenceTimings[].end` already exists and "drives onBeat hinting; the renderer cuts on these" — a ready hook for beat/energy snapping.
- `transitions` is a GLOBAL render hint applied only **title→body** (`renderTimeline`/`ffmpegBackend`: `hardcut`=cut, `crossfade`=xfade 0.8s, `dip_to_black`). Not per-cut.
- `captionStyle` consumed in `ffmpegBackend.applyOverlays` (`none` suppresses burn). `overlayDensity` caps quote/insert overlays (`capOverlays`).

**The gap:** brief carries a pacing curve + transition language; Assembly flattens to one cadence + one transition + end-to-end clips. No beat sync, no silence trim, no shot snapping, no J/L cuts.

---

## REFERENCE REPOS

| Repo | URL | Technique | Copy-what |
|---|---|---|---|
| wyattblue/auto-editor | https://github.com/WyattBlue/auto-editor · v3 fmt https://auto-editor.com/docs/v3 · v1 https://auto-editor.com/docs/v1 | Audio-loudness/motion first-pass → boolean `hasLoud[]` → `--margin` pad → `chunks (start,end,speed)` → **v3 nonlinear timeline JSON** (clips: `src,start,dur,offset,speed,stream,volume`) | The v3 clip schema is almost exactly our `Segment`. Adopt `offset` (in-point) + `speed` + a **margin** pad model. Silence/filler trim via audio threshold 0.04, motion 0.02. |
| Antiarin/beatsync-engine | https://github.com/Antiarin/beatsync-engine | `Config→AudioAnalysis→CutPlan→ClipAssignment→Render`. librosa BPM (half/double clamp) + beat grid; `cut_frequency` prob a beat→cut; `min_segment_ms` floor; 808 sub-bass onset "snap" cuts; per-mode presets (strobe/drill/float/cascade/epic); silence-gap = hold current clip | **The whole CutPlan dataclass model** + the 6 mode presets map 1:1 onto our editor presets. `cut_frequency`, `min_segment_ms`, `max_consecutive_same_source` are knobs we lack. Beat-grid→cut-point planner. |
| Breakthrough/PySceneDetect | https://github.com/Breakthrough/PySceneDetect · API https://www.scenedetect.com/docs/latest/api.html | `ContentDetector` (HSV diff, threshold 27) / `AdaptiveDetector` (rolling avg → robust to camera motion) → `get_cut_list()` FrameTimecodes + `get_scene_list()` (start,end) pairs | **Shot-boundary list** to SNAP our cut points to real shots (never cut mid-motion). `AdaptiveDetector` avoids false cuts on pans. Precompute per source clip → `shotBoundaries[]`. |
| AcademySoftwareFoundation/OpenTimelineIO | https://github.com/AcademySoftwareFoundation/OpenTimelineIO · arch https://opentimelineio.readthedocs.io/en/latest/tutorials/architecture.html | Industry EDL model: `Timeline→Stack→Track→[Clip,Gap,Transition]`; Clip has `source_range`(in/out) + `media_reference`; `Transition{in_offset,out_offset,transition_type}` overlaps two adjacent items | Model **Transition as a between-clip object with in/out offsets** (= J/L + crossfade in ONE primitive). Gap = explicit silence. Optional `--export otio` for interop/debugging. |
| diffusionstudio/core | https://github.com/diffusionstudio/core | TS/WebCodecs NLE engine: declarative timeline, `subclip(in,out)`, `offsetBy`, silence removal, transitions, audio ramps, keyframing | Confirms our TS-native direction. `subclip`/`offsetBy` = the in-point+trim API our `Segment` should grow. Audio ramps = J/L building block. |
| AEON-7/aeon-music-video | https://github.com/AEON-7/aeon-music-video | librosa beat/onset/RMS → ffmpeg `sendcmd` filter automation (flash on kick, zoom on RMS, hue on centroid) | **Energy curve (RMS) → time-varying pacing & punch-in**, not just beats. ffmpeg `sendcmd` pattern for beat-synced effects without re-encode tricks. |
| arXiv 2506.18881 "Let Your Video Listen to Your Music" | https://arxiv.org/html/2506.18881v1 | Beat times (librosa spectral-flux) ↔ video **motion-energy peaks**; shift keyframes to align salient motion to beats | The principle: snap cuts to where **beat AND motion peak coincide**. Motion-energy = frame-diff curve (we can reuse PySceneDetect scores). |

---

## ADVANCED CAPABILITIES (prioritized)

For each: capability → **editor output** (new cutSheet/EDL field) → **Assembly wiring** → effort.

### P1 — Pacing curve (per-section / time-varying cadence) — LOWEST EFFORT, HIGHEST PAYOFF
- **Why first:** `CutSheet.sections[].cutsPerMin` already exists and is already averaged-away. Just stop averaging.
- **Editor output:** pass `cutSheet.sections` through unchanged + add `EditorDirectives.pacingCurve?: { atFrac: number; cutsPerMin: number }[]` (normalized 0–1 timeline position → cadence). Editor presets emit curves (hype: 15→18 climb; documentary: flat 3; shorts: 16 front-loaded).
- **Assembly wiring:** replace scalar `bodySegSeconds` with `segSecondsAt(posFrac)` in `layClips()` — interpolate cadence along the body; each clip's `durSec = 60 / cpmAt(filled/target)`. Map section boundaries to fractional body offsets (use `chapterPlan` durations or even split).
- **Effort:** S (1 fn + `layClips` loop change). No new deps.

### P2 — Hook/retention pacing (front-load fast cuts)
- **Editor output:** `EditorDirectives.hookSec?: number` + `hookCutsPerMin` (e.g. first 8s @ 16cpm). Special-case of pacing curve.
- **Assembly wiring:** seed the pacing curve so `posFrac < hookSec/bodySec` uses `hookCutsPerMin`. Front segments get shorter `durSec`.
- **Effort:** XS once P1 lands (it's a curve preset).

### P3 — Silence / filler trim (auto-editor)
- **Editor output:** `EditorDirectives.trim?: { audioThreshold:number; marginSec:[number,number]; minClipSec:number }`.
- **Assembly wiring:** new pre-plan pass `detectLoud(audioPath)` → `hasLoud[]` → margin-pad → `loudRanges`. For NARRATED bodies this trims dead air; produces per-clip `offset`+`durSec` from loud ranges instead of fixed segs. Requires adding `Segment.offset` (in-point) + `speed` (auto-editor's model). Shell out to `auto-editor file --export timeline:api=3` and ingest the v3 JSON directly (their clip schema ≈ our Segment).
- **Effort:** M (new analysis pass + `Segment.offset/speed` fields + ingest). Biggest win for talking-head/VO footage.

### P4 — Beat / energy-synced cuts (librosa)
- **Editor output:** `EditorDirectives.beatSync?: { mode:"beat_grid"|"hybrid"; cutFrequency:number; minSegmentMs:number; bassSnap?:boolean }` (beatsync-engine knobs).
- **Assembly wiring:** new `analyzeMusic(audioPath)` → `{ bpm, beats:number[], onsets:number[], rms:number[] }` (librosa microservice or `librosa` via py-shell). In `layClips`, snap clip boundaries to nearest beat ≥ `minSegmentMs`; `cutFrequency` decides which beats fire. Reuse existing `onBeat` flag on `Segment` + `sentenceTimings` plumbing. Energy (RMS) curve can FEED the P1 pacing curve automatically.
- **Effort:** M–L (needs librosa sidecar; beats array → snap logic). Best for lofi/hype/music-bed channels.

### P5 — Shot-aware cut points (PySceneDetect — never cut mid-motion)
- **Editor output:** none from editor; this is a SOURCE-FOOTAGE property. Add `PlanInput.shotBoundaries?: Record<src, number[]>` (sec).
- **Assembly wiring:** precompute per footage clip via `scenedetect AdaptiveDetector` → cache `shotBoundaries`. In `layClips`, when choosing a cut point, **snap to nearest shot boundary within tolerance**; otherwise keep cadence target. Prevents mid-pan cuts.
- **Effort:** M (scenedetect sidecar + cache + snap-with-tolerance). Combine with P4 (snap to beat∩shot, per arXiv 2506.18881).

### P6 — J/L cuts (audio leads / video tails — the pro tell)
- **Editor output:** `EditorDirectives.jlCuts?: { audioLeadSec:number; videoTailSec:number; prob:number }` (apply on a fraction of cuts).
- **Assembly wiring:** model as OTIO-style transition: extend the OUTGOING clip's audio past the visual cut (`videoTail`) and start NEXT clip's audio before its video (`audioLead`). Requires `Timeline` to allow audio/video offset per segment — add `Segment.audioLeadSec?`/`audioTailSec?` and have `ffmpegBackend.buildBody` offset the audio sub-stream (or split into a 2-track compose). Easiest with the audio-ramp pattern Diffusion Studio uses.
- **Effort:** L (touches the body-render audio path; currently single-stream). Highest polish, do last.

---

## RECOMMENDED next-level Editor design

### Richer editor surface (`editor.ts`)
Replace the single `cadence` enum with a **pacing-aware** surface (keep enums as presets that *emit* the structured fields, for backward-compat):
- `pacing`: enum preset → emits a `pacingCurve` (`{atFrac,cutsPerMin}[]`) + `hookSec`/`hookCutsPerMin`.
- `beatSync`: `off | beat_grid | hybrid` (+ `cutFrequency`, `minSegmentMs`, `bassSnap`).
- `trim`: `off | light | aggressive` → `{audioThreshold, marginSec, minClipSec}`.
- `shotSnap`: `off | on` (+ toleranceSec).
- `jlCuts`: `off | subtle | strong` → `{audioLeadSec, videoTailSec, prob}`.
- keep `transitions` but allow a **per-section** override list.

### CutSheet / EDL fields (extend `types.ts` `CutSheet` + `EditorDirectives`)
```ts
EditorDirectives {
  transitions; captionStyle; overlayDensity;          // existing
  cutsPerMin?;                                         // existing (becomes fallback)
  pacingCurve?: { atFrac: number; cutsPerMin: number }[];
  hookSec?: number; hookCutsPerMin?: number;
  beatSync?: { mode: "beat_grid"|"hybrid"; cutFrequency: number; minSegmentMs: number; bassSnap?: boolean };
  trim?: { audioThreshold: number; marginSec: [number, number]; minClipSec: number };
  shotSnap?: { enabled: boolean; toleranceSec: number };
  jlCuts?: { audioLeadSec: number; videoTailSec: number; prob: number };
}
```
Adopt auto-editor's clip model on `Segment`: add **`offset`** (source in-point) and **`speed`** so trim/retime are expressible (today segments are in-point-0, speed-1 only).

### planTimeline / renderTimeline changes
1. **`bodySegSeconds` → `segSecondsAt(posFrac, directives)`** — interpolate `pacingCurve` (fallback to scalar `cutsPerMin`, then legacy). Drives P1/P2.
2. **`layClips`**: walk body by accumulated time; at each boundary compute target `durSec` from `segSecondsAt`, then **snap** to (a) nearest beat (P4) and/or (b) nearest shot boundary (P5) within tolerance, respecting `minSegmentMs`. Set `Segment.onBeat`.
3. **New analysis sidecars** (Python, behind a thin `AudioAnalysis`/`ShotAnalysis` interface, cached by content hash like segments): `analyzeMusic` (librosa beats/onsets/rms), `detectLoud` (auto-editor or own threshold), `detectShots` (scenedetect). Keep `planTimeline` PURE — pass results in via `PlanInput` (mirrors current `sentenceTimings`/`overlays` injection).
4. **Trim pass** (P3): pre-`layClips`, convert `loudRanges` → segments with `offset`/`durSec`/`speed`.
5. **`RenderBackend.buildBody`**: honor per-segment `offset`/`speed`; add J/L by offsetting the audio sub-stream per `Segment.audioLeadSec/audioTailSec` (P6). Optional `--export otio` debug dump using the OTIO Transition(in_offset/out_offset) model.
6. **Per-section transitions**: let `transitions` be `string | {atFrac,style}[]`; `composeWithIntro`/body joins pick style per boundary.

### What OpusClip/Submagic/Vizard/Captions.ai/Descript actually do (worth copying)
- **Transcript-first editing (Descript/Submagic):** the transcript IS the timeline — delete a sentence → cut auto-propagates. We already have `sentenceTimings`; expose a transcript→cut map so the editor (or a human) edits text, not a timeline.
- **Filler/silence removal as default first pass (Submagic AutoCut, Descript):** matches P3. Always run before pacing.
- **Highlight/hook detection (OpusClip, Vizard Magic Clips):** "big-data" scoring of moments → reorder to lead with the hook + strong CTA. For us = a retention-scoring pass feeding `hookSec` + segment ordering (LLM scores transcript spans).
- **Dynamic word-level captions + keyword highlight + emoji/SFX triggers (Submagic 99%, Opus 97%):** upgrade `captionStyle` from look-only to **word-level karaoke + keyword emphasis** in the overlay pass.
- **Auto B-roll on a density SLIDER (Submagic/Vizard):** our `overlayDensity` enum → a continuous slider; insert contextual B-roll/inserts driven by transcript keywords (already have `overlayRule`).
- **Auto-reframe / subject-track (OpusClip relayout):** we already have a `reframe` hint (`center|subject_track`) — wire subject tracking.
- **Takeaway:** the winning pattern is **transcript → highlight-score → silence-trim → pacing/beat cuts → dynamic captions → contextual B-roll → reframe**, all auto with knobs. We have the skeleton (CutSheet, overlays, reframe, sentenceTimings); P1–P6 fill the intelligence gaps.

### Suggested build order
P1 (pacing curve, S) → P2 (hook, XS) → P3 (trim, M) → P4 (beat-sync, M-L) → P5 (shot-snap, M) → P6 (J/L, L). P1+P2 ship value with zero new deps by un-averaging data the brief already produces.
