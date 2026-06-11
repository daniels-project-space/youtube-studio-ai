/**
 * fal.ai FLUX1.1 [pro] still-image generation. Used for thumbnail base art
 * (sharper, more cinematic, and more controllable than the higgsfield CLI path,
 * with no login session to expire). HTTP only — works identically locally and
 * inside the Trigger cloud task. Key: FAL_KEY (vault service "fal").
 *
 * Endpoint returns a hosted CDN url for the generated image.
 */

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
