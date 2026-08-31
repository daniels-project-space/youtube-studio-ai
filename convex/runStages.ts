import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { deriveReleaseEvidenceProjection } from "../src/lib/releaseEvidenceStatus";
import { assertRunExecutionWriteFence, requiresRunExecutionWriteFence } from "../src/lib/runLease";

/**
 * Upsert a per-block stage row for a run. Keyed by (runId, block) so the
 * runner can transition a stage queued -> running -> ok|failed idempotently.
 */
export const upsertRunStage = mutation({
  args: {
    ownerId: v.string(),
    runId: v.id("runs"),
    leaseOwner: v.optional(v.string()),
    executionLeaseToken: v.optional(v.number()),
    block: v.string(),
    status: v.string(),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    cost: v.optional(v.number()),
    inputs: v.optional(v.any()),
    outputs: v.optional(v.any()),
    error: v.optional(v.string()),
  },
  returns: v.id("runStages"),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "run stage write");
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerId !== args.ownerId) {
      throw new Error("run stage ownership mismatch");
    }
    if ((args.leaseOwner === undefined) !== (args.executionLeaseToken === undefined)) {
      throw new Error("run stage write must provide both execution lease fence fields or neither");
    }
    if (args.leaseOwner !== undefined && args.executionLeaseToken !== undefined) {
      assertRunExecutionWriteFence(run, {
        leaseOwner: args.leaseOwner,
        executionLeaseToken: args.executionLeaseToken,
      }, Date.now());
    } else if (requiresRunExecutionWriteFence(run)) {
      throw new Error("run stage write requires an execution lease fence");
    }
    const existing = await ctx.db
      .query("runStages")
      .withIndex("by_run_block", (q) =>
        q.eq("runId", args.runId).eq("block", args.block),
      )
      .unique();

    let stageId: Id<"runStages">;
    let stageOutputs: unknown = args.outputs;
    if (existing) {
      const patch: Record<string, unknown> = { status: args.status };
      if (args.startedAt !== undefined) patch.startedAt = args.startedAt;
      if (args.finishedAt !== undefined) patch.finishedAt = args.finishedAt;
      if (args.cost !== undefined) patch.cost = args.cost;
      if (args.inputs !== undefined) patch.inputs = args.inputs;
      if (args.outputs !== undefined) patch.outputs = args.outputs;
      if (args.error !== undefined) patch.error = args.error;
      // A stage transitioning to OK clears any stale failure/supersede text —
      // rows used to show "superseded by self-heal…" alongside status ok.
      if (args.status === "ok" && args.error === undefined && existing.error) patch.error = undefined;
      await ctx.db.patch(existing._id, patch);
      stageId = existing._id;
      stageOutputs = args.outputs ?? existing.outputs;
    } else {
      stageId = await ctx.db.insert("runStages", {
        ownerId: args.ownerId,
        runId: args.runId,
        block: args.block,
        status: args.status,
        startedAt: args.startedAt,
        finishedAt: args.finishedAt,
        cost: args.cost ?? 0,
        inputs: args.inputs,
        outputs: args.outputs,
        error: args.error,
      });
    }

    // Artifact persistence precedes the runner's `qa_visual: ok` transition.
    // Read the raw rows only after writing this stage, then project a
    // conservative status onto the run. This does not gate or alter upload /
    // publish behavior; it makes the provenance state visible for audit.
    if (args.block === "qa_visual") {
      const artifacts = await ctx.db
        .query("runArtifacts")
        .withIndex("by_run", (q) => q.eq("runId", args.runId))
        .collect();
      const releaseEvidence = deriveReleaseEvidenceProjection({
        runId: args.runId,
        qaStage: { status: args.status, outputs: stageOutputs },
        artifacts,
      });
      await ctx.db.patch(args.runId, {
        releaseEvidenceStatus: releaseEvidence.status,
        releaseEvidenceCertificateFingerprint: releaseEvidence.certificateFingerprint,
        releaseEvidenceCertificateKey: releaseEvidence.certificateKey,
        releaseEvidenceUpdatedAt: Date.now(),
      });
    }

    return stageId;
  },
});

/** Max string length surfaced per output value in slim mode. */
const SLIM_MAX_STRING = 2000;

/**
 * Recursively truncate long string values inside a persisted outputs blob.
 * Convex values are acyclic JSON with bounded depth, so plain recursion is safe.
 */
function slimValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > SLIM_MAX_STRING
      ? value.slice(0, SLIM_MAX_STRING) + "…[truncated]"
      : value;
  }
  if (Array.isArray(value)) return value.map(slimValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v2] of Object.entries(value)) out[k] = slimValue(v2);
    return out;
  }
  return value;
}

export const listRunStages = query({
  args: {
    runId: v.id("runs"),
    /**
     * Browser diet: strip `inputs` entirely and truncate long output strings.
     * The run-detail page subscribes with slim:true; server-side consumers
     * (sink resume, learn, doctor) keep the full rows.
     */
    slim: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("runStages")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
    if (!args.slim) return rows;
    return rows.map((r) => {
      const { inputs: _inputs, outputs, ...rest } = r;
      void _inputs;
      return {
        ...rest,
        ...(outputs !== undefined ? { outputs: slimValue(outputs) } : {}),
      };
    });
  },
});
