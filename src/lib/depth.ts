/**
 * Monocular DEPTH MAP — no local GPU, no heavy new dependency.
 *
 * Produces a grayscale depth map (same resolution as the input still) that the
 * parallax loop engine displaces to fake 2.5D camera motion. Routes, in order:
 *   1. fal.ai `imageutils/marigold-depth` (FAL_KEY) — stable named endpoint,
 *      clean diffusion depth at input resolution. PRIMARY.
 *   2. Replicate `depth-anything-v2` (REPLICATE_API_TOKEN) — cheap fallback.
 * Both are no-GPU-on-our-side and effectively free at lofi volumes. A truly $0
 * option (Transformers.js CPU ONNX) exists but adds a ~heavy dep + model
 * download; we prefer the already-wired hosted clients for reliability.
 *
 * Output: a local grayscale PNG/JPG path. Convention here: BRIGHTER = NEARER
 * (Marigold/DA-V2 inverse depth) — the parallax shader treats high values as
 * foreground (larger displacement). Flip in the caller if a model differs.
 */
import { writeFile } from "node:fs/promises";

type Logger = (msg: string) => void;

async function download(url: string, outPath: string): Promise<string> {
  const r = await fetch(url);
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
  });
  const j = (await res.json()) as { image?: { url?: string }; detail?: unknown; error?: unknown };
  if (!res.ok) throw new Error(`fal marigold HTTP ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
  const url = j?.image?.url;
  if (!url) throw new Error(`fal marigold: no image url (${JSON.stringify(j).slice(0, 200)})`);
  log("depth: via fal marigold-depth");
  return url;
}

/** Replicate Depth-Anything-V2 fallback. Returns the depth image URL. */
async function replicateDepthAnything(imageUrl: string, log: Logger): Promise<string> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN not configured");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const create = await fetch("https://api.replicate.com/v1/models/chenxwh/depth-anything-v2/predictions", {
    method: "POST",
    headers,
    body: JSON.stringify({ input: { image: imageUrl, encoder: "vits" } }), // vits = Apache-2.0 (commercial-safe)
  });
  const created = (await create.json()) as { id?: string; status?: string; output?: unknown; error?: string; detail?: string };
  if (!create.ok || !created.id) throw new Error(`replicate depth create HTTP ${create.status}: ${created.detail ?? ""}`);
  const deadline = Date.now() + 120_000;
  let pred = created;
  while (pred.status !== "succeeded" && pred.status !== "failed") {
    if (Date.now() > deadline) throw new Error("replicate depth timed out");
    await new Promise((r) => setTimeout(r, 2000));
    pred = (await (await fetch(`https://api.replicate.com/v1/predictions/${created.id}`, { headers })).json()) as typeof created;
  }
  if (pred.status === "failed") throw new Error(`replicate depth failed: ${pred.error ?? "unknown"}`);
  const out = pred.output;
  const url = typeof out === "string" ? out : Array.isArray(out) && typeof out[0] === "string" ? out[0] : undefined;
  if (!url) throw new Error(`replicate depth: no url output (${JSON.stringify(out).slice(0, 160)})`);
  log("depth: via replicate depth-anything-v2");
  return url;
}

export interface DepthResult {
  /** Local path to the grayscale depth map image. */
  path: string;
  /** Which provider produced it. */
  provider: "fal-marigold" | "replicate-depth-anything";
}

/**
 * Get a depth map for a publicly-fetchable image URL, saved to `outPath`.
 * Tries fal → Replicate. NO silent fallback to a flat/fake map: if both fail it
 * throws (the loop engine then degrades to a non-parallax path, logged loudly).
 */
export async function getDepthMap(
  imageUrl: string,
  outPath: string,
  log: Logger = () => {},
): Promise<DepthResult> {
  try {
    const url = await falMarigold(imageUrl, log);
    return { path: await download(url, outPath), provider: "fal-marigold" };
  } catch (e) {
    log(`depth: fal marigold failed (${e instanceof Error ? e.message : e}) — trying replicate`);
  }
  const url = await replicateDepthAnything(imageUrl, log);
  return { path: await download(url, outPath), provider: "replicate-depth-anything" };
}
