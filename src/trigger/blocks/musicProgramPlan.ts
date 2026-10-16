/** Provider-free, route-sealed direction shared by music generation and visuals. */
import type { StyleDNA } from "@/engine/creative/types";
import { getMusicBrief, getVisualBrief } from "@/engine/creative/brief";
import type { Block, StageContext } from "@/engine/types";
import { createOriginalMusicProgramPlan, selectOriginalMusicProvider } from "@/engine/originalMusicProgram";
import { hasQualifiedMiniMaxMusic3 } from "@/lib/minimaxMusic3";
import { routeSeedForTopicSelection } from "./blockContext";

export function createMusicProgramPlanBlock(
  sourceProvider?: "yue2",
  readIdentity?: (ctx: StageContext) => { dna: StyleDNA | null; niche?: string },
): Block {
  return {
    id: "music_program_plan",
    consumes: ["topic"],
    produces: ["musicProgramPlan", "musicProgramPlanFingerprint"],
    run: async (ctx) => {
      const topic = typeof ctx.store["topic"] === "string" ? ctx.store["topic"] : "";
      if (!topic) throw new Error("music_program_plan: expected non-empty topic");
      const route = routeSeedForTopicSelection(ctx);
      if (!route || route.family !== "music_loop") {
        throw new Error("music_program_plan: requires a sealed music-loop channel program route");
      }
      const requestedProvider = ctx.params["provider"];
      if (sourceProvider && requestedProvider !== undefined && requestedProvider !== sourceProvider) {
        throw new Error("music_program_plan: explicit provider conflicts with YuE2 source ownership");
      }
      if (
        requestedProvider !== undefined &&
        requestedProvider !== "minimax_music3" &&
        requestedProvider !== "suno" &&
        requestedProvider !== "mureka" &&
        !(sourceProvider === "yue2" && requestedProvider === "yue2")
      ) {
        throw new Error("music_program_plan: provider must be minimax_music3, suno, or mureka");
      }
      const identity = readIdentity?.(ctx);
      const dna = identity ? identity.dna : (ctx.store["styleDNA"] as StyleDNA | null) ?? null;
      const visual = getVisualBrief(ctx.store);
      const audio = getMusicBrief(ctx.store);
      const setting = [
        visual?.setting,
        visual?.world,
        visual?.footageQueries?.[0],
        ctx.params["setting"] as string | undefined,
        dna?.setting,
        identity ? identity.niche : ctx.store["niche"] as string | undefined,
      ].map((value) => value?.toString().trim()).find(Boolean);
      const audioDirection = [
        `Original instrumental program for “${topic}”.`,
        dna?.audio?.genre ? `Preserve the channel sound: ${dna.audio.genre}.` : "",
        dna?.audio?.instrumentation?.length ? `Instrumentation: ${dna.audio.instrumentation.join(", ")}.` : "",
        dna?.audio?.textures?.length ? `Texture: ${dna.audio.textures.join(", ")}.` : "",
        audio?.musicPrompt ? `Episode mood movement: ${audio.musicPrompt.trim().slice(0, 260)}.` : "",
        "No vocals, no lyrics, and a musically resolved seamless loop.",
      ].filter(Boolean).join(" ");
      const plan = createOriginalMusicProgramPlan({
        route,
        topic,
        setting,
        visualStyle: (ctx.params["visualStyle"] as string | undefined) ??
          (ctx.store["visualStyle"] as string | undefined) ?? "lofi",
        motionIntent: sourceProvider === "yue2"
          ? `Camera completely static. ${(dna?.motionVocabulary ?? []).join("; ") || "Only subtle ambient motion"}. No abrupt cuts, flashes, or subject drift.`
          : "one calm, seamless camera movement with no abrupt cuts, flashes, or subject drift",
        audioDirection,
        providerPreference: sourceProvider ?? selectOriginalMusicProvider({
          requestedProvider: requestedProvider === "yue2" ? undefined : requestedProvider,
          minimaxQualified: hasQualifiedMiniMaxMusic3(),
        }),
      });
      ctx.log(`music_program_plan: sealed ${plan.fingerprint.slice(0, 12)} for ${plan.routeKey}`);
      return { musicProgramPlan: plan, musicProgramPlanFingerprint: plan.fingerprint };
    },
  };
}

export const musicProgramPlan = createMusicProgramPlanBlock();
