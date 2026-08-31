import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  parseSerializedProgramEpisodeMemoryKey,
  SERIALIZED_PROGRAM_EPISODE_VERSION,
} from "@/lib/serializedProgramEpisode";
import {
  assertSerializedProgramEpisodeContextBinding,
  createSerializedProgramEpisodeContext,
  parseSerializedProgramEpisodeContext,
  SERIALIZED_PROGRAM_EPISODE_CONTEXT_VERSION,
} from "@/lib/serializedProgramEpisodeContext";
import { mergeSeriesStoryState } from "@/lib/seriesStoryState";

/** Long enough for one continuation call, short enough that a crashed worker cannot burn an episode. */
export const SERIALIZED_PROGRAM_EPISODE_LEASE_MS = 5 * 60 * 1_000;

const claimArgs = {
  ownerId: v.string(),
  channelId: v.id("channels"),
  seriesIdentity: v.string(),
  routeFingerprint: v.string(),
  routeRunSeedFingerprint: v.string(),
  seriesTitle: v.string(),
  seriesCount: v.optional(v.number()),
  runId: v.id("runs"),
};

const serializedProgramEpisodeContextValidator = v.object({
  version: v.literal(SERIALIZED_PROGRAM_EPISODE_CONTEXT_VERSION),
  routeFingerprint: v.string(),
  routeRunSeedFingerprint: v.string(),
  runId: v.string(),
  seriesIdentity: v.string(),
  seriesTitle: v.string(),
  seriesCount: v.optional(v.number()),
  episodeNumber: v.number(),
  topic: v.string(),
  topicMemoryKey: v.string(),
  continuity: v.object({
    arcSummary: v.optional(v.string()),
    recentPlotBeats: v.array(v.object({ episode: v.number(), beat: v.string() })),
    unresolvedThreads: v.array(v.string()),
    entities: v.array(v.object({ name: v.string(), role: v.string() })),
  }),
  fingerprint: v.string(),
});

type SerializedEpisodeArgs = {
  readonly ownerId: string;
  readonly channelId: Id<"channels">;
  readonly seriesIdentity: string;
  readonly routeFingerprint: string;
  readonly routeRunSeedFingerprint: string;
  readonly seriesTitle: string;
  readonly seriesCount?: number;
  readonly runId: Id<"runs">;
};

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function assertSerializedEpisodeArgs(args: SerializedEpisodeArgs): void {
  if (!/^[a-f0-9]{64}$/.test(args.routeFingerprint)) {
    throw new Error("serialized program episode route fingerprint is invalid");
  }
  if (!/^[a-f0-9]{64}$/.test(args.routeRunSeedFingerprint)) {
    throw new Error("serialized program episode frozen route-seed fingerprint is invalid");
  }
  if (!args.seriesTitle.trim() || args.seriesTitle.length > 160) {
    throw new Error("serialized program episode title must contain 1-160 characters");
  }
  if (args.seriesCount !== undefined && (!positiveInteger(args.seriesCount) || args.seriesCount > 100)) {
    throw new Error("serialized program episode series count must be a positive integer no greater than 100");
  }
  if (!String(args.runId).trim() || String(args.runId).length > 500) {
    throw new Error("serialized program episode run identity is invalid");
  }
  const expectedIdentity = [
    SERIALIZED_PROGRAM_EPISODE_VERSION,
    args.routeFingerprint,
    encodeURIComponent(args.seriesTitle),
    args.seriesCount === undefined ? "open" : String(args.seriesCount),
  ].join("/");
  if (args.seriesIdentity !== expectedIdentity) {
    throw new Error("serialized program episode identity does not match its sealed route receipt");
  }
}

function assertClaimToken(claimToken: unknown): asserts claimToken is string {
  if (typeof claimToken !== "string" || !claimToken.trim() || claimToken.length > 600) {
    throw new Error("serialized program episode claim token is invalid");
  }
}

function mintClaimToken(): string {
  const token = globalThis.crypto?.randomUUID?.();
  if (!token) throw new Error("serialized program episode claim token could not be minted");
  return token;
}

type DurableSerializedProgramRoute = {
  readonly fingerprint?: unknown;
  readonly family?: unknown;
  readonly directives?: { readonly claimMode?: unknown };
  readonly serializedProgram?: {
    readonly version?: unknown;
    readonly seriesTitle?: unknown;
    readonly seriesCount?: unknown;
  };
};

async function assertOwnedSealedSerializedRoute(
  ctx: Pick<MutationCtx, "db">,
  args: SerializedEpisodeArgs,
): Promise<DurableSerializedProgramRoute> {
  const channel = await ctx.db.get(args.channelId);
  if (!channel || channel.ownerId !== args.ownerId) {
    throw new Error("serialized program episode channel owner mismatch");
  }
  const rawRoute = channel.identity && typeof channel.identity === "object"
    ? (channel.identity as { programRoute?: unknown }).programRoute
    : undefined;
  if (!rawRoute || typeof rawRoute !== "object" || Array.isArray(rawRoute)) {
    throw new Error("serialized program episode requires a durable sealed channel program route");
  }
  const route = rawRoute as DurableSerializedProgramRoute;
  const serializedProgram = route.serializedProgram;
  if (
    route.fingerprint !== args.routeFingerprint ||
    serializedProgram?.version !== "serialized_program/v1" ||
    serializedProgram.seriesTitle !== args.seriesTitle ||
    serializedProgram.seriesCount !== args.seriesCount
  ) {
    throw new Error("serialized program episode input does not match the durable sealed channel route");
  }
  return route;
}

/**
 * A reservation is only meaningful for an actual run owned by the same
 * channel.  This is deliberately checked by every lifecycle mutation rather
 * than trusting a service caller to bind an arbitrary string to a channel.
 */
async function assertOwnedSealedSerializedRouteAndRun(
  ctx: Pick<MutationCtx, "db">,
  args: SerializedEpisodeArgs,
): Promise<DurableSerializedProgramRoute> {
  const route = await assertOwnedSealedSerializedRoute(ctx, args);
  const run = await ctx.db.get(args.runId);
  if (!run || run.ownerId !== args.ownerId || run.channelId !== args.channelId) {
    throw new Error("serialized program episode run is missing or not bound to the requested owner and channel");
  }
  return route;
}

/** Mirrors Topic Select's route gate inside the service-only completion mutation. */
function assertTopicFitsProgramRoute(
  route: DurableSerializedProgramRoute,
  topic: string,
  episodeNumber: number,
): void {
  if (!topic.trim()) throw new Error("serialized program episode topic is empty");
  if (route.family === "quizyear" || route.directives?.claimMode === "certified_quiz_facts") {
    throw new Error("serialized program episode topic bypasses the certified QuizYear planner");
  }
  if (
    route.directives?.claimMode === "fictional_scenario_no_external_claims" &&
    /\b(?:breaking|latest|today|current events?|news|forecast)\b/i.test(topic)
  ) {
    throw new Error("serialized program episode topic violates the route no-real-world-claims contract");
  }
  const seriesTitle = route.serializedProgram?.seriesTitle;
  if (typeof seriesTitle !== "string" || !topic.startsWith(`${seriesTitle} — Part ${episodeNumber}`)) {
    throw new Error("serialized program episode topic is not bound to its sealed series and episode number");
  }
}

/**
 * Atomically owns the next uncompleted episode. A completed row for the same
 * pipeline run is replayed; any live claim, including the same run's incomplete
 * claim, returns busy so a second provider call can never race it.
 */
export const claimNext = mutation({
  args: claimArgs,
  returns: v.union(
    v.object({ kind: v.literal("acquired"), episodeNumber: v.number(), leaseExpiresAt: v.number(), claimToken: v.string() }),
    v.object({ kind: v.literal("completed"), episodeNumber: v.number(), topic: v.string() }),
    v.object({ kind: v.literal("busy"), retryAfterMs: v.number() }),
    v.object({ kind: v.literal("exhausted") }),
  ),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "serialized program episode claim");
    assertSerializedEpisodeArgs(args);
    await assertOwnedSealedSerializedRouteAndRun(ctx, args);
    const now = Date.now();
    const rows = await ctx.db
      .query("serializedProgramEpisodes")
      .withIndex("by_channel_series", (q) =>
        q.eq("channelId", args.channelId).eq("seriesIdentity", args.seriesIdentity),
      )
      .collect();
    const replay = rows.find((row) =>
      row.status === "completed" && row.runId === args.runId && typeof row.topic === "string",
    );
    if (replay?.topic) {
      if (!replay.serializedProgramEpisodeContext) {
        throw new Error(
          "serialized program episode replay predates the immutable continuity receipt; restart from a newly reserved episode",
        );
      }
      assertSerializedProgramEpisodeContextBinding({
        context: replay.serializedProgramEpisodeContext,
        routeFingerprint: args.routeFingerprint,
        routeRunSeedFingerprint: args.routeRunSeedFingerprint,
        runId: String(args.runId),
        seriesIdentity: args.seriesIdentity,
        seriesTitle: args.seriesTitle,
        ...(args.seriesCount === undefined ? {} : { seriesCount: args.seriesCount }),
        topic: replay.topic,
        topicMemoryKey: replay.topicMemoryKey,
      });
      return { kind: "completed" as const, episodeNumber: replay.episodeNumber, topic: replay.topic };
    }
    const liveClaim = rows.find((row) =>
      row.status === "claimed" && (row.leaseExpiresAt ?? 0) > now,
    );
    if (liveClaim) {
      return {
        kind: "busy" as const,
        // This is a durable not-before boundary, not a short polling hint.
        // The Trigger requeue waits until after the active lease rather than
        // paying a worker to retry it every second.
        retryAfterMs: Math.max(
          250,
          Math.min(
            (liveClaim.leaseExpiresAt ?? now) - now + 250,
            SERIALIZED_PROGRAM_EPISODE_LEASE_MS + 1_000,
          ),
        ),
      };
    }
    for (const stale of rows.filter((row) => row.status === "claimed")) {
      await ctx.db.delete(stale._id);
    }
    const completedEpisodeNumbers = new Set(
      rows
        .filter((row) => row.status === "completed")
        .map((row) => row.episodeNumber),
    );
    let episodeNumber = 1;
    while (completedEpisodeNumbers.has(episodeNumber)) episodeNumber += 1;
    if (args.seriesCount !== undefined && episodeNumber > args.seriesCount) {
      return { kind: "exhausted" as const };
    }
    const leaseExpiresAt = now + SERIALIZED_PROGRAM_EPISODE_LEASE_MS;
    const claimToken = mintClaimToken();
    await ctx.db.insert("serializedProgramEpisodes", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      version: SERIALIZED_PROGRAM_EPISODE_VERSION,
      seriesIdentity: args.seriesIdentity,
      routeFingerprint: args.routeFingerprint,
      routeRunSeedFingerprint: args.routeRunSeedFingerprint,
      seriesTitle: args.seriesTitle,
      ...(args.seriesCount === undefined ? {} : { seriesCount: args.seriesCount }),
      episodeNumber,
      runId: args.runId,
      claimToken,
      status: "claimed",
      claimedAt: now,
      updatedAt: now,
      leaseExpiresAt,
    });
    return { kind: "acquired" as const, episodeNumber, leaseExpiresAt, claimToken };
  },
});

/** Atomically writes the exact namespaced topic-memory entry and completes its claim. */
export const complete = mutation({
  args: {
    ...claimArgs,
    claimToken: v.string(),
    episodeNumber: v.number(),
    topic: v.string(),
    topicMemoryKey: v.string(),
    storyState: v.object({
      arcSummary: v.optional(v.string()),
      newPlotBeat: v.string(),
      unresolvedThreads: v.optional(v.array(v.string())),
      newEntities: v.optional(
        v.array(
          v.object({
            name: v.string(),
            role: v.string(),
          }),
        ),
      ),
    }),
  },
  returns: v.object({ episodeNumber: v.number(), topic: v.string() }),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "serialized program episode completion");
    assertSerializedEpisodeArgs(args);
    assertClaimToken(args.claimToken);
    const episodeNumber = positiveInteger(args.episodeNumber);
    const topic = args.topic.trim();
    if (!episodeNumber || !topic || topic.length > 500) {
      throw new Error("serialized program episode completion is invalid");
    }
    const memory = parseSerializedProgramEpisodeMemoryKey(args.topicMemoryKey);
    if (
      !memory ||
      memory.identity.value !== args.seriesIdentity ||
      memory.episodeNumber !== episodeNumber ||
      memory.topic !== topic
    ) {
      throw new Error("serialized program episode topic-memory key is not bound to its exact sealed episode");
    }
    const route = await assertOwnedSealedSerializedRouteAndRun(ctx, args);
    assertTopicFitsProgramRoute(route, topic, episodeNumber);
    const row = await ctx.db
      .query("serializedProgramEpisodes")
      .withIndex("by_channel_series_episode", (q) =>
        q.eq("channelId", args.channelId)
          .eq("seriesIdentity", args.seriesIdentity)
          .eq("episodeNumber", episodeNumber),
      )
      .unique();
    if (!row) throw new Error("serialized program episode claim is missing");
    if (row.status === "completed") {
      if (
        row.ownerId !== args.ownerId ||
        row.runId !== args.runId ||
        row.claimToken !== args.claimToken ||
        row.topic !== topic ||
        row.topicMemoryKey !== args.topicMemoryKey
      ) {
        throw new Error("serialized program episode completion is immutable or fenced by a newer acquisition");
      }
      if (!row.serializedProgramEpisodeContext) {
        throw new Error(
          "serialized program episode completion predates the immutable continuity receipt and cannot be replayed safely",
        );
      }
      assertSerializedProgramEpisodeContextBinding({
        context: row.serializedProgramEpisodeContext,
        routeFingerprint: args.routeFingerprint,
        routeRunSeedFingerprint: args.routeRunSeedFingerprint,
        runId: String(args.runId),
        seriesIdentity: args.seriesIdentity,
        seriesTitle: args.seriesTitle,
        ...(args.seriesCount === undefined ? {} : { seriesCount: args.seriesCount }),
        topic,
        topicMemoryKey: args.topicMemoryKey,
      });
      return { episodeNumber: row.episodeNumber, topic: row.topic };
    }
    const now = Date.now();
    if (
      row.ownerId !== args.ownerId ||
      row.runId !== args.runId ||
      row.claimToken !== args.claimToken ||
      (row.leaseExpiresAt ?? 0) <= now
    ) {
      throw new Error("serialized program episode claim is no longer owned by this continuation");
    }
    const priorTopic = await ctx.db
      .query("topicMemory")
      .withIndex("by_channel_key", (q) =>
        q.eq("channelId", args.channelId).eq("key", args.topicMemoryKey),
      )
      .first();
    if (!priorTopic) {
      await ctx.db.insert("topicMemory", {
        ownerId: args.ownerId,
        channelId: args.channelId,
        key: args.topicMemoryKey,
        usedAt: now,
      });
    }
    const newPlotBeat = args.storyState.newPlotBeat.trim();
    if (!newPlotBeat || newPlotBeat.length > 1_000) {
      throw new Error("serialized program episode continuity update requires a bounded non-empty plot beat");
    }
    const existingStoryState = await ctx.db
      .query("seriesStoryState")
      .withIndex("by_channel_series_identity", (q) =>
        q.eq("channelId", args.channelId).eq("seriesIdentity", args.seriesIdentity),
      )
      .unique();
    const mergedStoryState = mergeSeriesStoryState(
      existingStoryState
        ? {
            arcSummary: existingStoryState.arcSummary,
            plotBeats: existingStoryState.plotBeats,
            unresolvedThreads: existingStoryState.unresolvedThreads,
            entities: existingStoryState.entities,
            updatedAt: existingStoryState.updatedAt,
          }
        : null,
      {
        episode: episodeNumber,
        arcSummary: args.storyState.arcSummary,
        newPlotBeat,
        unresolvedThreads: args.storyState.unresolvedThreads,
        newEntities: args.storyState.newEntities,
        now,
      },
    );
    if (existingStoryState) {
      await ctx.db.patch(existingStoryState._id, mergedStoryState);
    } else {
      await ctx.db.insert("seriesStoryState", {
        ownerId: args.ownerId,
        channelId: args.channelId,
        seriesTitle: args.seriesTitle,
        seriesIdentity: args.seriesIdentity,
        ...mergedStoryState,
      });
    }
    const serializedProgramEpisodeContext = createSerializedProgramEpisodeContext({
      routeFingerprint: args.routeFingerprint,
      routeRunSeedFingerprint: args.routeRunSeedFingerprint,
      runId: String(args.runId),
      seriesIdentity: args.seriesIdentity,
      seriesTitle: args.seriesTitle,
      ...(args.seriesCount === undefined ? {} : { seriesCount: args.seriesCount }),
      episodeNumber,
      topic,
      topicMemoryKey: args.topicMemoryKey,
      continuity: {
        arcSummary: mergedStoryState.arcSummary,
        plotBeats: mergedStoryState.plotBeats,
        unresolvedThreads: mergedStoryState.unresolvedThreads,
        entities: mergedStoryState.entities,
      },
    });
    await ctx.db.patch(row._id, {
      status: "completed",
      topic,
      topicMemoryKey: args.topicMemoryKey,
      serializedProgramEpisodeContext,
      updatedAt: now,
      completedAt: now,
      leaseExpiresAt: undefined,
    });
    return { episodeNumber, topic };
  },
});

/**
 * Provider-free read of the one immutable episode receipt owned by this exact
 * frozen route/run. This deliberately never touches `seriesStoryState`: later
 * blocks must not drift when a following episode advances mutable continuity.
 */
export const getCompletedContextForRun = query({
  args: claimArgs,
  returns: v.union(v.null(), serializedProgramEpisodeContextValidator),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "serialized program episode context read");
    assertSerializedEpisodeArgs(args);
    const rows = await ctx.db
      .query("serializedProgramEpisodes")
      .withIndex("by_channel_series_run", (q) =>
        q.eq("channelId", args.channelId)
          .eq("seriesIdentity", args.seriesIdentity)
          .eq("runId", args.runId),
      )
      .collect();
    const row = rows.find((candidate) =>
      candidate.ownerId === args.ownerId &&
      candidate.routeFingerprint === args.routeFingerprint &&
      candidate.routeRunSeedFingerprint === args.routeRunSeedFingerprint &&
      candidate.seriesTitle === args.seriesTitle &&
      candidate.seriesCount === args.seriesCount,
    );
    if (!row || row.status !== "completed") return null;
    if (!row.serializedProgramEpisodeContext || typeof row.topic !== "string" || !row.topicMemoryKey) {
      throw new Error(
        "serialized program episode completion predates the immutable continuity receipt and cannot be used by later blocks",
      );
    }
    const context = parseSerializedProgramEpisodeContext(row.serializedProgramEpisodeContext);
    return assertSerializedProgramEpisodeContextBinding({
      context,
      routeFingerprint: args.routeFingerprint,
      routeRunSeedFingerprint: args.routeRunSeedFingerprint,
      runId: String(args.runId),
      seriesIdentity: args.seriesIdentity,
      seriesTitle: args.seriesTitle,
      ...(args.seriesCount === undefined ? {} : { seriesCount: args.seriesCount }),
      topic: row.topic,
      topicMemoryKey: row.topicMemoryKey,
    });
  },
});

/** A failed/malformed continuation gives its episode back immediately for a safe retry. */
export const release = mutation({
  args: { ...claimArgs, claimToken: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "serialized program episode release");
    assertSerializedEpisodeArgs(args);
    assertClaimToken(args.claimToken);
    await assertOwnedSealedSerializedRouteAndRun(ctx, args);
    const rows = await ctx.db
      .query("serializedProgramEpisodes")
      .withIndex("by_channel_series_run", (q) =>
        q.eq("channelId", args.channelId)
          .eq("seriesIdentity", args.seriesIdentity)
          .eq("runId", args.runId),
      )
      .collect();
    const row = rows.find((candidate) =>
      candidate.status === "claimed" && candidate.claimToken === args.claimToken,
    );
    if (!row) return false;
    await ctx.db.delete(row._id);
    return true;
  },
});
