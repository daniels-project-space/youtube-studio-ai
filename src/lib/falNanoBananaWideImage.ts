/**
 * Shared, receipt-bound Fal Nano Banana route for text-free 16:9 artwork.
 *
 * A channel banner and a thumbnail are different Studio artifacts, but their
 * provider transport is identical: one native Nano Banana image, no local
 * typography, one explicit aspect ratio, durable response evidence, and no
 * automatic retry after an ambiguous paid submission. Keeping that transport
 * here prevents those contracts from quietly diverging.
 */
import { createHash } from "node:crypto";

import { canonicalJson } from "@/lib/canonicalJson";
import {
  cacheImageResponse,
  getCachedImageResponse,
  imageRequestCacheKey,
  recordImageUsage,
} from "@/lib/imageUsage";
import { rasterImageDimensions } from "@/lib/imageDimensions";
import { hydrateEnv } from "@/lib/vault";

const PICTURE_ONLY_RULE =
  "ABSOLUTE RULE — PICTURE ONLY, NO TEXT: do not render letters, words, initials, numbers, captions, labels, signatures, logos with typography, or watermarks anywhere in the image.";

export type FalNanoBananaWideProfile = Readonly<{
  contractVersion: string;
  provider: "fal";
  model: "fal-ai/nano-banana" | "fal-ai/nano-banana/edit";
  apiVersion: string;
  route: string;
  aspectRatio: "16:9";
  accountingWidth: number;
  accountingHeight: number;
  minimumWidth: number;
  maximumWidth: number;
  minimumHeight: number;
  maximumHeight: number;
  maxPromptUtf8Bytes: number;
  outputImageUsd: number;
}>;

export type FalNanoBananaWideReceipt = Readonly<{
  provider: "fal";
  model: "fal-ai/nano-banana" | "fal-ai/nano-banana/edit";
  apiVersion: string;
  providerRequestId: string | null;
  route: string;
  width: number;
  height: number;
  promptUtf8Bytes: number;
  outputCostUsd: number;
  costUsd: number;
  sourceContentType: string;
  providerRequestCanonicalJson: string;
  providerRequestSha256: string;
  providerResponseMetadataCanonicalJson: string;
  providerResponseMetadataSha256: string;
  responseSha256: string;
  createdAt: number;
}>;

type FalImage = Readonly<{
  url?: string;
  content_type?: string;
  file_name?: string;
  file_size?: number;
  width?: number;
  height?: number;
}>;

type FalPayload = Readonly<{
  images?: FalImage[];
  description?: string;
  request_id?: string;
  error?: string | { message?: string };
}>;

type PaidFalResponse = Readonly<{
  url: string;
  image: FalImage;
  description: string;
  providerRequestId: string | null;
}>;

export class FalNanoBananaWideSubmissionError extends Error {
  readonly retryable = false;
  readonly status?: number;

  constructor(message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "FalNanoBananaWideSubmissionError";
    this.status = options.status;
  }
}

export class FalNanoBananaWideTransportError extends Error {
  readonly retryable = false;
  readonly providerReceipt: PaidFalResponse;

  constructor(message: string, providerReceipt: PaidFalResponse) {
    super(message);
    this.name = "FalNanoBananaWideTransportError";
    this.providerReceipt = providerReceipt;
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function boundedContext(value: string): string {
  const context = value.trim();
  if (!context || context.length > 8_192 || /[\u0000-\u001f\u007f]/u.test(context)) {
    throw new Error("Fal Nano Banana artwork requires a bounded durable idempotency context");
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
  if (payload.error && typeof payload.error.message === "string") return payload.error.message.slice(0, 240);
  return raw.slice(0, 240);
}

function boundedPngDataUri(value: string): string {
  const dataUri = value.trim();
  // The banner edit route may only receive an in-memory canonical canvas. Do
  // not turn the shared renderer into a remote-URL fetcher or an unbounded
  // data tunnel just to preserve the aspect ratio.
  if (
    !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/u.test(dataUri) ||
    dataUri.length > 8_000_000
  ) {
    throw new Error("Fal Nano Banana artwork edit requires a bounded PNG data-URI reference canvas");
  }
  return dataUri;
}

async function hydrateFalCredential(): Promise<void> {
  if (!process.env.FAL_KEY) await hydrateEnv("fal");
  if (!process.env.FAL_KEY) throw new Error("Fal Nano Banana artwork: FAL_KEY is not configured in the project vault");
}

export function hasFalNanoBananaWideImage(): boolean {
  return Boolean(process.env.FAL_KEY);
}

async function downloadPaidImage(args: { label: string; receipt: PaidFalResponse }): Promise<Buffer> {
  let lastError = "unknown CDN transport error";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(args.receipt.url, { signal: AbortSignal.timeout(90_000) });
      if (response.ok) return Buffer.from(await response.arrayBuffer());
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  throw new FalNanoBananaWideTransportError(
    `${args.label} generated successfully but its accepted output could not be downloaded (${lastError})`,
    args.receipt,
  );
}

/** Generate one text-free, 16:9 native Nano Banana image with immutable receipts. */
export async function generateFalNanoBananaWideImageWithReceipt(args: {
  profile: FalNanoBananaWideProfile;
  prompt: string;
  idempotencyContext: string;
  label: string;
  /** Required for the native Nano Banana edit endpoint; never a remote URL. */
  referenceImageDataUri?: string;
}): Promise<{ bytes: Buffer; receipt: FalNanoBananaWideReceipt }> {
  const { profile } = args;
  await hydrateFalCredential();
  const context = boundedContext(args.idempotencyContext);
  const prompt = `${args.prompt.trim()}\n\n${PICTURE_ONLY_RULE}`;
  const promptUtf8Bytes = Buffer.byteLength(prompt, "utf8");
  if (!args.prompt.trim() || promptUtf8Bytes > profile.maxPromptUtf8Bytes) {
    throw new Error(`${args.label} prompt is ${promptUtf8Bytes} UTF-8 bytes; maximum is ${profile.maxPromptUtf8Bytes}`);
  }
  const textToImageBody = {
    prompt,
    num_images: 1,
    aspect_ratio: profile.aspectRatio,
    output_format: "png",
    safety_tolerance: "4",
    limit_generations: true,
  } as const;
  const referenceImageDataUri = args.referenceImageDataUri === undefined
    ? undefined
    : boundedPngDataUri(args.referenceImageDataUri);
  if (profile.model === "fal-ai/nano-banana/edit" && !referenceImageDataUri) {
    throw new Error(`${args.label} native edit route requires its canonical reference canvas`);
  }
  const body = referenceImageDataUri
    ? { ...textToImageBody, image_urls: [referenceImageDataUri] }
    : textToImageBody;
  const providerRequestCanonicalJson = canonicalJson({
    apiVersion: profile.apiVersion,
    context,
    endpoint: profile.model,
    body,
  });
  const cacheKey = imageRequestCacheKey(profile.provider, profile.model, {
    contractVersion: profile.contractVersion,
    context,
    body,
  });
  let paid = getCachedImageResponse<PaidFalResponse>(cacheKey);
  if (!paid) {
    let response: Response;
    try {
      response = await fetch(`https://fal.run/${profile.model}`, {
        method: "POST",
        headers: {
          Authorization: `Key ${process.env.FAL_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (error) {
      throw new FalNanoBananaWideSubmissionError(
        `${args.label} submission ended without a durable response; refusing automatic resubmission`,
        { cause: error },
      );
    }
    const raw = await response.text();
    let payload: FalPayload = {};
    try {
      payload = raw ? JSON.parse(raw) as FalPayload : {};
    } catch (error) {
      throw new FalNanoBananaWideSubmissionError(
        `${args.label} returned unreadable HTTP ${response.status}; refusing automatic resubmission`,
        { status: response.status, cause: error },
      );
    }
    if (!response.ok) {
      throw new FalNanoBananaWideSubmissionError(
        `${args.label} returned HTTP ${response.status}; refusing automatic resubmission: ${providerError(payload, raw)}`,
        { status: response.status },
      );
    }
    const image = payload.images?.[0];
    const url = httpsUrl(image?.url);
    if (!image || !url || payload.images?.length !== 1) {
      throw new FalNanoBananaWideSubmissionError(
        `${args.label} returned no single durable HTTPS image output; refusing automatic resubmission`,
        { status: response.status },
      );
    }
    const requestId = response.headers.get("x-fal-request-id")?.trim() || payload.request_id?.trim() || null;
    if (requestId && requestId.length > 256) {
      throw new FalNanoBananaWideSubmissionError(`${args.label} returned an invalid request identifier`, { status: response.status });
    }
    const description = typeof payload.description === "string" ? payload.description : "";
    if (description.length > 8_192) {
      throw new FalNanoBananaWideSubmissionError(`${args.label} returned unbounded response metadata`, { status: response.status });
    }
    paid = { url, image, description, providerRequestId: requestId };
    cacheImageResponse(cacheKey, paid);
    recordImageUsage({
      provider: profile.provider,
      model: profile.model,
      route: profile.route,
      images: 1,
      width: profile.accountingWidth,
      height: profile.accountingHeight,
      costUsd: profile.outputImageUsd,
    });
  }

  const bytes = await downloadPaidImage({ label: args.label, receipt: paid });
  const dimensions = rasterImageDimensions(bytes);
  const ratio = dimensions.width / dimensions.height;
  if (
    !/^image\/(?:png|jpeg|webp)$/u.test(dimensions.contentType) ||
    dimensions.width < profile.minimumWidth || dimensions.width > profile.maximumWidth ||
    dimensions.height < profile.minimumHeight || dimensions.height > profile.maximumHeight ||
    Math.abs(ratio - 16 / 9) > 0.04
  ) {
    throw new FalNanoBananaWideSubmissionError(
      `${args.label} returned ${dimensions.contentType} ${dimensions.width}x${dimensions.height}; the sealed contract requires bounded 16:9 raster output`,
    );
  }
  if (
    (typeof paid.image.width === "number" && paid.image.width !== dimensions.width) ||
    (typeof paid.image.height === "number" && paid.image.height !== dimensions.height) ||
    (typeof paid.image.file_size === "number" && paid.image.file_size !== bytes.byteLength)
  ) throw new FalNanoBananaWideSubmissionError(`${args.label} output metadata does not match downloaded bytes`);
  const declaredContentType = paid.image.content_type?.split(";", 1)[0]?.trim().toLowerCase().replace(/^image\/jpg$/u, "image/jpeg");
  if (declaredContentType && declaredContentType !== dimensions.contentType) {
    throw new FalNanoBananaWideSubmissionError(`${args.label} declared ${declaredContentType} but returned ${dimensions.contentType} bytes`);
  }
  const providerResponseMetadataCanonicalJson = canonicalJson({
    requestId: paid.providerRequestId,
    description: paid.description,
    image: paid.image,
  });
  return {
    bytes,
    receipt: {
      provider: profile.provider,
      model: profile.model,
      apiVersion: profile.apiVersion,
      providerRequestId: paid.providerRequestId,
      route: profile.route,
      width: dimensions.width,
      height: dimensions.height,
      promptUtf8Bytes,
      outputCostUsd: profile.outputImageUsd,
      costUsd: profile.outputImageUsd,
      sourceContentType: dimensions.contentType,
      providerRequestCanonicalJson,
      providerRequestSha256: sha256(`fal-nano-banana-${profile.route}-provider\0${providerRequestCanonicalJson}`),
      providerResponseMetadataCanonicalJson,
      providerResponseMetadataSha256: sha256(`fal-nano-banana-${profile.route}-response-metadata\0${providerResponseMetadataCanonicalJson}`),
      responseSha256: sha256(bytes),
      createdAt: Date.now(),
    },
  };
}
