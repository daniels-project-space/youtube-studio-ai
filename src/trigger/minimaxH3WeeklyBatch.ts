/**
 * The paid weekly H3 data plane. It is intentionally separate from the
 * provider-free `plan-week-bulk` planner: this task accepts only already
 * approved keyframes/prompts and records actual R2-backed render receipts.
 */
import { task } from "@trigger.dev/sdk";
import { bootstrapSecrets } from "@/lib/bootstrap";
import {
  renderMiniMaxH3WeeklyBatch,
  type MiniMaxH3RenderRequest,
} from "@/lib/minimaxH3";
import { putObject } from "@/lib/storage";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

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
  }
  return { orderKey: safeIdentifier(payload.orderKey, "order key"), receiptKey: scopedReceiptKey(payload.receiptKey), jobs };
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
    await putObject(payload.receiptKey, canonicalJson(receipt), {
      contentType: "application/json",
      metadata: { "h3-batch-receipt": "v1", "h3-batch-sha256": sha256Hex(canonicalJson(receipt)) },
      ifNoneMatch: "*",
    });
    return { receiptKey: payload.receiptKey, ...receipt };
  },
});
