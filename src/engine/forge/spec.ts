/**
 * MODULE FORGE — spec DSL.
 *
 * When a channel needs a capability no module provides, the architect no
 * longer just queues a wish (missingCapabilities): the FORGE authors a new
 * module as a DECLARATIVE SPEC over the provider primitives we already trust
 * (LLM planning, flux stills, image-to-video, the registered Remotion comps,
 * overlay emission). A typed interpreter executes specs; this schema is the
 * safety boundary — a spec can only ever do what the primitives allow:
 * no arbitrary code, no network beyond our providers, no filesystem reach.
 *
 * Forged visual modules COMPOSITE through the proven finisher: they emit
 * overlay specs into `extraOverlays`, which timeline_assemble merges with
 * quote/insert overlays — generation is new, compositing stays battle-tested.
 */
import { z } from "zod";

/** `$store.key` | `$params.key` | `$item` | `$item.field` | `$steps.N` | literal. */
export const refSchema = z.union([z.string(), z.number(), z.boolean()]);

const llmStep = z.object({
  op: z.literal("llm_json"),
  /** Prompt template; ${refs} are interpolated. MUST instruct strict JSON. */
  prompt: z.string().min(20).max(4000),
  maxTokens: z.number().min(100).max(4000).optional(),
});

const imageStep = z.object({
  op: z.literal("image"),
  /** flux prompt template (refs interpolated). Text-free enforced by runtime. */
  prompt: z.string().min(10).max(1500),
});

const i2vStep = z.object({
  op: z.literal("i2v"),
  imageFrom: z.string(), // ref to a prior image step's url
  prompt: z.string().min(5).max(800),
  durationSec: z.number().min(5).max(10).optional(),
});

const remotionStep = z.object({
  op: z.literal("remotion"),
  comp: z.enum(["DataInsert", "TitleCard", "QuoteOverlay", "ThumbText"]),
  /** Props object; string values are ref-interpolated. */
  props: z.record(z.string(), z.any()),
  durationSec: z.number().min(1).max(20).optional(),
});

/** Emit overlay specs (merged into the timeline's compositing pass). */
const emitOverlaysStep = z.object({
  op: z.literal("emit_overlays"),
  /** Each: media from a prior step + WHERE on the timeline (refs allowed). */
  overlays: z.array(
    z.object({
      pathFrom: z.string(),
      startSec: refSchema,
      durSec: refSchema,
      noBlur: z.boolean().optional(),
      text: z.string().optional(),
    }),
  ).min(1).max(8),
});

const foreachStep = z.object({
  op: z.literal("foreach"),
  /** Ref to an array (e.g. a prior llm_json's plan). Hard-capped count. */
  overFrom: z.string(),
  max: z.number().min(1).max(16),
  steps: z.array(z.union([llmStep, imageStep, i2vStep, remotionStep, emitOverlaysStep])).min(1).max(6),
});

export const forgeStepSchema = z.union([
  llmStep, imageStep, i2vStep, remotionStep, emitOverlaysStep, foreachStep,
]);

export const forgedModuleSchema = z.object({
  /** Block id — always forged_<slug>. */
  id: z.string().regex(/^forged_[a-z0-9_]{3,40}$/),
  label: z.string().min(3).max(60),
  description: z.string().min(20).max(400),
  /** When the architect should pick this module. */
  whenToUse: z.string().min(10).max(400),
  /** Store keys read (runtime exposes only these + params). */
  consumes: z.array(z.enum([
    "topic", "script", "narrationText", "sentenceTimings", "styleDNA",
    "visualBrief", "structure", "introSec", "narrationDurationSec", "title",
  ])).min(1).max(6),
  /**
   * What it produces: forged modules may ONLY produce overlay specs
   * (extraOverlays, appended not replaced) — generation is open, mutation of
   * core keys is not. Widening this list is a human decision.
   */
  produces: z.literal("extraOverlays"),
  /** Placement anchor (inserted after the first present). */
  anchorAfter: z.array(z.string()).min(1).max(4),
  /** Tunable params surfaced to the architect (numbers only, bounded). */
  params: z.array(z.object({
    key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{1,24}$/),
    min: z.number(),
    max: z.number(),
    default: z.number(),
    describe: z.string().max(160),
  })).max(4),
  /** Hard cost ceiling the runtime enforces (USD of paid media steps). */
  maxCostUsd: z.number().min(0).max(5),
  steps: z.array(forgeStepSchema).min(1).max(12),
});

export type ForgedModuleSpec = z.infer<typeof forgedModuleSchema>;
export type ForgeStep = z.infer<typeof forgeStepSchema>;
