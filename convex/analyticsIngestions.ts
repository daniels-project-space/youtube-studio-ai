import { mutation } from "./studioFunctions";
import { v } from "convex/values";
import { hasAnyScope, YOUTUBE_ANALYTICS_SCOPE } from "../src/lib/publishingPolicy";

const DATA_READ_SCOPES = [
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.readonly",
] as const;

function assertInternalSecret(secret: string): void {
  const expected = process.env.INTERNAL_QUERY_SECRET;
  if (!expected || secret !== expected) {
    throw new Error("analyticsIngestions: invalid internal secret");
  }
}

export const start = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    connectorId: v.id("youtubeAuth"),
    connectorVersion: v.number(),
    source: v.union(
      v.literal("youtube_data_api"),
      v.literal("youtube_analytics_api"),
    ),
    metricDefinitionVersion: v.string(),
    windowStart: v.string(),
    windowEnd: v.string(),
    startedAt: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    const [channel, connector] = await Promise.all([
      ctx.db.get(args.channelId),
      ctx.db.get(args.connectorId),
    ]);
    if (!channel || channel.ownerId !== args.ownerId) {
      throw new Error("analyticsIngestions.start: channel owner mismatch");
    }
    if (
      !connector ||
      connector.ownerId !== args.ownerId ||
      connector.channelId !== args.channelId ||
      (connector.tokenVersion ?? 1) !== args.connectorVersion ||
      (connector.status ?? "active") !== "active"
    ) {
      throw new Error("analyticsIngestions.start: connector binding invalid");
    }
    const scopes = connector.grantedScopes ?? [];
    const scopeOk =
      args.source === "youtube_analytics_api"
        ? scopes.includes(YOUTUBE_ANALYTICS_SCOPE)
        : hasAnyScope(scopes, DATA_READ_SCOPES);
    if (!scopeOk) {
      throw new Error("analyticsIngestions.start: required OAuth scope missing");
    }
    return await ctx.db.insert("analyticsIngestions", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      connectorId: args.connectorId,
      connectorVersion: args.connectorVersion,
      source: args.source,
      metricDefinitionVersion: args.metricDefinitionVersion,
      windowStart: args.windowStart,
      windowEnd: args.windowEnd,
      status: "running",
      recordsWritten: 0,
      startedAt: args.startedAt,
    });
  },
});

export const finish = mutation({
  args: {
    secret: v.string(),
    ingestionId: v.id("analyticsIngestions"),
    status: v.union(
      v.literal("completed"),
      v.literal("partial"),
      v.literal("failed"),
    ),
    recordsWritten: v.number(),
    lastError: v.optional(v.string()),
    finishedAt: v.number(),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret);
    const row = await ctx.db.get(args.ingestionId);
    if (!row) throw new Error("analyticsIngestions.finish: ingestion not found");
    if (row.status !== "running" && row.status !== args.status) {
      throw new Error("analyticsIngestions.finish: terminal state conflict");
    }
    await ctx.db.patch(row._id, {
      status: args.status,
      recordsWritten: args.recordsWritten,
      lastError: args.lastError?.slice(0, 1_000),
      finishedAt: args.finishedAt,
    });
    return await ctx.db.get(row._id);
  },
});
