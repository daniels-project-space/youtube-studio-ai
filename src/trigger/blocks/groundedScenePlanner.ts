import { z } from "zod";
import { artifactContract } from "@/engine/artifactSchemas";
import type { ModuleManifest } from "@/engine/moduleManifest";
import { planScenes, type ScenePlanInput } from "@/engine/prompt/scenePlanner";
import { LoopVisualIdentitySchema, resolveLoopVisualIdentity } from "@/engine/loopVisualPlan";
import { createScenePlannerBlock } from "./lofiBlocks";

export const GROUNDED_SCENE_PLANNER_VERSION = "2.0.0-grounded-deterministic";
const text = z.string().trim().min(1).max(4000);
const libraryEntry = z.object({
  fluxPrompt: text, klingMotionPrompt: text,
  durationSec: z.number().finite().positive().optional(), musicPrompt: z.string().max(4000).optional(),
});

/** Deterministic visual-only projection; audio, narration and SEO remain untouched. */
export function planGroundedScenes(input: ScenePlanInput) {
  text.parse(input.topic);
  if (input.defaultDurationSec !== undefined) z.number().finite().positive().parse(input.defaultDurationSec);
  const dna = LoopVisualIdentitySchema.parse(input.styleDNA);
  // Authored library entries remain exact, not silently rewritten by synthesis.
  if (input.sceneLibrary && Object.hasOwn(input.sceneLibrary, input.topic)) {
    libraryEntry.parse(input.sceneLibrary[input.topic]);
    return planScenes(input);
  }
  // The legacy synthesizer drops the subject in its signature-scene branch.
  // Resolve that choice first, then use its single-scene identity composition.
  return planScenes({
    ...input, sceneLibrary: undefined,
    styleDNA: resolveLoopVisualIdentity(input.topic, dna),
  });
}

/** Opt-in revision: legacy pipelines keep their original scene-selection behavior. */
export function createGroundedScenePlannerManifest(legacy: ModuleManifest): ModuleManifest {
  if (legacy.id !== "scene_planner") throw new Error("grounded scene planning requires scene_planner");
  const block = createScenePlannerBlock(planGroundedScenes);
  const { styleDNA: _legacyOptional, ...optionalConsumes } = legacy.optionalConsumes;
  const { musicProgramMotionIntent, ...produces } = legacy.produces;
  void _legacyOptional;
  return {
    ...legacy, version: GROUNDED_SCENE_PLANNER_VERSION,
    consumes: { ...legacy.consumes, styleDNA: artifactContract("styleDNA") }, optionalConsumes,
    produces, optionalProduces: { ...legacy.optionalProduces, musicProgramMotionIntent },
    certification: { status: "contract", evidence: "Deterministic subject-preserving scene planning; not real-output or production qualification." },
    block, execute: block.run,
  };
}
