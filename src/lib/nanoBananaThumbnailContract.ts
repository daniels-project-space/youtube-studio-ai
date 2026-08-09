/**
 * Pure, runtime-agnostic thumbnail generation contract.
 *
 * Keep this module free of Node/provider imports: Convex validators consume the
 * same immutable contract as the Trigger worker without pulling provider code
 * into the Convex runtime.
 */
export const NANO_BANANA_THUMBNAIL_PROFILE = {
  contractVersion: "nano-banana-thumbnail/v2",
  provider: "gemini",
  model: "gemini-2.5-flash-image",
  apiVersion: "v1beta",
  route: "nano-banana-flash",
  /** Official native 16:9 output for gemini-2.5-flash-image. */
  providerOutputWidth: 1_344,
  providerOutputHeight: 768,
  /** Golden delivery dimensions, enforced after deterministic typography. */
  goldenWidth: 1_280,
  goldenHeight: 720,
  aspectRatio: "16:9",
  tier: "flash",
  allowText: false,
  allowFallback: false,
  /**
   * The provider charges $0.039 per output plus $0.30/M input tokens. Bounding
   * the final (NO_TEXT clause included) UTF-8 request keeps the admission
   * ceiling mathematically above the largest accepted provider token count.
   */
  maxPromptUtf8Bytes: 3_000,
  maxPromptTokenCount: 3_064,
  inputUsdPerMillionTokens: 0.30,
  outputImageUsd: 0.039,
  admissionCeilingUsd: 0.04,
} as const;

export function nanoBananaThumbnailCostUsd(promptTokenCount: number): number {
  if (
    !Number.isInteger(promptTokenCount) ||
    promptTokenCount < 1 ||
    promptTokenCount > NANO_BANANA_THUMBNAIL_PROFILE.maxPromptTokenCount
  ) {
    throw new Error(
      `nano banana thumbnail prompt tokens must be 1-${NANO_BANANA_THUMBNAIL_PROFILE.maxPromptTokenCount}`,
    );
  }
  return Number((
    NANO_BANANA_THUMBNAIL_PROFILE.outputImageUsd +
    promptTokenCount * NANO_BANANA_THUMBNAIL_PROFILE.inputUsdPerMillionTokens / 1_000_000
  ).toFixed(9));
}

export function nanoBananaThumbnailPromptCostUsd(promptTokenCount: number): number {
  nanoBananaThumbnailCostUsd(promptTokenCount);
  return Number((
    promptTokenCount * NANO_BANANA_THUMBNAIL_PROFILE.inputUsdPerMillionTokens / 1_000_000
  ).toFixed(9));
}

export interface NanoBananaImageReceipt {
  provider: "gemini";
  model: typeof NANO_BANANA_THUMBNAIL_PROFILE.model;
  apiVersion: typeof NANO_BANANA_THUMBNAIL_PROFILE.apiVersion;
  /** Exact provider response fields, not a locally assigned API revision. */
  modelVersion: string;
  responseId: string;
  route: typeof NANO_BANANA_THUMBNAIL_PROFILE.route;
  /** Dimensions parsed from the provider-returned encoded bytes. */
  width: typeof NANO_BANANA_THUMBNAIL_PROFILE.providerOutputWidth;
  height: typeof NANO_BANANA_THUMBNAIL_PROFILE.providerOutputHeight;
  promptUtf8Bytes: number;
  promptTokenCount: number;
  promptCostUsd: number;
  outputCostUsd: typeof NANO_BANANA_THUMBNAIL_PROFILE.outputImageUsd;
  costUsd: number;
  sourceContentType: string;
  providerRequestCanonicalJson: string;
  providerRequestSha256: string;
  /** Canonical, lossless {modelVersion,responseId,usageMetadata} response subset. */
  providerResponseMetadataCanonicalJson: string;
  providerResponseMetadataSha256: string;
  responseSha256: string;
  createdAt: number;
}
