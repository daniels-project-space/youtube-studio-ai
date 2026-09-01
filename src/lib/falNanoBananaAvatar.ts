/**
 * One-purpose Fal adapter for square Nano Banana channel identity marks.
 *
 * It is intentionally not a generic image router. The request shape, model,
 * geometry, format, cost, and no-text policy are sealed here. A paid Fal
 * response is cached before its CDN bytes are downloaded so a transport retry
 * can reuse the accepted output instead of purchasing another image.
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
import {
  NANO_BANANA_AVATAR_PROFILE,
  type NanoBananaAvatarReceipt,
} from "@/lib/nanoBananaAvatarContract";
import { hydrateEnv } from "@/lib/vault";

const PROFILE = NANO_BANANA_AVATAR_PROFILE;
const ENDPOINT = `https://fal.run/${PROFILE.model}`;
const PICTURE_ONLY_RULE =
  "ABSOLUTE RULE — PICTURE ONLY, NO TEXT: do not render letters, words, initials, numbers, captions, labels, signatures, logos with typography, or watermarks anywhere in the image.";

interface FalAvatarImage {
  url?: string;
  content_type?: string;
  file_name?: string;
  file_size?: number;
  width?: number;
  height?: number;
}

interface FalAvatarPayload {
  images?: FalAvatarImage[];
  description?: string;
  request_id?: string;
  error?: string | { message?: string };
}

interface PaidFalAvatarResponse {
  url: string;
  image: FalAvatarImage;
  description: string;
  providerRequestId: string | null;
}

export interface FalNanoBananaAvatarResult {
  bytes: Buffer;
  receipt: NanoBananaAvatarReceipt;
}

export class FalNanoBananaAvatarSubmissionError extends Error {
  readonly retryable = false;
  readonly status?: number;
  readonly code = "FAL_NANO_BANANA_AVATAR_SUBMISSION_AMBIGUOUS";

  constructor(message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "FalNanoBananaAvatarSubmissionError";
    this.status = options.status;
  }
}

export class FalNanoBananaAvatarTransportError extends Error {
  readonly retryable = false;
  readonly code = "FAL_NANO_BANANA_AVATAR_OUTPUT_TRANSPORT_FAILED";
  readonly providerReceipt: PaidFalAvatarResponse;

  constructor(message: string, providerReceipt: PaidFalAvatarResponse) {
    super(message);
    this.name = "FalNanoBananaAvatarTransportError";
    this.providerReceipt = providerReceipt;
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function boundedContext(value: string): string {
  const context = value.trim();
  if (!context || context.length > 512 || /[\u0000-\u001f\u007f]/u.test(context)) {
    throw new Error("fal nano banana avatar requires a bounded durable idempotency context");
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

function providerError(payload: FalAvatarPayload, raw: string): string {
  if (typeof payload.error === "string") return payload.error.slice(0, 240);
  if (payload.error && typeof payload.error.message === "string") {
    return payload.error.message.slice(0, 240);
  }
  return raw.slice(0, 240);
}

async function hydrateFalCredential(): Promise<void> {
  if (!process.env.FAL_KEY) await hydrateEnv("fal");
  if (!process.env.FAL_KEY) {
    throw new Error("fal nano banana avatar: FAL_KEY is not configured in the project vault");
  }
}

async function downloadPaidImage(receipt: PaidFalAvatarResponse): Promise<Buffer> {
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
  throw new FalNanoBananaAvatarTransportError(
    `fal nano banana avatar generated successfully but its accepted output could not be downloaded (${lastError})`,
    receipt,
  );
}

export async function generateFalNanoBananaAvatarImageWithReceipt(args: {
  prompt: string;
  idempotencyContext: string;
}): Promise<FalNanoBananaAvatarResult> {
  await hydrateFalCredential();
  const context = boundedContext(args.idempotencyContext);
  const prompt = `${args.prompt.trim()}\n\n${PICTURE_ONLY_RULE}`;
  const promptUtf8Bytes = Buffer.byteLength(prompt, "utf8");
  if (!args.prompt.trim() || promptUtf8Bytes > PROFILE.maxPromptUtf8Bytes) {
    throw new Error(
      `fal nano banana avatar prompt is ${promptUtf8Bytes} UTF-8 bytes; ` +
        `the fail-closed maximum is ${PROFILE.maxPromptUtf8Bytes}`,
    );
  }
  const body = {
    prompt,
    num_images: 1,
    aspect_ratio: PROFILE.aspectRatio,
    output_format: "png",
    safety_tolerance: "4",
    limit_generations: true,
  } as const;
  const providerRequestCanonicalJson = canonicalJson({
    apiVersion: PROFILE.apiVersion,
    context,
    endpoint: PROFILE.model,
    body,
  });
  const cacheKey = imageRequestCacheKey(PROFILE.provider, PROFILE.model, {
    context,
    body,
  });
  let paid = getCachedImageResponse<PaidFalAvatarResponse>(cacheKey);
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
      throw new FalNanoBananaAvatarSubmissionError(
        "fal nano banana avatar submission ended without a durable response; refusing automatic resubmission",
        { cause: error },
      );
    }

    const raw = await response.text();
    let payload: FalAvatarPayload = {};
    try {
      payload = raw ? JSON.parse(raw) as FalAvatarPayload : {};
    } catch (error) {
      throw new FalNanoBananaAvatarSubmissionError(
        `fal nano banana avatar returned unreadable HTTP ${response.status}; refusing automatic resubmission`,
        { status: response.status, cause: error },
      );
    }
    if (!response.ok) {
      throw new FalNanoBananaAvatarSubmissionError(
        `fal nano banana avatar returned HTTP ${response.status}; refusing automatic resubmission: ` +
          providerError(payload, raw),
        { status: response.status },
      );
    }
    const image = payload.images?.[0];
    const url = httpsUrl(image?.url);
    if (!image || !url || payload.images?.length !== 1) {
      throw new FalNanoBananaAvatarSubmissionError(
        "fal nano banana avatar returned no single durable HTTPS image output; refusing automatic resubmission",
        { status: response.status },
      );
    }
    const requestId = response.headers.get("x-fal-request-id")?.trim() || payload.request_id?.trim() || null;
    if (requestId && requestId.length > 256) {
      throw new FalNanoBananaAvatarSubmissionError(
        "fal nano banana avatar returned an invalid request identifier",
        { status: response.status },
      );
    }
    const description = typeof payload.description === "string" ? payload.description : "";
    if (description.length > 8_192) {
      throw new FalNanoBananaAvatarSubmissionError(
        "fal nano banana avatar returned unbounded response metadata",
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
      width: PROFILE.providerOutputWidth,
      height: PROFILE.providerOutputHeight,
      costUsd: PROFILE.outputImageUsd,
    });
  }

  const bytes = await downloadPaidImage(paid);
  const dimensions = rasterImageDimensions(bytes);
  if (
    dimensions.contentType !== "image/png" ||
    dimensions.width !== PROFILE.providerOutputWidth ||
    dimensions.height !== PROFILE.providerOutputHeight
  ) {
    throw new FalNanoBananaAvatarSubmissionError(
      `fal nano banana avatar returned ${dimensions.contentType} ${dimensions.width}x${dimensions.height}; ` +
        `the sealed contract requires image/png ${PROFILE.providerOutputWidth}x${PROFILE.providerOutputHeight}`,
    );
  }
  if (
    (typeof paid.image.width === "number" && paid.image.width !== dimensions.width) ||
    (typeof paid.image.height === "number" && paid.image.height !== dimensions.height) ||
    (typeof paid.image.file_size === "number" && paid.image.file_size !== bytes.byteLength)
  ) {
    throw new FalNanoBananaAvatarSubmissionError(
      "fal nano banana avatar output metadata does not match the downloaded bytes",
    );
  }
  const declaredContentType = paid.image.content_type?.split(";", 1)[0]?.trim().toLowerCase()
    .replace(/^image\/jpg$/u, "image/jpeg");
  if (declaredContentType && declaredContentType !== dimensions.contentType) {
    throw new FalNanoBananaAvatarSubmissionError(
      `fal nano banana avatar declared ${declaredContentType} but returned ${dimensions.contentType} bytes`,
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
      width: PROFILE.providerOutputWidth,
      height: PROFILE.providerOutputHeight,
      promptUtf8Bytes,
      outputCostUsd: PROFILE.outputImageUsd,
      costUsd: PROFILE.outputImageUsd,
      sourceContentType: dimensions.contentType,
      providerRequestCanonicalJson,
      providerRequestSha256: sha256(`fal-nano-banana-provider\0${providerRequestCanonicalJson}`),
      providerResponseMetadataCanonicalJson,
      providerResponseMetadataSha256: sha256(
        `fal-nano-banana-response-metadata\0${providerResponseMetadataCanonicalJson}`,
      ),
      responseSha256: sha256(bytes),
      createdAt: Date.now(),
    },
  };
}
