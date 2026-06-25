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
import { ASSEMBLY_SURFACE } from "./module";
import { TimelineSchema, type Timeline, type Segment, type Overlay } from "./timeline";

/** The raw decision inputs (mirrors what the god-block pulled from ctx.store). */
export interface PlanInput {
  footageClips: string[];
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
  /** Editor crew directives (the WIRE from the Editor sub-module): transitions + cadence + captionStyle. */
  editor?: { transitions?: string; cutsPerMin?: number; captionStyle?: string };
}

/** Per-account assemble params (resolved from a ChannelProfile or passed directly). */
export interface AssembleParams {
  aspect: "16:9" | "9:16";
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
  outroCard: true,
  chapterCards: true,
  transitions: "hardcut",
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
    aspect: k.aspect === "9:16" ? "9:16" : "16:9",
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
    targetLufs: Number(k.targetLufs),
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

/** Lay clips end-to-end at `seg` seconds each until `target` is covered, cycling the pool. */
function fillBody(clips: string[], entitySet: Set<string>, target: number, seg: number, onBeat: boolean): Segment[] {
  const out: Segment[] = [];
  let filled = 0;
  let i = 0;
  while (filled + 0.001 < target) {
    const dur = Math.min(seg, target - filled);
    const src = clips.length ? clips[i % clips.length] : "";
    out.push({ kind: entitySet.has(src) ? "entity" : "footage", src, durSec: dur, onBeat });
    i++;
    filled += dur;
  }
  return out;
}

/**
 * Build the typed Timeline. Pure. `params` defaults to the god-block defaults; pass
 * `resolveAssembleParams(profile)` for per-account behavior.
 */
export function planTimeline(input: PlanInput, params: AssembleParams = ASSEMBLE_DEFAULTS): Timeline {
  const narrationSec = input.narrationDurationSec;
  const introSec = input.introCardSrc && input.introCardSrc.length > 0 ? params.introSec : 0;
  const hasIntro = introSec > 0; // introStyle 'none'/'cold_open' collapses introSec to 0
  const tailSec = params.tailSec;
  const total = introSec + narrationSec + tailSec;
  const [w, h] = params.aspect === "9:16" ? [1080, 1920] : [1920, 1080];
  // Cadence priority: editor crew directive → cutEnergy knob → explicit cutSheet → legacy length-based (parity).
  const cpm = input.editor?.cutsPerMin ?? params.cutsPerMin;
  const bodyMaxSeg = bodySegSeconds(
    narrationSec,
    input.cutSheet ?? (cpm ? { sections: [{ cutsPerMin: cpm }] } : undefined),
  );
  // Transitions/captions: the EDITOR directs, falling back to the channel's own assemble knobs.
  const transitions = input.editor?.transitions ?? params.transitions;
  const captionStyle = input.editor?.captionStyle;
  const clips = interleave(input.footageClips, input.entityClips ?? []);
  const entitySet = new Set(input.entityClips ?? []);
  const onBeat = (input.sentenceTimings?.length ?? 0) > 0;

  const segments: Segment[] = [];
  if (hasIntro) segments.push({ kind: "card", role: "intro", durSec: introSec, bgSrc: input.cardBgSrc });

  if (params.chapterCards && input.chapterPlan && input.chapterPlan.length > 0) {
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
        segments.push(...fillBody(rotated, entitySet, wndw.durSec, bodyMaxSeg, true));
        ci += Math.max(1, Math.ceil(wndw.durSec / bodyMaxSeg));
      }
    }
  } else {
    // beat body: cover narration + tail at the cut cadence
    segments.push(...fillBody(clips, entitySet, narrationSec + tailSec, bodyMaxSeg, onBeat));
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

  // parse() applies schema normalization + fails loud on a structurally bad plan.
  return TimelineSchema.parse({
    format: { w, h, fps: 30 },
    segments,
    audio: {
      narrationSrc: input.narrationSrc,
      musicSrc: input.musicSrc,
      introSec,
      bodySec: narrationSec,
      tailSec,
      duck: { introVol: params.introMusicVol, bodyVol: params.bodyMusicVol, rampSec: params.musicDuckRampSec },
      fadeOutSec: params.fadeOutSec,
      audioFadeOutSec: params.audioFadeOutSec,
      targetLufs: params.targetLufs,
    },
    // captions toggle (onboarding/settings) — off ⇒ drop caption overlays from the plan
    overlays: (input.overlays ?? []).filter((o) => params.captions || o.kind !== "caption"),
    lengthBand: { minSec: params.minSeconds, maxSec: params.maxSeconds, tolSec: params.tolSec },
    checkpoints: { preOverlaySec: total },
    ...(params.aspect === "9:16" ? { reframe: { aspect: "9:16" } } : {}),
    renderHints: {
      transitions: TRANSITION_HINTS.has(transitions) ? transitions : "hardcut",
      reframe: REFRAME_HINTS.has(params.reframe ?? "none") ? (params.reframe ?? "none") : "none",
      ...(captionStyle && CAPTION_STYLE_HINTS.has(captionStyle) ? { captionStyle } : {}),
    },
  });
}
