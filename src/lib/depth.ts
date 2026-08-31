/**
 * Monocular DEPTH MAP — no local GPU, no heavy new dependency.
 *
 * Produces a grayscale depth map (same resolution as the input still) that the
 * parallax loop engine displaces to fake 2.5D camera motion. It submits only
 * fal.ai `imageutils/marigold-depth` (FAL_KEY), which produces clean diffusion
 * depth at input resolution. A failure degrades to the caller's already-safe
 * Ken-Burns route; it must never buy a second provider result after FAL has
 * accepted or may have accepted the request.
 *
 * Output: a local grayscale PNG/JPG path. Convention here: BRIGHTER = NEARER
 * (Marigold/DA-V2 inverse depth) — the parallax shader treats high values as
 * foreground (larger displacement). Flip in the caller if a model differs.
 */
import { writeFile } from "node:fs/promises";

type Logger = (msg: string) => void;

async function download(url: string, outPath: string): Promise<string> {
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`depth: download failed HTTP ${r.status}`);
  await writeFile(outPath, Buffer.from(await r.arrayBuffer()));
  return outPath;
}

/** fal.ai Marigold depth (sync). Returns the depth image URL. */
async function falMarigold(imageUrl: string, log: Logger): Promise<string> {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY not configured");
  const res = await fetch("https://fal.run/fal-ai/imageutils/marigold-depth", {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "content-type": "application/json" },
    // low steps/ensemble = fast; processing_res 0 = keep input resolution.
    body: JSON.stringify({ image_url: imageUrl, num_inference_steps: 4, ensemble_size: 3, processing_res: 0 }),
    signal: AbortSignal.timeout(120_000),
  });
  const j = (await res.json()) as { image?: { url?: string }; detail?: unknown; error?: unknown };
  if (!res.ok) throw new Error(`fal marigold HTTP ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
  const url = j?.image?.url;
  if (!url) throw new Error(`fal marigold: no image url (${JSON.stringify(j).slice(0, 200)})`);
  log("depth: via fal marigold-depth");
  return url;
}

export interface DepthResult {
  /** Local path to the grayscale depth map image. */
  path: string;
  /** Which provider produced it. */
  provider: "fal-marigold";
}

/**
 * Get a depth map for a publicly-fetchable image URL, saved to `outPath`.
 * Once the FAL POST starts, this never invokes another paid provider: a
 * response, parse, or download failure is ambiguous after submission and must
 * throw so the loop engine degrades to a non-parallax path, logged loudly.
 */
export async function getDepthMap(
  imageUrl: string,
  outPath: string,
  log: Logger = () => {},
): Promise<DepthResult> {
  const url = await falMarigold(imageUrl, log);
  return { path: await download(url, outPath), provider: "fal-marigold" };
}
