/**
 * Sealed Fal Nano Banana edit contract for Lo-Fi video-frame thumbnails.
 *
 * This is deliberately separate from both the normal direct thumbnail module
 * and the square channel-avatar adapter. It may add the two approved text
 * elements, but it must edit one exact 1280x720 frame derived from a rendered
 * video and may never fall back to another provider or model.
 */
export const FAL_NANO_BANANA_LOFI_THUMBNAIL_PROFILE = {
  contractVersion: "fal-nano-banana-lofi-thumbnail/v1",
  provider: "fal",
  model: "fal-ai/nano-banana/edit",
  apiVersion: "fal-model-api/v1",
  route: "fal-nano-banana-lofi-video-reference",
  aspectRatio: "16:9",
  referenceWidth: 1_280,
  referenceHeight: 720,
  accountingWidth: 1_344,
  accountingHeight: 768,
  allowText: true,
  allowFallback: false,
  maxPromptUtf8Bytes: 3_000,
  maxReferenceBytes: 2_000_000,
  outputImageUsd: 0.039,
  admissionCeilingUsd: 0.04,
} as const;

export interface FalNanoBananaLofiThumbnailReceipt {
  provider: typeof FAL_NANO_BANANA_LOFI_THUMBNAIL_PROFILE.provider;
  model: typeof FAL_NANO_BANANA_LOFI_THUMBNAIL_PROFILE.model;
  apiVersion: typeof FAL_NANO_BANANA_LOFI_THUMBNAIL_PROFILE.apiVersion;
  providerRequestId: string | null;
  route: typeof FAL_NANO_BANANA_LOFI_THUMBNAIL_PROFILE.route;
  width: number;
  height: number;
  promptUtf8Bytes: number;
  referenceSha256: string;
  typographyMatteSha256: string;
  outputCostUsd: typeof FAL_NANO_BANANA_LOFI_THUMBNAIL_PROFILE.outputImageUsd;
  costUsd: number;
  sourceContentType: string;
  providerRequestCanonicalJson: string;
  providerRequestSha256: string;
  providerResponseMetadataCanonicalJson: string;
  providerResponseMetadataSha256: string;
  responseSha256: string;
  createdAt: number;
}
