/**
 * One-purpose Fal Nano Banana adapter for Lo-Fi thumbnail reference edits.
 *
 * A paid Fal response is cached before CDN download, and every request binds
 * the exact reference bytes, prompt, model, geometry and idempotency context.
 */
import { createHash } from "node:crypto";

import { canonicalJson } from "@/lib/canonicalJson";
import {
  FAL_NANO_BANANA_LOFI_THUMBNAIL_PROFILE,
  type FalNanoBananaLofiThumbnailReceipt,
} from "@/lib/falNanoBananaLofiThumbnailContract";
import {
  cacheImageResponse,
  getCachedImageResponse,
  imageRequestCacheKey,
  recordImageUsage,
} from "@/lib/imageUsage";
import { rasterImageDimensions } from "@/lib/imageDimensions";
import { hydrateEnv } from "@/lib/vault";

const PROFILE = FAL_NANO_BANANA_LOFI_THUMBNAIL_PROFILE;
const ENDPOINT = `https://fal.run/${PROFILE.model}`;

interface FalImage {
  url?: string;
  content_type?: string;
  file_name?: string;
  file_size?: number;
  width?: number;
  height?: number;
}

interface FalPayload {
  images?: FalImage[];
  description?: string;
  request_id?: string;
  error?: string | { message?: string };
}

interface PaidFalResponse {
  url: string;
  image: FalImage;
  description: string;
  providerRequestId: string | null;
}

export interface FalNanoBananaLofiThumbnailResult {
  bytes: Buffer;
  receipt: FalNanoBananaLofiThumbnailReceipt;
}

export class FalNanoBananaLofiThumbnailSubmissionError extends Error {
  readonly retryable = false;
  readonly status?: number;
  readonly code = "FAL_NANO_BANANA_LOFI_THUMBNAIL_SUBMISSION_AMBIGUOUS";

  constructor(message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "FalNanoBananaLofiThumbnailSubmissionError";
    this.status = options.status;
  }
}

export class FalNanoBananaLofiThumbnailTransportError extends Error {
  readonly retryable = false;
  readonly code = "FAL_NANO_BANANA_LOFI_THUMBNAIL_OUTPUT_TRANSPORT_FAILED";
  readonly providerReceipt: PaidFalResponse;

  constructor(message: string, providerReceipt: PaidFalResponse) {
    super(message);
    this.name = "FalNanoBananaLofiThumbnailTransportError";
    this.providerReceipt = providerReceipt;
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function boundedContext(value: string): string {
  const context = value.trim();
  if (!context || context.length > 8_192 || /[\u0000-\u001f\u007f]/u.test(context)) {
    throw new Error("fal Lo-Fi Nano Banana requires a bounded durable idempotency context");
  }
  return context;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4_096) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function providerError(payload: FalPayload, raw: string): string {
  if (typeof payload.error === "string") return payload.error.slice(0, 240);
  if (payload.error && typeof payload.error.message === "string") {
    return payload.error.message.slice(0, 240);
  }
  return raw.slice(0, 240);
}

async function hydrateFalCredential(): Promise<void> {
  if (!process.env.FAL_KEY) await hydrateEnv("fal");
  if (!process.env.FAL_KEY) {
    throw new Error("fal Lo-Fi Nano Banana: FAL_KEY is not configured in the project vault");
  }
}

export function hasFalNanoBananaLofiThumbnail(): boolean {
  return Boolean(process.env.FAL_KEY);
}

async function downloadPaidImage(receipt: PaidFalResponse): Promise<Buffer> {
  let lastError = "unknown CDN transport error";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(receipt.url, { signal: AbortSignal.timeout(90_000) });
      if (response.ok) return Buffer.from(await response.arrayBuffer());
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  throw new FalNanoBananaLofiThumbnailTransportError(
    `fal Lo-Fi Nano Banana generated successfully but its accepted output could not be downloaded (${lastError})`,
    receipt,
  );
}

export async function generateFalNanoBananaLofiThumbnailWithReceipt(args: {
  prompt: string;
  referenceImage: Buffer;
  referenceMimeType?: "image/jpeg" | "image/png" | "image/webp";
  typographyMatteImage: Buffer;
  typographyMatteMimeType?: "image/png";
  idempotencyContext: string;
}): Promise<FalNanoBananaLofiThumbnailResult> {
  await hydrateFalCredential();
  const context = boundedContext(args.idempotencyContext);
  const prompt = args.prompt.trim();
  const promptUtf8Bytes = Buffer.byteLength(prompt, "utf8");
  if (!prompt || promptUtf8Bytes > PROFILE.maxPromptUtf8Bytes) {
    throw new Error(
      `fal Lo-Fi Nano Banana prompt is ${promptUtf8Bytes} UTF-8 bytes; ` +
        `the fail-closed maximum is ${PROFILE.maxPromptUtf8Bytes}`,
    );
  }
  if (!args.referenceImage.byteLength || args.referenceImage.byteLength > PROFILE.maxReferenceBytes) {
    throw new Error(
      `fal Lo-Fi Nano Banana reference must be 1-${PROFILE.maxReferenceBytes} bytes`,
    );
  }
  const referenceDimensions = rasterImageDimensions(args.referenceImage);
  if (
    referenceDimensions.width !== PROFILE.referenceWidth ||
    referenceDimensions.height !== PROFILE.referenceHeight
  ) {
    throw new Error(
      `fal Lo-Fi Nano Banana reference must be ${PROFILE.referenceWidth}x${PROFILE.referenceHeight}; ` +
        `received ${referenceDimensions.width}x${referenceDimensions.height}`,
    );
  }
  const referenceMimeType = args.referenceMimeType ?? referenceDimensions.contentType;
  if (referenceMimeType !== referenceDimensions.contentType) {
    throw new Error(
      `fal Lo-Fi Nano Banana reference MIME ${referenceMimeType} does not match ` +
        `${referenceDimensions.contentType} bytes`,
    );
  }
  const referenceSha256 = sha256(args.referenceImage);
  if (!args.typographyMatteImage.byteLength ||
    args.typographyMatteImage.byteLength > PROFILE.maxReferenceBytes) {
    throw new Error(
      `fal Lo-Fi Nano Banana typography matte must be 1-${PROFILE.maxReferenceBytes} bytes`,
    );
  }
  const matteDimensions = rasterImageDimensions(args.typographyMatteImage);
  if (
    matteDimensions.width !== PROFILE.referenceWidth ||
    matteDimensions.height !== PROFILE.referenceHeight ||
    matteDimensions.contentType !== "image/png" ||
    (args.typographyMatteMimeType !== undefined && args.typographyMatteMimeType !== "image/png")
  ) {
    throw new Error(
      `fal Lo-Fi Nano Banana typography matte must be image/png ` +
        `${PROFILE.referenceWidth}x${PROFILE.referenceHeight}`,
    );
  }
  const typographyMatteSha256 = sha256(args.typographyMatteImage);
  const body = {
    prompt,
    num_images: 1,
    aspect_ratio: PROFILE.aspectRatio,
    output_format: "png",
    safety_tolerance: "4",
    image_urls: [
      `data:image/png;base64,${args.typographyMatteImage.toString("base64")}`,
      `data:${referenceMimeType};base64,${args.referenceImage.toString("base64")}`,
    ],
    limit_generations: true,
  } as const;
  const providerRequestCanonicalJson = canonicalJson({
    apiVersion: PROFILE.apiVersion,
    context,
    endpoint: PROFILE.model,
    body,
  });
  const cacheKey = imageRequestCacheKey(PROFILE.provider, PROFILE.model, { context, body });
  let paid = getCachedImageResponse<PaidFalResponse>(cacheKey);
  if (!paid) {
    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Key ${process.env.FAL_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (error) {
      throw new FalNanoBananaLofiThumbnailSubmissionError(
        "fal Lo-Fi Nano Banana submission ended without a durable response; refusing automatic resubmission",
        { cause: error },
      );
    }

    const raw = await response.text();
    let payload: FalPayload = {};
    try {
      payload = raw ? JSON.parse(raw) as FalPayload : {};
    } catch (error) {
      throw new FalNanoBananaLofiThumbnailSubmissionError(
        `fal Lo-Fi Nano Banana returned unreadable HTTP ${response.status}; refusing automatic resubmission`,
        { status: response.status, cause: error },
      );
    }
    if (!response.ok) {
      throw new FalNanoBananaLofiThumbnailSubmissionError(
        `fal Lo-Fi Nano Banana returned HTTP ${response.status}; refusing automatic resubmission: ` +
          providerError(payload, raw),
        { status: response.status },
      );
    }
    const image = payload.images?.[0];
    const url = httpsUrl(image?.url);
    if (!image || !url || payload.images?.length !== 1) {
      throw new FalNanoBananaLofiThumbnailSubmissionError(
        "fal Lo-Fi Nano Banana returned no single durable HTTPS image output; refusing automatic resubmission",
        { status: response.status },
      );
    }
    const requestId = response.headers.get("x-fal-request-id")?.trim() || payload.request_id?.trim() || null;
    if (requestId && requestId.length > 256) {
      throw new FalNanoBananaLofiThumbnailSubmissionError(
        "fal Lo-Fi Nano Banana returned an invalid request identifier",
        { status: response.status },
      );
    }
    const description = typeof payload.description === "string" ? payload.description : "";
    if (description.length > 8_192) {
      throw new FalNanoBananaLofiThumbnailSubmissionError(
        "fal Lo-Fi Nano Banana returned unbounded response metadata",
        { status: response.status },
      );
    }
    paid = { url, image, description, providerRequestId: requestId };
    cacheImageResponse(cacheKey, paid);
    recordImageUsage({
      provider: PROFILE.provider,
      model: PROFILE.model,
      route: PROFILE.route,
      images: 1,
      width: PROFILE.accountingWidth,
      height: PROFILE.accountingHeight,
      costUsd: PROFILE.outputImageUsd,
    });
  }

  const bytes = await downloadPaidImage(paid);
  const dimensions = rasterImageDimensions(bytes);
  const ratio = dimensions.width / dimensions.height;
  if (
    !/^image\/(?:png|jpeg|webp)$/u.test(dimensions.contentType) ||
    dimensions.width < 512 ||
    dimensions.height < 288 ||
    dimensions.width > 4_096 ||
    dimensions.height > 4_096 ||
    Math.abs(ratio - 16 / 9) > 0.04
  ) {
    throw new FalNanoBananaLofiThumbnailSubmissionError(
      `fal Lo-Fi Nano Banana returned ${dimensions.contentType} ${dimensions.width}x${dimensions.height}; ` +
        "the sealed contract requires a bounded 16:9 raster output",
    );
  }
  if (
    (typeof paid.image.width === "number" && paid.image.width !== dimensions.width) ||
    (typeof paid.image.height === "number" && paid.image.height !== dimensions.height) ||
    (typeof paid.image.file_size === "number" && paid.image.file_size !== bytes.byteLength)
  ) {
    throw new FalNanoBananaLofiThumbnailSubmissionError(
      "fal Lo-Fi Nano Banana output metadata does not match the downloaded bytes",
    );
  }
  const declaredContentType = paid.image.content_type?.split(";", 1)[0]?.trim().toLowerCase()
    .replace(/^image\/jpg$/u, "image/jpeg");
  if (declaredContentType && declaredContentType !== dimensions.contentType) {
    throw new FalNanoBananaLofiThumbnailSubmissionError(
      `fal Lo-Fi Nano Banana declared ${declaredContentType} but returned ${dimensions.contentType} bytes`,
    );
  }
  const providerResponseMetadataCanonicalJson = canonicalJson({
    requestId: paid.providerRequestId,
    description: paid.description,
    image: paid.image,
  });
  return {
    bytes,
    receipt: {
      provider: PROFILE.provider,
      model: PROFILE.model,
      apiVersion: PROFILE.apiVersion,
      providerRequestId: paid.providerRequestId,
      route: PROFILE.route,
      width: dimensions.width,
      height: dimensions.height,
      promptUtf8Bytes,
      referenceSha256,
      typographyMatteSha256,
      outputCostUsd: PROFILE.outputImageUsd,
      costUsd: PROFILE.outputImageUsd,
      sourceContentType: dimensions.contentType,
      providerRequestCanonicalJson,
      providerRequestSha256: sha256(`fal-nano-banana-lofi-provider\0${providerRequestCanonicalJson}`),
      providerResponseMetadataCanonicalJson,
      providerResponseMetadataSha256: sha256(
        `fal-nano-banana-lofi-response-metadata\0${providerResponseMetadataCanonicalJson}`,
      ),
      responseSha256: sha256(bytes),
      createdAt: Date.now(),
    },
  };
}
