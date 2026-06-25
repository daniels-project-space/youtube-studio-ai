/**
 * Timeline — the typed EDL (edit-decision list) that IS the Assembly module's contract.
 *
 * The old `timeline_assemble` block fused edit-decisions + rendering + healing into
 * one imperative 269-LOC block reading 9 hidden store keys. This splits BRAIN from
 * HANDS: `planTimeline()` emits a pure, inspectable, hashable `Timeline`; a pure
 * `renderTimeline()` executes it deterministically. A Timeline is DATA — unit-testable
 * with no Trigger/Convex/ffmpeg in the loop.
 *
 * ADDITIVE ONLY — nothing imports this yet; the live block keeps running untouched
 * until the new path is parity-proven.
 */
import { z } from "zod";

/** Output canvas. */
export const FormatSchema = z.object({
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  fps: z.number().int().positive().default(30),
});

/* --- body track: a discriminated union of clip vs card segments --- */
const FootageSeg = z.object({
  kind: z.literal("footage"),
  src: z.string(), // local path / R2 key / url
  inSec: z.number().nonnegative().optional(),
  durSec: z.number().positive(),
  /** true if this cut was placed on a beat / sentence boundary. */
  onBeat: z.boolean().optional(),
});
const EntitySeg = FootageSeg.extend({ kind: z.literal("entity") });
const CardSeg = z.object({
  kind: z.literal("card"),
  role: z.enum(["intro", "chapter", "outro"]),
  durSec: z.number().positive(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  bgSrc: z.string().optional(),
  fadeInSec: z.number().nonnegative().optional(),
});
export const SegmentSchema = z.discriminatedUnion("kind", [FootageSeg, EntitySeg, CardSeg]);

/** Audio plan: narration over a ducked music bed, at broadcast loudness. */
export const AudioPlanSchema = z.object({
  narrationSrc: z.string().optional(),
  musicSrc: z.string().optional(),
  introSec: z.number().nonnegative().default(0),
  bodySec: z.number().nonnegative(),
  tailSec: z.number().nonnegative().default(3),
  duck: z
    .object({
      introVol: z.number().min(0).max(2).default(0.513),
      bodyVol: z.number().min(0).max(2).default(0.1026),
      rampSec: z.number().nonnegative().default(4),
    })
    .default({}),
  fadeOutSec: z.number().nonnegative().default(2),
  audioFadeOutSec: z.number().nonnegative().optional(),
  /** Integrated loudness target (e.g. -14 LUFS for YouTube). Renderer normalizes to this. */
  targetLufs: z.number().optional(),
  /** Composer's narration voice FX (radio / warm / telephone). Carried for the audio pass. */
  voiceFx: z.string().optional(),
});

/** A timed overlay window. Captions/quotes/inserts mount only within [startSec,endSec]. */
export const OverlaySchema = z.object({
  kind: z.enum(["caption", "quote", "insert"]),
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
  src: z.string().optional(),
  text: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  style: z.record(z.string(), z.unknown()).optional(),
});

/** The full edit-plan. Pure data → inspectable, hashable, testable. */
export const TimelineSchema = z.object({
  version: z.literal(1).default(1),
  format: FormatSchema,
  /** Ordered body track (clips + cards). */
  segments: z.array(SegmentSchema).min(1),
  audio: AudioPlanSchema,
  overlays: z.array(OverlaySchema).default([]),
  /** Hard length gate — render aborts (loud) if the projected runtime lands outside [min,max]±tol. */
  lengthBand: z
    .object({
      minSec: z.number().nonnegative().default(0),
      maxSec: z.number().nonnegative().default(0),
      tolSec: z.number().nonnegative().default(30),
    })
    .default({}),
  /** Declared heal point — overlay-class defects re-render from here, no regex on hints. */
  checkpoints: z.object({ preOverlaySec: z.number().nonnegative().optional() }).default({}),
  /** Optional vertical/social reframe. */
  reframe: z.object({ aspect: z.enum(["16:9", "9:16", "1:1"]), strategy: z.string().optional() }).optional(),
  /**
   * Optional render hints — declarative knobs the backend reads to choose between
   * proven primitives (kept OPTIONAL so pre-existing plans/tests validate unchanged).
   *   transitions → composeIntro crossfade seconds (hardcut=0, crossfade/dip=0.8)
   *   reframe     → post-compose center-crop strategy for portrait targets
   */
  renderHints: z
    .object({
      transitions: z.enum(["hardcut", "crossfade", "dip_to_black"]).optional(),
      reframe: z.enum(["none", "center", "subject_track"]).optional(),
      /** Editor's caption-style intent (→ caption pass). none/minimal/karaoke/bold. */
      captionStyle: z.enum(["none", "minimal", "karaoke", "bold"]).optional(),
    })
    .optional(),
  meta: z.object({ channelSlug: z.string().optional(), runId: z.string().optional(), archetype: z.string().optional() }).optional(),
});

/** What renderTimeline returns — receipts, not prose. No silent skips: drops surface as warnings. */
export const ReceiptSchema = z.object({
  videoKey: z.string(),
  videoLocalPath: z.string().optional(),
  durationSec: z.number().nonnegative(),
  segmentsRendered: z.number().int().nonnegative(),
  cardsRendered: z.number().int().nonnegative().default(0),
  overlaysApplied: z.number().int().nonnegative().default(0),
  /** Typed, gateable degradations (a dropped card/overlay) — never a swallowed log line. */
  warnings: z.array(z.string()).default([]),
  /** Content-addressed segments reused on retry (idempotency). */
  cacheHits: z.number().int().nonnegative().default(0),
  healedFrom: z.enum(["full", "preOverlay"]).optional(),
});

export type Format = z.infer<typeof FormatSchema>;
export type Segment = z.infer<typeof SegmentSchema>;
export type AudioPlan = z.infer<typeof AudioPlanSchema>;
export type Overlay = z.infer<typeof OverlaySchema>;
export type Timeline = z.infer<typeof TimelineSchema>;
export type Receipt = z.infer<typeof ReceiptSchema>;

/* ------------------------------- helpers ------------------------------- */

/** Projected total runtime of the plan (intro + body + tail). */
export function projectedDurationSec(t: Timeline): number {
  return t.audio.introSec + t.audio.bodySec + t.audio.tailSec;
}

/**
 * Validate a Timeline BEFORE spending any render compute (the rubric's "validate
 * before spend" + "fail loud"). Returns the parsed Timeline or a list of human errors.
 * Pure — no I/O.
 */
export function validateTimeline(raw: unknown): { ok: boolean; timeline?: Timeline; errors: string[] } {
  const parsed = TimelineSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const t = parsed.data;
  const errors: string[] = [];
  const total = projectedDurationSec(t);

  // length band (the old early length-gate, now declarative)
  const { minSec, maxSec, tolSec } = t.lengthBand;
  if (maxSec > 0 && total > maxSec + tolSec) errors.push(`length: projected ${Math.round(total)}s > max ${maxSec}s (+${tolSec} tol)`);
  if (minSec > 0 && total < minSec - tolSec) errors.push(`length: projected ${Math.round(total)}s < min ${minSec}s (-${tolSec} tol)`);

  // overlays must sit inside the runtime
  for (const [i, o] of t.overlays.entries()) {
    if (o.endSec <= o.startSec) errors.push(`overlay[${i}] (${o.kind}): endSec ${o.endSec} <= startSec ${o.startSec}`);
    if (o.endSec > total + 0.5) errors.push(`overlay[${i}] (${o.kind}): endSec ${o.endSec} exceeds runtime ${Math.round(total)}s`);
  }

  // real media: a clip segment with an empty src is dead-air, not coverage (0-footage trap)
  for (const [i, s] of t.segments.entries()) {
    if (s.kind !== "card" && !(s.src && s.src.trim())) errors.push(`segment[${i}] (${s.kind}): empty media src (dead-air, not coverage)`);
  }
  // body coverage: footage/entity segment time should cover the narration body
  const clipCoverage = t.segments.filter((s) => s.kind !== "card").reduce((a, s) => a + s.durSec, 0);
  if (clipCoverage + 0.5 < t.audio.bodySec) errors.push(`coverage: clips total ${clipCoverage.toFixed(1)}s < body ${t.audio.bodySec}s (would loop / dead-air)`);

  // heal checkpoint sanity
  const cp = t.checkpoints.preOverlaySec;
  if (cp !== undefined && cp > total + 0.5) errors.push(`checkpoint.preOverlaySec ${cp} exceeds runtime ${Math.round(total)}s`);

  return errors.length ? { ok: false, errors } : { ok: true, timeline: t, errors: [] };
}
