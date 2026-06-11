/**
 * UNIFIED image-to-video with SUBSCRIPTION-FIRST routing:
 *
 *   1. Higgsfield (operator's subscription — monthly credits renew; burn these
 *      FIRST, they're already paid for).
 *   2. fal.ai (pay-per-clip) — only when Higgsfield credits are exhausted for
 *      the month (R2 marker, auto-resets on month rollover) or the request
 *      needs a capability Higgsfield's CLI doesn't expose (FLF2V end-frame
 *      loops keep the proven fal/Kling tail_image_url path).
 *
 * A credits/quota error from Higgsfield marks the month exhausted and falls
 * through to fal in the SAME call — callers never see the switch.
 */
import { join } from "node:path";
import { downloadTo, makeRunTempDir } from "@/lib/files";
import { generateFalI2V, type FalI2VRequest, type FalI2VResult } from "@/lib/falVideo";
import { putObject, getObjectBytes } from "@/lib/storage";

const QUOTA_KEY = "state/higgsfield_quota.json";
let quotaCache: { month: string; exhausted: boolean } | null = null;

function thisMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

async function higgsfieldExhausted(): Promise<boolean> {
  const month = thisMonth();
  if (quotaCache?.month === month) return quotaCache.exhausted;
  try {
    const raw = JSON.parse(Buffer.from(await getObjectBytes(QUOTA_KEY)).toString()) as { month?: string };
    quotaCache = { month, exhausted: raw.month === month };
  } catch {
    quotaCache = { month, exhausted: false };
  }
  return quotaCache.exhausted;
}

async function markExhausted(log: (m: string) => void): Promise<void> {
  quotaCache = { month: thisMonth(), exhausted: true };
  try {
    await putObject(QUOTA_KEY, Buffer.from(JSON.stringify({ month: thisMonth(), at: Date.now() })), {
      contentType: "application/json",
    });
  } catch { /* marker is best-effort; the in-process cache still holds */ }
  log(`i2v: Higgsfield monthly credits EXHAUSTED — fal.ai takes over until ${thisMonth()} rolls over`);
}

function isQuotaError(msg: string): boolean {
  return /credit|insufficient|quota|not enough|balance|payment required|subscription/i.test(msg);
}

export interface I2VRequest extends FalI2VRequest {
  log?: (m: string) => void;
  /** Scratch id for temp files (defaults to a time-free generic). */
  runId?: string;
}

export async function generateI2V(req: I2VRequest): Promise<FalI2VResult> {
  const log = req.log ?? (() => {});

  // Capability gate: FLF2V (end-frame) loops stay on the proven fal path.
  const flf2v = Boolean(req.tailImageUrl);
  const higgsReady = process.env.HIGGSFIELD_LIVE === "1";

  if (!flf2v && higgsReady && !(await higgsfieldExhausted())) {
    try {
      const { generateClip, runCli } = await import("@/lib/higgsfield");
      // CLI takes a local path/upload id — fetch the still locally.
      const tmp = await makeRunTempDir(req.runId ?? "i2v");
      const still = await downloadTo(req.imageUrl, join(tmp, `i2v_start_${Math.abs(hash(req.imageUrl))}.png`));
      // Plain forward i2v: start-image only (no end frame).
      const out = (await runCli([
        "generate", "create", req.model && !req.model.includes("/") ? req.model : "kling3_0",
        "--prompt", req.prompt,
        "--start-image", still,
        "--duration", String((req.durationSec ?? 5) >= 8 ? 10 : 5),
        "--aspect_ratio", req.aspectRatio ?? "16:9",
        "--mode", "std",
        "--sound", "off",
        "--wait", "--wait-timeout", "20m", "--wait-interval", "5s",
      ])) as Record<string, unknown>;
      const url = extractUrl(out);
      if (!url) throw new Error("higgsfield returned no result url");
      log(`i2v: Higgsfield (subscription) ✓`);
      void generateClip; // (end-frame variant available for future loop use)
      return { url, jobId: String(out["id"] ?? out["job_id"] ?? "higgsfield"), model: "higgsfield/kling" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isQuotaError(msg)) {
        await markExhausted(log);
      } else {
        log(`i2v: Higgsfield failed (${msg.slice(0, 140)}) — fal fallback for this clip`);
      }
    }
  }

  return generateFalI2V(req);
}

function extractUrl(job: Record<string, unknown>): string | undefined {
  for (const k of ["url", "result_url", "video_url", "output_url"]) {
    if (typeof job[k] === "string") return job[k] as string;
  }
  const results = job["results"] as Record<string, unknown> | undefined;
  if (results) {
    for (const v of Object.values(results)) {
      if (typeof v === "string" && v.startsWith("http")) return v;
      if (v && typeof v === "object" && typeof (v as Record<string, unknown>)["url"] === "string") {
        return (v as Record<string, unknown>)["url"] as string;
      }
    }
  }
  return undefined;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
