import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type {
  StudioAction,
  StudioActionApprovalReceipt,
} from "@/lib/studioActionApprovalContract";
import {
  normalizeYoutubeChannelName,
  normalizeYoutubeHandle,
} from "@/lib/youtubeChannelCreationClaim";

export type {
  StudioAction,
  StudioActionApprovalReceipt,
} from "@/lib/studioActionApprovalContract";

const MAX_RECEIPT_TTL_MS = 15 * 60 * 1_000;
const DEFAULT_RECEIPT_TTL_MS = 10 * 60 * 1_000;
const MAX_CLOCK_SKEW_MS = 30_000;

function stableJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("approval values must be finite");
    return JSON.stringify(value);
  }
  if (value === undefined) return '"$undefined"';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") throw new Error("unsupported approval value");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function signingKey(): Buffer {
  const privateKey = process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY;
  if (!privateKey) throw new Error("STUDIO_CONVEX_JWT_PRIVATE_KEY is required for action approvals");
  return createHash("sha256")
    .update("youtube-studio-ai/action-approval/v1\0", "utf8")
    .update(privateKey, "utf8")
    .digest();
}

function unsigned(receipt: Omit<StudioActionApprovalReceipt, "signature">): string {
  return stableJson(receipt);
}

function signature(receipt: Omit<StudioActionApprovalReceipt, "signature">): string {
  return createHmac("sha256", signingKey()).update(unsigned(receipt)).digest("base64url");
}

export function issueStudioActionApproval(args: {
  action: StudioAction;
  ownerId: string;
  subject: string;
  actor: string;
  evidence: string;
  maxCostUsd?: number;
  now?: number;
  ttlMs?: number;
}): StudioActionApprovalReceipt {
  const now = args.now ?? Date.now();
  const ttlMs = args.ttlMs ?? DEFAULT_RECEIPT_TTL_MS;
  if (!args.ownerId.trim() || !args.subject.trim()) throw new Error("approval owner and subject are required");
  if (!args.actor.startsWith("authenticated-operator:")) {
    throw new Error("action approval requires an authenticated operator actor");
  }
  if (!args.evidence.trim()) throw new Error("action approval evidence is required");
  if (!Number.isFinite(ttlMs) || ttlMs < 1_000 || ttlMs > MAX_RECEIPT_TTL_MS) {
    throw new Error("action approval TTL must be between one second and fifteen minutes");
  }
  if (
    args.maxCostUsd !== undefined &&
    (!Number.isFinite(args.maxCostUsd) || args.maxCostUsd <= 0 || args.maxCostUsd > 100)
  ) {
    throw new Error("action approval cost cap must be greater than zero and at most $100");
  }
  const receipt: Omit<StudioActionApprovalReceipt, "signature"> = {
    version: "studio-action-approval/v1",
    action: args.action,
    ownerId: args.ownerId,
    subject: args.subject,
    actor: args.actor,
    evidence: args.evidence.trim().slice(0, 500),
    issuedAt: now,
    expiresAt: now + ttlMs,
    ...(args.maxCostUsd === undefined ? {} : { maxCostUsd: args.maxCostUsd }),
  };
  return { ...receipt, signature: signature(receipt) };
}

export function verifyStudioActionApproval(
  value: unknown,
  expected: {
    action: StudioAction;
    ownerId: string;
    subject: string;
    now?: number;
    maximumCostUsd?: number;
    /**
     * An expired receipt may only resume when its exact signed bytes were
     * already frozen in durable state before expiry.
     */
    persistedReceiptFingerprint?: string;
  },
): value is StudioActionApprovalReceipt {
  try {
    if (!value || typeof value !== "object") return false;
    const receipt = value as Partial<StudioActionApprovalReceipt>;
    if (
      receipt.version !== "studio-action-approval/v1" ||
      receipt.action !== expected.action ||
      receipt.ownerId !== expected.ownerId ||
      receipt.subject !== expected.subject ||
      !receipt.actor?.startsWith("authenticated-operator:") ||
      !receipt.evidence?.trim() ||
      typeof receipt.issuedAt !== "number" ||
      typeof receipt.expiresAt !== "number" ||
      typeof receipt.signature !== "string"
    ) return false;
    const now = expected.now ?? Date.now();
    const receiptFingerprint = studioActionApprovalFingerprint(
      receipt as StudioActionApprovalReceipt,
    );
    if (
      receipt.issuedAt > now + MAX_CLOCK_SKEW_MS ||
      (receipt.expiresAt < now && expected.persistedReceiptFingerprint !== receiptFingerprint) ||
      receipt.expiresAt - receipt.issuedAt > MAX_RECEIPT_TTL_MS
    ) return false;
    if (
      expected.maximumCostUsd !== undefined &&
      (typeof receipt.maxCostUsd !== "number" || receipt.maxCostUsd > expected.maximumCostUsd)
    ) return false;
    const { signature: actual, ...claims } = receipt as StudioActionApprovalReceipt;
    const expectedSignature = signature(claims);
    const actualBytes = Buffer.from(actual, "utf8");
    const expectedBytes = Buffer.from(expectedSignature, "utf8");
    return actualBytes.byteLength === expectedBytes.byteLength &&
      timingSafeEqual(actualBytes, expectedBytes);
  } catch {
    return false;
  }
}

export function studioActionApprovalFingerprint(
  receipt: StudioActionApprovalReceipt,
): string {
  return createHash("sha256").update(stableJson(receipt)).digest("hex");
}

const PROOF_FIELDS = new Set([
  "inceptionApproval",
  "probeApproval",
  "publishingApproval",
  "youtubeCreationApproval",
  "approvalActor",
  "approvalEvidence",
  "youtubeCreationActor",
  "youtubeCreationEvidence",
]);

export function channelDesignApprovalSubject(
  ownerId: string,
  design: Record<string, unknown>,
): string {
  const intent = Object.fromEntries(
    Object.entries(design).filter(([key]) => key !== "ownerId" && !PROOF_FIELDS.has(key)),
  );
  const digest = createHash("sha256")
    .update(stableJson({ ownerId, intent }))
    .digest("hex");
  return `channel-design:${digest}`;
}

export function pipelineProbeApprovalSubject(args: {
  ownerId: string;
  channelId: string;
  runId: string;
  pipelineOverrideFingerprint: string;
  maximumCostUsd: number;
}): string {
  const digest = createHash("sha256").update(stableJson(args)).digest("hex");
  return `pipeline-probe:${digest}`;
}

export function pipelineOverrideFingerprint(pipeline: unknown): string {
  return createHash("sha256").update(stableJson(pipeline)).digest("hex");
}

export function youtubeChannelApprovalSubject(args: {
  ownerId: string;
  channelId: string;
  requestKey: string;
  name: string;
  handle: string;
}): string {
  const name = normalizeYoutubeChannelName(args.name);
  const handle = normalizeYoutubeHandle(args.handle);
  if (
    !args.ownerId.trim() ||
    !args.channelId.trim() ||
    !args.requestKey.trim() ||
    !name ||
    !handle
  ) {
    throw new Error("YouTube channel approval binding is incomplete");
  }
  const digest = createHash("sha256")
    .update(stableJson({
      ownerId: args.ownerId,
      channelId: args.channelId,
      requestKey: args.requestKey,
      name,
      handle,
    }))
    .digest("hex");
  return `youtube-channel-create:${digest}`;
}

export function youtubeChannelCreationRequestKey(args: {
  ownerId: string;
  channelId: string;
  intentKey: string;
  name: string;
  handle: string;
}): string {
  const name = normalizeYoutubeChannelName(args.name);
  const handle = normalizeYoutubeHandle(args.handle);
  if (
    !args.ownerId.trim() ||
    !args.channelId.trim() ||
    !args.intentKey.trim() ||
    !name ||
    !handle
  ) {
    throw new Error("YouTube channel creation request binding is incomplete");
  }
  return createHash("sha256")
    .update(stableJson({
      action: "youtube-channel-create",
      ownerId: args.ownerId,
      channelId: args.channelId,
      intentKey: args.intentKey,
      name,
      handle,
    }))
    .digest("hex");
}

/**
 * Authority issued before the app channel id exists. It binds the exact visible
 * provider identity to the immutable channel-build intent.
 */
export function youtubeChannelIntentApprovalSubject(args: {
  ownerId: string;
  intentKey: string;
  name: string;
  handle: string;
}): string {
  const name = normalizeYoutubeChannelName(args.name);
  const handle = normalizeYoutubeHandle(args.handle);
  if (!args.ownerId.trim() || !args.intentKey.trim() || !name || !handle) {
    throw new Error("YouTube channel intent approval binding is incomplete");
  }
  const digest = createHash("sha256")
    .update(stableJson({
      action: "youtube-channel-create",
      ownerId: args.ownerId,
      intentKey: args.intentKey,
      name,
      handle,
    }))
    .digest("hex");
  return `youtube-channel-create-intent:${digest}`;
}
