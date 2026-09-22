import { artifactContract } from "@/engine/artifactSchemas";
import { LoopVisualIdentitySchema, LoopVisualPlanSchema, LoopVisualPlanningParamsSchema, loopVisualPlanFingerprint, resolveLoopVisualIdentity } from "@/engine/loopVisualPlan";
import type { ModuleManifest } from "@/engine/moduleManifest";
import { planScenes } from "@/engine/prompt/scenePlanner";
import type { StageContext } from "@/engine/types";
import { stageReuseHash } from "@/engine/stageReuse";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import { musicProgramForCurrentRoute } from "./blockContext";
import { createGroundedScenePlannerManifest, planGroundedScenes } from "./groundedScenePlanner";
import { createKeyframesBlock, createScenePlannerBlock } from "./lofiBlocks";

export const BOUND_SCENE_PLANNER_VERSION = "3.0.0-bound-visual-plan";
export const BOUND_KEYFRAMES_VERSION = "2.0.0-bound-visual-plan";

async function planBoundVisuals(ctx: StageContext) {
  const planningParams = LoopVisualPlanningParamsSchema.parse(Object.fromEntries(
    ["clipDurationSec", "visualStyle", "setting", "sceneLibrary"].filter(key => ctx.params[key] !== undefined).map(key => [key, ctx.params[key]]),
  ));
  const program = musicProgramForCurrentRoute(ctx, String(ctx.store["topic"]));
  let bound: unknown;
  const block = createScenePlannerBlock(input => {
    const sourceIdentity = LoopVisualIdentitySchema.parse(input.styleDNA);
    const fromLibrary = !!input.sceneLibrary && Object.hasOwn(input.sceneLibrary, input.topic);
    if (fromLibrary && program) {
      throw new Error("bound scene plan: authored library and sealed music program both own this scene; resolve the conflicting inputs before rendering");
    }
    const identity = program
      ? { ...sourceIdentity, signatureScenes: [], setting: program.visual.setting, motionVocabulary: [program.visual.motionIntent] }
      : fromLibrary ? sourceIdentity : resolveLoopVisualIdentity(input.topic, sourceIdentity);
    // Validate the same public planning inputs as the previous opt-in revision.
    const plan = planGroundedScenes({ ...input, styleDNA: identity });
    const scenes = program ? planScenes({ ...input, sceneLibrary: undefined, styleDNA: identity }).scenes : plan.scenes;
    const body = {
      version: "loop-visual-plan/v1" as const, ownerId: ctx.ownerId, channelId: ctx.channelId, runId: ctx.runId,
      topic: input.topic, planningParams, inputFingerprint: sha256Hex(canonicalJson({ ...input, styleDNA: sourceIdentity })),
      programFingerprint: program?.fingerprint ?? null,
      authority: program ? "music_program" as const : fromLibrary ? "authored_library" as const : "channel_identity" as const,
      identity, scene: scenes[0],
    };
    bound = LoopVisualPlanSchema.parse({ ...body, fingerprint: loopVisualPlanFingerprint(body) });
    return { ...plan, scenes };
  });
  const result = await block.run(ctx);
  return { ...result, loopVisualPlan: LoopVisualPlanSchema.parse(bound) };
}

async function admittedVisualIdentity(ctx: StageContext) {
  const actual = LoopVisualPlanSchema.parse(ctx.store["loopVisualPlan"]);
  const ref = ctx.artifactRefs?.["loopVisualPlan"];
  if (!ref || ref.key !== "loopVisualPlan" || ref.producerModule !== "scene_planner" ||
    ref.producerVersion !== BOUND_SCENE_PLANNER_VERSION || ref.type !== "LoopVisualPlan" ||
    !ref.artifactId.startsWith(`${ctx.runId}:scene_planner:loopVisualPlan:`) ||
    ref.payloadHash !== stageReuseHash(ctx.store["loopVisualPlan"])) {
    throw new Error("bound keyframes: current planner producer lineage and payload hash are required before rendering");
  }
  // Fingerprints alone are not authority: reconstruct from current frozen inputs.
  const expected = (await planBoundVisuals({ ...ctx, params: actual.planningParams, log: () => {} })).loopVisualPlan;
  if (canonicalJson(actual) !== canonicalJson(expected) ||
    canonicalJson(ctx.store["scenes"]) !== canonicalJson([actual.scene])) {
    throw new Error("bound keyframes: visual plan does not bind the current run, scene and frozen planning inputs");
  }
  return actual.identity;
}

export function createBoundScenePlannerManifest(legacy: ModuleManifest): ModuleManifest {
  const grounded = createGroundedScenePlannerManifest(legacy);
  const block = { ...grounded.block, produces: [...grounded.block.produces, "loopVisualPlan"], run: planBoundVisuals };
  return { ...grounded, version: BOUND_SCENE_PLANNER_VERSION, block, execute: block.run,
    capabilities: [...grounded.capabilities, "visuals.bound_scene_plan"],
    requiredDownstreamCapabilities: [...grounded.requiredDownstreamCapabilities, "visuals.keyframe_generated"],
    requiredDownstreamConsumes: { ...grounded.requiredDownstreamConsumes, "visuals.keyframe_generated": "loopVisualPlan" },
    produces: { ...grounded.produces, loopVisualPlan: artifactContract("loopVisualPlan") },
    certification: { status: "contract", evidence: "Run-bound scene and effective identity handoff; not real-output qualification." } };
}

export function createBoundKeyframesManifest(legacy: ModuleManifest, planner: ModuleManifest): ModuleManifest {
  if (legacy.id !== "keyframes" || planner.id !== "scene_planner") throw new Error("bound visuals require scene_planner and keyframes");
  const block = createKeyframesBlock(admittedVisualIdentity, true);
  const consumes = { ...legacy.consumes, ...planner.consumes, loopVisualPlan: artifactContract("loopVisualPlan") };
  const optionalConsumes = Object.fromEntries(Object.entries({ ...legacy.optionalConsumes, ...planner.optionalConsumes })
    .filter(([key]) => !(key in consumes)));
  return { ...legacy, version: BOUND_KEYFRAMES_VERSION, consumes, optionalConsumes, block, execute: block.run,
    requiredCapabilities: [...legacy.requiredCapabilities, "visuals.bound_scene_plan"],
    certification: { status: "contract", evidence: "Revalidates frozen visual plan before paid image generation and reviews its selected setting; not artistic qualification." } };
}
