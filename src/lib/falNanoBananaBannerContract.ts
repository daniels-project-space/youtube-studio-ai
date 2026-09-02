/**
 * Receipt-bound native Nano Banana contract for channel banners.
 *
 * This uses the original Nano Banana native edit route with a sealed 16:9
 * reference canvas. Its compact neutral silhouette is a non-published layout
 * guide: it prevents the base model from returning a 16:9 scene letterboxed
 * inside its own 7:4 output frame or enlarging the hero beyond YouTube's
 * device-safe band. A banner is channel identity, not a thumbnail disguised
 * as one.
 */
export const FAL_NANO_BANANA_BANNER_PROFILE = {
  contractVersion: "fal-nano-banana-channel-banner/v1",
  provider: "fal",
  model: "fal-ai/nano-banana/edit",
  apiVersion: "fal-model-api/v1",
  route: "fal-nano-banana-channel-banner-edit",
  aspectRatio: "16:9",
  accountingWidth: 1_344,
  accountingHeight: 768,
  minimumWidth: 512,
  maximumWidth: 4_096,
  minimumHeight: 288,
  maximumHeight: 4_096,
  allowText: false,
  allowFallback: false,
  maxPromptUtf8Bytes: 3_000,
  outputImageUsd: 0.039,
  admissionCeilingUsd: 0.04,
} as const;

export interface FalNanoBananaBannerReceipt {
  provider: typeof FAL_NANO_BANANA_BANNER_PROFILE.provider;
  model: typeof FAL_NANO_BANANA_BANNER_PROFILE.model;
  apiVersion: typeof FAL_NANO_BANANA_BANNER_PROFILE.apiVersion;
  providerRequestId: string | null;
  route: typeof FAL_NANO_BANANA_BANNER_PROFILE.route;
  width: number;
  height: number;
  promptUtf8Bytes: number;
  outputCostUsd: typeof FAL_NANO_BANANA_BANNER_PROFILE.outputImageUsd;
  costUsd: number;
  sourceContentType: string;
  providerRequestCanonicalJson: string;
  providerRequestSha256: string;
  providerResponseMetadataCanonicalJson: string;
  providerResponseMetadataSha256: string;
  responseSha256: string;
  createdAt: number;
}
