/**
 * renderTimeline — the Assembly "hands" (orchestration). Executes a typed Timeline
 * deterministically: validate-before-spend → render cards + body → compose intro +
 * ducked audio → crossfade outro → apply overlays → publish. Idempotent (content-
 * addressed) and heal-aware (re-finish from a declared pre-overlay checkpoint).
 *
 * The actual ffmpeg/Remotion/storage calls live behind a `RenderBackend` so this
 * orchestration is PURE and unit-testable with a fake backend; the real backend is
 * the single swappable integration adapter (validated by the real-render parity step).
 */
import { createHash } from "node:crypto";
import {
  validateTimeline,
  projectedDurationSec,
  ReceiptSchema,
  type Timeline,
  type Receipt,
  type Segment,
  type Overlay,
  type Format,
} from "./timeline";

/** A card to render as a standalone clip (intro/outro; chapter cards are built inside buildBody). */
export interface CardSpec {
  role: "intro" | "chapter" | "outro";
  title?: string;
  subtitle?: string;
  bgSrc?: string;
  durSec: number;
  fadeInSec?: number;
}

/** The concrete render ops. Real impl wraps ffmpeg.ts + Remotion + R2; tests inject a fake. */
export interface RenderBackend {
  /** Render an intro/outro card → local clip path. */
  renderCard(card: CardSpec, fmt: Format): Promise<string>;
  /** Build the body track (footage/entity clips + any chapter cards, IN ORDER) → local path. Backend fetches sources. */
  buildBody(middle: Segment[], opts: { targetSec: number; fmt: Format }): Promise<string>;
  /** Compose intro card + body + ducked music + narration → local path. Backend fetches music/narration. */
  composeIntro(args: {
    introCardPath?: string;
    bodyPath: string;
    musicSrc?: string;
    narrationSrc?: string;
    introSec: number;
    bodySec: number;
    tailSec: number;
    fadeOutSec: number;
    audioFadeOutSec: number;
    introMusicVol: number;
    bodyMusicVol: number;
    musicDuckRampSec: number;
    /** Crossfade (xfade) seconds title→body. From renderHints.transitions; optional (backend may ignore). */
    crossfadeSec?: number;
    /**
     * Transition TYPE title→body (renderHints.transitions). Lets the backend BRANCH:
     *   crossfade    → xfade dissolve (default)
     *   dip_to_black → fade DOWN to black then back up (a real visual difference)
     *   hardcut      → straight cut (crossfadeSec 0)
     * Optional; a backend may ignore it and fall back to crossfadeSec alone.
     */
    transition?: "hardcut" | "crossfade" | "dip_to_black";
    fmt: Format;
  }): Promise<string>;
  /** Crossfade an outro card over the tail → local path. */
  patchOutro(basePath: string, outroCardPath: string, startSec: number, durSec: number, fmt: Format): Promise<string>;
  /**
   * OPTIONAL post-compose reframe to the target aspect (portrait repurpose).
   * `strategy` is the renderHints.reframe value (center | subject_track). Omitting
   * this method (fake backends) is fine — renderTimeline only calls it when present
   * AND the plan asks for a non-"none" reframe on a portrait target.
   */
  reframe?(basePath: string, fmt: Format, strategy: string): Promise<{ path: string; warnings: string[] }>;
  /**
   * OPTIONAL loudness normalize to an integrated LUFS target (AudioPlan.targetLufs).
   * renderTimeline calls this AFTER compose (and after the optional reframe) only
   * when targetLufs is set AND the backend implements it — mirroring the optional
   * `reframe` pattern so fake backends (which omit it) are an exact no-op.
   */
  normalizeLoudness?(path: string, lufs: number): Promise<{ path: string; warnings: string[] }>;
  /**
   * Burn captions/quotes/inserts → { path, applied, warnings }. Drops surface as
   * warnings, never silent. The optional `opts.captionStyle` (renderHints.captionStyle)
   * lets the backend restyle / suppress the caption burn:
   *   none    → skip caption burn entirely (quote/insert specs still composite)
   *   minimal → smaller, low-key captions
   *   karaoke → active-word highlight colour
   *   bold    → large, heavy outline (default-ish look, louder)
   * Omitting it ⇒ the backend's standard caption style (back-compatible).
   */
  applyOverlays(
    basePath: string,
    overlays: Overlay[],
    fmt: Format,
    opts?: { captionStyle?: "none" | "minimal" | "karaoke" | "bold" },
  ): Promise<{ path: string; applied: number; warnings: string[] }>;
  /** Probe a local video's duration (sec). */
  probe(path: string): Promise<number>;
  /** Content-addressed artifact cache (idempotency + heal checkpoint). */
  cacheGet(key: string): Promise<string | null>;
  cachePut(key: string, localPath: string): Promise<void>;
  /** Publish the final video → its storage key. */
  publish(localPath: string): Promise<string>;
}

/** Deterministic canonical stringify (recursively key-sorted) → stable hash input. */
function canonical(v: unknown): string {
  if (v === undefined) return "null"; // undefined and a JSON round-trip (which drops it) hash the same
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  const o = v as Record<string, unknown>;
  // skip undefined-valued keys so hash(plan) === hash(JSON.parse(JSON.stringify(plan))) — stable across persistence
  return "{" + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + canonical(o[k])).join(",") + "}";
}

/** Content-addressed key for a Timeline (idempotency). Same plan + version ⇒ same key. */
export function hashTimeline(t: Timeline, salt = ""): string {
  return createHash("sha1").update(salt + "|" + canonical(t)).digest("hex").slice(0, 16);
}

export interface RenderOpts {
  /** Bumped when the renderer's behavior changes, to invalidate the cache. */
  toolVersion?: string;
}

const isCard = (s: Segment): s is Extract<Segment, { kind: "card" }> => s.kind === "card";

/** renderHints.transitions → composeIntro crossfade seconds. hardcut=0, crossfade/dip=0.8. */
function crossfadeSecFromHints(transitions?: string): number {
  if (transitions === "crossfade" || transitions === "dip_to_black") return 0.8;
  return 0; // hardcut / undefined
}

/**
 * renderHints.transitions → the typed transition the backend BRANCHES on. Normalizes
 * anything unknown to "crossfade" only when a crossfade time is present; otherwise
 * "hardcut". Keeps dip_to_black DISTINCT from crossfade (the backend renders a real
 * fade-to-black instead of a dissolve).
 */
function transitionFromHints(transitions?: string): "hardcut" | "crossfade" | "dip_to_black" | undefined {
  if (transitions === "hardcut" || transitions === "crossfade" || transitions === "dip_to_black") return transitions;
  return undefined;
}

/** Execute a Timeline → finished video Receipt. Deterministic, idempotent, heal-aware. */
export async function renderTimeline(timeline: Timeline, backend: RenderBackend, opts: RenderOpts = {}): Promise<Receipt> {
  // 1. VALIDATE BEFORE SPEND — fail loud, never render an invalid plan.
  const v = validateTimeline(timeline);
  if (!v.ok) throw new Error(`renderTimeline: invalid plan — ${v.errors.join("; ")}`);
  const t = v.timeline as Timeline;
  const fmt = t.format;
  const ver = opts.toolVersion ?? "v1";
  const warnings: string[] = [];
  let cacheHits = 0;

  const clipCount = t.segments.filter((s) => !isCard(s)).length;
  const cardCount = t.segments.filter(isCard).length;

  // 2. WHOLE-VIDEO IDEMPOTENCY — already rendered for this exact plan?
  const finalKey = `render/${hashTimeline(t, ver)}.mp4`;
  const done = await backend.cacheGet(finalKey);
  if (done) {
    return ReceiptSchema.parse({
      videoKey: finalKey,
      videoLocalPath: done,
      durationSec: projectedDurationSec(t),
      segmentsRendered: clipCount,
      cardsRendered: cardCount,
      overlaysApplied: t.overlays.length,
      warnings,
      cacheHits: 1,
    });
  }

  // 3. PRE-OVERLAY CHECKPOINT — overlay-class heals re-finish from here, no full rebuild.
  const preKey = `render/${hashTimeline(t, ver + ":preoverlay")}.mp4`;
  let composed = await backend.cacheGet(preKey);
  let healedFrom: "full" | "preOverlay";
  let cardsRendered = 0;

  if (composed) {
    cacheHits++;
    healedFrom = "preOverlay";
  } else {
    healedFrom = "full";
    const intro = t.segments.find((s): s is Extract<Segment, { kind: "card" }> => isCard(s) && s.role === "intro");
    const outro = t.segments.find((s): s is Extract<Segment, { kind: "card" }> => isCard(s) && s.role === "outro");
    const middle = t.segments.filter((s) => !(isCard(s) && (s.role === "intro" || s.role === "outro")));

    let introCardPath: string | undefined;
    if (intro) {
      introCardPath = await backend.renderCard({ role: "intro", title: intro.title, subtitle: intro.subtitle, bgSrc: intro.bgSrc, durSec: intro.durSec }, fmt);
      cardsRendered++;
    }
    cardsRendered += middle.filter(isCard).length; // chapter cards built inside buildBody

    const bodyPath = await backend.buildBody(middle, { targetSec: t.audio.bodySec + t.audio.tailSec, fmt });

    composed = await backend.composeIntro({
      introCardPath,
      bodyPath,
      musicSrc: t.audio.musicSrc,
      narrationSrc: t.audio.narrationSrc,
      introSec: t.audio.introSec,
      bodySec: t.audio.bodySec,
      tailSec: t.audio.tailSec,
      fadeOutSec: t.audio.fadeOutSec,
      audioFadeOutSec: t.audio.audioFadeOutSec ?? t.audio.fadeOutSec,
      introMusicVol: t.audio.duck.introVol,
      bodyMusicVol: t.audio.duck.bodyVol,
      musicDuckRampSec: t.audio.duck.rampSec,
      crossfadeSec: crossfadeSecFromHints(t.renderHints?.transitions),
      transition: transitionFromHints(t.renderHints?.transitions),
      fmt,
    });

    if (outro) {
      const outroCard = await backend.renderCard({ role: "outro", title: outro.title, subtitle: outro.subtitle, bgSrc: outro.bgSrc, durSec: outro.durSec, fadeInSec: outro.fadeInSec }, fmt);
      cardsRendered++;
      const bodyDur = await backend.probe(composed);
      composed = await backend.patchOutro(composed, outroCard, Math.max(0, bodyDur - outro.durSec), outro.durSec, fmt);
    }

    await backend.cachePut(preKey, composed); // checkpoint for future overlay-class heals
  }

  // 4. OVERLAYS (finishing pass) — always run; this is where overlay-class heals re-finish.
  // renderHints.captionStyle threads through so the backend can restyle / suppress captions.
  const fin = await backend.applyOverlays(composed, t.overlays, fmt, { captionStyle: t.renderHints?.captionStyle });
  warnings.push(...fin.warnings);
  let finalPath = fin.path;

  // 4b. OPTIONAL REFRAME — portrait repurpose. Only when the plan declares a
  // portrait target (reframe.aspect 9:16/1:1) AND a non-"none" strategy AND the
  // backend implements it. Fake backends omit reframe() ⇒ this is a no-op.
  const reframeStrategy = t.renderHints?.reframe;
  const portrait = t.reframe?.aspect === "9:16" || t.reframe?.aspect === "1:1";
  if (backend.reframe && portrait && reframeStrategy && reframeStrategy !== "none") {
    const rf = await backend.reframe(finalPath, fmt, reframeStrategy);
    finalPath = rf.path;
    warnings.push(...rf.warnings);
  }

  // 4c. OPTIONAL LOUDNESS NORMALIZE — bring the mix to AudioPlan.targetLufs (e.g.
  // -14 LUFS for YouTube). Runs LAST so it normalizes the final mix (post-overlay,
  // post-reframe). Only when targetLufs is set AND the backend implements it; fake
  // backends omit normalizeLoudness ⇒ no-op (exactly like reframe).
  const targetLufs = t.audio.targetLufs;
  if (backend.normalizeLoudness && typeof targetLufs === "number") {
    const ln = await backend.normalizeLoudness(finalPath, targetLufs);
    finalPath = ln.path;
    warnings.push(...ln.warnings);
  }

  // 5. PUBLISH + cache the final.
  const videoKey = await backend.publish(finalPath);
  const durationSec = await backend.probe(finalPath);
  await backend.cachePut(finalKey, finalPath);

  return ReceiptSchema.parse({
    videoKey,
    videoLocalPath: finalPath,
    durationSec,
    segmentsRendered: clipCount,
    cardsRendered: healedFrom === "preOverlay" ? 0 : cardsRendered,
    overlaysApplied: fin.applied,
    warnings,
    cacheHits,
    healedFrom,
  });
}
