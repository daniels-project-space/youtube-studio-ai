/**
 * planTimeline — the Assembly "brain" (pure). Turns the raw inputs the old
 * `timeline_assemble` god-block read from `ctx.store` + a ChannelProfile into a
 * typed, inspectable Timeline. NO I/O, NO ffmpeg, NO orchestration — just edit
 * decisions. The math here replicates the god-block EXACTLY (parity target):
 * intro/body/tail length, `bodySegSeconds` cut cadence, footage⇄entity interleave,
 * chapter windows, intro/outro cards, music-duck levels.
 */
import { moduleParams, type ChannelProfile } from "@/engine/channelProfile";
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

/** Resolve per-account assemble params from a ChannelProfile (god-block defaults preserved). */
export function resolveAssembleParams(profile: ChannelProfile, block = "timeline_assemble"): AssembleParams {
  const p = moduleParams(profile, block);
  const num = (k: string, d: number) => (typeof p[k] === "number" ? (p[k] as number) : d);
  const fadeOutSec = num("fadeOutSec", ASSEMBLE_DEFAULTS.fadeOutSec);
  return {
    aspect: p["aspect"] === "9:16" ? "9:16" : "16:9",
    introSec: num("introSec", ASSEMBLE_DEFAULTS.introSec),
    tailSec: num("tailSec", ASSEMBLE_DEFAULTS.tailSec),
    fadeOutSec,
    audioFadeOutSec: num("audioFadeOutSec", fadeOutSec),
    minSeconds: num("minSeconds", 0),
    maxSeconds: num("maxSeconds", 0),
    tolSec: 30,
    introMusicVol: num("introMusicVol", ASSEMBLE_DEFAULTS.introMusicVol),
    bodyMusicVol: num("bodyMusicVol", ASSEMBLE_DEFAULTS.bodyMusicVol),
    musicDuckRampSec: num("musicDuckRampSec", ASSEMBLE_DEFAULTS.musicDuckRampSec),
    targetLufs: typeof p["targetLufs"] === "number" ? (p["targetLufs"] as number) : undefined,
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
  const hasIntro = !!(input.introCardSrc && input.introCardSrc.length > 0);
  const introSec = hasIntro ? params.introSec : 0;
  const tailSec = params.tailSec;
  const total = introSec + narrationSec + tailSec;
  const [w, h] = params.aspect === "9:16" ? [1080, 1920] : [1920, 1080];
  const bodyMaxSeg = bodySegSeconds(narrationSec, input.cutSheet);
  const clips = interleave(input.footageClips, input.entityClips ?? []);
  const entitySet = new Set(input.entityClips ?? []);
  const onBeat = (input.sentenceTimings?.length ?? 0) > 0;

  const segments: Segment[] = [];
  if (hasIntro) segments.push({ kind: "card", role: "intro", durSec: introSec, bgSrc: input.cardBgSrc });

  if (input.chapterPlan && input.chapterPlan.length > 0) {
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

  if (tailSec >= 2) {
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
    overlays: input.overlays ?? [],
    lengthBand: { minSec: params.minSeconds, maxSec: params.maxSeconds, tolSec: params.tolSec },
    checkpoints: { preOverlaySec: total },
    ...(params.aspect === "9:16" ? { reframe: { aspect: "9:16" } } : {}),
  });
}
