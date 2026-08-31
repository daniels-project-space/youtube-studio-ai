import { idempotencyKeys, schedules, tasks } from "@trigger.dev/sdk";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { bundleFanoutDispatchSchedule } from "@/lib/bundleFanout";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";

const BUNDLE_FANOUT_DISPATCH_LIMIT = 25;

type DueReceipt = { runId: Id<"runs"> };

type DispatchClaim =
  | { kind: "enqueued"; runId: Id<"runs"> }
  | { kind: "busy"; runId: Id<"runs">; retryAt?: number }
  | { kind: "pending"; runId: Id<"runs">; retryAt?: number }
  | { kind: "failed"; runId: Id<"runs">; error?: string }
  | {
      kind: "claimed";
      runId: Id<"runs">;
      envelope: unknown;
      leaseToken: string;
    };

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1_000) || "bundle fanout Trigger enqueue failed";
}

/**
 * Recover an accepted-but-unacknowledged fanout enqueue without minting a new
 * child or a new Trigger identity. This remains independent of the ordinary
 * generation scheduler: it delivers only already-admitted work.
 */
export async function dispatchDueBundleFanouts(input?: {
  ownerId?: string;
  now?: number;
}): Promise<{ due: number; triggered: number; deferred: number }> {
  await bootstrapSecrets((message) =>
    console.log(`[bundle-fanout-dispatcher] ${message}`),
  );
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  const ownerId = input?.ownerId ?? process.env.STUDIO_OWNER_ID ?? "owner_daniel";
  const now = input?.now ?? Date.now();
  const convex = new ConvexHttpClient(url);
  const due = (await convex.query(api.runs.listDueBundleFanoutDispatches, {
    ownerId,
    now,
  })) as DueReceipt[];

  let triggered = 0;
  let deferred = 0;
  for (const receipt of due.slice(0, BUNDLE_FANOUT_DISPATCH_LIMIT)) {
    const claim = (await convex.mutation(api.runs.claimBundleFanoutDispatch, {
      ownerId,
      runId: receipt.runId,
      now: Date.now(),
    })) as DispatchClaim;
    if (claim.kind !== "claimed") continue;

    try {
      const request = bundleFanoutDispatchSchedule({
        runId: claim.runId,
        envelope: claim.envelope,
      });
      const idempotencyKey = await idempotencyKeys.create(request.idempotencySeed, {
        scope: "global",
      });
      await tasks.trigger("run-pipeline", request.payload, {
        concurrencyKey: request.concurrencyKey,
        idempotencyKey,
      });
      await convex.mutation(api.runs.markBundleFanoutDispatchEnqueued, {
        ownerId,
        runId: claim.runId,
        leaseToken: claim.leaseToken,
        now: Date.now(),
      });
      triggered++;
    } catch (error) {
      deferred++;
      try {
        await convex.mutation(api.runs.deferBundleFanoutDispatch, {
          ownerId,
          runId: claim.runId,
          leaseToken: claim.leaseToken,
          now: Date.now(),
          error: errorMessage(error),
        });
      } catch (deferError) {
        // The claim lease itself is durable. If Convex is temporarily down
        // after an uncertain Trigger response, a later dispatcher tick first
        // waits for that lease, then reissues the exact same global key.
        console.error(
          `[bundle-fanout-dispatcher] failed to defer ${claim.runId}: ${errorMessage(deferError)}`,
        );
      }
    }
  }
  return { due: due.length, triggered, deferred };
}

export const bundleFanoutDispatcher = schedules.task({
  id: "bundle-fanout-dispatcher",
  // Recovery happens well inside the bounded outbox deadline. Empty ticks are
  // one indexed read and never admit a fresh render.
  cron: "* * * * *",
  maxDuration: 120,
  run: async () => dispatchDueBundleFanouts(),
});
