import { canonicalJson } from "@/lib/canonicalJson";
import { PLAN_WEEK_IMAGE_UNIT_USD } from "@/lib/planWeekContract";
import {
  NANO_BANANA_THUMBNAIL_PROFILE,
  nanoBananaThumbnailCostUsd,
  nanoBananaThumbnailPromptCostUsd,
  type NanoBananaImageReceipt,
} from "@/lib/nanoBananaThumbnailContract";
import type { NovitaImageProviderReceipt } from "@/lib/novitaMedia";

const SHA256 = /^[a-f0-9]{64}$/;

/** Immutable validator for already-written v1 rows; never derive history from live profiles. */
const LEGACY_PLAN_WEEK_NOVITA_IMAGE_PROFILE = {
  contractVersion: "1.0.0",
  id: "production",
  phase: "image" as const,
  model: "Tongyi-MAI/Z-Image-Turbo",
  revision: "f332072aa78be7aecdf3ee76d5c247082da564a6",
  checkpoint: "Z-Image-Turbo",
  width: 1_920,
  height: 1_088,
  steps: 9,
  guidanceScale: 0,
  precision: "bf16" as const,
  candidates: 1,
  infrastructure: {
    provider: "novita" as const,
    capacityMode: "spot" as const,
    weightStorage: "local-persistent-disk" as const,
    cacheMount: "/workspace/model-cache" as const,
    checkpointing: true as const,
    idleShutdownSeconds: 300,
    elasticGpuCeiling: 8,
  },
  allowFallback: false as const,
} as const;

export const PLAN_WEEK_THUMBNAIL_RECEIPT_METADATA = {
  checkpointKey: "plan-week-checkpoint-key",
  providerRequestSha256: "plan-week-provider-request-sha256",
  providerEvidenceSha256: "plan-week-provider-evidence-sha256",
  /** Historical artifact compatibility only. New writes use providerEvidenceSha256. */
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

export interface PlanWeekNanoBananaProviderRenderReceipt extends PlanWeekRenderScope {
  version: "plan-week-provider-render/v2";
  provider: "gemini";
  route: typeof NANO_BANANA_THUMBNAIL_PROFILE.route;
  sourceKey: string;
  sourceContentType: string;
  model: typeof NANO_BANANA_THUMBNAIL_PROFILE.model;
  apiVersion: typeof NANO_BANANA_THUMBNAIL_PROFILE.apiVersion;
  modelVersion: string;
  responseId: string;
  profileId: typeof NANO_BANANA_THUMBNAIL_PROFILE.contractVersion;
  width: typeof NANO_BANANA_THUMBNAIL_PROFILE.providerOutputWidth;
  height: typeof NANO_BANANA_THUMBNAIL_PROFILE.providerOutputHeight;
  promptUtf8Bytes: number;
  promptTokenCount: number;
  promptCostUsd: number;
  outputCostUsd: typeof NANO_BANANA_THUMBNAIL_PROFILE.outputImageUsd;
  costUsd: number;
  requestSha256: string;
  requestCanonicalJson: string;
  providerResponseMetadataCanonicalJson: string;
  providerResponseMetadataSha256: string;
  responseSha256: string;
  createdAt: number;
}

/** Existing immutable rows remain readable; no new render path creates this shape. */
export interface LegacyPlanWeekNovitaProviderRenderReceipt extends PlanWeekRenderScope {
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

export type PlanWeekProviderRenderReceipt =
  | PlanWeekNanoBananaProviderRenderReceipt
  | LegacyPlanWeekNovitaProviderRenderReceipt;

export type PlanWeekNanoBananaSourceReceipt = NanoBananaImageReceipt & {
  sourceKey: string;
};

export interface PlanWeekArtifactReceipt {
  version: "plan-week-thumbnail-artifact/v1";
  providerRequestSha256: string;
  destinationKey: string;
  byteLength: number;
  sha256: string;
  etag: string;
  createdAt: number;
}

export function planWeekNanoBananaRequestContext(
  scope: PlanWeekRenderScope,
  sourceKey: string,
): string {
  return canonicalJson({
    contractVersion: NANO_BANANA_THUMBNAIL_PROFILE.contractVersion,
    scope: {
      ownerId: scope.ownerId,
      channelId: scope.channelId,
      batchId: scope.batchId,
      itemId: scope.itemId,
      attempt: scope.attempt,
      requestKey: scope.requestKey,
      checkpointKey: scope.checkpointKey,
      destinationKey: scope.destinationKey,
    },
    sourceKey,
  });
}

export function makePlanWeekProviderRenderReceipt(
  scope: PlanWeekRenderScope,
  rendered: PlanWeekNanoBananaSourceReceipt,
): PlanWeekNanoBananaProviderRenderReceipt {
  const profile = NANO_BANANA_THUMBNAIL_PROFILE;
  const receipt: PlanWeekNanoBananaProviderRenderReceipt = {
    version: "plan-week-provider-render/v2",
    ...scope,
    provider: profile.provider,
    route: profile.route,
    sourceKey: rendered.sourceKey,
    sourceContentType: rendered.sourceContentType,
    model: rendered.model,
    apiVersion: rendered.apiVersion,
    modelVersion: rendered.modelVersion,
    responseId: rendered.responseId,
    profileId: profile.contractVersion,
    width: rendered.width,
    height: rendered.height,
    promptUtf8Bytes: rendered.promptUtf8Bytes,
    promptTokenCount: rendered.promptTokenCount,
    promptCostUsd: rendered.promptCostUsd,
    outputCostUsd: rendered.outputCostUsd,
    costUsd: rendered.costUsd,
    requestSha256: rendered.providerRequestSha256,
    requestCanonicalJson: rendered.providerRequestCanonicalJson,
    providerResponseMetadataCanonicalJson: rendered.providerResponseMetadataCanonicalJson,
    providerResponseMetadataSha256: rendered.providerResponseMetadataSha256,
    responseSha256: rendered.responseSha256,
    createdAt: rendered.createdAt,
  };
  if (!validatePlanWeekProviderRenderReceipt(receipt, scope)) {
    throw new Error("invalid plan-week Nano Banana provider receipt");
  }
  return receipt;
}

function validScope(
  value: PlanWeekProviderRenderReceipt,
  expected?: Partial<PlanWeekRenderScope>,
): boolean {
  const fields = [
    value.ownerId,
    value.channelId,
    value.batchId,
    value.itemId,
    value.requestKey,
    value.checkpointKey,
    value.destinationKey,
    value.sourceKey,
    value.model,
    value.version === "plan-week-provider-render/v2" ? value.apiVersion : value.modelRevision,
    value.profileId,
  ];
  if (
    fields.some((field) => typeof field !== "string" || !field.trim() || field.length > 1_024) ||
    !Number.isInteger(value.attempt) ||
    value.attempt < 1 ||
    value.checkpointKey !== `thumbnail:${value.itemId}:${value.attempt}` ||
    value.sourceKey === value.destinationKey ||
    !Number.isFinite(value.costUsd) ||
    value.costUsd < 0 ||
    value.costUsd > PLAN_WEEK_IMAGE_UNIT_USD + Number.EPSILON ||
    !Number.isFinite(value.createdAt) ||
    value.createdAt <= 0 ||
    typeof value.requestCanonicalJson !== "string" ||
    !value.requestCanonicalJson ||
    !SHA256.test(value.requestSha256)
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

function validateNanoBananaCanonicalRequest(
  receipt: PlanWeekNanoBananaProviderRenderReceipt,
): boolean {
  if (receipt.requestCanonicalJson.length > 200_000) return false;
  try {
    const parsed = JSON.parse(receipt.requestCanonicalJson) as Record<string, unknown>;
    const body = parsed["body"] as Record<string, unknown>;
    const contents = body?.["contents"] as Array<Record<string, unknown>>;
    const parts = contents?.[0]?.["parts"] as Array<Record<string, unknown>>;
    const generationConfig = body?.["generationConfig"] as Record<string, unknown>;
    const modalities = generationConfig?.["responseModalities"] as unknown[];
    const imageConfig = generationConfig?.["imageConfig"] as Record<string, unknown>;
    const prompt = parts?.[0]?.["text"];
    return canonicalJson(parsed) === receipt.requestCanonicalJson &&
      parsed["apiVersion"] === NANO_BANANA_THUMBNAIL_PROFILE.apiVersion &&
      parsed["model"] === NANO_BANANA_THUMBNAIL_PROFILE.model &&
      parsed["operation"] === "generateContent" &&
      parsed["context"] === planWeekNanoBananaRequestContext(receipt, receipt.sourceKey) &&
      Array.isArray(contents) && contents.length === 1 &&
      Array.isArray(parts) && parts.length === 1 &&
      typeof prompt === "string" &&
      new TextEncoder().encode(prompt).byteLength === receipt.promptUtf8Bytes &&
      prompt.includes("ABSOLUTE RULE — PICTURE ONLY, NO TEXT") &&
      Array.isArray(modalities) && modalities.length === 1 && modalities[0] === "IMAGE" &&
      imageConfig?.["aspectRatio"] === NANO_BANANA_THUMBNAIL_PROFILE.aspectRatio &&
      imageConfig?.["imageSize"] === undefined;
  } catch {
    return false;
  }
}

function validateNanoBananaResponseMetadata(
  receipt: PlanWeekNanoBananaProviderRenderReceipt,
): boolean {
  if (
    typeof receipt.modelVersion !== "string" || !receipt.modelVersion.trim() ||
    receipt.modelVersion.length > 256 ||
    typeof receipt.responseId !== "string" || !receipt.responseId.trim() ||
    receipt.responseId.length > 256 ||
    typeof receipt.providerResponseMetadataCanonicalJson !== "string" ||
    receipt.providerResponseMetadataCanonicalJson.length > 100_000 ||
    !SHA256.test(receipt.providerResponseMetadataSha256)
  ) return false;
  try {
    const metadata = JSON.parse(receipt.providerResponseMetadataCanonicalJson) as Record<string, unknown>;
    const usage = metadata["usageMetadata"] as Record<string, unknown>;
    return canonicalJson(metadata) === receipt.providerResponseMetadataCanonicalJson &&
      metadata["modelVersion"] === receipt.modelVersion &&
      metadata["responseId"] === receipt.responseId &&
      usage?.["promptTokenCount"] === receipt.promptTokenCount &&
      Number.isInteger(receipt.promptTokenCount) &&
      receipt.promptTokenCount >= 1 &&
      receipt.promptTokenCount <= NANO_BANANA_THUMBNAIL_PROFILE.maxPromptTokenCount &&
      receipt.promptCostUsd === nanoBananaThumbnailPromptCostUsd(receipt.promptTokenCount) &&
      receipt.outputCostUsd === NANO_BANANA_THUMBNAIL_PROFILE.outputImageUsd &&
      receipt.costUsd === nanoBananaThumbnailCostUsd(receipt.promptTokenCount);
  } catch {
    return false;
  }
}

function validateNanoBananaReceipt(
  value: PlanWeekNanoBananaProviderRenderReceipt,
  expected?: Partial<PlanWeekRenderScope>,
): boolean {
  const profile = NANO_BANANA_THUMBNAIL_PROFILE;
  return value.version === "plan-week-provider-render/v2" &&
    value.provider === profile.provider &&
    value.route === profile.route &&
    value.model === profile.model &&
    value.apiVersion === profile.apiVersion &&
    value.profileId === profile.contractVersion &&
    value.width === profile.providerOutputWidth &&
    value.height === profile.providerOutputHeight &&
    Number.isInteger(value.promptUtf8Bytes) &&
    value.promptUtf8Bytes >= 1 &&
    value.promptUtf8Bytes <= profile.maxPromptUtf8Bytes &&
    /^image\/(?:png|jpeg|webp)$/i.test(value.sourceContentType) &&
    SHA256.test(value.responseSha256) &&
    validScope(value, expected) &&
    validateNanoBananaCanonicalRequest(value) &&
    validateNanoBananaResponseMetadata(value);
}

function validateLegacyNovitaReceipt(
  value: LegacyPlanWeekNovitaProviderRenderReceipt,
  expected?: Partial<PlanWeekRenderScope>,
): boolean {
  const imageProfile = planWeekProductionImageProfile();
  if (
    value.version !== "plan-week-provider-render/v1" ||
    value.provider !== "novita" ||
    !validScope(value, expected) ||
    !/^image-[a-f0-9]{32}$/.test(value.providerJobId) ||
    !legacyProviderSourceMatchesRequest(value) ||
    value.profileId !== imageProfile.id ||
    value.model !== imageProfile.model ||
    value.modelRevision !== imageProfile.revision ||
    value.width !== imageProfile.width ||
    value.height !== imageProfile.height ||
    ![value.profileSha256, value.manifestSha256, value.billingReceiptSha256]
      .every((hash) => SHA256.test(hash))
  ) return false;
  const runtime = value.runtimeAttestation;
  const billing = value.billingReceipt;
  return Boolean(
    runtime &&
    runtime.provider === "novita" &&
    runtime.capacityMode === imageProfile.infrastructure.capacityMode &&
    runtime.weightStorage === imageProfile.infrastructure.weightStorage &&
    runtime.cacheMount === imageProfile.infrastructure.cacheMount &&
    runtime.checkpointing === imageProfile.infrastructure.checkpointing &&
    Number.isInteger(runtime.gpuCount) &&
    runtime.gpuCount >= 1 &&
    runtime.gpuCount <= imageProfile.infrastructure.elasticGpuCeiling &&
    runtime.idleShutdownSeconds === imageProfile.infrastructure.idleShutdownSeconds &&
    runtime.model === value.model &&
    runtime.revision === value.modelRevision &&
    runtime.checkpoint === imageProfile.checkpoint &&
    runtime.pipeline === undefined &&
    runtime.distilledLoraCheckpoint === undefined &&
    runtime.spatialUpscalerCheckpoint === undefined &&
    billing &&
    billing.provider === "novita" &&
    billing.currency === "USD" &&
    typeof billing.receiptId === "string" &&
    billing.receiptId.trim().length >= 8 &&
    billing.receiptId.length <= 200 &&
    typeof billing.gpuSku === "string" &&
    Boolean(billing.gpuSku.trim()) &&
    billing.gpuSku.length <= 100 &&
    billing.gpuCount === runtime.gpuCount &&
    [billing.gpuSeconds, billing.gpuRateUsdPerSecond, billing.startupUsd, billing.storageUsd]
      .every((amount) => Number.isFinite(amount) && amount >= 0) &&
    Number.isFinite(billing.costUsd) &&
    Math.abs(billing.costUsd - value.costUsd) <= 0.000001 &&
    Math.abs(
      billing.gpuSeconds * billing.gpuRateUsdPerSecond + billing.startupUsd + billing.storageUsd -
      billing.costUsd
    ) <= 0.000001 &&
    validateLegacyCanonicalProviderRequest(value.requestCanonicalJson, imageProfile)
  );
}

export function validatePlanWeekProviderRenderReceipt(
  receipt: unknown,
  expected?: Partial<PlanWeekRenderScope>,
): receipt is PlanWeekProviderRenderReceipt {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return false;
  const version = (receipt as { version?: unknown }).version;
  if (version === "plan-week-provider-render/v2") {
    return validateNanoBananaReceipt(
      receipt as PlanWeekNanoBananaProviderRenderReceipt,
      expected,
    );
  }
  if (version === "plan-week-provider-render/v1") {
    return validateLegacyNovitaReceipt(
      receipt as LegacyPlanWeekNovitaProviderRenderReceipt,
      expected,
    );
  }
  return false;
}

function legacyProviderSourceMatchesRequest(
  receipt: LegacyPlanWeekNovitaProviderRenderReceipt,
): boolean {
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

/** Historical Novita contract used only to validate already-immutable rows. */
export function planWeekProductionImageProfile() {
  return LEGACY_PLAN_WEEK_NOVITA_IMAGE_PROFILE;
}

function validateLegacyCanonicalProviderRequest(
  encoded: string,
  expectedProfile: ReturnType<typeof planWeekProductionImageProfile>,
): boolean {
  if (encoded.length > 200_000) return false;
  try {
    const parsed = JSON.parse(encoded) as Record<string, unknown>;
    return canonicalJson(parsed) === encoded &&
      canonicalJson(parsed["profile"]) === canonicalJson(expectedProfile) &&
      typeof parsed["prefix"] === "string" &&
      Boolean((parsed["prefix"] as string).trim()) &&
      Array.isArray(parsed["jobs"]) &&
      parsed["jobs"].length === 1 &&
      parsed["nshard"] === 1 &&
      parsed["jobsSel"] === "full" &&
      parsed["maxConcurrent"] === 1 &&
      typeof parsed["maxCostUsd"] === "number" &&
      Number.isFinite(parsed["maxCostUsd"]) &&
      (parsed["maxCostUsd"] as number) > 0 &&
      (parsed["maxCostUsd"] as number) <= PLAN_WEEK_IMAGE_UNIT_USD + Number.EPSILON;
  } catch {
    return false;
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Convex-safe integrity check for durable receipt fields. These local hashes
 * detect mutation; they are not a provider signature or provider attestation.
 */
export async function verifyPlanWeekProviderReceiptCryptography(
  receipt: PlanWeekProviderRenderReceipt,
): Promise<boolean> {
  if (!validatePlanWeekProviderRenderReceipt(receipt)) return false;
  if (receipt.version === "plan-week-provider-render/v2") {
    const [requestHash, metadataHash] = await Promise.all([
      sha256(`nano-banana-provider\0${receipt.requestCanonicalJson}`),
      sha256(`nano-banana-response-metadata\0${receipt.providerResponseMetadataCanonicalJson}`),
    ]);
    return requestHash === receipt.requestSha256 &&
      metadataHash === receipt.providerResponseMetadataSha256;
  }
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
  if (receipt.version === "plan-week-provider-render/v2") {
    return {
      provider: receipt.provider,
      model: receipt.model,
      route: receipt.route,
      images: 1,
      width: receipt.width,
      height: receipt.height,
      costUsd: receipt.costUsd,
    };
  }
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

export function planWeekProviderEvidenceSha256(
  receipt: PlanWeekProviderRenderReceipt,
): string {
  return receipt.version === "plan-week-provider-render/v2"
    ? receipt.responseSha256
    : receipt.billingReceiptSha256;
}

export function isFinalizedPlanWeekRenderReceipt(value: unknown): value is {
  providerReceipt: PlanWeekProviderRenderReceipt;
  artifactReceipt: PlanWeekArtifactReceipt;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as { providerReceipt?: unknown; artifactReceipt?: unknown };
  return validatePlanWeekProviderRenderReceipt(row.providerReceipt) &&
    validatePlanWeekArtifactReceipt(row.artifactReceipt, row.providerReceipt);
}

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
  ) return false;
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
  const evidenceMetadataKey = provider.version === "plan-week-provider-render/v2"
    ? PLAN_WEEK_THUMBNAIL_RECEIPT_METADATA.providerEvidenceSha256
    : PLAN_WEEK_THUMBNAIL_RECEIPT_METADATA.billingReceiptSha256;
  return Boolean(
    head &&
    head.contentType === "image/jpeg" &&
    head.contentLength === artifact.byteLength &&
    head.etag === artifact.etag &&
    head.metadata[PLAN_WEEK_THUMBNAIL_RECEIPT_METADATA.checkpointKey] === checkpointKey &&
    head.metadata[PLAN_WEEK_THUMBNAIL_RECEIPT_METADATA.providerRequestSha256] ===
      provider.requestSha256 &&
    head.metadata[evidenceMetadataKey] === planWeekProviderEvidenceSha256(provider) &&
    head.metadata[PLAN_WEEK_THUMBNAIL_RECEIPT_METADATA.artifactSha256] === artifact.sha256 &&
    head.metadata[PLAN_WEEK_THUMBNAIL_RECEIPT_METADATA.artifactCreatedAt] ===
      String(artifact.createdAt)
  );
}
