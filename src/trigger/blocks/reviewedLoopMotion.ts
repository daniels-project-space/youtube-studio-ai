import { artifactContract } from "@/engine/artifactSchemas";
import { ExecutionError } from "@/engine/executionErrors";
import { LoopKeyframeDirectionSchema } from "@/engine/loopVisualPlan";
import type { ModuleManifest } from "@/engine/moduleManifest";
import { stageReuseHash } from "@/engine/stageReuse";
import type { StageContext } from "@/engine/types";
import { verifyBoundLoopVisualPlan } from "./boundLoopVisuals";
import { createLoopClipsBlock } from "./lofiBlocks";
import { createYuE2KeyframesManifest, createYuE2LoopVisualManifest, admitYuE2LoopSource } from "./yue2LoopVisuals";

export const REVIEWED_MOTION_KEYFRAMES_VERSION = "3.1.0-yue2-reviewed-motion";
export const REVIEWED_MOTION_CLIPS_VERSION = "2.1.0-yue2-reviewed-motion";

export function createReviewedMotionKeyframesManifest(legacy: ModuleManifest, planner: ModuleManifest): ModuleManifest {
  const source = createYuE2KeyframesManifest(legacy, planner);
  const run = async (ctx: StageContext) => {
    if (ctx.params.qaProfile === "draft" || ctx.params.qualityProfile === "draft") {
      throw new ExecutionError("Reviewed loop motion requires production keyframe review before rendering", { retryable: false });
    }
    const plan = await verifyBoundLoopVisualPlan(ctx);
    const patch = await source.execute(ctx);
    return { ...patch, loopKeyframeDirection: LoopKeyframeDirectionSchema.parse({
      version: "loop-keyframe-direction/v1", ownerId: ctx.ownerId, channelId: ctx.channelId, runId: ctx.runId,
      visualPlanFingerprint: plan.fingerprint, f1Key: patch.f1Key, motionPrompt: patch.motionPrompt, reviewProfile: "production",
    }) };
  };
  const block = { ...source.block, produces: [...source.block.produces, "loopKeyframeDirection"], run };
  return { ...source, version: REVIEWED_MOTION_KEYFRAMES_VERSION, block, execute: run,
    produces: { ...source.produces, loopKeyframeDirection: artifactContract("loopKeyframeDirection") },
    requiredDownstreamCapabilities: [...new Set([...source.requiredDownstreamCapabilities, "visuals.motion_generated"])],
    requiredDownstreamConsumes: { ...source.requiredDownstreamConsumes, "visuals.motion_generated": "loopKeyframeDirection" },
    certification: { status: "contract", evidence: "Retains one production-reviewed still/motion pair bound to the scene plan; not artistic qualification." } };
}

async function reviewedMotion(ctx: StageContext) {
  try {
    const plan = await verifyBoundLoopVisualPlan(ctx);
    const direction = LoopKeyframeDirectionSchema.parse(ctx.store["loopKeyframeDirection"]);
    const ref = ctx.artifactRefs?.loopKeyframeDirection;
    if (!ref || ref.key !== "loopKeyframeDirection" || ref.type !== "LoopKeyframeDirection" ||
      ref.producerModule !== "keyframes" || ref.producerVersion !== REVIEWED_MOTION_KEYFRAMES_VERSION ||
      !ref.artifactId.startsWith(`${ctx.runId}:keyframes:loopKeyframeDirection:`) ||
      ref.payloadHash !== stageReuseHash(direction) ||
      direction.ownerId !== ctx.ownerId || direction.channelId !== ctx.channelId || direction.runId !== ctx.runId ||
      direction.visualPlanFingerprint !== plan.fingerprint || direction.f1Key !== ctx.store["f1Key"] ||
      direction.motionPrompt !== ctx.store["motionPrompt"]) {
      throw new Error("current reviewed keyframe, motion and visual plan must have matching producer lineage and payload");
    }
    return direction.motionPrompt;
  } catch (error) {
    throw new ExecutionError(`Reviewed loop motion handoff invalid: ${error instanceof Error ? error.message : error}`,
      { retryable: false, code: "LOOP_MOTION_HANDOFF_INVALID" });
  }
}

export function createReviewedMotionClipsManifest(legacy: ModuleManifest, planner: ModuleManifest): ModuleManifest {
  const source = createYuE2LoopVisualManifest(legacy);
  const block = createLoopClipsBlock(admitYuE2LoopSource, reviewedMotion);
  const consumes = { ...source.consumes, ...planner.consumes,
    loopVisualPlan: artifactContract("loopVisualPlan"), loopKeyframeDirection: artifactContract("loopKeyframeDirection"),
    motionPrompt: artifactContract("motionPrompt") };
  return { ...source, version: REVIEWED_MOTION_CLIPS_VERSION, block, execute: block.run, consumes,
    optionalConsumes: Object.fromEntries(Object.entries({ ...source.optionalConsumes, ...planner.optionalConsumes })
      .filter(([key]) => !(key in consumes))),
    requiredCapabilities: [...source.requiredCapabilities, "visuals.bound_scene_plan", "visuals.keyframe_generated"],
    certification: { status: "contract", evidence: "Uses the bound image-grounded motion direction, never a program/template substitute; not motion-output qualification." } };
}
