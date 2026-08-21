import { type Infer, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
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

/**
 * One content-addressed artifact, minus the (ownerId, channelId, runId) triple
 * that every artifact of a single block shares. Batched writes hoist that
 * triple to the top level so the ownership read happens once per call.
 */
const artifactEntry = v.object({
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
});

type ArtifactEntry = Infer<typeof artifactEntry>;

/**
 * Per-entry contract validation — identical to the checks the single-artifact
 * `upsert` has always run. Batched writes apply it to every entry.
 */
function assertArtifactEntry(entry: ArtifactEntry): void {
  assertToken(entry.artifactId, "artifactId", 500);
  assertToken(entry.key, "key", 160);
  assertToken(entry.type, "type", 160);
  assertToken(entry.schemaVersion, "schemaVersion", 80);
  assertToken(entry.producerModule, "producerModule", 160);
  assertToken(entry.producerVersion, "producerVersion", 80);
  if (!/^[a-f0-9]{64}$/.test(entry.payloadHash)) {
    throw new Error("runArtifacts: invalid SHA-256 payloadHash");
  }
  if (entry.inputArtifactIds.length > 128 || entry.optionalFallbacks.length > 128) {
    throw new Error("runArtifacts: lineage exceeds contract limits");
  }
  for (const id of entry.inputArtifactIds) assertToken(id, "inputArtifactId", 500);
  for (const key of entry.optionalFallbacks) assertToken(key, "optionalFallback", 160);
}

/** Channel + run ownership fence. Shared by both write paths. */
async function assertRunOwnership(
  ctx: MutationCtx,
  ownerId: string,
  channelId: Id<"channels">,
  runId: Id<"runs">,
): Promise<void> {
  const [channel, run] = await Promise.all([ctx.db.get(channelId), ctx.db.get(runId)]);
  if (!channel || channel.ownerId !== ownerId) {
    throw new Error("runArtifacts: channel ownership mismatch");
  }
  if (!run || run.ownerId !== ownerId || run.channelId !== channelId) {
    throw new Error("runArtifacts: run ownership/channel mismatch");
  }
}

/**
 * Insert-if-absent, verify-if-present. Artifacts are immutable and
 * content-addressed, so re-writing the same `artifactId` is a no-op that
 * returns the existing row; a same-id/different-content write is a contract
 * violation and throws.
 */
async function writeArtifactRow(
  ctx: MutationCtx,
  ownerId: string,
  channelId: Id<"channels">,
  runId: Id<"runs">,
  entry: ArtifactEntry,
): Promise<Id<"runArtifacts">> {
  const existing = await ctx.db
    .query("runArtifacts")
    .withIndex("by_artifact_id", (q) => q.eq("artifactId", entry.artifactId))
    .unique();
  const row = { ownerId, channelId, runId, ...entry };
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
}

/**
 * Single-artifact write. Retained for backward compatibility: a Trigger.dev
 * task version deployed before `upsertMany` existed may still call it.
 * New callers should use `upsertMany` (one round-trip per block).
 */
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
    const { secret: _secret, ownerId, channelId, runId, ...entry } = args;
    void _secret;
    assertArtifactEntry(entry);
    await assertRunOwnership(ctx, ownerId, channelId, runId);
    return await writeArtifactRow(ctx, ownerId, channelId, runId, entry);
  },
});

/**
 * Batched artifact write — every artifact one block produced, in ONE Convex
 * round-trip instead of one call per produced key. A 14-output block (e.g.
 * `qa_visual`) drops from 14 mutations to 1.
 *
 * ATOMIC BY DESIGN. A Convex mutation is a single transaction, so either every
 * entry lands or none does. That is a deliberate tightening of the previous
 * N-separate-calls behaviour, which could leave a block's artifact set
 * half-written when entry k failed. Artifact ids are deterministic (content +
 * lineage hash), so a retry re-derives identical ids and re-writing is
 * idempotent — all-or-nothing costs nothing on retry and never leaves a
 * partially-described block behind.
 *
 * Request-size bound: the caller caps an inline payload at 100 KB (larger
 * values are stored as a short summary instead) and the widest block declares
 * 14 outputs, so a worst-case batch is ~1.4 MB — far under Convex's 16 MiB
 * function-argument limit. A block with dramatically more or larger outputs
 * would need that budget rechecked.
 */
export const upsertMany = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    runId: v.id("runs"),
    artifacts: v.array(artifactEntry),
  },
  returns: v.array(v.id("runArtifacts")),
  handler: async (ctx, args) => {
    assertInternalSecret(args.secret, "runArtifacts.upsertMany");
    assertToken(args.ownerId, "ownerId", 160);
    // Validate the whole batch before any write, so a malformed entry can
    // never be preceded by a partially-applied sibling.
    for (const entry of args.artifacts) assertArtifactEntry(entry);
    if (args.artifacts.length === 0) return [];
    await assertRunOwnership(ctx, args.ownerId, args.channelId, args.runId);

    const ids: Array<Id<"runArtifacts">> = [];
    for (const entry of args.artifacts) {
      // Sequential, not Promise.all: a batch that repeats an artifactId must
      // observe the first write (read-your-own-writes) exactly as two
      // sequential single upserts used to.
      ids.push(await writeArtifactRow(ctx, args.ownerId, args.channelId, args.runId, entry));
    }
    return ids;
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
