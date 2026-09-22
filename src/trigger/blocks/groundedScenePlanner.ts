import { z } from "zod";
import { artifactContract } from "@/engine/artifactSchemas";
import type { ModuleManifest } from "@/engine/moduleManifest";
import { planScenes, type ScenePlanInput } from "@/engine/prompt/scenePlanner";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import { createScenePlannerBlock } from "./lofiBlocks";

export const GROUNDED_SCENE_PLANNER_VERSION = "2.0.0-grounded-deterministic";
const text = z.string().trim().min(1).max(4000);
const texts = z.array(text).max(64);
const visualIdentity = z.object({
  recurringSubject: text, setting: text,
  signatureScenes: z.array(z.object({ name: text, setting: text, motion: text })).max(64).optional(),
  composition: z.string().max(4000).optional(), colorGrade: z.string().max(4000).optional(),
  motifs: texts.optional(), visualAvoid: texts.optional(), motionVocabulary: texts.optional(),
  motionDiscipline: z.string().max(4000).optional(),
});
const libraryEntry = z.object({
  fluxPrompt: text, klingMotionPrompt: text,
  durationSec: z.number().finite().positive().optional(), musicPrompt: z.string().max(4000).optional(),
});

/** Deterministic visual-only projection; audio, narration and SEO remain untouched. */
export function planGroundedScenes(input: ScenePlanInput) {
  text.parse(input.topic);
  if (input.defaultDurationSec !== undefined) z.number().finite().positive().parse(input.defaultDurationSec);
  const dna = visualIdentity.parse(input.styleDNA);
  // Authored library entries remain exact, not silently rewritten by synthesis.
  if (input.sceneLibrary && Object.hasOwn(input.sceneLibrary, input.topic)) {
    libraryEntry.parse(input.sceneLibrary[input.topic]);
    return planScenes(input);
  }
  const choices = dna.signatureScenes ?? [];
  const seed = sha256Hex(canonicalJson({ topic: input.topic.trim(), subject: dna.recurringSubject, choices }));
  const choice = choices.length ? choices[Number.parseInt(seed.slice(0, 12), 16) % choices.length] : undefined;
  // The legacy synthesizer drops the subject in its signature-scene branch.
  // Resolve that choice first, then use its single-scene identity composition.
  return planScenes({
    ...input, sceneLibrary: undefined,
    styleDNA: {
      ...dna, signatureScenes: [],
      setting: choice?.setting ?? dna.setting,
      motionVocabulary: choice ? [choice.motion] : dna.motionVocabulary,
    },
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
