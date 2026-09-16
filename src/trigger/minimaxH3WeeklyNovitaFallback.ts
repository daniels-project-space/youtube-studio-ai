/** Explicit provider fallback for a weekly H3 order held by Salad capacity. */
import { task } from "@trigger.dev/sdk";
import { bootstrapSecrets } from "@/lib/bootstrap";
import {
  MINIMAX_H3_MANIFEST_SHA256,
  MINIMAX_H3_PROFILE,
  MINIMAX_H3_RUNTIME_ID,
  miniMaxH3RequestKey,
  renderMiniMaxH3WeeklyBatch,
  type MiniMaxH3RenderedVideo,
} from "@/lib/minimaxH3";
import { getObjectBytes, putObject } from "@/lib/storage";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256BytesHex, sha256Hex } from "@/lib/sha256";
import { summarizeMiniMaxH3Receipt } from "@/lib/minimaxH3Status";
import {
  assertMiniMaxH3WeeklyBatchArgs,
  createMiniMaxH3WeeklyFallbackReceipt,
  createMiniMaxH3WeeklyJobReceipt,
  materializePreparedFootage,
  miniMaxH3WeeklyJobReceiptKey,
  readPreparedFootageManifest,
  renderedResultsFromPersistedReceipt,
  type PersistedWeeklyJobReceipt,
  type PersistedWeeklyReceipt,
  type MiniMaxH3WeeklyBatchArgs,
} from "./minimaxH3WeeklyBatch";

function notFound(error: unknown): boolean {
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } } | null;
  return candidate?.name === "NoSuchKey" || candidate?.name === "NotFound" || candidate?.$metadata?.httpStatusCode === 404;
}

async function readAggregate(key: string, ownerId: string): Promise<PersistedWeeklyReceipt | null> {
  let bytes: Uint8Array;
  try {
    bytes = await getObjectBytes(key);
  } catch (error) {
    if (notFound(error)) return null;
    throw error;
  }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error("weekly H3 Novita fallback receipt is not valid JSON"); }
  summarizeMiniMaxH3Receipt(parsed, ownerId);
  return parsed as PersistedWeeklyReceipt;
}

async function readFallbackClaim(args: {
  receiptKey: string;
  orderKey: string;
  requestKey: string;
  outputKey: string;
}): Promise<MiniMaxH3RenderedVideo | null> {
  const key = miniMaxH3WeeklyJobReceiptKey(args.receiptKey, args.requestKey);
  let bytes: Uint8Array;
  try { bytes = await getObjectBytes(key); } catch (error) {
    if (notFound(error)) return null;
    throw error;
  }
  let parsed: PersistedWeeklyJobReceipt;
  try { parsed = JSON.parse(new TextDecoder().decode(bytes)) as PersistedWeeklyJobReceipt; } catch {
    throw new Error("weekly H3 Novita fallback job receipt is not valid JSON");
  }
  const receipt = parsed.providerReceipt;
  if (
    parsed.schema !== "minimax-h3-weekly-job/v1" || parsed.orderKey !== args.orderKey || parsed.requestKey !== args.requestKey ||
    receipt.schema !== "minimax-h3-worker/v1" || receipt.requestKey !== args.requestKey || receipt.execution !== "weekly-fallback" ||
    receipt.runtime.provider !== "novita" || receipt.runtime.gpuModel !== "RTX 5090" || receipt.runtime.capacityMode !== "spot" ||
    receipt.runtime.runtimeId !== MINIMAX_H3_RUNTIME_ID || receipt.runtime.modelManifestSha256 !== MINIMAX_H3_MANIFEST_SHA256 ||
    canonicalJson(receipt.profile) !== canonicalJson(MINIMAX_H3_PROFILE) || receipt.output.r2Key !== args.outputKey ||
    !Number.isSafeInteger(receipt.output.byteLength) || receipt.output.byteLength < 1_024 ||
    !/^[a-f0-9]{64}$/u.test(receipt.output.contentSha256) || !Number.isSafeInteger(parsed.createdAt) || parsed.createdAt <= 0
  ) throw new Error("weekly H3 Novita fallback job receipt is bound to a different request");
  const outputBytes = await getObjectBytes(args.outputKey);
  if (outputBytes.byteLength !== receipt.output.byteLength || sha256BytesHex(outputBytes) !== receipt.output.contentSha256) {
    throw new Error("weekly H3 Novita fallback job receipt does not match its retained R2 output");
  }
  return { requestKey: args.requestKey, receipt, outputBytes };
}

async function persistFallbackClaim(args: {
  receiptKey: string;
  orderKey: string;
  result: MiniMaxH3RenderedVideo;
}): Promise<void> {
  const body = canonicalJson(createMiniMaxH3WeeklyJobReceipt(args));
  const key = miniMaxH3WeeklyJobReceiptKey(args.receiptKey, args.result.requestKey);
  try {
    await putObject(key, body, {
      contentType: "application/json",
      metadata: { "h3-job-receipt": "minimax-h3-weekly-job/v1", sha256: sha256Hex(body) },
      ifNoneMatch: "*",
    });
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status !== 409 && status !== 412) throw error;
  }
  const persisted = await readFallbackClaim({
    receiptKey: args.receiptKey,
    orderKey: args.orderKey,
    requestKey: args.result.requestKey,
    outputKey: args.result.receipt.output.r2Key,
  });
  if (!persisted || canonicalJson(persisted.receipt) !== canonicalJson(args.result.receipt)) {
    throw new Error("weekly H3 Novita fallback job receipt changed after create-only write");
  }
}

async function readFrozenPacket(payload: MiniMaxH3WeeklyBatchArgs): Promise<string[]> {
  const packetKey = `${payload.receiptKey.slice(0, -".json".length)}.request.json`;
  const packet = JSON.parse(new TextDecoder().decode(await getObjectBytes(packetKey))) as Record<string, unknown>;
  const sourceRequestKeys = payload.jobs.map((job) => miniMaxH3RequestKey({ ...job, provider: "salad", execution: "weekly-batch" }));
  if (
    packet.schema !== "minimax-h3-weekly-request/v1" || packet.orderKey !== payload.orderKey ||
    canonicalJson(packet.requestKeys) !== canonicalJson(sourceRequestKeys) || canonicalJson(packet.jobs) !== canonicalJson(payload.jobs)
  ) throw new Error("weekly H3 Novita fallback request packet is not bound to the Salad order");
  return sourceRequestKeys;
}

export const minimaxH3WeeklyNovitaFallbackTask = task({
  id: "minimax-h3-weekly-novita-fallback",
  maxDuration: 3_600,
  retry: { maxAttempts: 1 },
  queue: { concurrencyLimit: 1 },
  run: async (rawPayload: MiniMaxH3WeeklyBatchArgs) => {
    const payload = assertMiniMaxH3WeeklyBatchArgs(rawPayload);
    if (!payload.ownerId || payload.capacityHoldStartedAt === undefined) {
      throw new Error("weekly H3 Novita fallback requires the signed owner and Salad hold start");
    }
    await bootstrapSecrets(() => undefined, {
      services: ["cloudflare", "novita"],
      required: [
        "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY",
        "MINIMAX_H3_NOVITA_WORKER_URL", "MINIMAX_H3_NOVITA_WORKER_TOKEN",
      ],
    });
    const sourceRequestKeys = await readFrozenPacket(payload);
    const prior = await readAggregate(payload.receiptKey, payload.ownerId);
    if (prior) {
      const priorIsNovitaFallback = prior.schema === "minimax-h3-weekly-batch/v2";
      const preparedFootageKey = payload.preparedFootage
        ? await materializePreparedFootage(
            payload.preparedFootage,
            await readPreparedFootageManifest(payload.preparedFootage),
            payload.jobs,
            renderedResultsFromPersistedReceipt(prior),
            priorIsNovitaFallback
              ? { provider: "novita", execution: "weekly-fallback" }
              : { provider: "salad", execution: "weekly-batch" },
          )
        : undefined;
      return { state: "reconciled" as const, provider: "novita" as const, receiptKey: payload.receiptKey, ...(preparedFootageKey ? { preparedFootageKey } : {}) };
    }
    const requestKeys = payload.jobs.map((job) => miniMaxH3RequestKey({ ...job, provider: "novita", execution: "weekly-fallback" }));
    const results: Array<MiniMaxH3RenderedVideo | undefined> = new Array(payload.jobs.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(8, payload.jobs.length) }, async () => {
      for (;;) {
        const index = next++;
        if (index >= payload.jobs.length) return;
        results[index] = await readFallbackClaim({
          receiptKey: payload.receiptKey,
          orderKey: payload.orderKey,
          requestKey: requestKeys[index]!,
          outputKey: payload.jobs[index]!.output.r2Key,
        }) ?? undefined;
      }
    }));
    const pendingIndexes = results.flatMap((item, index) => item === undefined ? [index] : []);
    const pendingJobs = pendingIndexes.map((index) => payload.jobs[index]!);
    await renderMiniMaxH3WeeklyBatch(pendingJobs, {
      provider: "novita",
      execution: "weekly-fallback",
      onJobComplete: async (pendingIndex, rendered) => {
        const originalIndex = pendingIndexes[pendingIndex];
        if (originalIndex === undefined) throw new Error("weekly H3 Novita fallback completion index is invalid");
        await persistFallbackClaim({ receiptKey: payload.receiptKey, orderKey: payload.orderKey, result: rendered });
        results[originalIndex] = rendered;
      },
    });
    if (!results.every((item): item is MiniMaxH3RenderedVideo => item !== undefined)) {
      throw new Error("weekly H3 Novita fallback completed without every shot result");
    }
    const receipt = createMiniMaxH3WeeklyFallbackReceipt({
      orderKey: payload.orderKey,
      sourceRequestKeys,
      result: results,
      waitedMs: Math.max(0, Date.now() - payload.capacityHoldStartedAt),
    });
    const body = canonicalJson(receipt);
    try {
      await putObject(payload.receiptKey, body, {
        contentType: "application/json",
        metadata: { "h3-batch-receipt": "v2", "h3-batch-sha256": sha256Hex(body), "h3-fallback-provider": "novita" },
        ifNoneMatch: "*",
      });
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status !== 409 && status !== 412) throw error;
      const winner = await readAggregate(payload.receiptKey, payload.ownerId);
      if (!winner) throw error;
      return { state: "reconciled" as const, provider: "novita" as const, receiptKey: payload.receiptKey };
    }
    const preparedFootageKey = payload.preparedFootage
      ? await materializePreparedFootage(
          payload.preparedFootage,
          await readPreparedFootageManifest(payload.preparedFootage),
          payload.jobs,
          results,
          { provider: "novita", execution: "weekly-fallback" },
        )
      : undefined;
    return { state: "complete" as const, provider: "novita" as const, receiptKey: payload.receiptKey, requestKeys, ...(preparedFootageKey ? { preparedFootageKey } : {}) };
  },
});
