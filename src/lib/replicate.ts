/**
 * Replicate API wrapper — used for upscaling (Real-ESRGAN) since Higgsfield has
 * no image upscaler (08c spec). Generic enough to run any model version.
 *
 *   REPLICATE_API_TOKEN — vault-hydrated; never hardcoded.
 *
 * Flow: POST /v1/predictions with a versioned model + input → poll the
 * prediction until status `succeeded`/`failed` → return output URL(s).
 */
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
