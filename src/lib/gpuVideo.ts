/**
 * gpuVideo — provider-abstracted GPU AI-video render module.
 *
 * One entry, `renderGpuVideo()`, that any workflow (incl. gen_footage, driven by
 * the DP planCoverage shot list) calls to get a clip. Swappable backends behind
 * one seam:
 *
 *   - "salad-ltx" (DEFAULT): ComfyUI + LTX on a Salad RTX 5090 serverless
 *                 container — cheapest true serverless 5090 (~$0.25/hr batch),
 *                 output → R2. The container gateway sits behind Cloudflare, so
 *                 calls carry a browser User-Agent + the Salad-Api-Key. Engine
 *                 (LTX / Wan, weights) is set by the container MANIFEST_JSON.
 *   - "fal-ltx"  (proven fallback): LTX-2 on fal's queue API — pay-per-second,
 *                 native audio, zero infra. Uses FAL_KEY.
 *
 * Result conforms to falVideo's `FalI2VResult` so it drops into the existing i2v
 * contract (gen_footage / timeline_assemble just work).
 *
 * CLOUDFLARE NOTE: the Salad container gateway 403s bare requests ("error code:
 * 1010"). Every gateway call MUST send a browser User-Agent — that is the fix
 * (verified: urllib → 403, browser UA → 200).
 */
import type { FalI2VResult } from "@/lib/falVideo";

/** Browser UA — Cloudflare bot-gate bypass for the Salad container gateway. */
const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export type GpuVideoProvider = "salad-ltx" | "fal-ltx";

export interface GpuVideoRequest {
  /** Motion/scene prompt (camera move + action). */
  prompt: string;
  /** Source still — a publicly fetchable URL (R2 public url / provider CDN / data URI). */
  imageUrl?: string;
  /** Clip length in seconds (LTX supports 6–20; snapped to the model's grid). */
  durationSec?: number;
  /** "1080p" (default) | "1440p" | "2160p". */
  resolution?: string;
  aspectRatio?: string;
  /** Generate native audio in the same pass (default true — the whole point). */
  audio?: boolean;
  negativePrompt?: string;
  /** Force a backend (else GPU_VIDEO_PROVIDER env, else "salad-ltx"). */
  provider?: GpuVideoProvider;
  /** Per-call model id override for the chosen provider. */
  model?: string;
  /** salad-ltx: override the ComfyUI workflow (full node graph). */
  workflow?: Record<string, unknown>;
  /** Deterministic seed (salad-ltx). */
  seed?: number;
  log?: (m: string) => void;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface GpuVideoResult extends FalI2VResult {
  /** Which backend produced the clip. */
  provider: GpuVideoProvider;
  /** True when the clip carries a model-generated audio track. */
  hasAudio: boolean;
  /** R2 object key when the clip was uploaded to R2 (salad-ltx → container s3). */
  r2Key?: string;
}

export class GpuVideoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GpuVideoError";
  }
}

/** Pick the backend: explicit → env → default (salad-ltx). Pure. */
export function selectProvider(req: GpuVideoRequest): GpuVideoProvider {
  const p = req.provider ?? (process.env.GPU_VIDEO_PROVIDER as GpuVideoProvider | undefined) ?? "salad-ltx";
  if (p !== "fal-ltx" && p !== "salad-ltx") throw new GpuVideoError(`unknown GPU_VIDEO_PROVIDER: ${p}`);
  return p;
}

/** Snap an arbitrary duration to LTX's supported grid (6–20, even seconds). */
export function ltxDuration(sec: number | undefined): number {
  const grid = [6, 8, 10, 12, 14, 16, 18, 20];
  const s = Math.round(sec ?? 6);
  return grid.reduce((best, g) => (Math.abs(g - s) < Math.abs(best - s) ? g : best), 6);
}

/** Build the fal LTX-2 image-to-video request body (native audio on by default). Pure. */
export function buildFalLtxBody(req: GpuVideoRequest): Record<string, unknown> {
  if (!req.imageUrl) throw new GpuVideoError("fal-ltx: imageUrl required (image-to-video)");
  const prompt = req.prompt.length > 2200 ? req.prompt.slice(0, 2200).replace(/\s+\S*$/, "") : req.prompt;
  return {
    image_url: req.imageUrl,
    prompt,
    duration: ltxDuration(req.durationSec),
    resolution: req.resolution ?? "1080p",
    fps: 25,
    generate_audio: req.audio !== false,
  };
}

/* --------------------------------- fal-ltx --------------------------------- */

const FAL_QUEUE_BASE = "https://queue.fal.run";
const FAL_LTX_MODEL = () => process.env.GPU_VIDEO_FAL_MODEL ?? "fal-ai/ltx-2/image-to-video/fast";

function falKey(): string {
  const k = process.env.FAL_KEY;
  if (!k) throw new GpuVideoError("FAL_KEY missing (vault service 'fal')");
  return k;
}

function extractVideoUrl(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const o = payload as Record<string, unknown>;
  const v = o.video as Record<string, unknown> | undefined;
  if (v && typeof v.url === "string") return v.url;
  if (typeof o.video_url === "string") return o.video_url;
  if (typeof o.url === "string") return o.url;
  const arr = o.videos as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(arr) && typeof arr[0]?.url === "string") return arr[0].url as string;
  return undefined;
}

async function renderFalLtx(req: GpuVideoRequest): Promise<GpuVideoResult> {
  const model = req.model || FAL_LTX_MODEL();
  const body = buildFalLtxBody(req);
  const log = req.log ?? (() => {});
  const submitRes = await fetch(`${FAL_QUEUE_BASE}/${model}`, {
    method: "POST",
    headers: { Authorization: `Key ${falKey()}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const submit = (await submitRes.json().catch(() => ({}))) as {
    request_id?: string; status_url?: string; response_url?: string;
  };
  if (!submitRes.ok || !submit.request_id) {
    throw new GpuVideoError(`fal-ltx submit failed: HTTP ${submitRes.status} ${JSON.stringify(submit).slice(0, 240)}`);
  }
  const id = submit.request_id;
  const statusUrl = submit.status_url ?? `${FAL_QUEUE_BASE}/${model}/requests/${id}/status`;
  const responseUrl = submit.response_url ?? `${FAL_QUEUE_BASE}/${model}/requests/${id}`;
  log(`gpuVideo[fal-ltx]: queued ${id} (${model})`);

  const deadline = Date.now() + (req.timeoutMs ?? 1_200_000);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, req.pollIntervalMs ?? 6000));
    const sRes = await fetch(statusUrl, { headers: { Authorization: `Key ${falKey()}` } });
    const s = (await sRes.json().catch(() => ({}))) as { status?: string };
    if (s.status === "COMPLETED") {
      const rRes = await fetch(responseUrl, { headers: { Authorization: `Key ${falKey()}` } });
      const payload = await rRes.json().catch(() => ({}));
      if (!rRes.ok) throw new GpuVideoError(`fal-ltx result HTTP ${rRes.status} ${JSON.stringify(payload).slice(0, 240)}`);
      const url = extractVideoUrl(payload);
      if (!url) throw new GpuVideoError(`fal-ltx completed but no video url: ${JSON.stringify(payload).slice(0, 240)}`);
      return { url, jobId: id, model, provider: "fal-ltx", hasAudio: req.audio !== false };
    }
    if (s.status && /fail|error|cancel/i.test(s.status)) {
      throw new GpuVideoError(`fal-ltx failed: status=${s.status}`);
    }
  }
  throw new GpuVideoError(`fal-ltx timed out (request ${id})`);
}

/* ------------------------------- salad-ltx --------------------------------- */

function saladKey(): string {
  const k = process.env.SALAD_API_KEY;
  if (!k) throw new GpuVideoError("SALAD_API_KEY missing (vault service 'salad')");
  return k;
}
function saladGateway(): string {
  const g = process.env.SALAD_LTX_GATEWAY;
  if (!g) throw new GpuVideoError("SALAD_LTX_GATEWAY missing — deploy the Salad ComfyUI+LTX container (vault 'salad')");
  return g.replace(/\/+$/, "");
}

/**
 * ComfyUI workflow for the Salad container. image-to-video when imageUrl is set,
 * else text-to-video. The concrete node graph depends on the engine baked into
 * the container's MANIFEST_JSON (LTX 0.9.1 vs LTX-2 vs Wan) and their node
 * names differ, so this is FULLY overridable via req.workflow /
 * SALAD_LTX_WORKFLOW_JSON — the smoke verifies node names against the live
 * container's /object_info and pins the correct graph there.
 */
export function buildLtxWorkflow(req: GpuVideoRequest): Record<string, unknown> {
  if (req.workflow) return req.workflow;
  if (process.env.SALAD_LTX_WORKFLOW_JSON) return JSON.parse(process.env.SALAD_LTX_WORKFLOW_JSON) as Record<string, unknown>;
  const frames = ltxDuration(req.durationSec) * 24 + 1;
  const [w, h] = req.resolution === "720p" ? [1280, 720] : [768, 512];
  const neg = req.negativePrompt ?? "low quality, worst quality, deformed, distorted, motion smear, motion artifacts, bad anatomy, ugly";
  const ckpt = process.env.SALAD_LTX_CKPT ?? "ltx-video-2b-v0.9.1.safetensors";
  const clip = process.env.SALAD_LTX_CLIP ?? "t5xxl_fp16.safetensors";
  const wf: Record<string, unknown> = {
    "44": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: ckpt } },
    "38": { class_type: "CLIPLoader", inputs: { clip_name: clip, type: "ltxv", device: "default" } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: req.prompt, clip: ["38", 0] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: neg, clip: ["38", 0] } },
    "69": { class_type: "LTXVConditioning", inputs: { frame_rate: 24, positive: ["6", 0], negative: ["7", 0] } },
  };
  if (req.imageUrl) {
    wf["10"] = { class_type: "LoadImage", inputs: { image: req.imageUrl } };
    wf["70"] = { class_type: "LTXVImgToVideo", inputs: { vae: ["44", 2], image: ["10", 0], width: w, height: h, length: frames, batch_size: 1, positive: ["69", 0], negative: ["69", 1] } };
  } else {
    wf["70"] = { class_type: "EmptyLTXVLatentVideo", inputs: { width: w, height: h, length: frames, batch_size: 1 } };
  }
  const latent = req.imageUrl ? ["70", 2] : ["70", 0];
  const cPos = req.imageUrl ? ["70", 0] : ["69", 0];
  const cNeg = req.imageUrl ? ["70", 1] : ["69", 1];
  wf["73"] = { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } };
  wf["71"] = { class_type: "LTXVScheduler", inputs: { steps: 30, max_shift: 2.05, base_shift: 0.95, stretch: true, terminal: 0.1, latent } };
  wf["72"] = { class_type: "SamplerCustom", inputs: { model: ["44", 0], add_noise: true, noise_seed: req.seed ?? 12345, cfg: 3.0, positive: cPos, negative: cNeg, sampler: ["73", 0], sigmas: ["71", 0], latent_image: latent } };
  wf["8"] = { class_type: "VAEDecode", inputs: { samples: ["72", 0], vae: ["44", 2] } };
  wf["74"] = { class_type: "VHS_VideoCombine", inputs: { images: ["8", 0], frame_rate: 24, format: "video/h264-mp4", filename_prefix: "ltx", save_output: true } };
  return wf;
}

/** Fetch an image URL → base64 data URI. comfyui-api's URL→input staging is broken
 *  on the LTX-2.3 build (points LoadImage at an input/ path where nothing is saved),
 *  so we must inline the image as base64. */
async function fetchDataUri(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;
  const r = await fetch(url);
  if (!r.ok) throw new GpuVideoError(`salad-ltx: image fetch HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const ct = r.headers.get("content-type") || (/\.png(\?|$)/i.test(url) ? "image/png" : "image/jpeg");
  return `data:${ct};base64,${buf.toString("base64")}`;
}

/** Inject this call's image (base64) + prompts into a pinned LTX-2.3 ComfyUI template.
 *  Positive/negative CLIPTextEncode are resolved via the LTXVConditioning node's links. */
function injectTemplate(
  wf: Record<string, any>,
  o: { image?: string; prompt: string; negative?: string },
): Record<string, unknown> {
  let posId: string | undefined, negId: string | undefined;
  for (const n of Object.values(wf)) {
    if (n?.class_type === "LTXVConditioning") {
      posId = n.inputs?.positive?.[0];
      negId = n.inputs?.negative?.[0];
    }
  }
  for (const [id, n] of Object.entries(wf)) {
    if (n?.class_type === "LoadImage" && o.image) n.inputs.image = o.image;
    if (n?.class_type === "CLIPTextEncode") {
      if (id === posId) n.inputs.text = o.prompt;
      else if (id === negId && o.negative != null) n.inputs.text = o.negative;
    }
  }
  return wf as Record<string, unknown>;
}

async function renderSaladLtx(req: GpuVideoRequest): Promise<GpuVideoResult> {
  const log = req.log ?? (() => {});
  const gw = saladGateway();
  const bucket = process.env.SALAD_R2_BUCKET;
  const prefix = process.env.SALAD_R2_PREFIX ?? "ltx/";
  if (!bucket) throw new GpuVideoError("SALAD_R2_BUCKET missing — salad-ltx returns clips via R2");

  // Prefer the pinned LTX-2.3 template (SALAD_LTX_WORKFLOW_JSON) and inject this call's
  // image+prompt; fall back to the legacy 0.9.1 builder only when no template is pinned.
  const tmplRaw = req.workflow ?? (process.env.SALAD_LTX_WORKFLOW_JSON ? JSON.parse(process.env.SALAD_LTX_WORKFLOW_JSON) : undefined);
  let workflow: Record<string, unknown>;
  if (tmplRaw) {
    const image = req.imageUrl ? await fetchDataUri(req.imageUrl) : undefined;
    workflow = injectTemplate(JSON.parse(JSON.stringify(tmplRaw)), { image, prompt: req.prompt, negative: req.negativePrompt });
  } else {
    workflow = buildLtxWorkflow(req);
  }

  const headers = { "Salad-Api-Key": saladKey(), "content-type": "application/json", "User-Agent": BROWSER_UA };
  // ASYNC submit: the Salad gateway hard-caps ~100s (Cloudflare) but 22B renders take
  // minutes; comfyui-api uploads the clip to R2 and we poll listObjects() for it.
  const body = { prompt: workflow, s3: { bucket, prefix, async: true } };
  const { listObjects, presignDownload } = await import("@/lib/storage");
  const before = new Set(await listObjects(prefix, bucket).catch(() => [] as string[]));
  const res = await fetch(`${gw}/prompt`, { method: "POST", headers, body: JSON.stringify(body) });
  const submit = (await res.json().catch(() => ({}))) as { id?: string };
  if (!res.ok && res.status !== 202) throw new GpuVideoError(`salad-ltx /prompt HTTP ${res.status}: ${JSON.stringify(submit).slice(0, 260)}`);
  log(`gpuVideo[salad-ltx]: queued ${submit.id ?? "?"} — polling R2 ${prefix}`);

  const deadline = Date.now() + (req.timeoutMs ?? 900_000);
  let r2Key: string | undefined;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, req.pollIntervalMs ?? 6000));
    const keys = await listObjects(prefix, bucket).catch(() => [] as string[]);
    const fresh = keys.filter((k) => !before.has(k) && /\.(mp4|webm|mov)$/i.test(k) && (!submit.id || k.includes(submit.id)));
    if (fresh.length) { r2Key = fresh.sort().reverse()[0]; break; }
  }
  if (!r2Key) throw new GpuVideoError(`salad-ltx timed out waiting for clip in R2 ${prefix} (job ${submit.id ?? "?"})`);

  let url = `s3://${bucket}/${r2Key}`;
  try { url = await presignDownload(r2Key, { expiresIn: 7 * 24 * 3600 }); } catch { /* keep s3:// */ }
  log(`gpuVideo[salad-ltx]: ✓ → r2:${r2Key}`);
  return {
    url,
    r2Key,
    jobId: String(submit.id ?? "salad"),
    model: process.env.SALAD_LTX_CKPT ?? "ltx-2.3-22b",
    provider: "salad-ltx",
    hasAudio: false, // video-only recipe (loreshort adds narration/music in ffmpeg)
  };
}

/* --------------------------------- entry ----------------------------------- */

/** Render ONE GPU video clip on the selected backend. */
export async function renderGpuVideo(req: GpuVideoRequest): Promise<GpuVideoResult> {
  const provider = selectProvider(req);
  if (provider === "salad-ltx") return renderSaladLtx(req);
  return renderFalLtx(req);
}
