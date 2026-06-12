/**
 * Ideogram 3.0 thumbnailer — text-first YouTube thumbnails (~95% text accuracy,
 * far better than Flux for big overlaid headlines). Preferred thumbnail path;
 * Flux/claude_flux remains the fallback. Port of v1's ideogram strategy.
 *
 * Key: IDEOGRAM_API_KEY (vault service "ideogram"). Absent → returns null so the
 * caller falls through to claude_flux (degrade gracefully).
 */
const IDEOGRAM_URL = "https://api.ideogram.ai/generate";

export function hasIdeogramKey(): boolean {
  return Boolean(process.env.IDEOGRAM_API_KEY);
}

/** Build a text-first prompt Ideogram renders well (exact text, bold, dominant). */
function buildPrompt(title: string, niche?: string, subtitle?: string): string {
  const short = title.split(/ [—-] /)[0].toUpperCase().slice(0, 40);
  const bg = niche
    ? `dramatic cinematic background evoking ${niche}, high contrast`
    : "dramatic cinematic background, high contrast";
  const parts = [
    `A YouTube thumbnail, 16:9, ${bg}.`,
    `Large bold text reading exactly "${short}" in thick Impact-style font, centered, white fill with strong black outline and drop shadow.`,
    "The text is the dominant element — at least 40% of the frame.",
  ];
  if (subtitle) {
    parts.push(`Smaller subtitle text reading exactly "${subtitle}" below the title, thin white font.`);
  }
  parts.push(
    "High contrast, vibrant saturated colors, dramatic lighting, no watermarks, professional YouTube thumbnail quality.",
  );
  return parts.join(" ");
}

/** Generate a thumbnail via Ideogram. Returns the image URL or null on any failure. */
/** Raw-prompt Ideogram render (the caller owns the full typography prompt). */
export async function generateIdeogramRaw(args: {
  prompt: string;
  model?: string;
  timeoutMs?: number;
}): Promise<string | null> {
  const key = process.env.IDEOGRAM_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(IDEOGRAM_URL, {
      method: "POST",
      headers: { "Api-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        image_request: {
          prompt: args.prompt,
          aspect_ratio: "ASPECT_16_9",
          model: args.model ?? "V_3",
          magic_prompt_option: "OFF",
        },
      }),
      signal: AbortSignal.timeout(args.timeoutMs ?? 120_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: { url?: string }[] };
    return data.data?.[0]?.url ?? null;
  } catch {
    return null;
  }
}

export async function generateIdeogramThumbnail(args: {
  title: string;
  niche?: string;
  subtitle?: string;
  model?: string;
  timeoutMs?: number;
}): Promise<string | null> {
  const key = process.env.IDEOGRAM_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(IDEOGRAM_URL, {
      method: "POST",
      headers: { "Api-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        image_request: {
          prompt: buildPrompt(args.title, args.niche, args.subtitle),
          aspect_ratio: "ASPECT_16_9",
          model: args.model ?? "V_3",
          magic_prompt_option: "OFF",
        },
      }),
      signal: AbortSignal.timeout(args.timeoutMs ?? 120_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: { url?: string }[] };
    return data.data?.[0]?.url ?? null;
  } catch {
    return null;
  }
}
