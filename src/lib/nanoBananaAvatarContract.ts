/**
 * Receipt-bound Nano Banana contract for square channel identity marks.
 *
 * This is deliberately separate from the direct-Google 16:9 thumbnail
 * contract. Channel identity is the one operator-approved exception that uses
 * Nano Banana through Fal, with a fixed square request and no provider fallback.
 */
export const NANO_BANANA_AVATAR_PROFILE = {
  contractVersion: "fal-nano-banana-avatar/v1",
  provider: "fal",
  model: "fal-ai/nano-banana",
  apiVersion: "fal-model-api/v1",
  route: "fal-nano-banana-avatar",
  providerOutputWidth: 1_024,
  providerOutputHeight: 1_024,
  aspectRatio: "1:1",
  allowText: false,
  allowFallback: false,
  maxPromptUtf8Bytes: 3_000,
  outputImageUsd: 0.039,
  admissionCeilingUsd: 0.04,
} as const;

export interface NanoBananaAvatarReceipt {
  provider: typeof NANO_BANANA_AVATAR_PROFILE.provider;
  model: typeof NANO_BANANA_AVATAR_PROFILE.model;
  apiVersion: typeof NANO_BANANA_AVATAR_PROFILE.apiVersion;
  /** Fal returns this as a response header/body field when available. */
  providerRequestId: string | null;
  route: typeof NANO_BANANA_AVATAR_PROFILE.route;
  width: typeof NANO_BANANA_AVATAR_PROFILE.providerOutputWidth;
  height: typeof NANO_BANANA_AVATAR_PROFILE.providerOutputHeight;
  promptUtf8Bytes: number;
  outputCostUsd: typeof NANO_BANANA_AVATAR_PROFILE.outputImageUsd;
  costUsd: number;
  sourceContentType: string;
  providerRequestCanonicalJson: string;
  providerRequestSha256: string;
  providerResponseMetadataCanonicalJson: string;
  providerResponseMetadataSha256: string;
  responseSha256: string;
  createdAt: number;
}
