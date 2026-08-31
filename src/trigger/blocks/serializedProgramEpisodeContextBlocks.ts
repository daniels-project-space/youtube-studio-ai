import type { Block, StageContext } from "@/engine/types";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { assertSerializedProgramEpisodeContextBinding } from "@/lib/serializedProgramEpisodeContext";
import { requireSerializedProgramEpisodeContextRoute } from "@/trigger/serializedProgramEpisodeContext";

function convex(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  return new ConvexHttpClient(url);
}

function topic(ctx: StageContext): string {
  const value = ctx.store["topic"];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("serialized_program_episode_context: topic_select must produce a non-empty topic first");
  }
  return value;
}

/**
 * A provider-free bridge from topic_select's atomic serial completion to the
 * rest of a route-owned episode. It only reads the completed episode row; it
 * never asks seriesStoryState for live continuity and cannot create a route.
 */
export const serializedProgramEpisodeContextBlock: Block = {
  id: "serialized_program_episode_context",
  consumes: ["topic"],
  produces: ["serializedProgramEpisodeContext"],
  run: async (ctx) => {
    const { route, identity, routeRunSeedFingerprint } = requireSerializedProgramEpisodeContextRoute(
      ctx,
      "serialized_program_episode_context",
    );
    const episodeTopic = topic(ctx);
    const context = await convex().query(api.serializedProgramEpisodes.getCompletedContextForRun, {
      ownerId: ctx.ownerId,
      channelId: ctx.channelId as Id<"channels">,
      seriesIdentity: identity.value,
      routeFingerprint: route.routeFingerprint,
      routeRunSeedFingerprint,
      seriesTitle: identity.seriesTitle,
      ...(identity.seriesCount === undefined ? {} : { seriesCount: identity.seriesCount }),
      runId: ctx.runId as Id<"runs">,
    });
    if (!context) {
      throw new Error(
        "serialized_program_episode_context: topic_select did not commit a completed immutable episode receipt for this run",
      );
    }
    const bound = assertSerializedProgramEpisodeContextBinding({
      context,
      routeFingerprint: route.routeFingerprint,
      routeRunSeedFingerprint,
      runId: ctx.runId,
      seriesIdentity: identity.value,
      seriesTitle: identity.seriesTitle,
      ...(identity.seriesCount === undefined ? {} : { seriesCount: identity.seriesCount }),
      topic: episodeTopic,
    });
    ctx.log(
      `serialized_program_episode_context: episode ${bound.episodeNumber}` +
        `${bound.seriesCount ? `/${bound.seriesCount}` : ""} receipt ${bound.fingerprint.slice(0, 12)}`,
    );
    return { serializedProgramEpisodeContext: bound };
  },
};

export const serializedProgramEpisodeContextBlocks: Block[] = [
  serializedProgramEpisodeContextBlock,
];
