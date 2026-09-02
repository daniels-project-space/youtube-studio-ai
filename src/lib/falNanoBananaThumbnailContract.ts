/**
 * Current production contract for text-free 16:9 thumbnail scene generation.
 *
 * The normal thumbnail module owns deterministic typography after this image
 * is returned. Fal Nano Banana therefore produces picture-only artwork and is
 * pinned independently from the Lo-Fi reference-edit side lane.
 */
export const FAL_NANO_BANANA_THUMBNAIL_PROFILE = {
  contractVersion: "fal-nano-banana-thumbnail/v1",
  provider: "fal",
  model: "fal-ai/nano-banana",
  apiVersion: "fal-model-api/v1",
  route: "fal-nano-banana-thumbnail",
  aspectRatio: "16:9",
  accountingWidth: 1_344,
  accountingHeight: 768,
  goldenWidth: 1_280,
  goldenHeight: 720,
  allowText: false,
  allowFallback: false,
  maxPromptUtf8Bytes: 3_000,
  outputImageUsd: 0.039,
  admissionCeilingUsd: 0.04,
} as const;

export interface FalNanoBananaThumbnailReceipt {
  provider: typeof FAL_NANO_BANANA_THUMBNAIL_PROFILE.provider;
  model: typeof FAL_NANO_BANANA_THUMBNAIL_PROFILE.model;
  apiVersion: typeof FAL_NANO_BANANA_THUMBNAIL_PROFILE.apiVersion;
  providerRequestId: string | null;
  route: typeof FAL_NANO_BANANA_THUMBNAIL_PROFILE.route;
  width: number;
  height: number;
  promptUtf8Bytes: number;
  outputCostUsd: typeof FAL_NANO_BANANA_THUMBNAIL_PROFILE.outputImageUsd;
  costUsd: number;
  sourceContentType: string;
  providerRequestCanonicalJson: string;
  providerRequestSha256: string;
  providerResponseMetadataCanonicalJson: string;
  providerResponseMetadataSha256: string;
  responseSha256: string;
  createdAt: number;
}
