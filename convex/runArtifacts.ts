import { v } from "convex/values";
import { mutation, query } from "./studioFunctions";

function assertInternalSecret(secret: string, operation: string): void {
  const expected = process.env.INTERNAL_QUERY_SECRET;
  if (!expected || secret !== expected) {
    throw new Error(`${operation}: invalid internal secret`);
  }
}

function assertToken(value: string, name: string, max = 300): void {
  if (!value || value.length > max || /[\u0000-\u001f]/.test(value)) {
    throw new Error(`runArtifacts: invalid ${name}`);
  }
}

const persistence = v.union(
  v.literal("inline"),
  v.literal("reference"),
  v.literal("summary"),
);

export const upsert = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    artifactId: v.string(),
    key: v.string(),
    type: v.string(),
    schemaVersion: v.string(),
    producerModule: v.string(),
    producerVersion: v.string(),
    payloadHash: v.string(),
    inputArtifactIds: v.array(v.string()),
    optionalFallbacks: v.array(v.string()),
    persistence,
    payload: v.optional(v.any()),
    summary: v.optional(v.string()),
    createdAt: v.number(),
  },
  returns: v.id("runArtifacts"),
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret, "runArtifacts.upsert");
    assertToken(args.ownerId, "ownerId", 160);
    assertToken(args.artifactId, "artifactId", 500);
    assertToken(args.key, "key", 160);
    assertToken(args.type, "type", 160);
    assertToken(args.schemaVersion, "schemaVersion", 80);
    assertToken(args.producerModule, "producerModule", 160);
    assertToken(args.producerVersion, "producerVersion", 80);
    if (!/^[a-f0-9]{64}$/.test(args.payloadHash)) {
      throw new Error("runArtifacts: invalid SHA-256 payloadHash");
    }
    if (args.inputArtifactIds.length > 128 || args.optionalFallbacks.length > 128) {
      throw new Error("runArtifacts: lineage exceeds contract limits");
    }
    for (const id of args.inputArtifactIds) assertToken(id, "inputArtifactId", 500);
    for (const key of args.optionalFallbacks) assertToken(key, "optionalFallback", 160);

    const [channel, run] = await Promise.all([
      ctx.db.get(args.channelId),
      ctx.db.get(args.runId),
    ]);
    if (!channel || channel.ownerId !== args.ownerId) {
      throw new Error("runArtifacts: channel ownership mismatch");
    }
    if (!run || run.ownerId !== args.ownerId || run.channelId !== args.channelId) {
      throw new Error("runArtifacts: run ownership/channel mismatch");
    }

    const existing = await ctx.db
      .query("runArtifacts")
      .withIndex("by_artifact_id", (q) => q.eq("artifactId", args.artifactId))
      .unique();
    const { secret: _secret, ...row } = args;
    if (existing) {
      const immutableMatch =
        existing.ownerId === row.ownerId &&
        existing.channelId === row.channelId &&
        existing.runId === row.runId &&
        existing.key === row.key &&
        existing.type === row.type &&
        existing.schemaVersion === row.schemaVersion &&
        existing.producerModule === row.producerModule &&
        existing.producerVersion === row.producerVersion &&
        existing.payloadHash === row.payloadHash &&
        JSON.stringify(existing.inputArtifactIds) === JSON.stringify(row.inputArtifactIds) &&
        JSON.stringify(existing.optionalFallbacks) === JSON.stringify(row.optionalFallbacks);
      if (!immutableMatch) {
        throw new Error("runArtifacts: immutable artifact id collision");
      }
      return existing._id;
    }
    return await ctx.db.insert("runArtifacts", row);
  },
});

export const listForRun = query({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    runId: v.id("runs"),
  },
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret, "runArtifacts.listForRun");
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerId !== args.ownerId) {
      throw new Error("runArtifacts: run ownership mismatch");
    }
    return await ctx.db
      .query("runArtifacts")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
  },
});
