import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type StageProgress = {
  stageId: Id<"runStages">;
  block: string;
  status: string;
  startedAt?: number;
};

async function projection(ctx: QueryCtx | MutationCtx, ownerId: string, runId: Id<"runs">) {
  const row = await ctx.db.query("runStageProgress").withIndex("by_run", q => q.eq("runId", runId)).unique();
  if (row && row.ownerId !== ownerId) throw new Error("run stage progress ownership mismatch");
  return row;
}

/** Enroll only before the first stage write; never infer a partial legacy ledger. */
export async function prepareRunStageProgress(ctx: MutationCtx, ownerId: string, runId: Id<"runs">) {
  const existing = await projection(ctx, ownerId, runId);
  if (existing) return existing;
  const prior = await ctx.db.query("runStages").withIndex("by_run", q => q.eq("runId", runId)).take(1);
  const value = { ownerId, runId, ...(prior.length === 0 ? { stages: [] as StageProgress[] } : {}) };
  const id = await ctx.db.insert("runStageProgress", value);
  return { ...value, _id: id };
}

/** All writes share their source mutation's transaction and execution fence. */
export async function updateRunStageProgress(
  ctx: MutationCtx,
  ownerId: string,
  runId: Id<"runs">,
  updates: StageProgress[],
  prepared?: Pick<Doc<"runStageProgress">, "_id" | "ownerId" | "runId" | "stages">,
) {
  const row = prepared ?? await projection(ctx, ownerId, runId);
  if (!row?.stages) return;
  if (row.ownerId !== ownerId || row.runId !== runId) throw new Error("run stage progress ownership mismatch");
  const stages = [...row.stages];
  let changed = false;
  for (const update of updates) {
    const index = stages.findIndex(stage => stage.stageId === update.stageId);
    const prior = stages[index];
    if (prior && prior.block === update.block && prior.status === update.status && prior.startedAt === update.startedAt) continue;
    if (index < 0) stages.push(update);
    else stages[index] = update;
    changed = true;
  }
  if (changed) await ctx.db.patch(row._id, { stages });
}

export async function readRunStageProgress(ctx: QueryCtx, ownerId: string, runId: Id<"runs">) {
  const row = await projection(ctx, ownerId, runId);
  if (row?.stages) return row.stages;
  // Old runs stay accurate without an eager backfill or partially populated mirror.
  return ctx.db.query("runStages").withIndex("by_run", q => q.eq("runId", runId)).collect();
}
