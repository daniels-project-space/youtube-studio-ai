/**
 * Durable, read-only capacity waiter for the weekly H3 Salad lane.
 *
 * This task never calls a paid worker. It either re-admits the original
 * Salad order, schedules the next bounded check, or hands the frozen packet
 * to the exact persistent-disk OpenRelay fallback after the 24-hour wait window.
 */
import { idempotencyKeys, task, tasks } from "@trigger.dev/sdk";
import { bootstrapSecrets } from "@/lib/bootstrap";
import {
  MINIMAX_H3_WEEKLY_CAPACITY_FALLBACK_MS,
  assertMiniMaxH3SaladCapacity,
  miniMaxH3RequestKey,
  miniMaxH3WeeklyRequestPacketKey,
} from "@/lib/minimaxH3";
import { getObjectBytes } from "@/lib/storage";
import { canonicalJson } from "@/lib/canonicalJson";
import { isMiniMaxH3CapacityHoldError } from "@/lib/minimaxH3Status";
import { saladPriorityPolicyFromEnv } from "@/lib/saladCloud";
import {
  assertMiniMaxH3WeeklyBatchArgs,
  queueMiniMaxH3WeeklyCapacityRetry,
  type MiniMaxH3WeeklyBatchArgs,
} from "./minimaxH3WeeklyBatch";

function notFound(error: unknown): boolean {
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } } | null;
  return candidate?.name === "NoSuchKey" || candidate?.name === "NotFound" || candidate?.$metadata?.httpStatusCode === 404;
}

async function objectExists(key: string): Promise<boolean> {
  try {
    await getObjectBytes(key);
    return true;
  } catch (error) {
    if (notFound(error)) return false;
    throw error;
  }
}

async function assertFrozenPacket(payload: MiniMaxH3WeeklyBatchArgs): Promise<void> {
  const requestKeys = payload.jobs.map((job) => miniMaxH3RequestKey({
    ...job,
    provider: "salad",
    execution: "weekly-batch",
  }));
  const packetKey = miniMaxH3WeeklyRequestPacketKey(payload.receiptKey);
  const packet = JSON.parse(new TextDecoder().decode(await getObjectBytes(packetKey))) as Record<string, unknown>;
  if (
    packet.schema !== "minimax-h3-weekly-request/v1" ||
    packet.orderKey !== payload.orderKey ||
    canonicalJson(packet.requestKeys) !== canonicalJson(requestKeys) ||
    canonicalJson(packet.jobs) !== canonicalJson(payload.jobs)
  ) {
    throw new Error("weekly MiniMax H3 capacity retry packet is not bound to the original order");
  }
}

export const minimaxH3WeeklyCapacityRetryTask = task({
  id: "minimax-h3-weekly-capacity-retry",
  maxDuration: 120,
  retry: { maxAttempts: 1 },
  queue: { concurrencyLimit: 1 },
  run: async (rawPayload: MiniMaxH3WeeklyBatchArgs) => {
    const payload = assertMiniMaxH3WeeklyBatchArgs(rawPayload);
    if (!payload.ownerId || payload.capacityHoldStartedAt === undefined) {
      throw new Error("weekly MiniMax H3 capacity retry requires the signed owner and hold start");
    }
    await bootstrapSecrets(() => undefined, {
      services: ["cloudflare", "salad"],
      required: [
        "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY",
        "MINIMAX_H3_SALAD_WORKER_URL", "MINIMAX_H3_SALAD_WORKER_TOKEN",
      ],
    });
    if (await objectExists(payload.receiptKey)) {
      return { state: "reconciled" as const, receiptKey: payload.receiptKey };
    }
    await assertFrozenPacket(payload);
    const now = Date.now();
    const deadline = payload.capacityHoldStartedAt + MINIMAX_H3_WEEKLY_CAPACITY_FALLBACK_MS;
    if (now >= deadline) {
      const idempotencyKey = await idempotencyKeys.create(
        `minimax-h3-weekly-openrelay-fallback:${payload.ownerId}:${payload.orderKey}`,
        { scope: "global" },
      );
      const handle = await tasks.trigger("minimax-h3-weekly-openrelay-fallback", payload, {
        concurrencyKey: `minimax-h3-weekly:${payload.ownerId}`,
        idempotencyKey,
      });
      return {
        state: "fallback_queued" as const,
        provider: "openrelay" as const,
        waitedMs: now - payload.capacityHoldStartedAt,
        triggerRunId: handle.id,
      };
    }
    try {
      const policy = saladPriorityPolicyFromEnv();
      await assertMiniMaxH3SaladCapacity(payload.jobs.length, {
        mediumPriorityEnabled: policy.mediumEnabled,
        allowHighPriorityFallback: policy.highFallbackEnabled,
      });
      const idempotencyKey = await idempotencyKeys.create(
        `minimax-h3-weekly-capacity-admitted:${payload.ownerId}:${payload.orderKey}:${Math.floor(now / 900_000)}`,
        { scope: "global" },
      );
      const handle = await tasks.trigger("minimax-h3-weekly-batch", payload, {
        concurrencyKey: `minimax-h3-weekly:${payload.ownerId}`,
        idempotencyKey,
      });
      return { state: "salad_admitted" as const, provider: "salad" as const, triggerRunId: handle.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isMiniMaxH3CapacityHoldError(message)) throw error;
      const queued = await queueMiniMaxH3WeeklyCapacityRetry({ payload, now });
      return {
        state: "capacity_held" as const,
        provider: "salad" as const,
        nextCheckAt: queued.nextCheckAt,
        capacityHoldStartedAt: queued.capacityHoldStartedAt,
        triggerRunId: queued.triggerRunId,
      };
    }
  },
});
