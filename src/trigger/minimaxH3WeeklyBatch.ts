/**
 * The paid weekly H3 data plane. It is intentionally separate from the
 * provider-free `plan-week-bulk` planner: this task accepts only already
 * approved keyframes/prompts and records actual R2-backed render receipts.
 */
import { task } from "@trigger.dev/sdk";
import { bootstrapSecrets } from "@/lib/bootstrap";
import {
  miniMaxH3RequestKey,
  renderMiniMaxH3WeeklyBatch,
  type MiniMaxH3RenderRequest,
} from "@/lib/minimaxH3";
import { getObjectBytes, putObject } from "@/lib/storage";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256BytesHex, sha256Hex } from "@/lib/sha256";

export interface MiniMaxH3WeeklyBatchArgs {
  /** Stable owner/week work-order identity; used as the task idempotency seed. */
  orderKey: string;
  /** A scoped receipt path, outside the individual video output paths. */
  receiptKey: string;
  jobs: Array<Omit<MiniMaxH3RenderRequest, "provider" | "execution">>;
}

function safeIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) {
    throw new Error(`weekly MiniMax H3 ${label} is invalid`);
  }
  return value;
}

function scopedReceiptKey(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("owner/") || !value.endsWith(".json") ||
      value.length > 1_000 || value.includes("\\") || /(?:^|\/)\.\.?($|\/)/u.test(value)) {
    throw new Error("weekly MiniMax H3 receipt key is invalid");
  }
  return value;
}

/** Validates task input before vault hydration or a provider request. */
export function assertMiniMaxH3WeeklyBatchArgs(value: unknown): MiniMaxH3WeeklyBatchArgs {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("weekly MiniMax H3 payload is invalid");
  const payload = value as Record<string, unknown>;
  if (!Array.isArray(payload.jobs) || payload.jobs.length < 1 || payload.jobs.length > 60) {
    throw new Error("weekly MiniMax H3 payload must contain 1..60 jobs");
  }
  const jobs = payload.jobs as MiniMaxH3WeeklyBatchArgs["jobs"];
  const requestKeys = new Set<string>();
  const outputKeys = new Set<string>();
  for (const [index, job] of jobs.entries()) {
    if (!job || typeof job !== "object" || Array.isArray(job) || !job.output || typeof job.output !== "object" ||
        typeof job.output.r2Key !== "string" || !job.output.r2Key.startsWith("owner/") ||
        job.output.r2Key.length <= "owner/".length || job.output.r2Key.includes("\\") ||
        /(?:^|\/)\.\.?($|\/)/u.test(job.output.r2Key)) {
      throw new Error(`weekly MiniMax H3 job ${index + 1} has an invalid owner-scoped output key`);
    }
    if (!job.firstFrame || typeof job.firstFrame !== "object" || Array.isArray(job.firstFrame) ||
        typeof job.firstFrame.r2Key !== "string" || !job.firstFrame.r2Key.startsWith("owner/") ||
        job.firstFrame.r2Key.length <= "owner/".length || job.firstFrame.r2Key.includes("\\") ||
        /(?:^|\/)\.\.?($|\/)/u.test(job.firstFrame.r2Key)) {
      throw new Error(`weekly MiniMax H3 job ${index + 1} has an invalid owner-scoped first-frame key`);
    }
    // Run the complete provider-free request normalizer at the task boundary,
    // before vault hydration or any paid worker call. This catches malformed
    // prompt/seed/hash/cost fields that the path checks above cannot see.
    let requestKey: string;
    try {
      requestKey = miniMaxH3RequestKey({
        ...job,
        provider: "salad",
        execution: "weekly-batch",
      });
    } catch (error) {
      throw new Error(`weekly MiniMax H3 job ${index + 1} is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (requestKeys.has(requestKey)) {
      throw new Error(`weekly MiniMax H3 batch has duplicate request identity at job ${index + 1}`);
    }
    requestKeys.add(requestKey);
    const outputKey = job.output.r2Key;
    if (outputKeys.has(outputKey)) {
      throw new Error(`weekly MiniMax H3 batch has duplicate output key at job ${index + 1}`);
    }
    outputKeys.add(outputKey);
  }
  return { orderKey: safeIdentifier(payload.orderKey, "order key"), receiptKey: scopedReceiptKey(payload.receiptKey), jobs };
}

function objectNotFound(error: unknown): boolean {
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } } | null;
  return candidate?.name === "NoSuchKey" || candidate?.name === "NotFound" ||
    candidate?.$metadata?.httpStatusCode === 404;
}

type PersistedWeeklyReceipt = {
  schema: "minimax-h3-weekly-batch/v1";
  orderKey: string;
  requestKeys: string[];
  outputs: Array<{ r2Key: string; contentSha256: string; byteLength: number; costUsd: number }>;
  totalCostUsd: number;
  createdAt: number;
};

/** Reconciles a prior batch receipt and every retained R2 output. */
async function readPersistedReceipt(
  key: string,
  expected: { orderKey: string; requestKeys: readonly string[]; outputKeys: readonly string[] },
): Promise<PersistedWeeklyReceipt | null> {
  let bytes: Uint8Array;
  try {
    bytes = await getObjectBytes(key);
  } catch (error) {
    if (objectNotFound(error)) return null;
    throw error;
  }
  let parsed: PersistedWeeklyReceipt;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as PersistedWeeklyReceipt;
  } catch {
    throw new Error("weekly MiniMax H3 receipt exists but is not valid JSON");
  }
  if (
    parsed?.schema !== "minimax-h3-weekly-batch/v1" ||
    parsed.orderKey !== expected.orderKey ||
    !Array.isArray(parsed.requestKeys) ||
    parsed.requestKeys.length !== expected.requestKeys.length ||
    parsed.requestKeys.some((requestKey, index) => requestKey !== expected.requestKeys[index]) ||
    !Array.isArray(parsed.outputs) ||
    parsed.outputs.length !== expected.outputKeys.length ||
    parsed.outputs.some((output, index) =>
      output?.r2Key !== expected.outputKeys[index] ||
      !/^[a-f0-9]{64}$/.test(output?.contentSha256 ?? "") ||
      !Number.isSafeInteger(output?.byteLength) || output.byteLength < 1_024 ||
      !Number.isFinite(output?.costUsd) || output.costUsd < 0),
    !Number.isFinite(parsed.totalCostUsd) || parsed.totalCostUsd < 0 ||
    !Number.isSafeInteger(parsed.createdAt) || parsed.createdAt <= 0
  ) {
    throw new Error("weekly MiniMax H3 receipt exists but is bound to a different request");
  }
  for (const output of parsed.outputs) {
    const actual = await getObjectBytes(output.r2Key);
    if (actual.byteLength !== output.byteLength || sha256BytesHex(actual) !== output.contentSha256) {
      throw new Error("weekly MiniMax H3 persisted receipt does not match an R2 output");
    }
  }
  return parsed;
}

export const minimaxH3WeeklyBatchTask = task({
  id: "minimax-h3-weekly-batch",
  // H3 workers hydrate and can run up to sixty five-second clips over three
  // 5090 replicas. Trigger retries are disabled: a transport failure after a
  // provider submission is explicitly reconciled by request key, never replayed.
  maxDuration: 3_600,
  retry: { maxAttempts: 1 },
  queue: { concurrencyLimit: 1 },
  run: async (rawPayload: MiniMaxH3WeeklyBatchArgs) => {
    const payload = assertMiniMaxH3WeeklyBatchArgs(rawPayload);
    await bootstrapSecrets(() => undefined, {
      services: ["cloudflare", "salad"],
      required: [
        "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY",
        "MINIMAX_H3_SALAD_WORKER_URL", "MINIMAX_H3_SALAD_WORKER_TOKEN",
      ],
    });
    const requestKeys = payload.jobs.map((job) => miniMaxH3RequestKey({
      ...job,
      provider: "salad",
      execution: "weekly-batch",
    }));
    const outputKeys = payload.jobs.map((job) => job.output.r2Key);
    const prior = await readPersistedReceipt(payload.receiptKey, {
      orderKey: payload.orderKey,
      requestKeys,
      outputKeys,
    });
    if (prior) return { receiptKey: payload.receiptKey, ...prior, reconciled: true as const };
    const result = await renderMiniMaxH3WeeklyBatch(payload.jobs);
    const receipt = {
      schema: "minimax-h3-weekly-batch/v1",
      orderKey: payload.orderKey,
      requestKeys: result.map((item) => item.requestKey),
      outputs: result.map((item) => ({
        r2Key: item.receipt.output.r2Key,
        contentSha256: item.receipt.output.contentSha256,
        byteLength: item.receipt.output.byteLength,
        costUsd: item.receipt.runtime.costUsd,
      })),
      totalCostUsd: Number(result.reduce((sum, item) => sum + item.receipt.runtime.costUsd, 0).toFixed(6)),
      createdAt: Date.now(),
    };
    // A batch receipt is create-only. If a controller loses its response after
    // rendering, it must read/reconcile this immutable proof rather than issue
    // a second paid order with a new receipt spelling.
    const body = canonicalJson(receipt);
    try {
      await putObject(payload.receiptKey, body, {
        contentType: "application/json",
        metadata: { "h3-batch-receipt": "v1", "h3-batch-sha256": sha256Hex(body) },
        ifNoneMatch: "*",
      });
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status !== 409 && status !== 412) throw error;
      const winner = await readPersistedReceipt(payload.receiptKey, { orderKey: payload.orderKey, requestKeys, outputKeys });
      if (!winner) throw error;
      return { receiptKey: payload.receiptKey, ...winner, reconciled: true as const };
    }
    return { receiptKey: payload.receiptKey, ...receipt };
  },
});
