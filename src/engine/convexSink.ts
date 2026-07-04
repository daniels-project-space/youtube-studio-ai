/**
 * Convex-backed RunStageSink — persists every block transition to the
 * `runStages` table via the Convex HTTP client. This is the production sink the
 * Trigger task hands to the runner; tests use an in-memory sink instead.
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { RunStageSink } from "./types";

export function makeConvexSink(
  client: ConvexHttpClient,
  ownerId: string,
): RunStageSink {
  return {
    async upsert(args) {
      await client.mutation(api.runStages.upsertRunStage, {
        ownerId: args.ownerId ?? ownerId,
        runId: args.runId as Id<"runs">,
        block: args.block,
        status: args.status,
        startedAt: args.startedAt,
        finishedAt: args.finishedAt,
        cost: args.cost,
        inputs: args.inputs,
        outputs: args.outputs,
        error: args.error,
      });
    },
    async getCompleted(runId) {
      const rows = (await client.query(api.runStages.listRunStages, {
        runId: runId as Id<"runs">,
      })) as Array<{ block: string; status: string; outputs?: unknown; cost?: number }>;
      return (rows ?? [])
        .filter((r) => r.status === "ok" && r.outputs != null)
        .map((r) => ({ block: r.block, outputs: r.outputs, cost: r.cost }));
    },
  };
}

/** Build a Convex client from NEXT_PUBLIC_CONVEX_URL (fails loud if unset). */
export function convexClientFromEnv(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  }
  return new ConvexHttpClient(url);
}
