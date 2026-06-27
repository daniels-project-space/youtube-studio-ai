/**
 * VideoBrief accessor — the ONE typed view over the crew's slices.
 *
 * The five crew-role blocks each produce a slice into separate ctx.store keys
 * (structure / visualBrief / cutSheet / musicBrief / validationSpec). Consumers
 * used to read them with scattered ad-hoc casts (`ctx.store["visualBrief"] as
 * {...}`). This module is the single place that knows the slice → key mapping and
 * returns the real types, so cross-module reads are type-safe and the whole brief
 * can be passed around as one object (the contract Mastra workflow-state needs).
 *
 * Tier-2 (docs/MODULES_TO_MASTRA.md). Pure reads — behaviour-identical to the
 * raw store access it replaces.
 */
import type {
  VideoBrief,
  StructureBrief,
  VisualBrief,
  CutSheet,
  AudioBrief,
  ValidationSpec,
} from "./types";

type Store = Record<string, unknown>;

/** The Composer's raw store output (the "musicBrief" key): prompt + audio mix. */
export interface MusicBrief {
  musicPrompt?: string;
  audio?: AudioBrief;
}

export function getStructure(s: Store): StructureBrief | undefined {
  return s["structure"] as StructureBrief | undefined;
}
export function getVisualBrief(s: Store): VisualBrief | undefined {
  return s["visualBrief"] as VisualBrief | undefined;
}
export function getCutSheet(s: Store): CutSheet | undefined {
  return s["cutSheet"] as CutSheet | undefined;
}
export function getMusicBrief(s: Store): MusicBrief | undefined {
  return s["musicBrief"] as MusicBrief | undefined;
}
export function getValidationSpec(s: Store): ValidationSpec | undefined {
  return s["validationSpec"] as ValidationSpec | undefined;
}

/** Assemble the scattered crew-slice store keys into ONE typed VideoBrief. */
export function readVideoBrief(s: Store): VideoBrief {
  const music = getMusicBrief(s);
  return {
    structure: getStructure(s),
    visual: getVisualBrief(s),
    cutSheet: getCutSheet(s),
    musicPrompt: music?.musicPrompt,
    audio: music?.audio,
    validation: getValidationSpec(s),
  };
}
