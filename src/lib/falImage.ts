/**
 * fal.ai FLUX1.1 [pro] still-image generation. Used for thumbnail base art
 * (sharper, more cinematic, and more controllable than the higgsfield CLI path,
 * with no login session to expire). HTTP only — works identically locally and
 * inside the Trigger cloud task. Key: FAL_KEY (vault service "fal").
 *
 * Two shapes:
 *   generateFalFluxProImage — the original url-returning thumbnail-base call
 *     (kept byte-for-byte for existing callers).
 *   generateFalImage        — the PROVIDER-ROUTER shape (bytes out, banana-
 *     compatible args) that banana.ts delegates to when the operator disables
 *     Google image gen (IMAGE_DISABLE_GEMINI=1 / IMAGE_PROVIDERS=fal,…).
 */
// NOTE: banana.ts ↔ falImage.ts import each other (banana delegates here; we
// reuse its NO_TEXT_CLAUSE so both providers enforce the SAME picture-only
// guard). Safe: both bindings are only dereferenced at call time, never during
// module evaluation.
import { NO_TEXT_CLAUSE } from "@/lib/banana";
import {
  FAL_FLUX_PRO_V11_MODEL,
  falDimensionsForAspect,
  falImageCostUsd,
  falImageRoute,
  falPresetForAspect,
  normalizeFalAspectRatio,
  selectedFalImageModel,
} from "@/lib/falImagePricing";
import {
  cacheImageResponse,
  getCachedImageResponse,
  imageRequestCacheKey,
  recordImageUsage,
  type ImageUsageRecord,
} from "@/lib/imageUsage";

const FAL_ENDPOINT = `https://fal.run/${FAL_FLUX_PRO_V11_MODEL}`;

interface FalProviderImage {
  url?: string;
  width?: number;
  height?: number;
}

interface FalPaidImageReceipt {
  url: string;
  usage: ImageUsageRecord;
}

export class FalImageTransportError extends Error {
  readonly retryable = false;
  readonly observedCostUsd: number;
  readonly providerReceipt: { url: string; model: string };

  constructor(message: string, receipt: FalPaidImageReceipt) {
    super(message);
    this.name = "FalImageTransportError";
    this.observedCostUsd = receipt.usage.costUsd;
    this.providerReceipt = { url: receipt.url, model: receipt.usage.model };
  }
}

/**
 * A paid Fal submission that did not produce a durable provider receipt.
 *
 * Without a provider idempotency key or status handle, a transport failure or
 * non-success response can be ambiguous: the provider may already have
 * accepted the generation. Mark it non-retryable so neither this adapter nor
 * the engine can silently purchase the same image again.
 */
export class FalImageSubmissionError extends Error {
  readonly retryable = false;
  readonly status?: number;
  readonly code = "FAL_IMAGE_SUBMISSION_AMBIGUOUS";

  constructor(message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "FalImageSubmissionError";
    this.status = options.status;
  }
}

function positiveDimension(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function accountFalImageResponse(
  model: string,
  images: FalProviderImage[],
  fallback: { width: number; height: number },
): ImageUsageRecord {
  const width = positiveDimension(images[0]?.width, fallback.width);
  const height = positiveDimension(images[0]?.height, fallback.height);
  const imageCount = Math.max(1, images.length);
  return recordImageUsage({
    provider: "fal",
    model,
    route: falImageRoute(model),
    images: imageCount,
    width,
    height,
    costUsd: falImageCostUsd({ model, width, height, images: imageCount }),
  });
}

export function hasFalKey(): boolean {
  return !!process.env.FAL_KEY;
}

export interface FalImageRequest {
  prompt: string;
  /** Output width in px (def 1344 — 16:9-ish, multiple of 16). */
  width?: number;
  /** Output height in px (def 768). */
  height?: number;
  /** 1..6, higher = fewer content rejections (def "5"). */
  safetyTolerance?: string;
}

/**
 * Generate one FLUX1.1 [pro] image and return its hosted url. Throws on a
 * missing key or a non-2xx response so callers can fall back to another model.
 */
export async function generateFalFluxProImage(req: FalImageRequest): Promise<string> {
  if (!hasFalKey()) throw new Error("FAL_KEY missing (vault service 'fal')");
  const width = req.width ?? 1344;
  const height = req.height ?? 768;
  const body = {
    prompt: req.prompt,
    image_size: { width, height },
    num_images: 1,
    output_format: "jpeg",
    safety_tolerance: req.safetyTolerance ?? "5",
  };
  const cacheKey = imageRequestCacheKey("fal", FAL_FLUX_PRO_V11_MODEL, body);
  const cached = getCachedImageResponse<FalPaidImageReceipt>(cacheKey);
  if (cached) return cached.url;
  const res = await fetch(FAL_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Key ${process.env.FAL_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`fal flux-pro ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const j = (await res.json()) as { images?: FalProviderImage[] };
  const url = j?.images?.[0]?.url;
  if (!url) throw new Error("fal flux-pro: no image url in response");
  const usage = accountFalImageResponse(
    FAL_FLUX_PRO_V11_MODEL,
    j.images ?? [],
    { width, height },
  );
  cacheImageResponse(cacheKey, { url, usage } satisfies FalPaidImageReceipt);
  return url;
}

/* ------------------------------------------------------------------ *
 * generateFalImage — the banana-compatible router target (bytes out).
 * ------------------------------------------------------------------ */

/** Stable FNV-1a 32-bit hash — deterministic seed from the prompt, so retried
 *  runs re-render the SAME image instead of paying for a random new one. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function downloadPaidFalImage(receipt: FalPaidImageReceipt): Promise<Buffer> {
  let lastError = "unknown CDN transport error";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const image = await fetch(receipt.url, {
        signal: AbortSignal.timeout(60_000),
      });
      if (image.ok) return Buffer.from(await image.arrayBuffer());
      lastError = `HTTP ${image.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < 2) await sleep(100 * (attempt + 1) * (attempt + 1));
  }
  throw new FalImageTransportError(
    `fal image generated successfully but CDN transport failed after 3 attempts (${lastError}); ` +
      "the paid provider receipt is cached and must be reused, not regenerated",
    receipt,
  );
}

/**
 * Generate one still on fal and return the image BYTES (banana contract).
 * Same arg shape as generateBananaImage so banana.ts can delegate 1:1:
 *   - no reference images → FLUX1.1 [pro] text→image
 *   - reference images    → FLUX Kontext img2img. LIMITATION: Kontext takes ONE
 *     image_url, so only the FIRST reference is used — multi-ref conditioning
 *     (e.g. a 3-view character sheet) degrades to single-ref on the fal route.
 *     References arrive as base64 and are passed as data: URIs (fal accepts them).
 *   - allowText false/undefined → banana's NO_TEXT_CLAUSE is appended, so the
 *     picture-only guard is identical across providers.
 * Retries 429/5xx twice (the groqVision backoff pattern); throws loud otherwise.
 */
export async function generateFalImage(req: {
  prompt: string;
  aspectRatio?: string;
  /** "1K" | "2K" | "4K" — accepted for banana signature parity; fal's named
   *  size presets pick the resolution, so this is a no-op on the fal route. */
  imageSize?: string;
  images?: { data: string; mimeType: string }[];
  allowText?: boolean;
  seed?: number;
  /** Cost tier (mirrors banana): "flash" uses the cheap model (default
   *  fal-ai/flux/schnell, env FAL_IMAGE_MODEL_FLASH) for simple picture-only
   *  assets (whiteboard line-art = 40+ images/video); "pro"/unset uses the
   *  quality model. i2i (references) always uses the kontext model. */
  tier?: "pro" | "flash";
  /** Maximum HTTP submissions after explicit 429 rejections. A 429 proves the
   * request was not admitted; every other response/transport failure stops
   * after one potentially-paid submission because Fal exposes no idempotency
   * key or accepted-job recovery handle on this endpoint. */
  maxProviderAttempts?: 1 | 2 | 3;
  /** Compatibility hook for the legacy process-global counter. Authoritative
   * billing is recorded in the runner's async-local image usage scope. */
  onUsage?: (usage: ImageUsageRecord) => void;
}): Promise<Buffer> {
  if (!hasFalKey()) throw new Error("FAL_KEY missing (vault service 'fal')");
  const prompt = req.allowText ? req.prompt : req.prompt + NO_TEXT_CLAUSE;
  const seed = req.seed ?? hash32(prompt);
  const aspect = normalizeFalAspectRatio(req.aspectRatio);
  const refs = req.images ?? [];
  const tier = req.tier ?? "pro";
  const model = selectedFalImageModel({ tier, hasReferences: refs.length > 0 });
  const route = falImageRoute(model);
  if (refs.length > 0 && route !== "kontext") {
    throw new Error(`Fal image-reference route requires Kontext, got "${model}"`);
  }
  if (refs.length === 0 && route === "kontext") {
    throw new Error(`Fal text-to-image route cannot use the Kontext edit endpoint "${model}"`);
  }

  const endpoint = `https://fal.run/${model}`;
  let body: Record<string, unknown>;
  if (refs.length > 0) {
    body = {
      prompt,
      // Kontext takes exactly one reference (see LIMITATION above).
      image_url: `data:${refs[0].mimeType};base64,${refs[0].data}`,
      aspect_ratio: aspect,
      seed,
      num_images: 1,
      output_format: "jpeg",
      // Kontext uses the Pro-family safety contract; omit the optional field
      // and retain Fal's documented default rather than sending Schnell keys.
    };
  } else {
    body = {
      prompt,
      image_size: falPresetForAspect(aspect),
      seed,
      num_images: 1,
      output_format: "jpeg",
      ...(route === "schnell"
        ? { enable_safety_checker: true }
        : { safety_tolerance: "5" }),
    };
  }

  let lastErr = "";
  const cacheKey = imageRequestCacheKey("fal", model, body);
  let receipt = getCachedImageResponse<FalPaidImageReceipt>(cacheKey);
  const maxProviderAttempts = Math.max(1, Math.min(3, req.maxProviderAttempts ?? 3));
  for (let attempt = 0; !receipt && attempt < maxProviderAttempts; attempt++) {
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Key ${process.env.FAL_KEY}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      throw new FalImageSubmissionError(
        "fal image submission transport failed without a durable receipt; refusing automatic resubmission",
        { cause: error },
      );
    }
    if (res.status === 429) {
      lastErr = `HTTP ${res.status}`;
      if (attempt + 1 < maxProviderAttempts) {
        await sleep(1500 * (attempt + 1) * (attempt + 1));
      }
      continue;
    }
    if (!res.ok) {
      throw new FalImageSubmissionError(
        `fal image ${endpoint.split("fal.run/")[1]} returned HTTP ${res.status} without a durable receipt; ` +
          `refusing automatic resubmission: ${(await res.text()).slice(0, 240)}`,
        { status: res.status },
      );
    }
    const j = (await res.json()) as { images?: FalProviderImage[] };
    const url = j?.images?.[0]?.url;
    if (!url) throw new Error("fal image: no image url in response");
    const usage = accountFalImageResponse(
      model,
      j.images ?? [],
      falDimensionsForAspect(aspect),
    );
    receipt = { url, usage };
    cacheImageResponse(cacheKey, receipt);
    req.onUsage?.(usage);
  }
  if (!receipt) {
    throw new FalImageSubmissionError(
      `fal image exhausted ${maxProviderAttempts} explicit pre-spend rate-limit rejection(s) (${lastErr})`,
      { status: 429 },
    );
  }
  return downloadPaidFalImage(receipt);
}
