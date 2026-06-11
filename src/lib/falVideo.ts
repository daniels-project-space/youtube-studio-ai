/**
 * fal.ai image-to-video (i2v) — the CLOUD replacement for the dead Higgsfield
 * CLI. Pure HTTP + FAL_KEY (vault service "fal"), so it runs identically locally
 * and inside the Trigger cloud task (no local binary, no auth session to expire).
 *
 * Uses fal's QUEUE API because i2v takes minutes:
 *   POST https://queue.fal.run/{model}                → { request_id, status_url, response_url }
 *   GET  {status_url}                                 → { status: IN_QUEUE|IN_PROGRESS|COMPLETED }
 *   GET  {response_url}                               → final payload { video: { url } }
 *
 * Default model = Kling i2v (the same engine the v1 lofi loops used), pinned via
 * FAL_I2V_MODEL so it can be swapped without a code change. Single start image:
 * we build the seamless LOOP from one forward clip (crossfade self-loop in
 * ffmpeg), so we never depend on rarer start+end-image models.
 */

const FAL_QUEUE_BASE = "https://queue.fal.run";

/** Pinned i2v model (override via env). Kling 1.6 standard = good motion/cost. */
export const FAL_I2V_MODEL =
  process.env.FAL_I2V_MODEL ?? "fal-ai/kling-video/v1.6/standard/image-to-video";

export class FalVideoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FalVideoError";
  }
}

function falKey(): string {
  const k = process.env.FAL_KEY;
  if (!k) throw new FalVideoError("FAL_KEY missing (vault service 'fal')");
  return k;
}

export interface FalI2VRequest {
  /** Motion/scene prompt (already constitution-composed by the caller). */
  prompt: string;
  /** Negative prompt (locked-camera STATIC_CAMERA_NEGATIVE). */
  negativePrompt?: string;
  /** Source still: a publicly fetchable URL (R2 public url or provider CDN). */
  imageUrl: string;
  /**
   * Optional END frame (FLF2V). Set this to the SAME url as `imageUrl` to make
   * the animated clip return to its start → a genuinely seamless loop with the
   * elements still moving (waves foaming, curtains billowing), with no boomerang
   * velocity-flip. Requires a Kling end-frame-capable model (`tail_image_url`).
   */
  tailImageUrl?: string;
  /** Clip length in seconds — Kling accepts 5 or 10 (def 5, frugal). */
  durationSec?: number;
  /** def 16:9 */
  aspectRatio?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface FalI2VResult {
  /** Remote URL of the generated mp4. */
  url: string;
  /** fal request id (for audit). */
  jobId: string;
  /** Resolved model id. */
  model: string;
}

interface QueueSubmit {
  request_id?: string;
  status_url?: string;
  response_url?: string;
  detail?: unknown;
}
interface QueueStatus {
  status?: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | string;
  detail?: unknown;
}

function extractVideoUrl(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const o = payload as Record<string, unknown>;
  const v = o.video as Record<string, unknown> | undefined;
  if (v && typeof v.url === "string") return v.url;
  // some models return { video_url } or { url } or { videos: [{url}] }
  if (typeof o.video_url === "string") return o.video_url;
  if (typeof o.url === "string") return o.url;
  const arr = o.videos as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(arr) && typeof arr[0]?.url === "string") return arr[0].url as string;
  return undefined;
}

/**
 * Generate ONE image-to-video clip on fal and poll the queue to completion.
 * Throws on any failure so the caller (loop_clips) can surface it loudly — no
 * silent fake media.
 */
export async function generateFalI2V(req: FalI2VRequest): Promise<FalI2VResult> {
  const model = FAL_I2V_MODEL;
  // Kling exposes duration as a string enum "5"|"10".
  const dur = (req.durationSec ?? 5) >= 8 ? "10" : "5";
  const body: Record<string, unknown> = {
    prompt: req.prompt,
    image_url: req.imageUrl,
    duration: dur,
    aspect_ratio: req.aspectRatio ?? "16:9",
  };
  if (req.negativePrompt) body.negative_prompt = req.negativePrompt;
  // FLF2V: end frame = start frame closes the loop seamlessly (Kling end-frame
  // models read `tail_image_url`). Models that ignore it just produce a normal
  // forward clip — so this is safe to always pass when requested.
  if (req.tailImageUrl) body.tail_image_url = req.tailImageUrl;

  const submitRes = await fetch(`${FAL_QUEUE_BASE}/${model}`, {
    method: "POST",
    headers: { Authorization: `Key ${falKey()}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const submit = (await submitRes.json().catch(() => ({}))) as QueueSubmit;
  if (!submitRes.ok || !submit.request_id) {
    throw new FalVideoError(
      `fal i2v submit failed: HTTP ${submitRes.status} ${JSON.stringify(submit).slice(0, 240)}`,
    );
  }
  const id = submit.request_id;
  const statusUrl = submit.status_url ?? `${FAL_QUEUE_BASE}/${model}/requests/${id}/status`;
  const responseUrl = submit.response_url ?? `${FAL_QUEUE_BASE}/${model}/requests/${id}`;

  const deadline = Date.now() + (req.timeoutMs ?? 1_200_000);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, req.pollIntervalMs ?? 6000));
    const sRes = await fetch(statusUrl, { headers: { Authorization: `Key ${falKey()}` } });
    const s = (await sRes.json().catch(() => ({}))) as QueueStatus;
    if (s.status === "COMPLETED") {
      const rRes = await fetch(responseUrl, { headers: { Authorization: `Key ${falKey()}` } });
      const payload = await rRes.json().catch(() => ({}));
      if (!rRes.ok) {
        throw new FalVideoError(`fal i2v result fetch failed: HTTP ${rRes.status} ${JSON.stringify(payload).slice(0, 240)}`);
      }
      const url = extractVideoUrl(payload);
      if (!url) throw new FalVideoError(`fal i2v completed but no video url: ${JSON.stringify(payload).slice(0, 240)}`);
      return { url, jobId: id, model };
    }
    if (s.status && /fail|error|cancel/i.test(s.status)) {
      throw new FalVideoError(`fal i2v failed: status=${s.status} ${JSON.stringify(s).slice(0, 200)}`);
    }
  }
  throw new FalVideoError(`fal i2v timed out (request ${id})`);
}
