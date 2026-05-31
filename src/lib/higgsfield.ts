/**
 * Higgsfield CLI wrapper — VERIFIED live surface (2026-05-31, CLI v0.1.40).
 *
 * Command shape (verbatim from `higgsfield generate create --help`):
 *   higgsfield generate create <model> --prompt "..." [--param value]... --json --wait
 *   Media flags: --image | --start-image | --end-image | --video | --audio
 *   Media flags accept a UUID (upload id OR a prior job id) OR a local path.
 *   --wait blocks until the job finishes and prints result URL(s); with --json
 *   the full job JSON is printed to stdout.
 *
 * Lofi usage (08c spec):
 *   - keyframes: `flux_2` stills (~1.5 cr each) → returns a job id; the job id is
 *     passed DIRECTLY as --start-image/--end-image to Kling (no download/reupload).
 *   - loop_clips: `kling3_0` with BOTH --start-image and --end-image (~7.5 cr/clip);
 *     clip1(F1→F2) + clip2(F2→F1) = seamless A→B→A loop unit.
 *
 * Auth-expiry: output matching the session-expired signature throws a typed
 * {@link HiggsfieldSessionExpiredError} so callers can fire a Telegram alert.
 *
 * Live gate: real spawn only runs when HIGGSFIELD_LIVE=1 (set after a verified
 * `higgsfield auth login`); otherwise we throw rather than silently fake media.
 */
import { spawn } from "node:child_process";

export class HiggsfieldSessionExpiredError extends Error {
  constructor(
    message = "Higgsfield session expired — run `higgsfield auth login`",
  ) {
    super(message);
    this.name = "HiggsfieldSessionExpiredError";
  }
}

export class HiggsfieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HiggsfieldError";
  }
}

const SESSION_EXPIRED_RE =
  /session\s+expired|not\s+authenticated|please\s+log\s*in|unauthorized/i;

export interface HiggsfieldRunOptions {
  /** CLI binary path (default: `higgsfield`, overridable for tests). */
  bin?: string;
  /** Hard timeout in ms for a single CLI call (default 20m to match --wait). */
  timeoutMs?: number;
}

interface CliResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/** Promisified spawn capturing stdout/stderr with a timeout. */
function exec(
  bin: string,
  args: string[],
  timeoutMs = 1_200_000,
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new HiggsfieldError(`higgsfield timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new HiggsfieldError(`spawn failed: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}

/**
 * Low-level: run the higgsfield CLI with args and return parsed JSON stdout.
 * Always appends --json. Caller decides whether to add --wait. Traps the
 * session-expired signature on both exit code and text.
 */
export async function runCli(
  args: string[],
  opts: HiggsfieldRunOptions = {},
): Promise<unknown> {
  if (process.env.HIGGSFIELD_LIVE !== "1") {
    throw new HiggsfieldError(
      "higgsfield CLI not wired (set HIGGSFIELD_LIVE=1 after `higgsfield auth login`)",
    );
  }
  const bin = opts.bin ?? process.env.HIGGSFIELD_BIN ?? "higgsfield";
  const result = await exec(bin, [...args, "--json"], opts.timeoutMs);
  const combined = `${result.stdout}\n${result.stderr}`;
  if (SESSION_EXPIRED_RE.test(combined)) {
    throw new HiggsfieldSessionExpiredError();
  }
  if (result.code !== 0) {
    throw new HiggsfieldError(
      `higgsfield exited ${result.code}: ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
  return parseLastJson(result.stdout);
}

/** Parse the last top-level JSON object/array printed on stdout. */
function parseLastJson(stdout: string): unknown {
  const text = stdout.trim();
  try {
    return JSON.parse(text);
  } catch {
    const lastObj = text.lastIndexOf("{");
    const lastArr = text.lastIndexOf("[");
    const start = Math.max(lastObj, lastArr);
    if (start >= 0) {
      try {
        return JSON.parse(text.slice(start));
      } catch {
        /* fall through */
      }
    }
    throw new HiggsfieldError(
      `higgsfield returned non-JSON output: ${text.slice(0, 200)}`,
    );
  }
}

/** account status → { email, credits, subscription_plan_type }. */
export interface AccountStatus {
  email: string;
  credits: number;
  subscription_plan_type: string;
}

export async function accountStatus(
  opts?: HiggsfieldRunOptions,
): Promise<AccountStatus> {
  const out = (await runCli(
    ["account", "status"],
    opts,
  )) as Partial<AccountStatus>;
  return {
    email: out.email ?? "",
    credits: typeof out.credits === "number" ? out.credits : NaN,
    subscription_plan_type: out.subscription_plan_type ?? "",
  };
}

/**
 * Normalize a `generate create`/`get` response to a single job object. The CLI
 * returns a TOP-LEVEL ARRAY of jobs for `--wait` (verified: flux_2/kling3_0),
 * but some commands return a bare object — handle both. We pick the first job.
 */
function asJob(raw: unknown): Record<string, unknown> {
  if (Array.isArray(raw)) {
    if (raw.length === 0) {
      throw new HiggsfieldError("higgsfield returned an empty job array");
    }
    return raw[0] as Record<string, unknown>;
  }
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    // Some commands wrap under jobs/data arrays.
    const jobs = o.jobs as unknown;
    if (Array.isArray(jobs) && jobs.length > 0) {
      return jobs[0] as Record<string, unknown>;
    }
    return o;
  }
  throw new HiggsfieldError(
    `unexpected higgsfield response: ${JSON.stringify(raw).slice(0, 200)}`,
  );
}

/**
 * Extract a job id from a `generate create`/`generate get` JSON response. The
 * CLI returns the job set under varying keys depending on model; check the
 * common ones (`id`, `job_id`, `jobs[0].id`, `data.id`).
 */
function extractJobId(out: Record<string, unknown>): string {
  if (typeof out.id === "string") return out.id;
  if (typeof out.job_id === "string") return out.job_id;
  const jobs = out.jobs as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(jobs) && typeof jobs[0]?.id === "string") {
    return jobs[0].id as string;
  }
  const data = out.data as Record<string, unknown> | undefined;
  if (data && typeof data.id === "string") return data.id;
  throw new HiggsfieldError(
    `could not find job id in higgsfield response: ${JSON.stringify(out).slice(0, 200)}`,
  );
}

/**
 * Extract the first result asset URL from a finished job JSON. Higgsfield jobs
 * expose results under several shapes; check the known ones.
 */
function extractResultUrl(out: Record<string, unknown>): string | undefined {
  const tryUrl = (o: unknown): string | undefined => {
    if (!o || typeof o !== "object") return undefined;
    const r = o as Record<string, unknown>;
    for (const k of [
      "url",
      "result_url",
      "output_url",
      "video_url",
      "image_url",
    ]) {
      if (typeof r[k] === "string") return r[k] as string;
    }
    return undefined;
  };
  const direct = tryUrl(out);
  if (direct) return direct;
  for (const arrKey of ["results", "outputs", "assets", "jobs"]) {
    const arr = out[arrKey] as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(arr)) {
      for (const item of arr) {
        const u = tryUrl(item);
        if (u) return u;
        const nested = tryUrl(item.result) ?? tryUrl(item.output);
        if (nested) return nested;
      }
    }
  }
  return tryUrl(out.result) ?? tryUrl(out.output) ?? tryUrl(out.data);
}

export interface GenerateResult {
  /** Higgsfield job id (reusable downstream as a media flag value). */
  jobId: string;
  /** Result asset URL if --wait resolved it; undefined if still pending. */
  url?: string;
  /** Raw parsed JSON for callers that need more. */
  raw: Record<string, unknown>;
}

export interface KeyframeRequest {
  prompt: string;
  /** def 16:9 */
  aspectRatio?: string;
  /** 1k|2k def 2k */
  resolution?: string;
  /** def flux_2 */
  model?: string;
}

/**
 * Generate a still keyframe via `flux_2` (or override model). Blocks with
 * --wait and returns the job id + result URL.
 */
export async function generateKeyframe(
  req: KeyframeRequest,
  opts?: HiggsfieldRunOptions,
): Promise<GenerateResult> {
  const out = await runCli(
    [
      "generate",
      "create",
      req.model ?? "flux_2",
      "--prompt",
      req.prompt,
      "--aspect_ratio",
      req.aspectRatio ?? "16:9",
      "--resolution",
      req.resolution ?? "2k",
      "--wait",
      "--wait-timeout",
      "20m",
      "--wait-interval",
      "5s",
    ],
    opts,
  );
  const job = asJob(out);
  return { jobId: extractJobId(job), url: extractResultUrl(job), raw: job };
}

export interface ClipRequest {
  prompt: string;
  /** Start image: a higgsfield job id, upload id, or local path. */
  startImage: string;
  /** End image: a higgsfield job id, upload id, or local path. */
  endImage: string;
  /** Clip duration in seconds (def 5 — shortest for frugal M1). */
  durationSec?: number;
  /** def 16:9 */
  aspectRatio?: string;
  /** pro|std|4k — std is cheapest (def). */
  mode?: string;
  /** on|off — off for lofi (music added at assemble). */
  sound?: string;
  /** def kling3_0 (only model verified to take both start+end image). */
  model?: string;
}

/**
 * Generate a Kling clip between two keyframes (start+end-frame mode). Used to
 * build the seamless A→B→A lofi loop. Blocks with --wait, returns job id + URL.
 */
export async function generateClip(
  req: ClipRequest,
  opts?: HiggsfieldRunOptions,
): Promise<GenerateResult> {
  const out = await runCli(
    [
      "generate",
      "create",
      req.model ?? "kling3_0",
      "--prompt",
      req.prompt,
      "--start-image",
      req.startImage,
      "--end-image",
      req.endImage,
      "--duration",
      String(req.durationSec ?? 5),
      "--aspect_ratio",
      req.aspectRatio ?? "16:9",
      "--mode",
      req.mode ?? "std",
      "--sound",
      req.sound ?? "off",
      "--wait",
      "--wait-timeout",
      "20m",
      "--wait-interval",
      "5s",
    ],
    opts,
  );
  const job = asJob(out);
  return { jobId: extractJobId(job), url: extractResultUrl(job), raw: job };
}

/** Fetch a job's JSON (used to resolve a result URL after an async create). */
export async function getJob(
  jobId: string,
  opts?: HiggsfieldRunOptions,
): Promise<GenerateResult> {
  const out = await runCli(["generate", "get", jobId], opts);
  const job = asJob(out);
  return { jobId: extractJobId(job), url: extractResultUrl(job), raw: job };
}
