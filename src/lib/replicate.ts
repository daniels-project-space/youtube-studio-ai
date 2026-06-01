/**
 * Replicate API wrapper.
 *
 *   REPLICATE_API_TOKEN — vault-hydrated; never hardcoded.
 *
 * Two uses:
 *   1. {@link upscaleLoopUnit} — the REAL upscaler (legacy `topaz.py`):
 *      Topaz `topazlabs/video-upscale` on the short ~30s LOOP UNIT only (never
 *      the full render). Bounds cost/time to ~$0.25 / ~1 min vs ~$40-75 / ~3h.
 *      Real-ESRGAN is blacklisted for video per the legacy policy.
 *   2. {@link upscaleImage} — Real-ESRGAN still upscaler (kept for thumbnails).
 *
 * Flow: optionally upload the input file to Replicate's file store, POST
 * /v1/predictions with a versioned model + input → poll until
 * `succeeded`/`failed` → return output URL(s).
 */
import { readFile, stat } from "node:fs/promises";

const REPLICATE_BASE = "https://api.replicate.com/v1";

export class ReplicateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplicateError";
  }
}

function token(): string {
  const t = process.env.REPLICATE_API_TOKEN;
  if (!t) throw new ReplicateError("REPLICATE_API_TOKEN is not configured");
  return t;
}

interface Prediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: unknown;
  error?: string;
  urls?: { get?: string };
}

async function api<T>(
  path: string,
  init?: RequestInit & { method?: string },
): Promise<T> {
  const res = await fetch(`${REPLICATE_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const json = (await res.json()) as T & { detail?: string };
  if (!res.ok) {
    throw new ReplicateError(
      `replicate ${path} -> HTTP ${res.status}: ${(json as { detail?: string }).detail ?? ""}`,
    );
  }
  return json as T;
}

/**
 * Real-ESRGAN image upscaler. Default version is the widely-used
 * nightmareai/real-esrgan model. Returns the upscaled image URL.
 */
const REAL_ESRGAN_VERSION =
  process.env.REPLICATE_REALESRGAN_VERSION ??
  "f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa";

async function runUpscale(
  scale: number,
  args: {
    imageUrl: string;
    faceEnhance?: boolean;
    pollIntervalMs?: number;
    timeoutMs?: number;
  },
): Promise<string> {
  const created = await api<Prediction>("/predictions", {
    method: "POST",
    body: JSON.stringify({
      version: REAL_ESRGAN_VERSION,
      input: {
        image: args.imageUrl,
        scale,
        face_enhance: args.faceEnhance ?? false,
      },
    }),
  });

  const deadline = Date.now() + (args.timeoutMs ?? 600_000);
  let pred = created;
  while (pred.status !== "succeeded" && pred.status !== "failed") {
    if (Date.now() > deadline) {
      throw new ReplicateError(`upscale timed out (prediction ${created.id})`);
    }
    await new Promise((r) => setTimeout(r, args.pollIntervalMs ?? 4000));
    pred = await api<Prediction>(`/predictions/${created.id}`);
  }
  if (pred.status === "failed") {
    throw new ReplicateError(`upscale failed: ${pred.error ?? "unknown"}`);
  }
  const out = pred.output;
  if (typeof out === "string") return out;
  if (Array.isArray(out) && typeof out[0] === "string") return out[0];
  throw new ReplicateError(
    `upscale produced no URL output: ${JSON.stringify(out).slice(0, 200)}`,
  );
}

/**
 * Real-ESRGAN image upscaler with OOM resilience. Replicate's shared GPUs OOM
 * on large inputs at high scale; we retry at progressively lower scale (and on
 * transient errors) before giving up. Returns the upscaled image URL.
 */
export async function upscaleImage(args: {
  imageUrl: string;
  scale?: number;
  faceEnhance?: boolean;
  pollIntervalMs?: number;
  timeoutMs?: number;
}): Promise<string> {
  // Descending scale ladder: a 2K still at x4/x3 OOMs; x2/x1.5 usually fits.
  const start = args.scale ?? 2;
  const ladder = Array.from(new Set([start, 2, 1.5, 1])).filter(
    (s) => s <= start && s >= 1,
  );
  let lastErr: unknown;
  for (const scale of ladder) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await runUpscale(scale, args);
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        // Only retry/step-down on OOM or transient infra errors.
        if (!/out of memory|cuda|capacity|timed out|5\d\d/i.test(msg)) {
          throw e;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  throw new ReplicateError(
    `upscale exhausted scale ladder: ${lastErr instanceof Error ? lastErr.message : lastErr}`,
  );
}

/* --------------------------- Flux text-to-image ------------------------- */

/**
 * Flux base-image generator for the claude_flux thumbnailer. Renders a
 * TEXT-FREE 16:9 base from a prompt (text is overlaid downstream by ffmpeg).
 *
 * Defaults to `black-forest-labs/flux-schnell` (fast/cheap). The slug is an
 * official model (no version pin needed — `/models/<owner>/<name>/predictions`
 * runs the latest official version). Returns the rendered image URL.
 */
const FLUX_MODEL =
  process.env.REPLICATE_FLUX_MODEL ?? "black-forest-labs/flux-schnell";

export async function generateFluxImage(args: {
  prompt: string;
  aspectRatio?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
}): Promise<string> {
  const created = await api<Prediction>(
    `/models/${FLUX_MODEL}/predictions`,
    {
      method: "POST",
      body: JSON.stringify({
        input: {
          prompt: args.prompt,
          aspect_ratio: args.aspectRatio ?? "16:9",
          output_format: "png",
          num_outputs: 1,
          disable_safety_checker: false,
        },
      }),
    },
  );

  const deadline = Date.now() + (args.timeoutMs ?? 300_000);
  let pred = created;
  while (pred.status !== "succeeded" && pred.status !== "failed") {
    if (Date.now() > deadline) {
      throw new ReplicateError("flux generation timed out");
    }
    await new Promise((r) => setTimeout(r, args.pollIntervalMs ?? 2000));
    pred = await api<Prediction>(`/predictions/${created.id}`);
  }
  if (pred.status === "failed") {
    throw new ReplicateError(`flux failed: ${pred.error ?? "unknown"}`);
  }
  const out = pred.output;
  if (typeof out === "string") return out;
  if (Array.isArray(out) && typeof out[0] === "string") return out[0];
  throw new ReplicateError(
    `flux produced no URL output: ${JSON.stringify(out).slice(0, 200)}`,
  );
}

/* -------------------------- Topaz video upscale ------------------------- */

/**
 * Pinned Topaz video-upscale model + version — ported VERBATIM from legacy
 * `strategies/upscale/topaz.py:22`. Do not bump without re-verifying params.
 */
export const TOPAZ_MODEL_VERSION =
  "topazlabs/video-upscale:f4dad23bbe2d0bf4736d2ea8c9156f1911d8eeb511c8d0bb390931e25caaef61";

/** Loop unit must fit a direct upload (legacy UPLOAD_SIZE_CAP_MB). */
const UPLOAD_SIZE_CAP_MB = 95;

const VALID_RESOLUTIONS = new Set(["720p", "1080p", "4k"]);

/**
 * Encode a local video file as a `data:video/mp4;base64,...` URI.
 *
 * Topaz `video-upscale` rejects bare Replicate `/v1/files` URLs with
 * "`source.container` is required" because that URL carries no file extension
 * for it to infer the container from. A data URI carries the MIME type
 * explicitly, so the container is unambiguous — and it matches the legacy
 * pattern (the python client base64-inlines small file inputs). The loop unit
 * is short (~10-30s) so this stays well within request limits.
 */
async function fileToDataUri(path: string): Promise<string> {
  const buf = await readFile(path);
  return `data:video/mp4;base64,${Buffer.from(buf).toString("base64")}`;
}

export interface UpscaleLoopUnitArgs {
  /** Local path to the short loop-unit mp4 (must be < ~95MB). */
  inputPath: string;
  /** 720p | 1080p | 4k (default 4k, legacy default). */
  targetResolution?: string;
  /** Output fps (15..60 per Topaz schema, default 30). */
  targetFps?: number;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

/**
 * Topaz upscale of the LOOP UNIT (faithful port of legacy `upscale_loop_unit`).
 * Validates the size cap + resolution + fps, uploads the unit, runs the pinned
 * Topaz model, and returns the upscaled video URL. Raises on any failure — the
 * caller (upscale block) decides whether to degrade to the native loop.
 */
export async function upscaleLoopUnit(
  args: UpscaleLoopUnitArgs,
): Promise<string> {
  const targetResolution = args.targetResolution ?? "4k";
  const targetFps = args.targetFps ?? 30;

  if (!VALID_RESOLUTIONS.has(targetResolution)) {
    throw new ReplicateError(
      `upscaleLoopUnit: invalid target_resolution '${targetResolution}' (allowed: 720p,1080p,4k)`,
    );
  }
  if (targetFps < 15 || targetFps > 60) {
    throw new ReplicateError(
      `upscaleLoopUnit: target_fps ${targetFps} out of range (15..60)`,
    );
  }
  const sizeMb = (await stat(args.inputPath)).size / (1024 * 1024);
  if (sizeMb > UPLOAD_SIZE_CAP_MB) {
    throw new ReplicateError(
      `upscaleLoopUnit: loop unit ${sizeMb.toFixed(1)}MB exceeds ${UPLOAD_SIZE_CAP_MB}MB upload cap`,
    );
  }

  const videoUrl = await fileToDataUri(args.inputPath);
  const [, version] = TOPAZ_MODEL_VERSION.split(":");
  const created = await api<Prediction>("/predictions", {
    method: "POST",
    body: JSON.stringify({
      version,
      input: {
        video: videoUrl,
        target_resolution: targetResolution,
        target_fps: targetFps,
      },
    }),
  });

  const deadline = Date.now() + (args.timeoutMs ?? 1_200_000);
  let pred = created;
  while (pred.status !== "succeeded" && pred.status !== "failed") {
    if (Date.now() > deadline) {
      throw new ReplicateError(`topaz upscale timed out (prediction ${created.id})`);
    }
    await new Promise((r) => setTimeout(r, args.pollIntervalMs ?? 5000));
    pred = await api<Prediction>(`/predictions/${created.id}`);
  }
  if (pred.status === "failed") {
    throw new ReplicateError(`topaz upscale failed: ${pred.error ?? "unknown"}`);
  }
  const out = pred.output;
  if (typeof out === "string") return out;
  if (Array.isArray(out) && typeof out[0] === "string") return out[0];
  if (out && typeof out === "object" && typeof (out as { url?: string }).url === "string") {
    return (out as { url: string }).url;
  }
  throw new ReplicateError(
    `topaz upscale produced no URL output: ${JSON.stringify(out).slice(0, 200)}`,
  );
}
