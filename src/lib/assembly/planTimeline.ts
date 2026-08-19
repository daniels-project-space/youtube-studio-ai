/**
 * planTimeline — the Assembly "brain" (pure). Turns the raw inputs the old
 * `timeline_assemble` god-block read from `ctx.store` + a ChannelProfile into a
 * typed, inspectable Timeline. NO I/O, NO ffmpeg, NO orchestration — just edit
 * decisions. The math here replicates the god-block EXACTLY (parity target):
 * intro/body/tail length, `bodySegSeconds` cut cadence, footage⇄entity interleave,
 * chapter windows, intro/outro cards, music-duck levels.
 */
import { moduleParams, type ChannelProfile } from "@/engine/channelProfile";
import { resolveKnobs, type KnobValue } from "@/engine/customization";
import {
  validateQualifiedShotRender,
  type ShotRenderManifest,
} from "@/engine/renderArtifacts";
import { ASSEMBLY_SURFACE } from "./module";
import { TimelineSchema, type Timeline, type Segment, type Overlay } from "./timeline";

/** The raw decision inputs (mirrors what the god-block pulled from ctx.store). */
export interface PlanInput {
  footageClips: string[];
  /** Authored, one-to-one story clip mapping. When present it owns the body edit. */
  shotRenderManifest?: ShotRenderManifest;
  /** Required proof that every manifest clip cleared the per-shot grader. */
  shotQaReport?: unknown;
  /** Required proof that the manifest covers the full narration with no gaps. */
  visualCoverage?: unknown;
  entityClips?: string[];
  narrationSrc?: string;
  narrationDurationSec: number;
  musicSrc?: string;
  /** Intro title card source ("" / undefined ⇒ no intro card, introSec collapses to 0). */
  introCardSrc?: string;
  /** Sentence end-times (beats) — drives onBeat hinting; the renderer cuts on these. */
  sentenceTimings?: { end: number }[];
  cutSheet?: { sections?: { name?: string; cutsPerMin: number }[] };
  chapterPlan?: { kind: "footage" | "card"; durSec: number; heading?: string }[];
  closingLine?: string;
  channelName?: string;
  cardBgSrc?: string;
  /** Optional precomputed overlay windows (captions/quotes/inserts). */
  overlays?: Overlay[];
  /** Editor crew directives (the WIRE from the Editor sub-module): transitions + cadence + captionStyle + overlayDensity + a pacing CURVE + a retention hook + silence-trim thresholds. */
  editor?: {
    transitions?: string;
    cutsPerMin?: number;
    captionStyle?: string;
    overlayDensity?: string;
    pacingCurve?: { atFrac: number; cutsPerMin: number }[];
    /** Retention-hook window (P2): first `hookSec` absolute seconds of the body at `hookCutsPerMin`. */
    hookSec?: number;
    hookCutsPerMin?: number;
    trim?: { minSilenceSec: number; padSec: number };
  };
  /** Composer crew directives (the WIRE from the Composer sub-module): duck level + loudness + voiceFx. */
  composer?: { bodyMusicVol?: number; targetLufs?: number; voiceFx?: string };
  /** Measured silence intervals in the RAW narration (from the injected probe). Combined with editor.trim ⇒ the renderer carves these out. */
  silenceIntervals?: { startSec: number; endSec: number }[];
}

/** Per-account assemble params (resolved from a ChannelProfile or passed directly). */
export interface AssembleParams {
  aspect: "16:9" | "9:16" | "1:1";
  introSec: number;
  tailSec: number;
  fadeOutSec: number;
  audioFadeOutSec: number;
  minSeconds: number;
  maxSeconds: number;
  tolSec: number;
  introMusicVol: number;
  bodyMusicVol: number;
  musicDuckRampSec: number;
  targetLufs?: number;
  /** Explicit cuts/min (from cutEnergy); undefined ⇒ legacy length-based cadence (god-block parity). */
  cutsPerMin?: number;
  /** Render the outro card (outroStyle !== "none"). */
  outroCard: boolean;
  /** Allow chapter-card splicing when a chapterPlan is present. */
  chapterCards: boolean;
  /** Between-shot transition style (render hint). */
  transitions: string;
  /** Burn captions; false ⇒ caption overlays are dropped from the plan (toggle in onboarding/settings). */
  captions: boolean;
  /** Repurpose horizontal → vertical strategy (render hint): none | center | subject_track. */
  reframe?: string;
}

/**
 * ANTI-LOOP BUFFER — extra footage the BEAT body lays down beyond the visible
 * runtime (narration + tail), so the body track can never underrun.
 *
 * The god-block asks its body renderer for `narrationSec + tailSec + 3`
 * (narratedBlocks.ts:2122). The margin is not cosmetic: `composeWithIntro`
 * LOOPS a short body to fill the runtime, so a body even a fraction under
 * length replays earlier clips at the tail — the "duplicate footage" defect QA
 * flags. The EDL path planned exactly `bodySec + tailSec`, so any clip shorter
 * than its planned window (very common: a 10s window on a 9.7s stock clip) made
 * the body underrun and loop.
 *
 * Applies to the BEAT body only — the chapter (structured) and authored
 * shot-manifest paths are exact-coverage by construction and the god-block adds
 * no buffer there either.
 */
export const BODY_BUFFER_SEC = 3;

/** God-block defaults, preserved verbatim. */
export const ASSEMBLE_DEFAULTS: AssembleParams = {
  aspect: "16:9",
  introSec: 5,
  tailSec: 3,
  fadeOutSec: 2,
  audioFadeOutSec: 2,
  minSeconds: 0,
  maxSeconds: 0,
  tolSec: 30,
  introMusicVol: 0.513,
  bodyMusicVol: 0.1026,
  musicDuckRampSec: 4,
  // The god-block ALWAYS loudness-normalizes the final mix, defaulting to -14
  // LUFS (`Number(ctx.params["targetLufs"] ?? -14)`, narratedBlocks.ts:2368) —
  // it is not an opt-in. Leaving this undefined made renderTimeline skip the
  // normalize pass entirely, shipping ~8 LUFS quieter than every legacy video.
  targetLufs: -14,
  outroCard: true,
  chapterCards: true,
  // The god-block passes NO crossfadeSec to composeWithIntro, whose documented
  // default is 0.8s — so every legacy video dissolves title→body. "hardcut" here
  // was a mis-transcription that forced crossfadeSec 0 on the EDL path. Presets
  // that genuinely want a straight cut (e.g. `hype`) still set it explicitly.
  transitions: "crossfade",
  captions: true,
  reframe: "none",
  // cutsPerMin omitted ⇒ legacy length-based cadence (god-block parity for the default/essay path)
};

/**
 * The body's per-clip screen time. EXACT replica of narratedBlocks.ts::bodySegSeconds
 * — keep in lockstep or the body loops / wastes footage.
 */
export function bodySegSeconds(narrationSec: number, cutSheet?: { sections?: { cutsPerMin: number }[] }): number {
  const cadences = (cutSheet?.sections ?? []).map((s) => s.cutsPerMin).filter((c) => c > 0);
  if (cadences.length) {
    const avg = cadences.reduce((a, b) => a + b, 0) / cadences.length;
    return Math.max(4, Math.min(30, Math.round(60 / avg)));
  }
  return narrationSec > 600 ? 25 : 10;
}

/** A half-open time range [startSec, endSec) in seconds. */
export interface TimeRange {
  startSec: number;
  endSec: number;
}

/**
 * Silence-trim math (pure). Given the raw narration length, detected silence intervals,
 * and the editor's thresholds, return the ordered KEEP ranges (the complement of the
 * dead air we carve out). Silences shorter than `minSilenceSec` are left alone; each
 * removed gap keeps `padSec` of breathing room on both sides so cuts aren't clipped.
 */
export function computeKeepRanges(totalSec: number, silences: TimeRange[], opts: { minSilenceSec: number; padSec: number }): TimeRange[] {
  if (!(totalSec > 0)) return [];
  const removable: TimeRange[] = [];
  for (const z of silences) {
    const s = Math.max(0, Math.min(totalSec, z.startSec));
    const e = Math.max(0, Math.min(totalSec, z.endSec));
    if (e - s < opts.minSilenceSec) continue; // too short to bother
    const rs = s + opts.padSec;
    const re = e - opts.padSec;
    if (re - rs > 0.01) removable.push({ startSec: rs, endSec: re });
  }
  removable.sort((a, b) => a.startSec - b.startSec);
  const keep: TimeRange[] = [];
  let cursor = 0;
  for (const r of removable) {
    if (r.startSec > cursor + 0.01) keep.push({ startSec: cursor, endSec: r.startSec });
    cursor = Math.max(cursor, r.endSec);
  }
  if (cursor < totalSec - 0.01) keep.push({ startSec: cursor, endSec: totalSec });
  return keep;
}

/** Total kept (trimmed) duration of a keep-range set. */
export function sumRanges(ranges: TimeRange[]): number {
  return ranges.reduce((a, r) => a + Math.max(0, r.endSec - r.startSec), 0);
}

/**
 * Map a timestamp in RAW narration time → its position after silence-trim. A time that
 * falls inside a removed gap snaps to the cut point (the accumulated kept length so far).
 */
export function mapTimeThroughKeep(t: number, keep: TimeRange[]): number {
  let acc = 0;
  for (const k of keep) {
    if (t < k.startSec) return acc; // in a removed gap before this kept range
    if (t <= k.endSec) return acc + (t - k.startSec);
    acc += k.endSec - k.startSec;
  }
  return acc;
}

/** Knob → behavior maps (the module's customization surface, applied). */
const DUCK_PROFILES: Record<string, { introVol: number; bodyVol: number }> = {
  none: { introVol: 0.5, bodyVol: 0.5 },
  gentle: { introVol: 0.55, bodyVol: 0.25 },
  standard: { introVol: 0.513, bodyVol: 0.1026 }, // == god-block default (parity)
  aggressive: { introVol: 0.5, bodyVol: 0.05 },
};
/** cutEnergy → cuts/min. `steady` is undefined ⇒ legacy length-based cadence (god-block parity). */
const CUT_ENERGY_CPM: Record<string, number | undefined> = { still: 2, slow: 3, steady: undefined, dynamic: 10, frenetic: 15 };
const INTRO_STYLE_SEC: Record<string, number> = { none: 0, cold_open: 0, title_card: 5, logo_sting: 2 };
/** Valid renderHints enum values (anything else normalizes to the safe default). */
const TRANSITION_HINTS = new Set(["hardcut", "crossfade", "dip_to_black"]);
const REFRAME_HINTS = new Set(["none", "center", "subject_track"]);
const CAPTION_STYLE_HINTS = new Set(["none", "minimal", "karaoke", "bold"]);

/**
 * Resolve per-account assemble params from a ChannelProfile via the CustomizationSurface:
 * read the Architect's `preset` + the channel's knob overrides → validated knob values →
 * AssembleParams. Raw numeric params (minSeconds/maxSeconds, or a direct introMusicVol etc.)
 * still win as fine-grained overrides. The `essay`/default path reproduces the god-block.
 */
export function resolveAssembleParams(profile: ChannelProfile, block = "timeline_assemble"): AssembleParams {
  const raw = moduleParams(profile, block);
  const num = (key: string, d: number): number => (typeof raw[key] === "number" ? (raw[key] as number) : d);
  const preset = typeof raw["preset"] === "string" ? (raw["preset"] as string) : undefined;

  const overrides: Record<string, KnobValue> = {};
  for (const k of ASSEMBLY_SURFACE.knobs) {
    const v = raw[k.id];
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") overrides[k.id] = v;
  }
  const resolved = resolveKnobs(ASSEMBLY_SURFACE, preset, overrides);
  if (!resolved.ok) throw new Error(`resolveAssembleParams: ${resolved.errors.join("; ")}`);
  const k = resolved.values;
  const duck = DUCK_PROFILES[String(k.musicDuckProfile)] ?? DUCK_PROFILES.standard;
  const fadeOutSec = num("fadeOutSec", ASSEMBLE_DEFAULTS.fadeOutSec);

  return {
    aspect: k.aspect === "9:16" ? "9:16" : k.aspect === "1:1" ? "1:1" : "16:9",
    introSec: num("introSec", INTRO_STYLE_SEC[String(k.introStyle)] ?? 5),
    tailSec: Number(k.tailSec),
    fadeOutSec,
    audioFadeOutSec: num("audioFadeOutSec", fadeOutSec),
    minSeconds: num("minSeconds", 0),
    maxSeconds: num("maxSeconds", 0),
    tolSec: 30,
    introMusicVol: num("introMusicVol", duck.introVol),
    bodyMusicVol: num("bodyMusicVol", duck.bodyVol),
    musicDuckRampSec: num("musicDuckRampSec", ASSEMBLE_DEFAULTS.musicDuckRampSec),
    // Never let an absent/!finite knob become NaN — that would silently disable
    // the loudness pass again (the exact class of bug this path just fixed).
    targetLufs: Number.isFinite(Number(k.targetLufs)) ? Number(k.targetLufs) : ASSEMBLE_DEFAULTS.targetLufs,
    cutsPerMin: CUT_ENERGY_CPM[String(k.cutEnergy)],
    outroCard: k.outroStyle !== "none",
    chapterCards: Boolean(k.chapterCards),
    transitions: String(k.transitions),
    captions: Boolean(k.captions),
    reframe: k.reframe !== undefined ? String(k.reframe) : ASSEMBLE_DEFAULTS.reframe,
  };
}

/** Alternate footage[k], entity[k] — the god-block's interleave. */
function interleave(footage: string[], entity: string[]): string[] {
  const out: string[] = [];
  const maxn = Math.max(footage.length, entity.length);
  for (let k = 0; k < maxn; k++) {
    if (footage[k]) out.push(footage[k]);
    if (entity[k]) out.push(entity[k]);
  }
  return out;
}

/** cuts/min interpolated along a pacing curve at body position `frac` (0–1). */
function cpmAtFrac(curve: { atFrac: number; cutsPerMin: number }[], frac: number): number {
  const pts = [...curve].sort((a, b) => a.atFrac - b.atFrac);
  if (pts.length === 0) return 6;
  if (frac <= pts[0].atFrac) return pts[0].cutsPerMin;
  if (frac >= pts[pts.length - 1].atFrac) return pts[pts.length - 1].cutsPerMin;
  for (let i = 1; i < pts.length; i++) {
    if (frac <= pts[i].atFrac) {
      const a = pts[i - 1], b = pts[i];
      const t = (frac - a.atFrac) / Math.max(1e-6, b.atFrac - a.atFrac);
      return a.cutsPerMin + t * (b.cutsPerMin - a.cutsPerMin);
    }
  }
  return pts[pts.length - 1].cutsPerMin;
}
/** Per-clip screen time from a cuts/min (clamped like bodySegSeconds: 2–30s). */
function segSecondsFromCpm(cpm: number): number {
  return Math.max(2, Math.min(30, 60 / Math.max(1, cpm)));
}

/**
 * P1 — un-average the per-video CutSheet: `briefEditor()` (crew.ts) already produces a
 * per-SECTION cadence (`CutSheet.sections[].cutsPerMin`), which `bodySegSeconds` otherwise
 * collapses into one flat average. When the sections actually carry DIFFERENT cadences,
 * turn them into a step-shaped pacing curve instead — each section holds its own cadence
 * flat across its slice of the body, then jumps at the boundary.
 *
 * Sections have no id shared with `chapterPlan` windows (separate authoring surfaces, and
 * chapter mode is a branch of `planTimeline` mutually exclusive with the beat body this
 * curve feeds — see the caller), so boundaries are an EVEN split across the body, per the
 * doc's documented fallback. Returns undefined (⇒ flat parity) when there's nothing to gain:
 * fewer than 2 usable sections, or all sections already agree on one cadence.
 */
export function cutSheetPacingCurve(
  sections?: { cutsPerMin: number }[],
): { atFrac: number; cutsPerMin: number }[] | undefined {
  const secs = (sections ?? []).filter((s) => s.cutsPerMin > 0);
  if (secs.length < 2) return undefined;
  if (secs.every((s) => s.cutsPerMin === secs[0].cutsPerMin)) return undefined; // uniform ⇒ parity
  const n = secs.length;
  const pts: { atFrac: number; cutsPerMin: number }[] = [];
  for (let i = 0; i < n; i++) {
    const start = i / n;
    const end = (i + 1) / n;
    const preEnd = Math.max(start, end - 1e-4);
    pts.push({ atFrac: start, cutsPerMin: secs[i].cutsPerMin });
    if (preEnd > start) pts.push({ atFrac: preEnd, cutsPerMin: secs[i].cutsPerMin });
  }
  return pts;
}

/**
 * P2 — seed/override a pacing curve with a fast-cut retention hook for the first `hookSec`
 * ABSOLUTE seconds of the body: `posFrac < hookSec/bodyTargetSec` ⇒ `hookCutsPerMin`, then
 * hands off to whatever curve (or flat cadence) was already driving the rest of the body.
 * Composes INTO the curve (a single interpolation call downstream) rather than being a
 * separate code path, per the doc. A no-op (returns `base` unchanged) when hookSec/
 * hookCutsPerMin aren't both set to a positive value, or the body has no length yet.
 */
export function composeHookCurve(
  base: { atFrac: number; cutsPerMin: number }[] | undefined,
  hookSec: number | undefined,
  hookCutsPerMin: number | undefined,
  bodyTargetSec: number,
  fallbackCpm: number,
): { atFrac: number; cutsPerMin: number }[] | undefined {
  if (!hookSec || hookSec <= 0 || !hookCutsPerMin || hookCutsPerMin <= 0 || !(bodyTargetSec > 0)) return base;
  const hookFrac = Math.max(0, Math.min(1, hookSec / bodyTargetSec));
  if (hookFrac <= 0) return base;
  const settleCpm = base && base.length ? cpmAtFrac(base, hookFrac) : fallbackCpm;
  const rest = (base ?? []).filter((p) => p.atFrac > hookFrac);
  const preEnd = Math.max(0, hookFrac - 1e-4);
  return [
    { atFrac: 0, cutsPerMin: hookCutsPerMin },
    ...(preEnd > 0 ? [{ atFrac: preEnd, cutsPerMin: hookCutsPerMin }] : []),
    { atFrac: hookFrac, cutsPerMin: settleCpm },
    ...rest,
  ];
}

/**
 * Resolve the ONE pacing curve driving the beat body, in priority order: an explicit
 * editor-authored curve (channel's `pacingShape`) → a curve derived from the per-video
 * CutSheet's per-section cadence (P1, only when it actually varies) → flat (undefined).
 * A retention hook (P2) then seeds/overrides the start of whichever wins. Computed ONCE
 * per plan — `segSecondsAt` below is called per-clip and must not rebuild this.
 */
function resolvePacingCurve(
  editor: PlanInput["editor"],
  cutSheetSections: { cutsPerMin: number }[] | undefined,
  bodyTargetSec: number,
  fallbackSec: number,
): { atFrac: number; cutsPerMin: number }[] | undefined {
  const baseCurve = editor?.pacingCurve && editor.pacingCurve.length ? editor.pacingCurve : cutSheetPacingCurve(cutSheetSections);
  return composeHookCurve(baseCurve, editor?.hookSec, editor?.hookCutsPerMin, bodyTargetSec, 60 / Math.max(1, fallbackSec));
}

/**
 * `segSecondsAt(posFrac, curve)` — the un-averaged replacement for a flat `bodySegSeconds`
 * scalar: per-clip screen time at body position `posFrac` (0–1). Falls back to `fallbackSec`
 * (the legacy flat `bodyMaxSeg`) verbatim when there's no curve — BACKWARD COMPATIBLE with
 * every caller that doesn't set an editor pacing curve, a varying CutSheet, or a hook.
 */
function segSecondsAt(
  posFrac: number,
  curve: { atFrac: number; cutsPerMin: number }[] | undefined,
  fallbackSec: number,
): number {
  return curve && curve.length ? segSecondsFromCpm(cpmAtFrac(curve, posFrac)) : fallbackSec;
}

/**
 * Lay clips end-to-end until `target` is covered, cycling the pool. `segAt(posFrac)`
 * gives the per-clip screen time at the current body fraction — a CONSTANT for flat
 * cadence (parity) or a varying value along the editor's pacing curve (P1/P2).
 */
function fillBody(clips: string[], entitySet: Set<string>, target: number, segAt: (posFrac: number) => number, onBeat: boolean): Segment[] {
  const out: Segment[] = [];
  let filled = 0;
  let i = 0;
  while (filled + 0.001 < target) {
    const raw = segAt(target > 0 ? filled / target : 0);
    const safeSeg = raw > 0.05 ? raw : 4; // never 0 → no infinite loop
    const dur = Math.min(safeSeg, target - filled);
    const src = clips.length ? clips[i % clips.length] : "";
    out.push({ kind: entitySet.has(src) ? "entity" : "footage", src, durSec: dur, onBeat });
    i++;
    filled += dur;
    if (out.length > 20000) break; // defensive cap (the narration guard already bounds this)
  }
  return out;
}

/**
 * P3 (Segment side) — adopt auto-editor's clip model (doc: "Adopt auto-editor's clip
 * model on Segment", RESEARCH_EDITOR_ADVANCED.md "RECOMMENDED next-level Editor
 * design"). When the body's footage pool IS the narration's own recording
 * (talking-head / screen-capture where mic and camera are the same file — the exact
 * shape auto-editor targets), materialize the silence-trim's KEEP ranges as REAL
 * per-clip `offset` (position in the RAW, untrimmed source) + `durSec`, instead of
 * cadence-cycling a generic b-roll pool that doesn't exist for this shape. Long kept
 * stretches are still sub-split at `segAt`'s target seg length so cuts/pacing keep
 * landing inside them; a segment NEVER straddles a removed gap. `segAt` receives the
 * position fraction ALONG THE TRIMMED (kept) timeline — the same contract `fillBody`
 * uses. `speed` is always 1 here: P3 only trims, it doesn't retime (P4/P6 are where a
 * non-1 speed would come from) — the field exists on Segment now so a future backend
 * has somewhere to read it once retime lands.
 */
export function segmentsFromKeepRanges(
  src: string,
  keep: TimeRange[],
  totalKeptSec: number,
  segAt: (posFrac: number) => number,
  onBeat: boolean,
): Segment[] {
  const out: Segment[] = [];
  let keptSoFar = 0; // position along the TRIMMED (kept) timeline — feeds segAt's posFrac
  for (const range of keep) {
    let cursor = range.startSec;
    while (cursor + 0.001 < range.endSec) {
      const posFrac = totalKeptSec > 0 ? keptSoFar / totalKeptSec : 0;
      const want = segAt(posFrac);
      const safeSeg = want > 0.05 ? want : 4; // never 0 → no infinite loop (mirrors fillBody)
      const dur = Math.min(safeSeg, range.endSec - cursor);
      out.push({ kind: "footage", src, offset: cursor, durSec: dur, speed: 1, onBeat });
      cursor += dur;
      keptSoFar += dur;
      if (out.length > 20000) return out; // defensive cap, mirrors fillBody
    }
  }
  return out;
}

/** Editor overlayDensity caps quote/insert overlay count (captions are never capped). */
function capOverlays(overlays: Overlay[], density?: string): Overlay[] {
  const cap = density === "sparse" ? 2 : density === "standard" ? 6 : Infinity; // rich / undefined ⇒ all
  if (!Number.isFinite(cap)) return overlays;
  let n = 0;
  return overlays.filter((o) => (o.kind === "caption" ? true : ++n <= cap));
}

/**
 * Build the typed Timeline. Pure. `params` defaults to the god-block defaults; pass
 * `resolveAssembleParams(profile)` for per-account behavior.
 */
export function planTimeline(input: PlanInput, params: AssembleParams = ASSEMBLE_DEFAULTS): Timeline {
  const narrationSec = input.narrationDurationSec;
  // Guard BEFORE any body fill — Infinity/NaN/huge would loop fillBody unbounded (OOM). Fail loud.
  if (!Number.isFinite(narrationSec) || narrationSec < 0 || narrationSec > 36000) {
    throw new Error(`planTimeline: narrationDurationSec must be finite and within [0, 36000]s, got ${narrationSec}`);
  }
  if (!Number.isFinite(params.tailSec) || params.tailSec < 0) {
    throw new Error(`planTimeline: tailSec must be finite and >= 0, got ${params.tailSec}`);
  }
  const introSec = input.introCardSrc && input.introCardSrc.length > 0 ? params.introSec : 0;
  const hasIntro = introSec > 0; // introStyle 'none'/'cold_open' collapses introSec to 0
  const tailSec = params.tailSec;
  const storyManifest = input.shotRenderManifest
    ? validateQualifiedShotRender({
        manifest: input.shotRenderManifest,
        qaReport: input.shotQaReport,
        coverage: input.visualCoverage,
      }).manifest
    : undefined;
  if (storyManifest) {
    if (Math.abs(storyManifest.durationSec - narrationSec) > 0.02) {
      throw new Error(
        `planTimeline: authored shot duration ${storyManifest.durationSec}s does not match narration ${narrationSec}s`,
      );
    }
    for (let index = 0; index < storyManifest.items.length; index++) {
      const item = storyManifest.items[index];
      if (index === 0 && Math.abs(item.t0) > 0.02) {
        throw new Error("planTimeline: authored shots must begin at t=0");
      }
      if (index > 0 && Math.abs(item.t0 - storyManifest.items[index - 1].t1) > 0.02) {
        throw new Error(`planTimeline: authored shot coverage gap/overlap before ${item.shotId}`);
      }
    }
  }

  // Silence-trim (editor): carve dead air out of the narration. Beat-body path only —
  // chapter timing is the director's lane, so trim sits out when a chapterPlan drives it.
  // Needs BOTH the editor directive (thresholds) and measured intervals (the probe).
  const inChapterMode = !storyManifest && !!(params.chapterCards && input.chapterPlan && input.chapterPlan.length > 0);
  const trim = input.editor?.trim;
  let keepRanges: TimeRange[] | undefined;
  let effectiveNarrationSec = narrationSec;
  if (trim && input.silenceIntervals && input.silenceIntervals.length > 0 && !inChapterMode && !storyManifest) {
    const kr = computeKeepRanges(narrationSec, input.silenceIntervals, trim);
    const trimmed = sumRanges(kr);
    // only adopt the trim if it actually shortens AND leaves real content (no zero-length narration)
    if (kr.length > 0 && trimmed > 0.5 && trimmed < narrationSec - 0.25) {
      keepRanges = kr;
      effectiveNarrationSec = trimmed;
    }
  }

  const total = introSec + effectiveNarrationSec + tailSec;
  const [w, h] = params.aspect === "9:16" ? [1080, 1920] : params.aspect === "1:1" ? [1080, 1080] : [1920, 1080];
  // Cadence priority: editor crew directive → cutEnergy knob → explicit cutSheet → legacy length-based (parity).
  const cpm = input.editor?.cutsPerMin ?? params.cutsPerMin;
  const bodyMaxSeg = bodySegSeconds(
    effectiveNarrationSec,
    input.cutSheet ?? (cpm ? { sections: [{ cutsPerMin: cpm }] } : undefined),
  );
  // Transitions/captions: the EDITOR directs, falling back to the channel's own assemble knobs.
  const transitions = input.editor?.transitions ?? params.transitions;
  const captionStyle = input.editor?.captionStyle;
  const clips = interleave(input.footageClips, input.entityClips ?? []);
  const entitySet = new Set(input.entityClips ?? []);
  const onBeat = (input.sentenceTimings?.length ?? 0) > 0;

  const segments: Segment[] = [];
  // The intro card is ALREADY RENDERED upstream (the `intro_card` block) and the
  // god-block composites that exact file. Carry its path on the segment so the
  // renderer reuses it instead of paying for a second, different Remotion card.
  if (hasIntro) segments.push({ kind: "card", role: "intro", durSec: introSec, bgSrc: input.cardBgSrc, src: input.introCardSrc });

  if (storyManifest) {
    segments.push(...storyManifest.items.map((item) => ({
      kind: "footage" as const,
      src: item.clipKey,
      durSec: item.t1 - item.t0,
      onBeat: true,
    })));
    // With no outro card, hold the final authored frame through the tail. The
    // narration body itself remains exactly one segment per authored shot.
    if (!params.outroCard && tailSec > 0) {
      segments.push({
        kind: "footage",
        src: storyManifest.items.at(-1)!.clipKey,
        durSec: tailSec,
        onBeat: false,
      });
    }
  } else if (params.chapterCards && input.chapterPlan && input.chapterPlan.length > 0) {
    let chapNo = 0;
    let ci = 0;
    for (const wndw of input.chapterPlan) {
      if (wndw.kind === "card") {
        chapNo++;
        segments.push({
          kind: "card",
          role: "chapter",
          durSec: Math.max(2, wndw.durSec),
          title: wndw.heading ?? `Part ${chapNo}`,
          subtitle: `Chapter ${chapNo}`,
          bgSrc: input.cardBgSrc,
        });
      } else {
        // footage window: fill from the (rotating) pool at the cut cadence
        const rotated = clips.length ? clips.slice(ci % clips.length).concat(clips.slice(0, ci % clips.length)) : [];
        segments.push(...fillBody(rotated, entitySet, wndw.durSec, () => bodyMaxSeg, true));
        ci += Math.max(1, Math.ceil(wndw.durSec / bodyMaxSeg));
      }
    }
  } else {
    // beat body: cover narration + tail at the cut cadence. A pacing CURVE — explicit
    // (editor.pacingCurve), or derived from the per-video CutSheet's per-section cadence
    // when it varies (P1), optionally seeded with a retention hook (P2) — varies the
    // per-clip length over the body; absent all three, the constant bodyMaxSeg is used
    // (flat cadence = parity with the old averaged behaviour).
    // +BODY_BUFFER_SEC — god-block parity (narratedBlocks.ts:2122). The extra
    // footage is never SHOWN (runtime is intro+body+tail); it exists so the body
    // track cannot underrun and make composeWithIntro loop back to clip 1.
    const bodyTargetSec = effectiveNarrationSec + tailSec + BODY_BUFFER_SEC;
    const pacingCurve = resolvePacingCurve(input.editor, input.cutSheet?.sections, bodyTargetSec, bodyMaxSeg);
    const segAt = (f: number) => segSecondsAt(f, pacingCurve, bodyMaxSeg);
    // P3 (Segment side): the ONE shape where auto-editor's real clip model applies —
    // a single footage source that IS the narration's own recording (talking-head /
    // screen-cap). Materialize the trim's keep ranges as real offset/durSec segments
    // instead of cadence-cycling a b-roll pool (there's nothing to cycle: it's one
    // clip). Every other shape (multi-clip pool, entity clips, trim off) falls
    // straight through to fillBody, byte for byte — unchanged.
    const singleSourceIsNarration =
      keepRanges && clips.length === 1 && !!input.narrationSrc && clips[0] === input.narrationSrc;
    if (singleSourceIsNarration && keepRanges) {
      segments.push(...segmentsFromKeepRanges(clips[0], keepRanges, effectiveNarrationSec, segAt, onBeat));
      // Same anti-loop guarantee fillBody gets from BODY_BUFFER_SEC: hold the
      // source forward past the last kept range so the body can never underrun.
      const bufferSec = tailSec + BODY_BUFFER_SEC;
      if (bufferSec > 0.05) {
        const lastEnd = keepRanges[keepRanges.length - 1]?.endSec ?? 0;
        segments.push({ kind: "footage", src: clips[0], offset: lastEnd, durSec: bufferSec, speed: 1, onBeat });
      }
    } else {
      segments.push(...fillBody(clips, entitySet, bodyTargetSec, segAt, onBeat));
    }
  }

  if (params.outroCard && tailSec >= 2) {
    segments.push({
      kind: "card",
      role: "outro",
      durSec: tailSec,
      title: (input.closingLine || "").trim() || "Until next time.",
      subtitle: input.channelName ?? "",
      bgSrc: input.cardBgSrc,
      fadeInSec: 1.2,
    });
  }

  // captions toggle (off ⇒ drop caption overlays) + editor overlayDensity caps quote/insert count.
  let planOverlays = capOverlays(
    (input.overlays ?? []).filter((o) => params.captions || o.kind !== "caption"),
    input.editor?.overlayDensity,
  );
  // When narration is trimmed, overlay windows (absolute video time) shift with the
  // content: intro-time overlays unchanged, body-time overlays mapped through the keep
  // ranges, tail-time overlays slid earlier by the total carved amount. Windows that
  // collapse into removed silence are dropped (their referenced moment is gone).
  if (keepRanges) {
    const carved = narrationSec - effectiveNarrationSec;
    const remap = (t: number): number => {
      if (t <= introSec) return t;
      const rel = t - introSec;
      if (rel <= narrationSec) return introSec + mapTimeThroughKeep(rel, keepRanges as TimeRange[]);
      return t - carved;
    };
    planOverlays = planOverlays
      .map((o) => ({ ...o, startSec: remap(o.startSec), endSec: remap(o.endSec) }))
      .filter((o) => o.endSec - o.startSec >= 0.1);
  }

  // parse() applies schema normalization + fails loud on a structurally bad plan.
  return TimelineSchema.parse({
    format: { w, h, fps: 30 },
    segments,
    audio: {
      narrationSrc: input.narrationSrc,
      musicSrc: input.musicSrc,
      introSec,
      bodySec: effectiveNarrationSec,
      tailSec,
      // Composer DIRECTS the mix: duck depth + master loudness fall back to the channel's assemble knobs.
      duck: { introVol: params.introMusicVol, bodyVol: input.composer?.bodyMusicVol ?? params.bodyMusicVol, rampSec: params.musicDuckRampSec },
      fadeOutSec: params.fadeOutSec,
      audioFadeOutSec: params.audioFadeOutSec,
      targetLufs: input.composer?.targetLufs ?? params.targetLufs,
      ...(input.composer?.voiceFx ? { voiceFx: input.composer.voiceFx } : {}),
      ...(keepRanges ? { narrationKeepRanges: keepRanges } : {}),
    },
    overlays: planOverlays,
    lengthBand: { minSec: params.minSeconds, maxSec: params.maxSeconds, tolSec: params.tolSec },
    checkpoints: { preOverlaySec: total },
    ...(params.aspect !== "16:9" ? { reframe: { aspect: params.aspect } } : {}),
    renderHints: {
      transitions: TRANSITION_HINTS.has(transitions) ? transitions : "hardcut",
      reframe: REFRAME_HINTS.has(params.reframe ?? "none") ? (params.reframe ?? "none") : "none",
      ...(captionStyle && CAPTION_STYLE_HINTS.has(captionStyle) ? { captionStyle } : {}),
    },
  });
}
