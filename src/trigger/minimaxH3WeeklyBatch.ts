/**
 * Historical weekly H3 receipt helpers and a permanently retired task handle.
 * New scene admission uses the tenant-bound Render Engine submitter.
 */
import { idempotencyKeys, task, tasks } from "@trigger.dev/sdk";
import {
  MINIMAX_H3_MANIFEST_SHA256,
  miniMaxH3RuntimeId,
  MINIMAX_H3_PROFILE,
  MINIMAX_H3_WEEKLY_CAPACITY_RECHECK_MS,
  MINIMAX_H3_WEEKLY_CAPACITY_FALLBACK_MS,
  miniMaxH3RequestKey,
  type MiniMaxH3RenderedVideo,
  type MiniMaxH3Receipt,
  type MiniMaxH3RenderRequest,
} from "@/lib/minimaxH3";
import { getObjectBytes, putObject } from "@/lib/storage";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256BytesHex, sha256Hex } from "@/lib/sha256";
import { rejectRetiredWeeklyH3Task } from "./legacyH3WeeklyRetirement";
import {
  assertPlanWeekPreparedFootageBinding,
  normalizePlanWeekPreparationManifest,
  planWeekPreparedFootageClipKey,
  planWeekPreparedFootageKey,
  planWeekPreparationKey,
  planWeekPreparationManifestSha256,
  type PlanWeekPreparedFootage,
  type PlanWeekPreparationManifest,
} from "@/lib/planWeekPreparation";

export interface MiniMaxH3WeeklyBatchArgs {
  /** Injected by the authenticated weekly API; required for fleet fencing. */
  ownerId?: string;
  /** Stable owner/week work-order identity; used as the task idempotency seed. */
  orderKey: string;
  /** A scoped receipt path, outside the individual video output paths. */
  receiptKey: string;
  jobs: Array<Omit<MiniMaxH3RenderRequest, "provider" | "execution">>;
  /** Server-set epoch for the automatic Salad wait window. */
  capacityHoldStartedAt?: number;
  /** Optional reviewed weekly packet to materialize as a reusable footage sidecar. */
  preparedFootage?: {
    ownerId: string;
    channelSlug: string;
    batchId: string;
    itemId: string;
    manifestKey: string;
    manifestSha256: string;
    sceneIds: string[];
  };
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

function safePathPart(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) {
    throw new Error(`weekly MiniMax H3 ${label} is invalid`);
  }
  return value;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value.trim().toLowerCase())) {
    throw new Error(`weekly MiniMax H3 ${label} is invalid`);
  }
  return value.trim().toLowerCase();
}

function preparedFootageBinding(value: unknown, jobs: readonly unknown[]): MiniMaxH3WeeklyBatchArgs["preparedFootage"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("weekly MiniMax H3 prepared-footage binding is invalid");
  }
  const raw = value as Record<string, unknown>;
  const sceneIds = raw.sceneIds;
  if (!Array.isArray(sceneIds) || sceneIds.length !== jobs.length || sceneIds.length < 1 || sceneIds.length > 60) {
    throw new Error("weekly MiniMax H3 prepared-footage scene ids must match the job count");
  }
  const normalizedSceneIds = sceneIds.map((sceneId, index) => {
    if (typeof sceneId !== "string" || !sceneId.trim() || sceneId.trim().length > 160) {
      throw new Error(`weekly MiniMax H3 prepared-footage scene ${index + 1} is invalid`);
    }
    return sceneId.trim();
  });
  if (new Set(normalizedSceneIds).size !== normalizedSceneIds.length) {
    throw new Error("weekly MiniMax H3 prepared-footage scene ids must be unique");
  }
  return {
    ownerId: safePathPart(raw.ownerId, "prepared-footage owner id"),
    channelSlug: safePathPart(raw.channelSlug, "prepared-footage channel slug"),
    batchId: safePathPart(raw.batchId, "prepared-footage batch id"),
    itemId: safePathPart(raw.itemId, "prepared-footage item id"),
    manifestKey: scopedReceiptKey(raw.manifestKey),
    manifestSha256: digest(raw.manifestSha256, "prepared-footage manifest digest"),
    sceneIds: normalizedSceneIds,
  };
}

/** Validates task input before vault hydration or a provider request. */
export function assertMiniMaxH3WeeklyBatchArgs(value: unknown): MiniMaxH3WeeklyBatchArgs {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("weekly MiniMax H3 payload is invalid");
  const payload = value as Record<string, unknown>;
  if (payload.ownerId !== undefined && (typeof payload.ownerId !== "string" || !payload.ownerId.trim() || payload.ownerId.length > 160)) {
    throw new Error("weekly MiniMax H3 owner id is invalid");
  }
  if (payload.capacityHoldStartedAt !== undefined &&
      (!Number.isSafeInteger(payload.capacityHoldStartedAt) || Number(payload.capacityHoldStartedAt) <= 0)) {
    throw new Error("weekly MiniMax H3 capacity hold start is invalid");
  }
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
  const preparedFootage = payload.preparedFootage === undefined
    ? undefined
    : preparedFootageBinding(payload.preparedFootage, jobs);
  if (preparedFootage) {
    const expectedManifestKey = planWeekPreparationKey({
      ownerId: preparedFootage.ownerId,
      channelSlug: preparedFootage.channelSlug,
      batchId: preparedFootage.batchId,
      itemId: preparedFootage.itemId,
    });
    if (preparedFootage.manifestKey !== expectedManifestKey) {
      throw new Error("weekly MiniMax H3 prepared-footage manifest key is not canonical");
    }
  }
  return {
    ...(payload.ownerId === undefined ? {} : { ownerId: payload.ownerId.trim() }),
    orderKey: safeIdentifier(payload.orderKey, "order key"),
    receiptKey: scopedReceiptKey(payload.receiptKey),
    jobs,
    ...(payload.capacityHoldStartedAt === undefined ? {} : { capacityHoldStartedAt: Number(payload.capacityHoldStartedAt) }),
    ...(preparedFootage ? { preparedFootage } : {}),
  };
}

function objectNotFound(error: unknown): boolean {
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } } | null;
  return candidate?.name === "NoSuchKey" || candidate?.name === "NotFound" ||
    candidate?.$metadata?.httpStatusCode === 404;
}

export type PersistedWeeklyReceipt = {
  schema: "minimax-h3-weekly-batch/v1" | "minimax-h3-weekly-batch/v2";
  orderKey: string;
  requestKeys: string[];
  /** Original Salad request identities when the weekly order uses an audited fallback. */
  sourceRequestKeys?: string[];
  /** The terminal provider is preserved in the sealed receipt; historical receipts remain readable. */
  fallback?: { provider: "novita" | "openrelay"; reason: "salad-capacity-timeout"; waitedMs: number };
  outputs: Array<{ r2Key: string; contentSha256: string; byteLength: number; costUsd: number }>;
  /** Full validated worker receipts; optional for backward-compatible v1 summaries. */
  providerReceipts?: MiniMaxH3Receipt[];
  totalCostUsd: number;
  createdAt: number;
};

/**
 * A batch receipt is intentionally written last, but each successful shot gets
 * its own create-only claim first. If shot 7 fails after shots 1–6 were paid,
 * a replay can restore those six outputs and render only the missing work.
 */
export const MINIMAX_H3_WEEKLY_JOB_RECEIPT_SCHEMA = "minimax-h3-weekly-job/v1" as const;
export type PersistedWeeklyJobReceipt = {
  schema: typeof MINIMAX_H3_WEEKLY_JOB_RECEIPT_SCHEMA;
  orderKey: string;
  requestKey: string;
  providerReceipt: MiniMaxH3Receipt;
  createdAt: number;
};

export function createMiniMaxH3WeeklyJobReceipt(args: {
  orderKey: string;
  result: MiniMaxH3RenderedVideo;
  createdAt?: number;
}): PersistedWeeklyJobReceipt {
  const createdAt = args.createdAt ?? Date.now();
  if (!Number.isSafeInteger(createdAt) || createdAt <= 0) {
    throw new Error("weekly MiniMax H3 job receipt timestamp is invalid");
  }
  return {
    schema: MINIMAX_H3_WEEKLY_JOB_RECEIPT_SCHEMA,
    orderKey: args.orderKey,
    requestKey: args.result.requestKey,
    providerReceipt: args.result.receipt,
    createdAt,
  };
}

export function miniMaxH3WeeklyJobReceiptKey(receiptKey: string, requestKey: string): string {
  if (typeof receiptKey !== "string" || !receiptKey.startsWith("owner/") || !receiptKey.endsWith(".json") ||
      receiptKey.length > 1_000 || receiptKey.includes("\\") || /(?:^|\/)\.\.?($|\/)/u.test(receiptKey)) {
    throw new Error("weekly MiniMax H3 receipt key is invalid");
  }
  if (typeof requestKey !== "string" || !/^[a-f0-9]{64}$/u.test(requestKey)) {
    throw new Error("weekly MiniMax H3 request key is invalid");
  }
  return receiptKey.slice(0, -".json".length) + `.job-${requestKey}.json`;
}

export type PersistedWeeklyRequestPacket = {
  schema: "minimax-h3-weekly-request/v1";
  orderKey: string;
  requestKeys: string[];
  jobs: MiniMaxH3WeeklyBatchArgs["jobs"];
  capacityHoldStartedAt?: number;
  createdAt: number;
};

export function createMiniMaxH3WeeklyRequestPacket(args: {
  orderKey: string;
  requestKeys: readonly string[];
  jobs: MiniMaxH3WeeklyBatchArgs["jobs"];
  capacityHoldStartedAt?: number;
  createdAt?: number;
}): PersistedWeeklyRequestPacket {
  const createdAt = args.createdAt ?? Date.now();
  if (!Number.isSafeInteger(createdAt) || createdAt <= 0) throw new Error("weekly MiniMax H3 request packet timestamp is invalid");
  return {
    schema: "minimax-h3-weekly-request/v1",
    orderKey: args.orderKey,
    requestKeys: [...args.requestKeys],
    jobs: structuredClone(args.jobs),
    ...(args.capacityHoldStartedAt === undefined ? {} : { capacityHoldStartedAt: args.capacityHoldStartedAt }),
    createdAt,
  };
}

/**
 * Schedule a read-only Salad capacity recheck.  The idempotency seed is tied
 * to the order and time bucket so a lost controller response cannot create a
 * fan-out of duplicate waiters for the same weekly order.
 */
export async function queueMiniMaxH3WeeklyCapacityRetry(args: {
  payload: MiniMaxH3WeeklyBatchArgs;
  now?: number;
}): Promise<{ triggerRunId: string; nextCheckAt: number; capacityHoldStartedAt: number }> {
  const payload = assertMiniMaxH3WeeklyBatchArgs(args.payload);
  if (!payload.ownerId) throw new Error("weekly MiniMax H3 capacity retry requires an owner id");
  const now = args.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error("weekly MiniMax H3 capacity retry clock is invalid");
  const capacityHoldStartedAt = payload.capacityHoldStartedAt ?? now;
  const deadline = capacityHoldStartedAt + MINIMAX_H3_WEEKLY_CAPACITY_FALLBACK_MS;
  // If an old controller wakes after the deadline, still enqueue one
  // immediate successor. That successor owns the explicit Novita fallback;
  // this avoids silently leaving an order held forever after a lost timer.
  const nextBoundary = Math.ceil((now + 1) / MINIMAX_H3_WEEKLY_CAPACITY_RECHECK_MS) * MINIMAX_H3_WEEKLY_CAPACITY_RECHECK_MS;
  const nextCheckAt = deadline <= now
    ? now + 1_000
    : Math.min(nextBoundary, deadline);
  const idempotencyKey = await idempotencyKeys.create(
    `minimax-h3-weekly-capacity-wait:${payload.ownerId}:${payload.orderKey}:${nextCheckAt}`,
    { scope: "global" },
  );
  const handle = await tasks.trigger("minimax-h3-weekly-capacity-retry", {
    ...payload,
    capacityHoldStartedAt,
  }, {
    delay: new Date(nextCheckAt),
    concurrencyKey: `minimax-h3-weekly:${payload.ownerId}`,
    idempotencyKey,
  });
  return { triggerRunId: handle.id, nextCheckAt, capacityHoldStartedAt };
}

/** Build the immutable weekly receipt without dropping per-shot provenance. */
export function createMiniMaxH3WeeklyReceipt(
  orderKey: string,
  result: readonly MiniMaxH3RenderedVideo[],
): PersistedWeeklyReceipt {
  const outputs = result.map((item) => ({
    r2Key: item.receipt.output.r2Key,
    contentSha256: item.receipt.output.contentSha256,
    byteLength: item.receipt.output.byteLength,
    costUsd: item.receipt.runtime.costUsd,
  }));
  return {
    schema: "minimax-h3-weekly-batch/v1",
    orderKey,
    requestKeys: result.map((item) => item.requestKey),
    outputs,
    providerReceipts: result.map((item) => item.receipt),
    totalCostUsd: Number(outputs.reduce((sum, item) => sum + item.costUsd, 0).toFixed(6)),
    createdAt: Date.now(),
  };
}

export function createMiniMaxH3WeeklyFallbackReceipt(args: {
  orderKey: string;
  sourceRequestKeys: readonly string[];
  result: readonly MiniMaxH3RenderedVideo[];
  waitedMs: number;
  createdAt?: number;
}): PersistedWeeklyReceipt {
  if (args.sourceRequestKeys.length !== args.result.length || args.result.length < 1) {
    throw new Error("weekly MiniMax H3 fallback receipt has mismatched request provenance");
  }
  const providers = new Set(args.result.map((item) => item.receipt.runtime.provider));
  if (providers.size !== 1 || (!providers.has("novita") && !providers.has("openrelay"))) {
    throw new Error("weekly MiniMax H3 fallback receipt must contain one supported terminal provider");
  }
  const provider = providers.has("novita") ? "novita" : "openrelay";
  const outputs = args.result.map((item) => ({
    r2Key: item.receipt.output.r2Key,
    contentSha256: item.receipt.output.contentSha256,
    byteLength: item.receipt.output.byteLength,
    costUsd: item.receipt.runtime.costUsd,
  }));
  const createdAt = args.createdAt ?? Date.now();
  if (!Number.isSafeInteger(createdAt) || createdAt <= 0 || !Number.isFinite(args.waitedMs) || args.waitedMs < 0) {
    throw new Error("weekly MiniMax H3 fallback receipt timing is invalid");
  }
  return {
    schema: "minimax-h3-weekly-batch/v2",
    orderKey: args.orderKey,
    sourceRequestKeys: [...args.sourceRequestKeys],
    fallback: { provider, reason: "salad-capacity-timeout", waitedMs: args.waitedMs },
    requestKeys: args.result.map((item) => item.requestKey),
    outputs,
    providerReceipts: args.result.map((item) => item.receipt),
    totalCostUsd: Number(outputs.reduce((sum, item) => sum + item.costUsd, 0).toFixed(6)),
    createdAt,
  };
}

type PreparedFootageScope = NonNullable<MiniMaxH3WeeklyBatchArgs["preparedFootage"]>;

/**
 * Verify the frozen packet and every first-frame object before any H3 job is
 * submitted. This all-or-nothing preflight prevents a late bad frame from
 * leaving a partially paid weekly order.
 */
export async function readPreparedFootageManifest(
  binding: PreparedFootageScope,
): Promise<PlanWeekPreparationManifest> {
  const bytes = await getObjectBytes(binding.manifestKey);
  if (sha256BytesHex(bytes) !== binding.manifestSha256) {
    throw new Error("weekly MiniMax H3 prepared-footage manifest digest does not match R2");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new Error(`weekly MiniMax H3 prepared-footage manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const manifest = normalizePlanWeekPreparationManifest(raw);
  if (
    planWeekPreparationManifestSha256(manifest) !== binding.manifestSha256 ||
    manifest.ownerId !== binding.ownerId ||
    manifest.channelSlug !== binding.channelSlug ||
    manifest.batchId !== binding.batchId ||
    manifest.itemId !== binding.itemId
  ) {
    throw new Error("weekly MiniMax H3 prepared-footage manifest scope does not match the request");
  }
  return manifest;
}

export function buildPreparedFootageSidecar(args: {
  manifest: PlanWeekPreparationManifest;
  binding: PreparedFootageScope;
  jobs: MiniMaxH3WeeklyBatchArgs["jobs"];
  result: readonly MiniMaxH3RenderedVideo[];
  provider?: "salad" | "novita" | "openrelay";
  execution?: "weekly-batch" | "weekly-fallback";
}): PlanWeekPreparedFootage {
  const provider = args.provider ?? "salad";
  const execution = args.execution ?? (provider === "salad" ? "weekly-batch" : "weekly-fallback");
  const nativeDurationSec = MINIMAX_H3_PROFILE.frames / MINIMAX_H3_PROFILE.fps;
  const clips = args.result.map((item, index) => ({
    r2Key: planWeekPreparedFootageClipKey({ ...args.binding, index }),
    sha256: item.receipt.output.contentSha256,
    byteLength: item.receipt.output.byteLength,
    durationSec: nativeDurationSec,
  }));
  const generatedFootageSceneManifest = {
    version: "generated-footage-scene-manifest/v1" as const,
    source: "story_spine" as const,
    exactOrder: true as const,
    durationSec: nativeDurationSec * args.jobs.length,
    items: args.jobs.map((job, index) => ({
      sceneId: args.binding.sceneIds[index]!,
      clipKey: clips[index]!.r2Key,
      t0: nativeDurationSec * index,
      t1: nativeDurationSec * (index + 1),
    })),
  };
  const prepared: PlanWeekPreparedFootage = {
    version: "plan-week-prepared-footage/v1",
    manifestSha256: args.binding.manifestSha256,
    ownerId: args.binding.ownerId,
    channelId: args.manifest.channelId,
    batchId: args.binding.batchId,
    itemId: args.binding.itemId,
    requestKey: args.manifest.requestKey,
    topic: args.manifest.plan.topic,
    generatedFootageSceneManifest,
    clips,
    renderer: {
      kind: "minimax-h3",
      provider,
      execution,
      runtimeId: miniMaxH3RuntimeId(provider),
      profileId: MINIMAX_H3_PROFILE.id,
      modelManifestSha256: MINIMAX_H3_MANIFEST_SHA256,
    },
    h3Jobs: args.jobs.map((job, index) => ({
      sceneId: args.binding.sceneIds[index]!,
      prompt: job.prompt,
      seed: job.seed,
      firstFrame: job.firstFrame,
      output: { r2Key: clips[index]!.r2Key },
      maxCostUsd: job.maxCostUsd,
      requestKey: miniMaxH3RequestKey({ ...job, provider, execution }),
    })),
    h3Receipts: args.result.map((item) => item.receipt),
    createdAt: Date.now(),
  };
  return assertPlanWeekPreparedFootageBinding({ prepared, manifest: args.manifest });
}

async function persistPreparedFootageSidecar(
  sidecarKey: string,
  prepared: PlanWeekPreparedFootage,
): Promise<void> {
  const body = canonicalJson(prepared);
  try {
    await putObject(sidecarKey, body, {
      contentType: "application/json",
      ifNoneMatch: "*",
      metadata: { "plan-week-prepared-footage": prepared.version, sha256: sha256Hex(body) },
    });
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status !== 409 && status !== 412) throw error;
  }
  const persisted = await getObjectBytes(sidecarKey);
  if (sha256BytesHex(persisted) !== sha256Hex(body)) {
    throw new Error("weekly MiniMax H3 prepared-footage sidecar changed after create-only write");
  }
}

export function renderedResultsFromPersistedReceipt(
  receipt: PersistedWeeklyReceipt,
): MiniMaxH3RenderedVideo[] {
  if (!receipt.providerReceipts || receipt.providerReceipts.length !== receipt.requestKeys.length) {
    throw new Error("weekly MiniMax H3 receipt lacks full provider provenance for prepared-footage materialization");
  }
  return receipt.providerReceipts.map((providerReceipt, index) => ({
    requestKey: receipt.requestKeys[index]!,
    receipt: providerReceipt,
    // The sidecar binds the immutable receipt and R2 bytes; the bytes are
    // re-read by the scheduled consumer immediately before assembly.
    outputBytes: new Uint8Array(0),
  }));
}

export async function materializePreparedFootage(
  binding: PreparedFootageScope,
  manifest: PlanWeekPreparationManifest,
  jobs: MiniMaxH3WeeklyBatchArgs["jobs"],
  result: readonly MiniMaxH3RenderedVideo[],
  options: { provider?: "salad" | "novita" | "openrelay"; execution?: "weekly-batch" | "weekly-fallback" } = {},
): Promise<string> {
  const prepared = buildPreparedFootageSidecar({ ...options, manifest, binding, jobs, result });
  const sidecarKey = planWeekPreparedFootageKey(binding);
  await persistPreparedFootageSidecar(sidecarKey, prepared);
  return sidecarKey;
}

export const minimaxH3WeeklyBatchTask = task({
  id: "minimax-h3-weekly-batch",
  // Retain the stale task identity and limits; every invocation aborts.
  maxDuration: 3_600,
  retry: { maxAttempts: 1 },
  queue: { concurrencyLimit: 1 },
  run: async (_rawPayload: MiniMaxH3WeeklyBatchArgs) => {
    void _rawPayload;
    return rejectRetiredWeeklyH3Task();
  },
});
