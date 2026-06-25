/**
 * ChannelProfile — the canonical per-account "spine".
 *
 * Per-account customization currently fans out into ~14 loose `ctx.store` keys at
 * run time (styleDNA, voiceId, palette, qualityBar, pipeline, channelName, …).
 * This type unifies them into ONE typed object that every module reads from, so a
 * channel is customized by DATA, not by per-channel code paths.
 *
 * SKELETON — ADDITIVE ONLY. Nothing in the live pipeline imports this yet; it
 * composes the EXISTING types (`ChannelIdentity`, `StyleDNA`, `PipelineEntry`) so
 * adopting it module-by-module is a pure, behavior-preserving refactor. Each
 * module adds the slice it needs as it gets leveled up.
 *
 * Modules are OPT-IN per channel: `pipeline` is the ordered set of modules this
 * channel actually runs — NOT every channel needs every module. Consumers ask
 * `usesModule(profile, "<block>")` instead of assuming a module is present, and
 * the future Pipeline Architect composes only the modules a channel declares.
 */
import { z } from "zod";
import type { ChannelIdentity, ChannelRow } from "@/lib/types";
import type { StyleDNA } from "./creative/types";
import type { PipelineEntry } from "./types";

/** One module the channel runs, with its per-channel params. Mirrors PipelineEntry. */
export const PipelineEntrySchema = z.object({
  block: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

export const ChannelProfileSchema = z.object({
  /* --- identity --- */
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  status: z.string().default("paused"),
  /** Archetype key (narrated-essay | lofi-ambient | crime-narrative | shorts | meditation | …) — the module-set baseline. */
  archetype: z.string(),
  /** Legacy template letter (A–E), kept for back-compat with channel rows. */
  template: z.string().optional(),
  budget: z.number().nonnegative().default(0),

  /* --- brand (typed passthrough — each is validated at its own source) --- */
  identity: z.custom<ChannelIdentity>(() => true),
  /** Deep visual/audio DNA. Absent until the channel is "established" (StyleDNA.confidence gate). */
  styleDNA: z.custom<StyleDNA>(() => true).optional(),

  /* --- the OPT-IN module set: which modules this channel runs, in order --- */
  pipeline: z.array(PipelineEntrySchema),

  /** Per-module param overrides, merged OVER a pipeline entry's own params. Lets a
   *  channel tune any module without touching code or the archetype default. */
  moduleOverrides: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
});

/** The canonical per-account object. Source of truth = the zod schema above. */
export type ChannelProfile = z.infer<typeof ChannelProfileSchema>;

/* --------------------------------- helpers --------------------------------- */

/** The set of module/block ids this channel actually runs. */
export function channelModules(p: ChannelProfile): Set<string> {
  return new Set(p.pipeline.map((e) => e.block));
}

/** Does this channel run the given module? (Not every channel needs every module.) */
export function usesModule(p: ChannelProfile, block: string): boolean {
  return p.pipeline.some((e) => e.block === block);
}

/** Merged params a module should run with: its pipeline-entry params + any profile override. */
export function moduleParams(p: ChannelProfile, block: string): Record<string, unknown> {
  const entry = p.pipeline.find((e) => e.block === block)?.params ?? {};
  const override = p.moduleOverrides?.[block] ?? {};
  return { ...entry, ...override };
}

/**
 * Assemble a ChannelProfile from the existing channel row + resolved pipeline +
 * (optional) distilled StyleDNA. PURE — no I/O. This is the single adapter that
 * will replace the ~14-key store fan-out: a module calls this once and reads the
 * typed object instead of reaching into `ctx.store`. Validates on build (fail loud).
 */
export function buildChannelProfile(args: {
  row: Pick<ChannelRow, "_id" | "name" | "slug" | "status" | "template" | "budget" | "identity">;
  archetype: string;
  pipeline: PipelineEntry[];
  styleDNA?: StyleDNA;
  moduleOverrides?: Record<string, Record<string, unknown>>;
}): ChannelProfile {
  const { row, archetype, pipeline, styleDNA, moduleOverrides } = args;
  return ChannelProfileSchema.parse({
    id: row._id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    archetype,
    template: row.template,
    budget: row.budget,
    identity: row.identity ?? {},
    styleDNA,
    pipeline,
    moduleOverrides,
  });
}
