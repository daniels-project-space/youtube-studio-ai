import { canonicalJson } from "@/lib/canonicalJson";
import { generationProfile } from "@/engine/generationProfiles";
import { PLAN_WEEK_IMAGE_UNIT_USD } from "@/lib/planWeekContract";
import type { NovitaImageProviderReceipt } from "@/lib/novitaMedia";

const SHA256 = /^[a-f0-9]{64}$/;

export const PLAN_WEEK_THUMBNAIL_RECEIPT_METADATA = {
  checkpointKey: "plan-week-checkpoint-key",
  providerRequestSha256: "plan-week-provider-request-sha256",
  billingReceiptSha256: "plan-week-billing-receipt-sha256",
  artifactSha256: "plan-week-artifact-sha256",
  artifactCreatedAt: "plan-week-artifact-created-at",
} as const;

export interface PlanWeekRenderScope {
  ownerId: string;
  channelId: string;
  batchId: string;
  itemId: string;
  attempt: number;
  requestKey: string;
  checkpointKey: string;
  destinationKey: string;
}

export interface PlanWeekProviderRenderReceipt extends PlanWeekRenderScope {
  version: "plan-week-provider-render/v1";
  provider: "novita";
  providerJobId: string;
  sourceKey: string;
  model: string;
  modelRevision: string;
  profileId: string;
  width: number;
  height: number;
  costUsd: number;
  runtimeAttestation: NovitaImageProviderReceipt["runtimeAttestation"];
  profileSha256: string;
  manifestSha256: string;
  requestSha256: string;
  requestCanonicalJson: string;
  billingReceiptSha256: string;
  billingReceipt: NovitaImageProviderReceipt["billingReceipt"];
  createdAt: number;
}

export interface PlanWeekArtifactReceipt {
  version: "plan-week-thumbnail-artifact/v1";
  providerRequestSha256: string;
  destinationKey: string;
  byteLength: number;
  sha256: string;
  etag: string;
  createdAt: number;
}

export function makePlanWeekProviderRenderReceipt(
  scope: PlanWeekRenderScope,
  rendered: NovitaImageProviderReceipt,
  createdAt = Date.now(),
): PlanWeekProviderRenderReceipt {
  const receipt: PlanWeekProviderRenderReceipt = {
    version: "plan-week-provider-render/v1",
    ...scope,
    provider: "novita",
    providerJobId: rendered.jobId,
    sourceKey: rendered.key,
    model: rendered.runtimeAttestation.model,
    modelRevision: rendered.runtimeAttestation.revision,
    profileId: rendered.profileId,
    width: rendered.width,
    height: rendered.height,
    costUsd: rendered.costUsd,
    runtimeAttestation: structuredClone(rendered.runtimeAttestation),
    profileSha256: rendered.profileSha256,
    manifestSha256: rendered.manifestSha256,
    requestSha256: rendered.requestSha256,
    requestCanonicalJson: rendered.requestCanonicalJson,
    billingReceiptSha256: rendered.billingReceiptSha256,
    billingReceipt: structuredClone(rendered.billingReceipt),
    createdAt,
  };
  if (!validatePlanWeekProviderRenderReceipt(receipt, scope)) {
    throw new Error("invalid plan-week provider render receipt");
  }
  return receipt;
}

export function validatePlanWeekProviderRenderReceipt(
  receipt: unknown,
  expected?: Partial<PlanWeekRenderScope>,
): receipt is PlanWeekProviderRenderReceipt {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return false;
  const value = receipt as PlanWeekProviderRenderReceipt;
  const profile = generationProfile("production");
  const imageProfile = planWeekProductionImageProfile();
  const fields = [
    value.ownerId,
    value.channelId,
    value.batchId,
    value.itemId,
    value.requestKey,
    value.checkpointKey,
    value.destinationKey,
    value.providerJobId,
    value.sourceKey,
    value.model,
    value.modelRevision,
    value.profileId,
  ];
  if (
    value.version !== "plan-week-provider-render/v1" ||
    value.provider !== "novita" ||
    fields.some((field) => typeof field !== "string" || !field.trim() || field.length > 1_024) ||
    !Number.isInteger(value.attempt) ||
    value.attempt < 1 ||
    value.checkpointKey !== `thumbnail:${value.itemId}:${value.attempt}` ||
    !/^image-[a-f0-9]{32}$/.test(value.providerJobId) ||
    value.sourceKey === value.destinationKey ||
    !providerSourceMatchesRequest(value) ||
    value.profileId !== profile.id ||
    value.model !== profile.image.model ||
    value.modelRevision !== profile.image.revision ||
    value.width !== profile.image.width ||
    value.height !== profile.image.height ||
    !Number.isFinite(value.costUsd) ||
    value.costUsd < 0 ||
    value.costUsd > PLAN_WEEK_IMAGE_UNIT_USD + Number.EPSILON ||
    !Number.isFinite(value.createdAt) ||
    value.createdAt <= 0 ||
    typeof value.requestCanonicalJson !== "string" ||
    !value.requestCanonicalJson ||
    ![value.profileSha256, value.manifestSha256, value.requestSha256, value.billingReceiptSha256]
      .every((hash) => SHA256.test(hash))
  ) return false;
  const runtime = value.runtimeAttestation;
  const billing = value.billingReceipt;
  if (
    !runtime ||
    runtime.provider !== "novita" ||
    runtime.capacityMode !== profile.infrastructure.capacityMode ||
    runtime.weightStorage !== profile.infrastructure.weightStorage ||
    runtime.cacheMount !== profile.infrastructure.cacheMount ||
    runtime.checkpointing !== profile.infrastructure.checkpointing ||
    !Number.isInteger(runtime.gpuCount) ||
    runtime.gpuCount < 1 ||
    runtime.gpuCount > profile.infrastructure.elasticGpuCeiling ||
    runtime.idleShutdownSeconds !== profile.infrastructure.idleShutdownSeconds ||
    runtime.model !== value.model ||
    runtime.revision !== value.modelRevision ||
    runtime.checkpoint !== profile.image.checkpoint ||
    runtime.pipeline !== undefined ||
    runtime.distilledLoraCheckpoint !== undefined ||
    runtime.spatialUpscalerCheckpoint !== undefined ||
    !billing ||
    billing.provider !== "novita" ||
    billing.currency !== "USD" ||
    typeof billing.receiptId !== "string" ||
    billing.receiptId.trim().length < 8 ||
    billing.receiptId.length > 200 ||
    typeof billing.gpuSku !== "string" ||
    !billing.gpuSku.trim() ||
    billing.gpuSku.length > 100 ||
    billing.gpuCount !== runtime.gpuCount ||
    ![billing.gpuSeconds, billing.gpuRateUsdPerSecond, billing.startupUsd, billing.storageUsd]
      .every((amount) => Number.isFinite(amount) && amount >= 0) ||
    !Number.isFinite(billing.costUsd) ||
    Math.abs(billing.costUsd - value.costUsd) > 0.000001 ||
    Math.abs(
      billing.gpuSeconds * billing.gpuRateUsdPerSecond + billing.startupUsd + billing.storageUsd -
      billing.costUsd
    ) > 0.000001 ||
    !validateCanonicalProviderRequest(value.requestCanonicalJson, imageProfile)
  ) return false;
  if (expected) {
    for (const [key, expectedValue] of Object.entries(expected)) {
      if (expectedValue !== undefined && value[key as keyof PlanWeekRenderScope] !== expectedValue) {
        return false;
      }
    }
  }
  return true;
}

function providerSourceMatchesRequest(receipt: PlanWeekProviderRenderReceipt): boolean {
  try {
    const request = JSON.parse(receipt.requestCanonicalJson) as Record<string, unknown>;
    const jobs = request["jobs"] as Array<Record<string, unknown>>;
    const prefix = request["prefix"];
    const outputId = jobs[0]?.["id"];
    return typeof prefix === "string" &&
      typeof outputId === "string" &&
      receipt.sourceKey === `imagecraft/${prefix}/${receipt.providerJobId}/stills/${outputId}.png`;
  } catch {
    return false;
  }
}

/** Exact immutable image contract admitted for plan-week production renders. */
export function planWeekProductionImageProfile() {
  const profile = generationProfile("production");
  return {
    contractVersion: profile.contractVersion,
    id: profile.id,
    phase: "image" as const,
    model: profile.image.model,
    revision: profile.image.revision,
    checkpoint: profile.image.checkpoint,
    width: profile.image.width,
    height: profile.image.height,
    steps: profile.image.steps,
    guidanceScale: profile.image.guidanceScale,
    precision: profile.image.precision,
    candidates: profile.image.candidates,
    infrastructure: profile.infrastructure,
    allowFallback: false as const,
  };
}

function validateCanonicalProviderRequest(
  encoded: string,
  expectedProfile: ReturnType<typeof planWeekProductionImageProfile>,
): boolean {
  if (encoded.length > 200_000) return false;
  try {
    const parsed = JSON.parse(encoded) as Record<string, unknown>;
    return canonicalJson(parsed) === encoded &&
      canonicalJson(parsed["profile"]) === canonicalJson(expectedProfile) &&
      typeof parsed["prefix"] === "string" &&
      Boolean(parsed["prefix"].trim()) &&
      Array.isArray(parsed["jobs"]) &&
      parsed["jobs"].length === 1 &&
      parsed["nshard"] === 1 &&
      parsed["jobsSel"] === "full" &&
      parsed["maxConcurrent"] === 1 &&
      typeof parsed["maxCostUsd"] === "number" &&
      Number.isFinite(parsed["maxCostUsd"]) &&
      parsed["maxCostUsd"] > 0 &&
      parsed["maxCostUsd"] <= PLAN_WEEK_IMAGE_UNIT_USD + Number.EPSILON;
  } catch {
    return false;
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Convex-safe independent recomputation of every hash whose source is durable. */
export async function verifyPlanWeekProviderReceiptCryptography(
  receipt: PlanWeekProviderRenderReceipt,
): Promise<boolean> {
  if (!validatePlanWeekProviderRenderReceipt(receipt)) return false;
  const [billingHash, profileHash, requestHash] = await Promise.all([
    sha256(canonicalJson(receipt.billingReceipt)),
    sha256(canonicalJson(planWeekProductionImageProfile())),
    sha256(`image\0${receipt.requestCanonicalJson}`),
  ]);
  return billingHash === receipt.billingReceiptSha256 &&
    profileHash === receipt.profileSha256 &&
    requestHash === receipt.requestSha256;
}

export function samePlanWeekProviderRenderReceipt(
  left: PlanWeekProviderRenderReceipt,
  right: PlanWeekProviderRenderReceipt,
): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export function makePlanWeekArtifactReceipt(args: {
  provider: PlanWeekProviderRenderReceipt;
  destinationKey: string;
  byteLength: number;
  sha256: string;
  etag: string;
  createdAt?: number;
}): PlanWeekArtifactReceipt {
  const artifact: PlanWeekArtifactReceipt = {
    version: "plan-week-thumbnail-artifact/v1",
    providerRequestSha256: args.provider.requestSha256,
    destinationKey: args.destinationKey,
    byteLength: args.byteLength,
    sha256: args.sha256,
    etag: args.etag,
    createdAt: args.createdAt ?? Date.now(),
  };
  if (!validatePlanWeekArtifactReceipt(artifact, args.provider)) {
    throw new Error("invalid plan-week thumbnail artifact receipt");
  }
  return artifact;
}

export function validatePlanWeekArtifactReceipt(
  artifact: unknown,
  provider: PlanWeekProviderRenderReceipt,
): artifact is PlanWeekArtifactReceipt {
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) return false;
  const value = artifact as PlanWeekArtifactReceipt;
  return Boolean(
    value.version === "plan-week-thumbnail-artifact/v1" &&
    value.providerRequestSha256 === provider.requestSha256 &&
    value.destinationKey === provider.destinationKey &&
    Number.isInteger(value.byteLength) &&
    value.byteLength > 0 &&
    value.byteLength <= 30 * 1024 * 1024 &&
    SHA256.test(value.sha256) &&
    typeof value.etag === "string" &&
    value.etag.trim() &&
    value.etag.length <= 256 &&
    Number.isFinite(value.createdAt) &&
    value.createdAt >= provider.createdAt
  );
}

export function samePlanWeekArtifactReceipt(
  left: PlanWeekArtifactReceipt,
  right: PlanWeekArtifactReceipt,
): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export function planWeekProviderReceiptImageUsage(receipt: PlanWeekProviderRenderReceipt) {
  return {
    provider: "novita" as const,
    model: `${receipt.model}@${receipt.modelRevision}`.toLowerCase(),
    route: "local-z-image-turbo",
    images: 1,
    width: receipt.width,
    height: receipt.height,
    costUsd: receipt.costUsd,
  };
}

export function isFinalizedPlanWeekRenderReceipt(value: unknown): value is {
  providerReceipt: PlanWeekProviderRenderReceipt;
  artifactReceipt: PlanWeekArtifactReceipt;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as {
    providerReceipt?: unknown;
    artifactReceipt?: unknown;
  };
  return validatePlanWeekProviderRenderReceipt(row.providerReceipt) &&
    validatePlanWeekArtifactReceipt(row.artifactReceipt, row.providerReceipt);
}

/**
 * Verify the complete durable Convex row, not only its nested receipt shape.
 * This prevents a valid receipt from another item being transplanted under a
 * forged set of top-level scope fields and prevents canonical hash tampering.
 */
export async function verifyFinalizedPlanWeekRenderReceipt(
  value: unknown,
  expected?: Partial<PlanWeekRenderScope>,
): Promise<boolean> {
  if (!isFinalizedPlanWeekRenderReceipt(value)) return false;
  const row = value as {
    ownerId?: unknown;
    channelId?: unknown;
    batchId?: unknown;
    itemId?: unknown;
    attempt?: unknown;
    requestKey?: unknown;
    checkpointKey?: unknown;
    destinationKey?: unknown;
    providerRequestSha256?: unknown;
    createdAt?: unknown;
    finalizedAt?: unknown;
    providerReceipt: PlanWeekProviderRenderReceipt;
    artifactReceipt: PlanWeekArtifactReceipt;
  };
  const provider = row.providerReceipt;
  const topLevelScope: PlanWeekRenderScope = {
    ownerId: String(row.ownerId ?? ""),
    channelId: String(row.channelId ?? ""),
    batchId: String(row.batchId ?? ""),
    itemId: String(row.itemId ?? ""),
    attempt: typeof row.attempt === "number" ? row.attempt : Number.NaN,
    requestKey: String(row.requestKey ?? ""),
    checkpointKey: String(row.checkpointKey ?? ""),
    destinationKey: String(row.destinationKey ?? ""),
  };
  if (
    !validatePlanWeekProviderRenderReceipt(provider, topLevelScope) ||
    row.providerRequestSha256 !== provider.requestSha256 ||
    row.createdAt !== provider.createdAt ||
    row.finalizedAt !== row.artifactReceipt.createdAt ||
    !validatePlanWeekArtifactReceipt(row.artifactReceipt, provider)
  ) {
    return false;
  }
  if (expected && !validatePlanWeekProviderRenderReceipt(provider, expected)) return false;
  return verifyPlanWeekProviderReceiptCryptography(provider);
}

export function planWeekArtifactHeadMatches(args: {
  head: {
    contentLength?: number;
    contentType?: string;
    etag?: string;
    metadata: Record<string, string>;
  } | null;
  checkpointKey: string;
  provider: PlanWeekProviderRenderReceipt;
  artifact: PlanWeekArtifactReceipt;
}): boolean {
  const { head, checkpointKey, provider, artifact } = args;
  return Boolean(
    head &&
    head.contentType === "image/jpeg" &&
    head.contentLength === artifact.byteLength &&
    head.etag === artifact.etag &&
    head.metadata[PLAN_WEEK_THUMBNAIL_RECEIPT_METADATA.checkpointKey] === checkpointKey &&
    head.metadata[PLAN_WEEK_THUMBNAIL_RECEIPT_METADATA.providerRequestSha256] ===
      provider.requestSha256 &&
    head.metadata[PLAN_WEEK_THUMBNAIL_RECEIPT_METADATA.billingReceiptSha256] ===
      provider.billingReceiptSha256 &&
    head.metadata[PLAN_WEEK_THUMBNAIL_RECEIPT_METADATA.artifactSha256] === artifact.sha256 &&
    head.metadata[PLAN_WEEK_THUMBNAIL_RECEIPT_METADATA.artifactCreatedAt] ===
      String(artifact.createdAt)
  );
}
