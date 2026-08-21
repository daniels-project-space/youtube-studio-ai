/**
 * Convex-backed RunStageSink — persists every block transition to the
 * `runStages` table via the Convex HTTP client. This is the production sink the
 * Trigger task hands to the runner; tests use an in-memory sink instead.
 */
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { RunStageSink } from "./types";
import { requireInternalQuerySecret } from "@/lib/youtubeConnector";

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
    async getResumeState(runId) {
      return (await client.query(api.runStages.listRunStages, {
        runId: runId as Id<"runs">,
      })) as Array<{
        block: string;
        status: string;
        outputs?: unknown;
        cost?: number;
        startedAt?: number;
        error?: string;
      }>;
    },
    async upsertArtifacts(args) {
      // One mutation for the whole block. `upsertMany` is transactional, so
      // the block's artifact set lands completely or not at all.
      if (args.artifacts.length === 0) return;
      await client.mutation(api.runArtifacts.upsertMany, {
        secret: requireInternalQuerySecret(),
        ownerId: args.ownerId ?? ownerId,
        channelId: args.channelId as Id<"channels">,
        runId: args.runId as Id<"runs">,
        artifacts: args.artifacts.map((entry) => ({
          artifactId: entry.artifact.artifactId,
          key: entry.artifact.key,
          type: entry.artifact.type,
          schemaVersion: entry.artifact.schemaVersion,
          producerModule: entry.artifact.producerModule,
          producerVersion: entry.artifact.producerVersion,
          payloadHash: entry.artifact.payloadHash,
          inputArtifactIds: entry.inputArtifactIds,
          optionalFallbacks: entry.optionalFallbacks,
          persistence: entry.persistence,
          payload: entry.payload,
          summary: entry.summary,
          createdAt: entry.createdAt,
        })),
      });
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
