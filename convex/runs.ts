import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// A run may take up to 70 minutes per attempt and can retry. These windows are
// deliberately wider than that execution envelope: do not hide or terminate a
// legitimate retry just because it is slow. A queued run has not started work,
// so it gets an even wider window before it is treated as abandoned.
const STALE_RUNNING_AFTER_MS = 6 * 60 * 60 * 1000;
const STALE_QUEUED_AFTER_MS = 24 * 60 * 60 * 1000;

function isStaleActiveRun(
  run: { status: string; startedAt?: number; _creationTime: number },
  now: number,
): boolean {
  const age = now - (run.startedAt ?? run._creationTime);
  return (
    (run.status === "running" && age > STALE_RUNNING_AFTER_MS) ||
    (run.status === "queued" && age > STALE_QUEUED_AFTER_MS)
  );
}

export const createRun = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    status: v.optional(v.string()),
  },
  returns: v.id("runs"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("runs", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      status: args.status ?? "queued",
      startedAt: Date.now(),
      costTotal: 0,
    });
  },
});

export const updateRun = mutation({
  args: {
    runId: v.id("runs"),
    status: v.optional(v.string()),
    finishedAt: v.optional(v.number()),
    costTotal: v.optional(v.number()),
    error: v.optional(v.string()),
    videoAssetId: v.optional(v.id("assets")),
    youtubeVideoId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { runId, ...rest } = args;
    const existing = await ctx.db.get(runId);
    if (!existing) throw new Error(`run not found: ${runId}`);
    const patch: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(rest)) {
      if (val !== undefined) patch[k] = val;
    }
    await ctx.db.patch(runId, patch);
    return null;
  },
});

export const getRun = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.runId);
  },
});

export const listRunsByChannel = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("runs")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .collect();
  },
});

/**
 * Active runs (queued|running) for an owner, newest first, enriched with the
 * channel name/slug — mirrors listRecent's enrichment. Abandoned records are
 * intentionally excluded even before the Doctor's next daily sweep, so a
 * dead worker cannot make the Overview claim a channel is active forever.
 */
export const listActive = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    // Bounded window instead of a full-table collect: active runs are always
    // recent, so the newest 200 (index desc ≈ startedAt desc) covers them.
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .order("desc")
      .take(200);
    const active = runs.filter(
      (r) =>
        (r.status === "queued" || r.status === "running") &&
        !isStaleActiveRun(r, now),
    );
    active.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
    return await Promise.all(
      active.map(async (run) => {
        const channel = await ctx.db.get(run.channelId);
        return {
          _id: run._id,
          status: run.status,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          costTotal: run.costTotal,
          youtubeVideoId: run.youtubeVideoId,
          error: run.error,
          channelName: channel?.name ?? "(unknown)",
          channelSlug: channel?.slug ?? "",
        };
      }),
    );
  },
});

/**
 * Terminally triage abandoned work without deleting its audit trail.
 *
 * This is intentionally conservative and idempotent. It only acts after the
 * same age gates used by listActive, records why the run was closed, and marks
 * it `canceled` rather than pretending an unstarted queued job failed. It
 * never resumes work or triggers a provider call, so old rows cannot cause
 * surprise rendering or spend during maintenance.
 */
export const triageStale = mutation({
  args: { ownerId: v.string() },
  returns: v.object({ queuedCanceled: v.number(), runningFailed: v.number() }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();
    let queuedCanceled = 0;
    let runningFailed = 0;

    for (const run of runs) {
      if (!isStaleActiveRun(run, now)) continue;
      const ageHours = Math.floor(
        (now - (run.startedAt ?? run._creationTime)) / (60 * 60 * 1000),
      );
      if (run.status === "queued") {
        await ctx.db.patch(run._id, {
          status: "canceled",
          finishedAt: now,
          error: `triaged by pipeline-doctor: queued for ${ageHours}h without starting`,
        });
        queuedCanceled++;
      } else {
        await ctx.db.patch(run._id, {
          status: "failed",
          finishedAt: now,
          error: `triaged by pipeline-doctor: running for ${ageHours}h beyond the safe execution window (worker likely died)`,
        });
        runningFailed++;
      }
    }
    return { queuedCanceled, runningFailed };
  },
});

/**
 * Repoint all runs of one channel onto another. Used by the dedupe-channels
 * maintenance script to migrate runs off duplicate channel docs before they
 * are deleted. Idempotent: re-running with no matching runs is a no-op.
 */
export const repointChannel = mutation({
  args: {
    fromChannelId: v.id("channels"),
    toChannelId: v.id("channels"),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_channel", (q) => q.eq("channelId", args.fromChannelId))
      .collect();
    for (const run of runs) {
      await ctx.db.patch(run._id, { channelId: args.toChannelId });
    }
    return runs.length;
  },
});

/**
 * Recent runs for an owner, newest first, enriched with the channel name.
 * Powers the minimal dashboard page (read-only).
 */
export const listRecent = query({
  args: { ownerId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    // Index desc ≈ startedAt desc (startedAt is stamped at insert) — take the
    // page directly instead of collecting every owner run then slicing.
    const limited = await ctx.db
      .query("runs")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .order("desc")
      .take(args.limit ?? 10);
    limited.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
    return await Promise.all(
      limited.map(async (run) => {
        const channel = await ctx.db.get(run.channelId);
        return {
          _id: run._id,
          status: run.status,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          costTotal: run.costTotal,
          youtubeVideoId: run.youtubeVideoId,
          error: run.error,
          channelName: channel?.name ?? "(unknown)",
          channelSlug: channel?.slug ?? "",
        };
      }),
    );
  },
});
