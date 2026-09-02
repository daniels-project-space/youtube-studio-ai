/** Sealed one-pass Fal Nano Banana Pro contract for non-LoFi thumbnails. */
export const FAL_NANO_BANANA_PRO_THUMBNAIL_PROFILE = {
  contractVersion: "fal-nano-banana-pro-thumbnail/v1",
  provider: "fal",
  model: "fal-ai/nano-banana-pro",
  apiVersion: "fal-model-api/v1",
  route: "fal-nano-banana-pro-native-thumbnail",
  aspectRatio: "16:9",
  resolution: "2K",
  accountingWidth: 2_048,
  accountingHeight: 1_152,
  allowText: true,
  allowReferenceImages: false,
  allowFallback: false,
  maxPromptUtf8Bytes: 8_000,
  outputImageUsd: 0.15,
  admissionCeilingUsd: 0.15,
} as const;

export interface FalNanoBananaProThumbnailReceipt {
  provider: typeof FAL_NANO_BANANA_PRO_THUMBNAIL_PROFILE.provider;
  model: typeof FAL_NANO_BANANA_PRO_THUMBNAIL_PROFILE.model;
  apiVersion: typeof FAL_NANO_BANANA_PRO_THUMBNAIL_PROFILE.apiVersion;
  providerRequestId: string | null;
  route: typeof FAL_NANO_BANANA_PRO_THUMBNAIL_PROFILE.route;
  width: number;
  height: number;
  promptUtf8Bytes: number;
  outputCostUsd: typeof FAL_NANO_BANANA_PRO_THUMBNAIL_PROFILE.outputImageUsd;
  costUsd: number;
  sourceContentType: string;
  providerRequestCanonicalJson: string;
  providerRequestSha256: string;
  providerResponseMetadataCanonicalJson: string;
  providerResponseMetadataSha256: string;
  responseSha256: string;
  createdAt: number;
}
