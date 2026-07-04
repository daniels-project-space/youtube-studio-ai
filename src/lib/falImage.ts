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

const FAL_ENDPOINT = "https://fal.run/fal-ai/flux-pro/v1.1";

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
  const res = await fetch(FAL_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Key ${process.env.FAL_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      prompt: req.prompt,
      image_size: { width: req.width ?? 1344, height: req.height ?? 768 },
      num_images: 1,
      output_format: "jpeg",
      safety_tolerance: req.safetyTolerance ?? "5",
    }),
  });
  if (!res.ok) {
    throw new Error(`fal flux-pro ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const j = (await res.json()) as { images?: { url?: string }[] };
  const url = j?.images?.[0]?.url;
  if (!url) throw new Error("fal flux-pro: no image url in response");
  return url;
}

/* ------------------------------------------------------------------ *
 * generateFalImage — the banana-compatible router target (bytes out).
 * ------------------------------------------------------------------ */

/** Text→image model (FLUX1.1 [pro] default); env FAL_IMAGE_MODEL overrides. */
function falImageModel(): string {
  return process.env.FAL_IMAGE_MODEL || "fal-ai/flux-pro/v1.1";
}
/** Image→image model for reference-conditioned renders (character sheets /
 *  style refs) — FLUX Kontext default; env FAL_IMAGE_I2I_MODEL overrides. */
function falImageI2iModel(): string {
  return process.env.FAL_IMAGE_I2I_MODEL || "fal-ai/flux-pro/kontext";
}

/** Banana aspectRatio → fal image_size preset (fal picks the pixel counts). */
const FAL_SIZE_OF: Record<string, string> = {
  "16:9": "landscape_16_9",
  "9:16": "portrait_16_9",
  "4:3": "landscape_4_3",
  "3:4": "portrait_4_3",
  "1:1": "square_hd",
};

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
}): Promise<Buffer> {
  if (!hasFalKey()) throw new Error("FAL_KEY missing (vault service 'fal')");
  const prompt = req.allowText ? req.prompt : req.prompt + NO_TEXT_CLAUSE;
  const seed = req.seed ?? hash32(prompt);
  const aspect = (req.aspectRatio ?? "16:9").trim();
  const refs = req.images ?? [];

  let endpoint: string;
  let body: Record<string, unknown>;
  if (refs.length > 0) {
    endpoint = `https://fal.run/${falImageI2iModel()}`;
    body = {
      prompt,
      // Kontext takes exactly one reference (see LIMITATION above).
      image_url: `data:${refs[0].mimeType};base64,${refs[0].data}`,
      aspect_ratio: aspect,
      seed,
      num_images: 1,
      output_format: "jpeg",
      // no safety_tolerance: Kontext caps it lower for image inputs (422 risk).
    };
  } else {
    const flashModel = process.env.FAL_IMAGE_MODEL_FLASH || "fal-ai/flux/schnell";
    endpoint = `https://fal.run/${req.tier === "flash" ? flashModel : falImageModel()}`;
    body = {
      prompt,
      image_size: FAL_SIZE_OF[aspect] ?? "landscape_16_9",
      seed,
      num_images: 1,
      output_format: "jpeg",
      safety_tolerance: "5",
    };
  }

  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Key ${process.env.FAL_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    if (res.status === 429 || res.status >= 500) {
      lastErr = `HTTP ${res.status}`;
      await sleep(1500 * (attempt + 1) * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`fal image ${endpoint.split("fal.run/")[1]} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = (await res.json()) as { images?: { url?: string }[] };
    const url = j?.images?.[0]?.url;
    if (!url) throw new Error("fal image: no image url in response");
    const img = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!img.ok) throw new Error(`fal image: CDN fetch ${img.status}`);
    return Buffer.from(await img.arrayBuffer());
  }
  throw new Error(`fal image exhausted retries (${lastErr})`);
}
