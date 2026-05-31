/**
 * Higgsfield CLI wrapper (MASTER-PLAN §B/§D, build-plan P1).
 *
 * Wraps the `higgsfield` CLI (`--json --wait`) with a submit -> poll -> result
 * lifecycle. The actual CLI invocations are STUBBED here (the CLI requires a
 * live `higgsfield auth login` session that is a Daniel-action dependency), but
 * the real structure, error surface, and "Session expired" trap are in place so
 * Phase 2 only has to fill in the exec calls.
 *
 * Auth-expiry handling: any CLI output matching the session-expired signature
 * throws a typed {@link HiggsfieldSessionExpiredError} so callers (Trigger
 * tasks) can fire a Telegram alert + document re-auth, per decision A/risk reg.
 */
import { spawn } from "node:child_process";

export class HiggsfieldSessionExpiredError extends Error {
  constructor(message = "Higgsfield session expired — run `higgsfield auth login`") {
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

const SESSION_EXPIRED_RE = /session\s+expired|not\s+authenticated|please\s+log\s*in/i;

export interface HiggsfieldRunOptions {
  /** CLI binary path (default: `higgsfield`, overridable for tests). */
  bin?: string;
  /** Hard timeout in ms for a single CLI call. */
  timeoutMs?: number;
}

interface CliResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/**
 * Low-level: run the higgsfield CLI with args and return parsed stdout.
 * Traps the session-expired signature on BOTH the exit code and the text.
 * (Currently the real spawn path is gated behind HIGGSFIELD_LIVE=1; without it
 * the function throws a NotWired error so we never silently fake media.)
 */
async function runCli(
  args: string[],
  opts: HiggsfieldRunOptions = {},
): Promise<unknown> {
  if (process.env.HIGGSFIELD_LIVE !== "1") {
    throw new HiggsfieldError(
      "higgsfield CLI not wired (set HIGGSFIELD_LIVE=1 after `higgsfield auth login`) — P2 dependency",
    );
  }
  const bin = opts.bin ?? process.env.HIGGSFIELD_BIN ?? "higgsfield";
  const result = await exec(bin, [...args, "--json", "--wait"], opts.timeoutMs);

  const combined = `${result.stdout}\n${result.stderr}`;
  if (SESSION_EXPIRED_RE.test(combined)) {
    throw new HiggsfieldSessionExpiredError();
  }
  if (result.code !== 0) {
    throw new HiggsfieldError(
      `higgsfield exited ${result.code}: ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new HiggsfieldError(
      `higgsfield returned non-JSON output: ${result.stdout.slice(0, 200)}`,
    );
  }
}

/** Promisified child_process spawn capturing stdout/stderr with a timeout. */
function exec(
  bin: string,
  args: string[],
  timeoutMs = 600_000,
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
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new HiggsfieldError(`failed to spawn ${bin}: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}

export interface KeyframeRequest {
  prompt: string;
  model?: string; // e.g. nano-banana-2 | flux
  /** Where the result should be addressed in R2 (key, not bytes). */
  outKey: string;
}

export interface KeyframeResult {
  jobId: string;
  r2Key: string;
}

export interface ClipRequest {
  startFrameKey: string;
  endFrameKey: string;
  model?: string; // e.g. kling
  durationSec?: number;
  outKey: string;
}

export interface ClipResult {
  jobId: string;
  r2Key: string;
}

/**
 * Generate a still keyframe (Nano-Banana-2 / Flux). With `--wait` the CLI
 * blocks until the job resolves; we surface the resulting asset key.
 */
export async function generateKeyframe(
  req: KeyframeRequest,
  opts?: HiggsfieldRunOptions,
): Promise<KeyframeResult> {
  const out = (await runCli(
    [
      "generate",
      "image",
      "--prompt",
      req.prompt,
      "--model",
      req.model ?? "nano-banana-2",
      "--out",
      req.outKey,
    ],
    opts,
  )) as { id?: string; key?: string };
  return { jobId: out.id ?? "", r2Key: out.key ?? req.outKey };
}

/**
 * Generate a Kling clip between two keyframes (start+end-frame mode). Used to
 * build the seamless A->B->A lofi loop. Falls back to interpolation is a P2
 * wiring concern (risk register).
 */
export async function generateClip(
  req: ClipRequest,
  opts?: HiggsfieldRunOptions,
): Promise<ClipResult> {
  const out = (await runCli(
    [
      "generate",
      "video",
      "--model",
      req.model ?? "kling",
      "--start-frame",
      req.startFrameKey,
      "--end-frame",
      req.endFrameKey,
      "--duration",
      String(req.durationSec ?? 10),
      "--out",
      req.outKey,
    ],
    opts,
  )) as { id?: string; key?: string };
  return { jobId: out.id ?? "", r2Key: out.key ?? req.outKey };
}
