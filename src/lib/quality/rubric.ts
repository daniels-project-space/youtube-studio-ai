/**
 * CHANNEL QUALITY RUBRIC — the explicit, per-channel definition of "what good
 * looks like", anchored to the GOLDEN reference for the format.
 *
 * The problem this solves: QA was vision-only + presence-based, so defects
 * (silent tail, buried VO, bad mix, thin visuals) shipped. Quality is now DATA:
 * named dimensions, each with a hard-gate flag + a pass floor + a weight, plus
 * free-text house standards — and every assessment grades against the certified
 * GOLDEN_MODULES entry for that format ("does this match our golden example?").
 *
 * Universal hard gates (every channel): narration audible+dominant, mix
 * loudness/no-clip, text legible+spelled. Channel-tunable hard gates (default
 * ON per the product decision): production value, narrative hook/arc/payoff,
 * on-brand. Coherence is scored but not blocking by default.
 */
import { GOLDEN_MODULES, CRAFT_RULES } from "@/engine/golden";

export type QualityDimension =
  | "audio_dialogue" // narration present, intelligible, dominant over the bed
  | "audio_mix" // broadcast loudness, no clipping, smooth ducking
  | "text_legibility" // on-screen text readable, clear of faces, correctly spelled
  | "production_value" // depth / motion / layering / richness — "more to the slides"
  | "narrative" // hook in the first seconds, arc, payoff; factual; no filler
  | "brand_fit" // palette / type / voice / pacing match the channel
  | "coherence"; // each shot SHOWS what its line says

export interface DimensionSpec {
  /** Contribution to the weighted overall score. */
  weight: number;
  /** Failing this BLOCKS the ship (a hard gate). */
  hardGate: boolean;
  /** Minimum 1–10 score to pass. */
  floor: number;
  /** Optional channel house-standard prose for this dimension. */
  note?: string;
}

export interface ChannelQualitySpec {
  channelId?: string;
  /** Format engine id (documotion | loreshort | comic | whiteboard | lofi | cinematic). */
  format: string;
  /** GOLDEN_MODULES key to grade against (the reference example). */
  goldenKey?: string;
  dims: Record<QualityDimension, DimensionSpec>;
  /** Free-form "this channel demands…" prose fed to the judge. */
  houseStandards?: string;
  /** Deterministic audio targets. */
  audio: { targetLufs: number; truePeakCeilingDb: number; minDialogueLeadDb: number; wpm: [number, number] };
  /** Technical floor. */
  technical: { minWidth: number; minHeight: number; durationSec?: [number, number] };
}

const HARD = (weight: number, floor = 7): DimensionSpec => ({ weight, hardGate: true, floor });
const SOFT = (weight: number, floor = 6): DimensionSpec => ({ weight, hardGate: false, floor });

/** Map a format engine id → the GOLDEN_MODULES key that exemplifies it. */
const FORMAT_GOLDEN: Record<string, string> = {
  documotion: "documotion",
  loreshort: "loreshort",
  comic: "motioncomic",
  whiteboard: "whiteboard",
  lofi: "lofi",
  cinematic: "cinematic",
};

/** The golden reference (how-it-should-be + its gates) for a format — the yardstick. */
export function goldenReference(format: string): { title: string; how: string; gates: string[] } | null {
  const key = FORMAT_GOLDEN[format] ?? format;
  const g = GOLDEN_MODULES.find((m) => m.key === key) ?? GOLDEN_MODULES.find((m) => m.key.includes(format) || format.includes(m.key));
  return g ? { title: g.title, how: g.how, gates: g.gates } : null;
}

/** The retention craft every narrated channel inherits — the narrative bar. */
export const NARRATIVE_CRAFT = CRAFT_RULES;

/** A strong default rubric for a format, anchored to its golden example. The
 *  per-channel layer (resolveRubric) overrides any field. */
export function defaultRubric(format: string): ChannelQualitySpec {
  const ambient = format === "lofi"; // music-only, no narration
  return {
    format,
    goldenKey: FORMAT_GOLDEN[format] ?? format,
    dims: {
      audio_dialogue: ambient ? SOFT(0) : HARD(3, 7),
      audio_mix: HARD(2, 7),
      text_legibility: HARD(2, 7),
      production_value: HARD(3, 7),
      narrative: ambient ? SOFT(1) : HARD(3, 7),
      brand_fit: HARD(2, 7),
      coherence: SOFT(2, 6),
    },
    audio: {
      targetLufs: -14,
      truePeakCeilingDb: -1.0,
      minDialogueLeadDb: ambient ? 0 : 9,
      wpm: [120, 165], // documentary-paced narration
    },
    technical: { minWidth: 1280, minHeight: 720 },
  };
}

/** Resolve the effective rubric: format default ⊕ per-channel overrides (deep, shallow-merged per field). */
export function resolveRubric(format: string, overrides?: Partial<ChannelQualitySpec>): ChannelQualitySpec {
  const base = defaultRubric(format);
  if (!overrides) return base;
  return {
    ...base,
    ...overrides,
    dims: { ...base.dims, ...(overrides.dims ?? {}) },
    audio: { ...base.audio, ...(overrides.audio ?? {}) },
    technical: { ...base.technical, ...(overrides.technical ?? {}) },
  };
}

/** The dimensions that are hard gates for this spec (failing any blocks the ship). */
export function hardGates(spec: ChannelQualitySpec): QualityDimension[] {
  return (Object.keys(spec.dims) as QualityDimension[]).filter((d) => spec.dims[d].hardGate);
}
