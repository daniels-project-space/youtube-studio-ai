/**
 * The paid weekly H3 data plane. It is intentionally separate from the
 * provider-free `plan-week-bulk` planner: this task accepts only already
 * approved keyframes/prompts and records actual R2-backed render receipts.
 */
import { task } from "@trigger.dev/sdk";
import { bootstrapSecrets } from "@/lib/bootstrap";
import {
  MINIMAX_H3_MANIFEST_SHA256,
  MINIMAX_H3_RUNTIME_ID,
  MINIMAX_H3_PROFILE,
  assertMiniMaxH3SaladCapacity,
  miniMaxH3WeeklyRequestPacketKey,
  miniMaxH3RequestKey,
  renderMiniMaxH3WeeklyBatch,
  type MiniMaxH3Receipt,
  type MiniMaxH3RenderedVideo,
  type MiniMaxH3RenderRequest,
} from "@/lib/minimaxH3";
import { getObjectBytes, putObject } from "@/lib/storage";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256BytesHex, sha256Hex } from "@/lib/sha256";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../convex/_generated/api";
import { saladFleetReservationIdentity } from "@/lib/saladFleetReservation";
import {
  assertPlanWeekPreparedFootageBinding,
  normalizePlanWeekPreparationManifest,
  planWeekPreparedFootageClipKey,
  planWeekPreparedFootageKey,
  planWeekPreparedH3FirstFrameKey,
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
    ...(preparedFootage ? { preparedFootage } : {}),
  };
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
  /** Full validated worker receipts; optional for backward-compatible v1 summaries. */
  providerReceipts?: MiniMaxH3Receipt[];
  totalCostUsd: number;
  createdAt: number;
};

export type PersistedWeeklyRequestPacket = {
  schema: "minimax-h3-weekly-request/v1";
  orderKey: string;
  requestKeys: string[];
  jobs: MiniMaxH3WeeklyBatchArgs["jobs"];
  createdAt: number;
};

export function createMiniMaxH3WeeklyRequestPacket(args: {
  orderKey: string;
  requestKeys: readonly string[];
  jobs: MiniMaxH3WeeklyBatchArgs["jobs"];
  createdAt?: number;
}): PersistedWeeklyRequestPacket {
  const createdAt = args.createdAt ?? Date.now();
  if (!Number.isSafeInteger(createdAt) || createdAt <= 0) throw new Error("weekly MiniMax H3 request packet timestamp is invalid");
  return {
    schema: "minimax-h3-weekly-request/v1",
    orderKey: args.orderKey,
    requestKeys: [...args.requestKeys],
    jobs: structuredClone(args.jobs),
    createdAt,
  };
}

function sameWeeklyRequestPacket(
  packet: PersistedWeeklyRequestPacket,
  expected: { orderKey: string; requestKeys: readonly string[]; jobs: MiniMaxH3WeeklyBatchArgs["jobs"] },
): boolean {
  return packet.schema === "minimax-h3-weekly-request/v1" &&
    packet.orderKey === expected.orderKey &&
    canonicalJson(packet.requestKeys) === canonicalJson(expected.requestKeys) &&
    canonicalJson(packet.jobs) === canonicalJson(expected.jobs) &&
    Number.isSafeInteger(packet.createdAt) && packet.createdAt > 0;
}

/** Persist and re-read the request packet; never overwrite a competing order. */
async function persistWeeklyRequestPacket(args: {
  receiptKey: string;
  orderKey: string;
  requestKeys: readonly string[];
  jobs: MiniMaxH3WeeklyBatchArgs["jobs"];
}): Promise<string> {
  const key = miniMaxH3WeeklyRequestPacketKey(args.receiptKey);
  const body = canonicalJson(createMiniMaxH3WeeklyRequestPacket({
    orderKey: args.orderKey,
    requestKeys: args.requestKeys,
    jobs: args.jobs,
  }));
  try {
    await putObject(key, body, {
      contentType: "application/json",
      metadata: { "h3-weekly-request": "v1", "h3-weekly-request-sha256": sha256Hex(body) },
      ifNoneMatch: "*",
    });
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status !== 409 && status !== 412) throw error;
  }
  let persisted: PersistedWeeklyRequestPacket;
  try {
    persisted = JSON.parse(Buffer.from(await getObjectBytes(key)).toString("utf8")) as PersistedWeeklyRequestPacket;
  } catch (error) {
    throw new Error(`weekly MiniMax H3 request packet is unavailable or invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!sameWeeklyRequestPacket(persisted, args)) {
    throw new Error("weekly MiniMax H3 request packet is bound to a different order");
  }
  return key;
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
  if (parsed.providerReceipts !== undefined && (
    !Array.isArray(parsed.providerReceipts) ||
    parsed.providerReceipts.length !== expected.requestKeys.length ||
    parsed.providerReceipts.some((receipt, index) => {
      const output = receipt?.output;
      const stored = parsed.outputs[index];
      return receipt?.schema !== "minimax-h3-worker/v1" ||
        receipt.requestKey !== expected.requestKeys[index] ||
        output?.r2Key !== stored?.r2Key ||
        output?.contentSha256 !== stored?.contentSha256 ||
        Number(output?.byteLength) !== stored?.byteLength ||
        receipt.runtime?.costUsd !== stored?.costUsd;
    })
  )) {
    throw new Error("weekly MiniMax H3 receipt provider provenance is invalid");
  }
  for (const output of parsed.outputs) {
    const actual = await getObjectBytes(output.r2Key);
    if (actual.byteLength !== output.byteLength || sha256BytesHex(actual) !== output.contentSha256) {
      throw new Error("weekly MiniMax H3 persisted receipt does not match an R2 output");
    }
  }
  return parsed;
}

type PreparedFootageScope = NonNullable<MiniMaxH3WeeklyBatchArgs["preparedFootage"]>;

/**
 * Verify the frozen packet and every first-frame object before any H3 job is
 * submitted. This all-or-nothing preflight prevents a late bad frame from
 * leaving a partially paid weekly order.
 */
async function readPreparedFootageManifest(
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

async function preflightPreparedFrames(
  jobs: readonly MiniMaxH3WeeklyBatchArgs["jobs"][number][],
  binding: PreparedFootageScope,
): Promise<void> {
  await Promise.all(jobs.map(async (job, index) => {
    const expectedKey = planWeekPreparedH3FirstFrameKey({
      ownerId: binding.ownerId,
      channelSlug: binding.channelSlug,
      batchId: binding.batchId,
      itemId: binding.itemId,
      index,
    });
    if (job.firstFrame.r2Key !== expectedKey) {
      throw new Error(`weekly MiniMax H3 prepared-footage first-frame ${index + 1} key is not canonical`);
    }
    const expectedOutputKey = planWeekPreparedFootageClipKey({ ...binding, index });
    if (job.output.r2Key !== expectedOutputKey) {
      throw new Error(`weekly MiniMax H3 prepared-footage output ${index + 1} key is not canonical`);
    }
    const bytes = await getObjectBytes(job.firstFrame.r2Key);
    if (sha256BytesHex(bytes) !== job.firstFrame.sha256) {
      throw new Error(`weekly MiniMax H3 prepared-footage first-frame ${index + 1} digest does not match R2`);
    }
  }));
}

export function buildPreparedFootageSidecar(args: {
  manifest: PlanWeekPreparationManifest;
  binding: PreparedFootageScope;
  jobs: MiniMaxH3WeeklyBatchArgs["jobs"];
  result: readonly MiniMaxH3RenderedVideo[];
}): PlanWeekPreparedFootage {
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
      provider: "salad",
      execution: "weekly-batch",
      runtimeId: MINIMAX_H3_RUNTIME_ID,
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
      requestKey: miniMaxH3RequestKey({ ...job, provider: "salad", execution: "weekly-batch" }),
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

function renderedResultsFromPersistedReceipt(
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

async function materializePreparedFootage(
  binding: PreparedFootageScope,
  manifest: PlanWeekPreparationManifest,
  jobs: MiniMaxH3WeeklyBatchArgs["jobs"],
  result: readonly MiniMaxH3RenderedVideo[],
): Promise<string> {
  const prepared = buildPreparedFootageSidecar({ manifest, binding, jobs, result });
  const sidecarKey = planWeekPreparedFootageKey(binding);
  await persistPreparedFootageSidecar(sidecarKey, prepared);
  return sidecarKey;
}

export const minimaxH3WeeklyBatchTask = task({
  id: "minimax-h3-weekly-batch",
  // H3 workers hydrate and can run up to sixty five-second clips over three
  // 5090 replicas. Medium is preferred, with a bounded high-priority fallback
  // selected during admission. Trigger retries are disabled: a transport failure after a
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
    const preparedManifest = payload.preparedFootage
      ? await readPreparedFootageManifest(payload.preparedFootage)
      : undefined;
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
    if (prior) {
      const preparedFootageKey = payload.preparedFootage
        ? await materializePreparedFootage(
            payload.preparedFootage,
            preparedManifest!,
            payload.jobs,
            renderedResultsFromPersistedReceipt(prior),
          )
        : undefined;
      return {
        receiptKey: payload.receiptKey,
        ...prior,
        ...(preparedFootageKey ? { preparedFootageKey } : {}),
        reconciled: true as const,
      };
    }
    // Salad capacity is a separate admission. The durable fleet fence is
    // acquired first so concurrent weekly orders cannot all pass the same
    // eventually-consistent market snapshot and allocate three GPUs each.
    const requestPacketKey = await persistWeeklyRequestPacket({
      receiptKey: payload.receiptKey,
      orderKey: payload.orderKey,
      requestKeys,
      jobs: payload.jobs,
    });
    // The Convex reservation table is released independently from the web
    // deploy. Keep this seam disabled until both Convex schema and Trigger
    // production are promoted together; otherwise an older live Trigger task
    // could receive a payload that names a function absent from its schema.
    const fleetReservationEnabled = process.env.SALAD_FLEET_RESERVATION_ENABLED === "1";
    const reservationIdentity = payload.ownerId && fleetReservationEnabled
      ? saladFleetReservationIdentity({
          ownerId: payload.ownerId,
          orderKey: payload.orderKey,
          requestKeys,
          requestedGpuCount: Math.min(3, payload.jobs.length),
          priority: "medium",
        })
      : undefined;
    const fleetConvex = payload.ownerId && fleetReservationEnabled
      ? (() => {
          const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
          if (!url) throw new Error("weekly MiniMax H3 fleet reservation requires NEXT_PUBLIC_CONVEX_URL");
          return new StudioConvexHttpClient(url);
        })()
      : undefined;
    const fleetLeaseToken = payload.ownerId && fleetReservationEnabled ? crypto.randomUUID() : undefined;
    const fleetReservation = reservationIdentity && fleetConvex && fleetLeaseToken
      ? await fleetConvex.mutation(api.saladFleetReservations.acquire, {
          reservationKey: reservationIdentity.reservationKey,
          reservationOwnerId: reservationIdentity.ownerId,
          orderKey: reservationIdentity.orderKey,
          requestedGpuCount: reservationIdentity.requestedGpuCount,
          priority: reservationIdentity.priority,
          leaseToken: fleetLeaseToken,
          now: Date.now(),
        })
      : undefined;
    const heldFleetPriority = fleetReservation && typeof fleetReservation.priority === "string"
      ? fleetReservation.priority
      : undefined;
    let providerStarted = false;
    const releaseFleetReservation = async (reason: string): Promise<void> => {
      if (!fleetConvex || !reservationIdentity || !fleetReservation) return;
      try {
        await fleetConvex.mutation(api.saladFleetReservations.release, {
          reservationKey: reservationIdentity.reservationKey,
          leaseToken: fleetReservation.leaseToken,
          now: Date.now(),
          reason,
        });
      } catch (error) {
        // Receipt durability still prevents duplicate spend; a temporary
        // release outage is bounded by the two-hour reservation lease.
        console.error("[minimax-h3-weekly-batch] fleet reservation release deferred", error);
      }
    };
    try {
      const capacity = await assertMiniMaxH3SaladCapacity(payload.jobs.length, {
        // Medium remains the first choice. High is the explicit, costlier
        // capacity escape hatch Daniel authorized: set the variable to "0" to
        // disable it for a deployment, but never let request JSON select it.
        allowHighPriorityFallback: process.env.MINIMAX_H3_SALAD_HIGH_PRIORITY_FALLBACK !== "0",
        // Medium is the safe default; set to "0" only for an intentional
        // maintenance window. High remains a separate fallback gate.
        mediumPriorityEnabled: process.env.MINIMAX_H3_SALAD_MEDIUM_PRIORITY !== "0",
        ...(heldFleetPriority === "high" ? { preferHighPriority: true } : {}),
      });
      if (capacity.fallbackUsed && fleetConvex && reservationIdentity && fleetReservation) {
        // The fence is acquired before the market snapshot to prevent two
        // weekly orders from both passing eventually-consistent capacity
        // checks.  Keep its persisted tier honest when the admitted route has
        // to use the explicit high-priority escape hatch.
        await fleetConvex.mutation(api.saladFleetReservations.upgradePriority, {
          reservationKey: reservationIdentity.reservationKey,
          leaseToken: fleetReservation.leaseToken,
          now: Date.now(),
          priority: "high",
        });
      }
      if (payload.preparedFootage) {
        // Preflight every input before the first worker request; a later bad
        // frame must never leave a partially paid weekly order.
        await preflightPreparedFrames(payload.jobs, payload.preparedFootage);
      }
      providerStarted = true;
      const result = await renderMiniMaxH3WeeklyBatch(payload.jobs, {
        saladCapacityMode: capacity.capacityMode,
      });
      const receipt = createMiniMaxH3WeeklyReceipt(payload.orderKey, result);
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
        await releaseFleetReservation("receipt-reconciled");
        const preparedFootageKey = payload.preparedFootage
          ? await materializePreparedFootage(
              payload.preparedFootage,
              preparedManifest!,
              payload.jobs,
              renderedResultsFromPersistedReceipt(winner),
            )
          : undefined;
        return {
          receiptKey: payload.receiptKey,
          ...winner,
          ...(preparedFootageKey ? { preparedFootageKey } : {}),
          reconciled: true as const,
        };
      }
      await releaseFleetReservation("receipt-stored");
      const preparedFootageKey = payload.preparedFootage
        ? await materializePreparedFootage(payload.preparedFootage, preparedManifest!, payload.jobs, result)
        : undefined;
      return {
        receiptKey: payload.receiptKey,
        ...receipt,
        requestPacketKey,
        ...(preparedFootageKey ? { preparedFootageKey } : {}),
      };
    } catch (error) {
      if (!providerStarted) await releaseFleetReservation("pre-provider-failure");
      throw error;
    }
  },
});
