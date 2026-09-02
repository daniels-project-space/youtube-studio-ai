/** Sealed Fal Nano Banana text-to-image adapter for normal thumbnails. */
import {
  generateFalNanoBananaWideImageWithReceipt,
  hasFalNanoBananaWideImage,
} from "@/lib/falNanoBananaWideImage";
import {
  FAL_NANO_BANANA_THUMBNAIL_PROFILE,
  type FalNanoBananaThumbnailReceipt,
} from "@/lib/falNanoBananaThumbnailContract";

export interface FalNanoBananaThumbnailResult {
  bytes: Buffer;
  receipt: FalNanoBananaThumbnailReceipt;
}

// Preserve the established public error names while the shared transport owns
// the actual no-retry-after-ambiguous-submission behavior.
export {
  FalNanoBananaWideSubmissionError as FalNanoBananaThumbnailSubmissionError,
  FalNanoBananaWideTransportError as FalNanoBananaThumbnailTransportError,
} from "@/lib/falNanoBananaWideImage";

export function hasFalNanoBananaThumbnail(): boolean {
  return hasFalNanoBananaWideImage();
}

export async function generateFalNanoBananaThumbnailWithReceipt(args: {
  prompt: string;
  idempotencyContext: string;
}): Promise<FalNanoBananaThumbnailResult> {
  const generated = await generateFalNanoBananaWideImageWithReceipt({
    profile: {
      ...FAL_NANO_BANANA_THUMBNAIL_PROFILE,
      minimumWidth: 512,
      maximumWidth: 4_096,
      minimumHeight: 288,
      maximumHeight: 4_096,
    },
    prompt: args.prompt,
    idempotencyContext: args.idempotencyContext,
    label: "Fal Nano Banana thumbnail",
  });
  return {
    bytes: generated.bytes,
    receipt: generated.receipt as FalNanoBananaThumbnailReceipt,
  };
}
