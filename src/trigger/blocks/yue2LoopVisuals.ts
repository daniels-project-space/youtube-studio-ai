import { artifactContract } from "@/engine/artifactSchemas";
import { ChannelProfileSchema, parseFrozenChannelProfile } from "@/engine/channelProfile";
import type { ModuleManifest } from "@/engine/moduleManifest";
import type { StageContext } from "@/engine/types";
import { ExecutionError } from "@/engine/executionErrors";
import { verifyApprovedYuE2Source } from "@/lib/approvedYuE2AssemblySource";
import { musicProgramForCurrentRoute } from "./blockContext";
import { createLoopClipsBlock, createMusicProgramPlanBlock } from "./lofiBlocks";
import { createBoundKeyframesManifest } from "./boundLoopVisuals";

export const YUE2_PROGRAM_VERSION = "2.0.0-yue2-intent";
export const YUE2_FROZEN_PROGRAM_VERSION = "2.1.0-yue2-frozen-identity";
export const YUE2_KEYFRAMES_VERSION = "3.0.0-yue2-reviewed";
export const YUE2_LOOP_CLIPS_VERSION = "2.0.0-yue2-reviewed";

export async function admitYuE2LoopSource(ctx: StageContext) {
  const program = musicProgramForCurrentRoute(ctx, String(ctx.store["topic"]));
  if (program && program.audio.providerPreference !== "yue2") {
    throw new Error("YuE2 loop visuals require the sealed YuE2 program, not a legacy provider plan");
  }
  const source = await verifyApprovedYuE2Source(ctx, "repeat");
  if (source.arrangement.arrangement.role !== "primary_music") {
    throw new Error("YuE2 loop visuals require the primary-music arrangement");
  }
  return source;
}

export function createYuE2ProgramManifest(legacy: ModuleManifest, frozenIdentity = false): ModuleManifest {
  if (legacy.id !== "music_program_plan") throw new Error("YuE2 program requires music_program_plan");
  const block = createMusicProgramPlanBlock("yue2", frozenIdentity ? ctx => {
    const profile = parseFrozenChannelProfile(ctx.store["channelProfile"]);
    if (!profile || profile.id !== ctx.channelId) throw new Error("YuE2 program requires the current channel's frozen profile");
    return { dna: profile.styleDNA ?? null, niche: profile.identity?.niche };
  } : undefined);
  return { ...legacy, version: frozenIdentity ? YUE2_FROZEN_PROGRAM_VERSION : YUE2_PROGRAM_VERSION,
    consumes: { ...legacy.consumes, ...(frozenIdentity ? {
      channelProfile: { ...artifactContract("channelProfile"), schema: ChannelProfileSchema },
    } : {}) },
    block, execute: block.run,
    certification: { status: "contract", evidence: "Explicit YuE2 program intent; no legacy provider selection or automatic qualification." } };
}

function sourceManifest(source: ModuleManifest, block: ModuleManifest["block"]): ModuleManifest {
  return { ...source, version: source.id === "keyframes" ? YUE2_KEYFRAMES_VERSION : YUE2_LOOP_CLIPS_VERSION,
    consumes: { ...source.consumes, yue2MusicCandidate: artifactContract("yue2MusicCandidate"),
      acceptedMusicArrangement: artifactContract("acceptedMusicArrangement") },
    requiredCapabilities: [...new Set([...source.requiredCapabilities, "audio.music_candidate", "music.arrangement.accepted"])],
    block, execute: block.run,
    certification: { status: "contract", evidence: "Private owner-approved YuE2 source admission before loop visual spend; not real-output qualification." } };
}

export function createYuE2KeyframesManifest(legacy: ModuleManifest, planner: ModuleManifest): ModuleManifest {
  const bound = createBoundKeyframesManifest(legacy, planner, async ctx => {
    try { await (await admitYuE2LoopSource(ctx)).assertCurrent(); }
    catch (error) { throw new ExecutionError(`YuE2 visual source review requires reconciliation: ${error instanceof Error ? error.message : error}`,
      { retryable: false, code: "YUE2_VISUAL_SOURCE_REVIEW" }); }
  });
  return sourceManifest(bound, bound.block);
}

export function createYuE2LoopVisualManifest(source: ModuleManifest): ModuleManifest {
  if (source.id !== "loop_clips") throw new Error("YuE2 loop visual consumer requires loop_clips");
  return sourceManifest(source, createLoopClipsBlock(admitYuE2LoopSource));
}
