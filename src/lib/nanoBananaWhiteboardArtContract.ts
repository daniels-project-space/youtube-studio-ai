/**
 * Pure contract for the Whiteboard renderer's receipt-bound image sources.
 *
 * This is deliberately separate from the thumbnail contract. Whiteboard art
 * is renderer input, not a channel thumbnail, and therefore needs its own
 * model pin, bounded cost envelope, and provider receipt shape.
 */
export const NANO_BANANA_PRO_WHITEBOARD_ART_PROFILE = {
  contractVersion: "nano-banana-pro-whiteboard-art/v2",
  /**
   * Nano Banana Pro is accessed through Fal only. The Studio must never put a
   * Google AI key on this renderer boundary.
   */
  provider: "fal",
  model: "fal-ai/nano-banana-pro",
  apiVersion: "fal.run/v1",
  route: "fal-nano-banana-pro-whiteboard-art",
  aspectRatio: "16:9",
  imageSize: "2K",
  allowText: false,
  allowFallback: false,
  // This bound includes the renderer's no-text clause. The source storyboard
  // schema independently bounds narration and layer descriptions.
  maxPromptUtf8Bytes: 8_000,
  /**
   * Fal documents a flat $0.15 Nano Banana Pro image price. Its synchronous
   * response has no token usage or per-request invoice, so this is a reserved
   * documented unit price—not fabricated Google usage data.
   */
  outputImageUsd: 0.15,
  admissionCeilingUsd: 0.15,
} as const;

/**
 * Cheaper support-art tier, admitted only after the layout-size benchmark.
 * It is deliberately not a fallback for the board's hero causal scene.
 */
export const NANO_BANANA_2_WHITEBOARD_SUPPORT_ART_PROFILE = {
  contractVersion: "nano-banana-2-whiteboard-support-art/v1",
  provider: "fal",
  model: "fal-ai/nano-banana-2",
  apiVersion: "fal.run/v1",
  route: "fal-nano-banana-2-whiteboard-support-art",
  aspectRatio: "16:9",
  imageSize: "1K",
  allowText: false,
  allowFallback: false,
  maxPromptUtf8Bytes: 5_000,
  /** Benchmark-qualified Fal list price for one 1K support illustration. */
  outputImageUsd: 0.08,
  admissionCeilingUsd: 0.08,
} as const;

export type WhiteboardArtTier = "hero" | "support";

export function nanoBananaProWhiteboardArtCostUsd(): number {
  return NANO_BANANA_PRO_WHITEBOARD_ART_PROFILE.outputImageUsd;
}

export function nanoBanana2WhiteboardSupportArtCostUsd(): number {
  return NANO_BANANA_2_WHITEBOARD_SUPPORT_ART_PROFILE.outputImageUsd;
}

export function whiteboardTieredArtCostUsd(heroJobs: number, supportJobs: number): number {
  if (!Number.isInteger(heroJobs) || heroJobs < 0 || !Number.isInteger(supportJobs) || supportJobs < 0) {
    throw new Error("Whiteboard tiered art cost requires non-negative whole job counts");
  }
  return heroJobs * nanoBananaProWhiteboardArtCostUsd() + supportJobs * nanoBanana2WhiteboardSupportArtCostUsd();
}

export interface NanoBananaProWhiteboardArtReceipt {
  provider: "fal";
  model: typeof NANO_BANANA_PRO_WHITEBOARD_ART_PROFILE.model;
  apiVersion: typeof NANO_BANANA_PRO_WHITEBOARD_ART_PROFILE.apiVersion;
  route: typeof NANO_BANANA_PRO_WHITEBOARD_ART_PROFILE.route;
  /** Parsed from the returned image bytes; source geometry is not assumed. */
  width: number;
  height: number;
  promptUtf8Bytes: number;
  /** Fal's documented unit charge reserved by pre-spend admission. */
  outputCostUsd: typeof NANO_BANANA_PRO_WHITEBOARD_ART_PROFILE.outputImageUsd;
  costUsd: number;
  sourceContentType: string;
  providerRequestCanonicalJson: string;
  providerRequestSha256: string;
  providerResponseMetadataCanonicalJson: string;
  providerResponseMetadataSha256: string;
  responseSha256: string;
  createdAt: number;
}

export interface NanoBanana2WhiteboardSupportArtReceipt {
  provider: "fal";
  model: typeof NANO_BANANA_2_WHITEBOARD_SUPPORT_ART_PROFILE.model;
  apiVersion: typeof NANO_BANANA_2_WHITEBOARD_SUPPORT_ART_PROFILE.apiVersion;
  route: typeof NANO_BANANA_2_WHITEBOARD_SUPPORT_ART_PROFILE.route;
  width: number;
  height: number;
  promptUtf8Bytes: number;
  outputCostUsd: typeof NANO_BANANA_2_WHITEBOARD_SUPPORT_ART_PROFILE.outputImageUsd;
  costUsd: number;
  sourceContentType: string;
  providerRequestCanonicalJson: string;
  providerRequestSha256: string;
  providerResponseMetadataCanonicalJson: string;
  providerResponseMetadataSha256: string;
  responseSha256: string;
  createdAt: number;
}

export type NanoBananaWhiteboardArtReceipt =
  | NanoBananaProWhiteboardArtReceipt
  | NanoBanana2WhiteboardSupportArtReceipt;

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

/**
 * Parse a persisted receipt before the renderer reuses an art cache or the
 * caller persists it. Bytes are checked separately by the caller so this file
 * stays safe for engine and Convex-adjacent consumers.
 */
export function assertNanoBananaProWhiteboardArtReceipt(
  value: unknown,
  contentSha256?: string,
): NanoBananaProWhiteboardArtReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Whiteboard art is missing its Nano Banana Pro provider receipt");
  }
  const receipt = value as Partial<NanoBananaProWhiteboardArtReceipt>;
  if (
    receipt.provider !== NANO_BANANA_PRO_WHITEBOARD_ART_PROFILE.provider ||
    receipt.model !== NANO_BANANA_PRO_WHITEBOARD_ART_PROFILE.model ||
    receipt.apiVersion !== NANO_BANANA_PRO_WHITEBOARD_ART_PROFILE.apiVersion ||
    receipt.route !== NANO_BANANA_PRO_WHITEBOARD_ART_PROFILE.route
  ) {
    throw new Error("Whiteboard art receipt escaped the sealed Nano Banana Pro profile");
  }
  if (
    !Number.isInteger(receipt.width) || (receipt.width ?? 0) < 1 ||
    !Number.isInteger(receipt.height) || (receipt.height ?? 0) < 1 ||
    !Number.isInteger(receipt.promptUtf8Bytes) || (receipt.promptUtf8Bytes ?? 0) < 1 ||
    (receipt.promptUtf8Bytes ?? 0) > NANO_BANANA_PRO_WHITEBOARD_ART_PROFILE.maxPromptUtf8Bytes ||
    typeof receipt.sourceContentType !== "string" || !receipt.sourceContentType.startsWith("image/") ||
    typeof receipt.providerRequestCanonicalJson !== "string" ||
    typeof receipt.providerResponseMetadataCanonicalJson !== "string" ||
    !isSha256(receipt.providerRequestSha256) ||
    !isSha256(receipt.providerResponseMetadataSha256) ||
    !isSha256(receipt.responseSha256) ||
    !Number.isFinite(receipt.createdAt) || (receipt.createdAt ?? 0) <= 0
  ) {
    throw new Error("Whiteboard art receipt is incomplete or outside its admitted bounds");
  }
  const expectedCost = nanoBananaProWhiteboardArtCostUsd();
  if (
    receipt.outputCostUsd !== NANO_BANANA_PRO_WHITEBOARD_ART_PROFILE.outputImageUsd ||
    receipt.costUsd !== expectedCost ||
    receipt.costUsd > NANO_BANANA_PRO_WHITEBOARD_ART_PROFILE.admissionCeilingUsd
  ) {
    throw new Error("Whiteboard art receipt has an unsealed Nano Banana Pro cost");
  }
  if (contentSha256 !== undefined && receipt.responseSha256 !== contentSha256) {
    throw new Error("Whiteboard art bytes do not match their Nano Banana Pro receipt");
  }
  return receipt as NanoBananaProWhiteboardArtReceipt;
}

export function assertNanoBanana2WhiteboardSupportArtReceipt(
  value: unknown,
  contentSha256?: string,
): NanoBanana2WhiteboardSupportArtReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Whiteboard support art is missing its Nano Banana 2 provider receipt");
  }
  const receipt = value as Partial<NanoBanana2WhiteboardSupportArtReceipt>;
  if (
    receipt.provider !== NANO_BANANA_2_WHITEBOARD_SUPPORT_ART_PROFILE.provider ||
    receipt.model !== NANO_BANANA_2_WHITEBOARD_SUPPORT_ART_PROFILE.model ||
    receipt.apiVersion !== NANO_BANANA_2_WHITEBOARD_SUPPORT_ART_PROFILE.apiVersion ||
    receipt.route !== NANO_BANANA_2_WHITEBOARD_SUPPORT_ART_PROFILE.route
  ) {
    throw new Error("Whiteboard support art receipt escaped the sealed Nano Banana 2 profile");
  }
  if (
    !Number.isInteger(receipt.width) || (receipt.width ?? 0) < 1 ||
    !Number.isInteger(receipt.height) || (receipt.height ?? 0) < 1 ||
    !Number.isInteger(receipt.promptUtf8Bytes) || (receipt.promptUtf8Bytes ?? 0) < 1 ||
    (receipt.promptUtf8Bytes ?? 0) > NANO_BANANA_2_WHITEBOARD_SUPPORT_ART_PROFILE.maxPromptUtf8Bytes ||
    typeof receipt.sourceContentType !== "string" || !receipt.sourceContentType.startsWith("image/") ||
    typeof receipt.providerRequestCanonicalJson !== "string" ||
    typeof receipt.providerResponseMetadataCanonicalJson !== "string" ||
    !isSha256(receipt.providerRequestSha256) ||
    !isSha256(receipt.providerResponseMetadataSha256) ||
    !isSha256(receipt.responseSha256) ||
    !Number.isFinite(receipt.createdAt) || (receipt.createdAt ?? 0) <= 0
  ) {
    throw new Error("Whiteboard support art receipt is incomplete or outside its admitted bounds");
  }
  const expectedCost = nanoBanana2WhiteboardSupportArtCostUsd();
  if (
    receipt.outputCostUsd !== NANO_BANANA_2_WHITEBOARD_SUPPORT_ART_PROFILE.outputImageUsd ||
    receipt.costUsd !== expectedCost ||
    receipt.costUsd > NANO_BANANA_2_WHITEBOARD_SUPPORT_ART_PROFILE.admissionCeilingUsd
  ) {
    throw new Error("Whiteboard support art receipt has an unsealed Nano Banana 2 cost");
  }
  if (contentSha256 !== undefined && receipt.responseSha256 !== contentSha256) {
    throw new Error("Whiteboard support art bytes do not match their Nano Banana 2 receipt");
  }
  return receipt as NanoBanana2WhiteboardSupportArtReceipt;
}

/** Parse either sealed tier. The route—not a caller-provided preference—selects it. */
export function assertNanoBananaWhiteboardArtReceipt(
  value: unknown,
  contentSha256?: string,
): NanoBananaWhiteboardArtReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Whiteboard art is missing a sealed provider receipt");
  }
  const route = (value as { route?: unknown }).route;
  if (route === NANO_BANANA_PRO_WHITEBOARD_ART_PROFILE.route) {
    return assertNanoBananaProWhiteboardArtReceipt(value, contentSha256);
  }
  if (route === NANO_BANANA_2_WHITEBOARD_SUPPORT_ART_PROFILE.route) {
    return assertNanoBanana2WhiteboardSupportArtReceipt(value, contentSha256);
  }
  throw new Error("Whiteboard art receipt uses an unadmitted provider route");
}
