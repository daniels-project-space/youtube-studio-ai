/**
 * Strict fal.ai Nano Banana 2 adapter for Visual Matter reference assets.
 *
 * The model returns a temporary hosted URL. We immediately download its pixels,
 * return hash-addressed provenance, and cache the paid provider receipt before
 * CDN retrieval so a transient download failure never silently repurchases a
 * render within the same execution.
 */
import { createHash } from "node:crypto";

import { canonicalJson } from "@/lib/canonicalJson";
import {
  cacheImageResponse,
  getCachedImageResponse,
  imageRequestCacheKey,
  recordImageUsage,
} from "@/lib/imageUsage";

export const FAL_NANO_BANANA_2_MODEL = "fal-ai/nano-banana-2";
const FAL_NANO_BANANA_2_EDIT_MODEL = `${FAL_NANO_BANANA_2_MODEL}/edit`;
const FAL_RUN_URL = "https://fal.run";
const MAX_REFERENCE_IMAGES = 6;

export type FalNanoBanana2AspectRatio =
  | "auto"
  | "21:9"
  | "16:9"
  | "3:2"
  | "4:3"
  | "5:4"
  | "1:1"
  | "4:5"
  | "3:4"
  | "2:3"
  | "9:16"
  | "4:1"
  | "1:4"
  | "8:1"
  | "1:8";

export interface FalNanoBanana2ReferenceImage {
  bytes: Uint8Array;
  contentType?: string;
}

export interface FalNanoBanana2Request {
  prompt: string;
  aspectRatio?: FalNanoBanana2AspectRatio;
  resolution?: "0.5K" | "1K" | "2K" | "4K";
  outputFormat?: "png" | "jpeg" | "webp";
  safetyTolerance?: "1" | "2" | "3" | "4" | "5" | "6";
  seed?: number;
  /**
   * Durable caller scope included in the receipt hash. Fal's direct endpoint
   * has no documented idempotency header, so this is never sent as prompt text.
   */
  idempotencyContext?: string;
  /** Image inputs select Nano Banana 2's documented multi-reference edit route. */
  referenceImages?: readonly FalNanoBanana2ReferenceImage[];
}

export interface FalNanoBanana2Receipt {
  provider: "fal";
  model: typeof FAL_NANO_BANANA_2_MODEL | typeof FAL_NANO_BANANA_2_EDIT_MODEL;
  responseId: string;
  requestSha256: string;
  responseSha256: string;
  providerResponseMetadataSha256: string;
  costUsd: number;
  createdAt: number;
  route: "text-to-image" | "image-edit";
  resolution: "0.5K" | "1K" | "2K" | "4K";
  seed: number;
  referenceSha256: string[];
  width?: number;
  height?: number;
}

export interface FalNanoBanana2Result {
  bytes: Buffer;
  contentType: string;
  receipt: FalNanoBanana2Receipt;
}

export class FalNanoBananaSubmissionError extends Error {
  readonly retryable = false;
  readonly status?: number;
  readonly code = "FAL_NANO_BANANA_SUBMISSION_AMBIGUOUS";

  constructor(message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "FalNanoBananaSubmissionError";
    this.status = options.status;
  }
}

export class FalNanoBananaTransportError extends Error {
  readonly retryable = false;
  readonly observedCostUsd: number;
  readonly providerReceipt: { responseId: string; model: FalNanoBanana2Receipt["model"] };

  constructor(message: string, receipt: FalNanoBanana2Receipt) {
    super(message);
    this.name = "FalNanoBananaTransportError";
    this.observedCostUsd = receipt.costUsd;
    this.providerReceipt = { responseId: receipt.responseId, model: receipt.model };
  }
}

interface FalProviderImage {
  url?: unknown;
  content_type?: unknown;
  width?: unknown;
  height?: unknown;
}

interface FalProviderResponse {
  images?: FalProviderImage[];
  description?: unknown;
}

interface CachedFalNanoBananaResult {
  outputUrl: string;
  contentType: string;
  receipt: FalNanoBanana2Receipt;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function configuredUnitCost(): number {
  const raw = process.env.FAL_NANO_BANANA_2_COST_USD;
  const cost = raw === undefined ? NaN : Number(raw);
  if (!Number.isFinite(cost) || cost <= 0) {
    throw new Error(
      "FAL_NANO_BANANA_2_COST_USD must be a positive, operator-reviewed per-image USD rate before Nano Banana 2 rendering can run",
    );
  }
  return cost;
}

function deterministicSeed(value: string): number {
  return Number.parseInt(sha256(value).slice(0, 8), 16);
}

function positiveDimension(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function conciseProviderError(body: string): string {
  try {
    const parsed = JSON.parse(body) as { detail?: unknown; message?: unknown; error?: unknown };
    for (const value of [parsed.detail, parsed.message, parsed.error]) {
      if (typeof value === "string" && value.trim()) return value.replace(/\s+/g, " ").trim().slice(0, 800);
    }
  } catch {
    // The endpoint can return a proxy error body; preserve a bounded diagnostic.
  }
  return body.replace(/\s+/g, " ").trim().slice(0, 800) || "no provider diagnostic";
}

function dataUri(reference: FalNanoBanana2ReferenceImage): string {
  const contentType = reference.contentType?.trim() || "image/png";
  if (!/^image\/(?:png|jpeg|webp)$/i.test(contentType)) {
    throw new Error(`Nano Banana 2 reference must be a PNG, JPEG, or WebP image; received '${contentType}'`);
  }
  if (!reference.bytes.byteLength) throw new Error("Nano Banana 2 reference image is empty");
  return `data:${contentType};base64,${Buffer.from(reference.bytes).toString("base64")}`;
}

async function downloadOutput(cached: CachedFalNanoBananaResult): Promise<{ bytes: Buffer; contentType: string }> {
  let lastError = "unknown CDN transport error";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(cached.outputUrl, { signal: AbortSignal.timeout(60_000) });
      if (response.ok) {
        const bytes = Buffer.from(await response.arrayBuffer());
        if (!bytes.length) throw new Error("empty CDN image payload");
        const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() || cached.contentType;
        return { bytes, contentType };
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1) * (attempt + 1)));
  }
  throw new FalNanoBananaTransportError(
    `Nano Banana 2 generated successfully but its CDN asset could not be retrieved after 3 attempts (${lastError}); ` +
      "the paid provider receipt is cached and must be reused, not regenerated",
    cached.receipt,
  );
}

/**
 * Render one Visual Matter reference on fal.ai. Text-to-image uses Nano Banana
 * 2; when reference pixels are present, the request uses Nano Banana 2's
 * multi-image edit endpoint so character and setting sheets become real visual
 * continuity inputs for storyboard frames.
 */
export async function generateFalNanoBanana2Image(
  request: FalNanoBanana2Request,
): Promise<FalNanoBanana2Result> {
  const apiKey = process.env.FAL_KEY?.trim();
  if (!apiKey) throw new Error("FAL_KEY is required for fal.ai Nano Banana 2 Visual Matter renders");
  const costUsd = configuredUnitCost();
  const prompt = request.prompt.replace(/\s+/g, " ").trim();
  if (!prompt) throw new Error("Nano Banana 2 requires a non-empty Visual Matter prompt");

  const references = request.referenceImages?.slice(0, MAX_REFERENCE_IMAGES) ?? [];
  const route: FalNanoBanana2Receipt["route"] = references.length ? "image-edit" : "text-to-image";
  const model: FalNanoBanana2Receipt["model"] = references.length
    ? FAL_NANO_BANANA_2_EDIT_MODEL
    : FAL_NANO_BANANA_2_MODEL;
  const aspectRatio = request.aspectRatio ?? "3:2";
  const resolution = request.resolution ?? "1K";
  const outputFormat = request.outputFormat ?? "png";
  const safetyTolerance = request.safetyTolerance ?? "4";
  const seed = request.seed ?? deterministicSeed(`${request.idempotencyContext ?? ""}\0${prompt}`);
  const referenceSha256 = references.map((reference) => sha256(reference.bytes));
  const requestIdentity = {
    model,
    route,
    prompt,
    aspectRatio,
    resolution,
    outputFormat,
    safetyTolerance,
    seed,
    idempotencyContext: request.idempotencyContext ?? null,
    referenceSha256,
  };
  const requestCanonicalJson = canonicalJson(requestIdentity);
  const requestSha256 = sha256(requestCanonicalJson);
  const cacheKey = imageRequestCacheKey("fal", model, requestIdentity);

  let cached = getCachedImageResponse<CachedFalNanoBananaResult>(cacheKey);
  if (!cached) {
    const body: Record<string, unknown> = {
      prompt,
      num_images: 1,
      seed,
      aspect_ratio: aspectRatio,
      output_format: outputFormat,
      safety_tolerance: safetyTolerance,
      sync_mode: false,
      resolution,
      limit_generations: true,
      ...(references.length ? { image_urls: references.map(dataUri) } : {}),
    };
    let response: Response;
    try {
      response = await fetch(`${FAL_RUN_URL}/${model}`, {
        method: "POST",
        headers: {
          Authorization: `Key ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (error) {
      throw new FalNanoBananaSubmissionError(
        "Nano Banana 2 submission transport failed without a durable provider receipt; refusing automatic resubmission",
        { cause: error },
      );
    }
    const raw = await response.text();
    if (!response.ok) {
      throw new FalNanoBananaSubmissionError(
        `fal.ai ${model} rejected the Visual Matter request (${response.status}): ${conciseProviderError(raw)}`,
        { status: response.status },
      );
    }

    let parsed: FalProviderResponse;
    try {
      parsed = JSON.parse(raw) as FalProviderResponse;
    } catch (error) {
      throw new FalNanoBananaSubmissionError("Nano Banana 2 returned non-JSON success metadata", { cause: error });
    }
    const image = parsed.images?.[0];
    const outputUrl = typeof image?.url === "string" && image.url.trim() ? image.url : undefined;
    if (!outputUrl) {
      throw new FalNanoBananaSubmissionError("Nano Banana 2 returned no durable output URL");
    }
    const contentType = typeof image?.content_type === "string" && image.content_type.trim()
      ? image.content_type
      : `image/${outputFormat}`;
    const width = positiveDimension(image?.width);
    const height = positiveDimension(image?.height);
    const metadata = {
      model,
      route,
      requestId: response.headers.get("x-fal-request-id") ?? response.headers.get("x-request-id"),
      billableUnits: response.headers.get("x-fal-billable-units"),
      response: parsed,
    };
    const responseId = metadata.requestId ?? sha256(canonicalJson(metadata)).slice(0, 24);
    const receipt: FalNanoBanana2Receipt = {
      provider: "fal",
      model,
      responseId,
      requestSha256,
      responseSha256: "",
      providerResponseMetadataSha256: sha256(canonicalJson(metadata)),
      costUsd,
      createdAt: Date.now(),
      route,
      resolution,
      seed,
      referenceSha256,
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
    };
    cached = { outputUrl, contentType, receipt };
    cacheImageResponse(cacheKey, cached);
    recordImageUsage({
      provider: receipt.provider,
      model: receipt.model,
      route: receipt.route,
      images: 1,
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
      costUsd,
    });
  }

  const downloaded = await downloadOutput(cached);
  return {
    bytes: downloaded.bytes,
    contentType: downloaded.contentType,
    receipt: {
      ...cached.receipt,
      responseSha256: sha256(downloaded.bytes),
    },
  };
}
