/**
 * Music generation — Mureka + Suno. Both produce instrumental tracks; the
 * assemble block loops/mixes them under the video.
 *
 *   MUREKA_API_KEY — vault-hydrated
 *   SUNO_API_KEY   — vault-hydrated
 *
 * Mureka contract (verified live 2026-05-31):
 *   POST https://api.mureka.ai/v1/instrumental/generate
 *        body { model, prompt }  -> { id, status }
 *   GET  https://api.mureka.ai/v1/instrumental/query/{id}
 *        -> { status, choices: [{ url|flac_url|... }] }  (status: preparing|running|succeeded|failed)
 *
 * Suno contract (sunoapi.org):
 *   POST /api/v1/generate -> { data: { taskId } }
 *   GET  /api/v1/generate/record-info?taskId=... -> sunoData[{ id, audioUrl, streamAudioUrl, duration }]
 *   POST /api/v1/wav/generate { taskId, audioId } -> { data: { taskId } }   (lossless WAV upgrade)
 *   GET  /api/v1/wav/record-info?taskId=...       -> { ... audioWavUrl ... }
 *
 * QUALITY DEFAULTS (2026-06-10): model V5 (crystal-clear, no V4 haze) in
 * customMode with the full style prompt (1000 chars vs the 480-char non-custom
 * cap), and a best-effort lossless WAV download per clip (falls back to the
 * mp3 audioUrl). One generation returns up to TWO clips — callers wanting a
 * multi-track mix should use them both before paying for another generation.
 *
 * selfLoopAudio() is the final polish pass for any bed that later loops via
 * `-stream_loop`: it folds the track's tail into its head with one crossfade
 * so end==start and every loop splice is seamless.
 */
import { execFile } from "node:child_process";
import { stat, unlink } from "node:fs/promises";
import { promisify } from "node:util";

import { hasQualifiedMiniMaxMusic3 } from "@/lib/minimaxMusic3";

const execFileP = promisify(execFile);

export class MusicError extends Error {
  readonly retryable = false;
  readonly status?: number;
  /** True only when the provider explicitly rejected the create before work. */
  readonly safeToFallback: boolean;
  /** Confirmed accepted generation jobs represented by this failure. */
  readonly acceptedUnits: number;
  readonly acceptedJobId?: string;

  constructor(
    message: string,
    options: {
      status?: number;
      safeToFallback?: boolean;
      acceptedUnits?: number;
      acceptedJobId?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "MusicError";
    this.status = options.status;
    this.safeToFallback = options.safeToFallback === true;
    this.acceptedUnits = Math.max(0, Math.floor(options.acceptedUnits ?? 0));
    this.acceptedJobId = options.acceptedJobId;
  }
}

/** Preserve confirmed generation spend when later work fails. */
export function withMusicGenerationCost(
  error: unknown,
  completedUnits: number,
  unitCostUsd: number,
): Error {
  const failure = error instanceof Error ? error : new Error(String(error));
  const acceptedOnFailure = error instanceof MusicError ? error.acceptedUnits : 0;
  const attestedObservedCost = typeof (error as { observedCostUsd?: unknown } | null)?.observedCostUsd === "number"
    ? Math.max(0, Number((error as { observedCostUsd: number }).observedCostUsd))
    : 0;
  const totalUnits = Math.max(0, Math.floor(completedUnits)) + acceptedOnFailure;
  Object.assign(failure, {
    retryable: false,
    additionalObservedCostUsd: totalUnits * Math.max(0, unitCostUsd) + attestedObservedCost,
  });
  return failure;
}

export type MusicProvider = "mureka" | "suno" | "minimax_music3";

/* --------------------- seamless self-loop (tail→head fold) --------------------- */

const FFMPEG_BIN = () => process.env.FFMPEG_BIN ?? "ffmpeg";
const FFPROBE_BIN = () => process.env.FFPROBE_BIN ?? "ffprobe";

const MP3_ENCODE_ARGS = ["-c:a", "libmp3lame", "-b:a", "320k", "-ar", "44100"];

/**
 * Exact duration of a PCM WAV, straight from its header (data-chunk bytes /
 * byte rate). Unlike the compressed case below, there is nothing to estimate.
 */
async function pcmWavDurationSec(path: string): Promise<number> {
  const { stdout } = await execFileP(FFPROBE_BIN(), [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "csv=p=0",
    path,
  ]);
  return Number(String(stdout).trim());
}

/**
 * DECODE-ACCURATE duration in seconds, for COMPRESSED files.
 *
 * `ffprobe -show_entries format=duration` is only a BITRATE ESTIMATE for MP3s
 * that carry no Xing/VBR header — which is every Suno-provider mp3. ffmpeg even
 * says so ("Estimating duration from bitrate, this may be inaccurate"). Measured
 * error on a real Suno track: 101.38s reported vs 111.00s actual (~9.5% short);
 * on a synthetic VBR-without-header file: 168.70s reported vs 111.00s actual
 * (+52% long). Any timestamp math built on that number is silently wrong.
 *
 * Decoding the whole stream to the null muxer and reading the final progress
 * timestamp is exact, and runs at ~100x realtime for audio (a 2-minute bed
 * measures in about a second). Returns 0 when ffmpeg emitted no timestamp.
 */
async function decodeAccurateDurationSec(path: string): Promise<number> {
  const { stdout } = await execFileP(
    FFMPEG_BIN(),
    [
      "-v", "error",
      // One progress block every 5s of wall time keeps stdout tiny; ffmpeg
      // always emits a final block when the stream ends, which is the one we use.
      "-stats_period", "5",
      "-i", path,
      "-f", "null", "-",
      "-progress", "pipe:1",
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  let seconds = 0;
  for (const m of String(stdout).matchAll(/^out_time_us=(\d+)$/gm)) {
    const us = Number(m[1]);
    if (Number.isFinite(us)) seconds = Math.max(seconds, us / 1_000_000);
  }
  return seconds;
}

/**
 * Make a music mix SELF-LOOPING: fold the tail into the head with ONE
 * triangular acrossfade, then trim, so the file's end flows seamlessly into its
 * start. Every consumer loops beds with `-stream_loop -1`, which is a HARD
 * splice at each loop point — an audible pop/jump every N minutes for hours.
 *
 * Mechanics (loop-continuity proof): with fade F and tail T = F + 0.5,
 *   main = A[0 .. D-T],  tail = A[D-T .. D],  out = acrossfade(tail, main).
 * `out` ends exactly where `tail` begins (A[D-T]), so on loop the pure 0.5s
 * tail lead-in continues the waveform sample-perfectly, then fades into the
 * head. Output is D - F seconds.
 *
 * THE TWO SEGMENTS MUST BE SEPARATE FILES, and it must stay that way. The
 * single-graph form of this — feeding `acrossfade` from two `atrim` branches of
 * the SAME decoded input — DEADLOCKS:
 * acrossfade has to drain its first input to EOF before it can emit anything,
 * which requires decoding the whole file, while the second branch must
 * simultaneously buffer the earlier portion. The graph starves and ffmpeg
 * writes a ~1KB header-only mp3 with ZERO audio frames — and still EXITS 0, so
 * nothing downstream noticed. (`asplit=2` does not fix it.) The two segments are
 * therefore extracted to separate temp files first, so acrossfade reads two
 * genuinely independent inputs. Temps are lossless WAV: the fold then costs one
 * mp3 generation, not three, and segment edges land on exact sample boundaries
 * instead of mp3 frame boundaries.
 *
 * Throws MusicError on ffmpeg/ffprobe failure, a corrupt result, or a source
 * too short to prove as a loop. A caller that later uses `-stream_loop` must
 * never receive the original bed as a "best effort" fallback: that would turn
 * an unproven seam into a repeated hard splice.
 */
export async function selfLoopAudio(
  inPath: string,
  outPath: string,
  opts?: { crossfadeSec?: number; log?: (msg: string) => void },
): Promise<string> {
  const fade = Math.min(4, Math.max(0.5, opts?.crossfadeSec ?? 2));
  const tmpFull = `${outPath}.selfloop-src.tmp.wav`;
  const tmpMain = `${outPath}.selfloop-main.tmp.wav`;
  const tmpTail = `${outPath}.selfloop-tail.tmp.wav`;
  let durationSec = 0;
  try {
    // PASS 0 — decode the source ONCE, losslessly. One cheap pass buys three
    // things: an EXACT duration (WAV header, not a bitrate guess), a
    // sample-exact grid for the two slices below, and a single mp3 generation
    // for the whole fold instead of three. Slicing the compressed mp3 directly
    // instead lands on frame/decoder-delay boundaries and leaves a ~0.25ms
    // phase step at the loop seam (measured: 11x the adjacent-sample delta,
    // versus 1.01x — i.e. indistinguishable from continuous — when slicing the
    // decoded WAV).
    try {
      await execFileP(
        FFMPEG_BIN(),
        ["-y", "-i", inPath, "-c:a", "pcm_s16le", tmpFull],
        { maxBuffer: 16 * 1024 * 1024 },
      );
      durationSec = await pcmWavDurationSec(tmpFull);
    } catch (e) {
      throw new MusicError(`selfLoopAudio: could not decode ${inPath} (${e instanceof Error ? e.message : e})`);
    }
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      // A decode that yields no audio at all means the INPUT is unreadable —
      // that is a real failure, not a "too short" no-op.
      throw new MusicError(`selfLoopAudio: could not measure input duration of ${inPath}`);
    }
    if (durationSec < fade * 4) {
      throw new MusicError(
        `selfLoopAudio: track is too short to establish seamless loop continuity ` +
          `(${durationSec.toFixed(1)}s; need at least ${(fade * 4).toFixed(1)}s)`,
      );
    }

    const tail = fade + 0.5; // 0.5s pure lead-in before the fade (see proof above)
    const mainEnd = (durationSec - tail).toFixed(6);
    try {
      // PASS 1 — head/main segment A[0 .. D-T] to its own file.
      await execFileP(
        FFMPEG_BIN(),
        ["-y", "-i", tmpFull, "-t", mainEnd, "-c:a", "pcm_s16le", tmpMain],
        { maxBuffer: 16 * 1024 * 1024 },
      );
      // PASS 2 — tail segment A[D-T .. D] to its own file.
      await execFileP(
        FFMPEG_BIN(),
        ["-y", "-ss", mainEnd, "-i", tmpFull, "-c:a", "pcm_s16le", tmpTail],
        { maxBuffer: 16 * 1024 * 1024 },
      );
      // PASS 3 — crossfade TWO SEPARATE inputs (no shared-decoder deadlock).
      await execFileP(
        FFMPEG_BIN(),
        [
          "-y",
          "-i", tmpTail,
          "-i", tmpMain,
          "-filter_complex", `[0:a][1:a]acrossfade=d=${fade}:c1=tri:c2=tri[out]`,
          "-map", "[out]",
          ...MP3_ENCODE_ARGS,
          outPath,
        ],
        { maxBuffer: 16 * 1024 * 1024 },
      );
    } catch (e) {
      throw new MusicError(`selfLoopAudio: ffmpeg fold failed (${e instanceof Error ? e.message : e})`);
    }
  } finally {
    await unlink(tmpFull).catch(() => {});
    await unlink(tmpMain).catch(() => {});
    await unlink(tmpTail).catch(() => {});
  }

  // ---- PROVE THE OUTPUT IS REAL BEFORE CLAIMING SUCCESS ----------------
  // ffmpeg exits 0 on an empty mux, so a zero-frame file is indistinguishable
  // from success by exit code alone. That is exactly how the single-pass
  // filtergraph shipped a ~1KB corrupt bed into every lofi render. Never return
  // a path this function has not decoded and measured.
  const expectedSec = durationSec - fade;
  let outBytes = 0;
  try {
    outBytes = (await stat(outPath)).size;
  } catch (e) {
    throw new MusicError(`selfLoopAudio: output ${outPath} was not written (${e instanceof Error ? e.message : e})`);
  }
  if (outBytes < 16 * 1024) {
    throw new MusicError(
      `selfLoopAudio: output is ${outBytes}B — corrupt/empty mux (expected ~${expectedSec.toFixed(1)}s of 320k audio)`,
    );
  }
  let outSec = 0;
  try {
    outSec = await decodeAccurateDurationSec(outPath);
  } catch (e) {
    throw new MusicError(`selfLoopAudio: output verification decode failed (${e instanceof Error ? e.message : e})`);
  }
  const tolerance = Math.max(1, expectedSec * 0.03);
  if (!Number.isFinite(outSec) || outSec <= 0 || Math.abs(outSec - expectedSec) > tolerance) {
    throw new MusicError(
      `selfLoopAudio: output duration ${outSec.toFixed(2)}s is not the expected ${expectedSec.toFixed(2)}s (±${tolerance.toFixed(2)}s) — refusing to return a bad loop`,
    );
  }
  opts?.log?.(
    `selfLoopAudio: folded tail→head (${fade}s crossfade) — ${durationSec.toFixed(1)}s → ${outSec.toFixed(1)}s, ${(outBytes / 1024).toFixed(0)}KB, verified non-empty; mix now loops seamlessly`,
  );
  return outPath;
}

export interface MusicTrack {
  /** Best available URL for this clip (WAV when the upgrade succeeded, else mp3). */
  url: string;
  /** Lossless WAV URL when the conversion succeeded. */
  wavUrl?: string;
  /** Provider clip id (Suno audioId). */
  audioId?: string;
  durationSec?: number;
}

export interface MusicResult {
  provider: MusicProvider;
  /** Remote URL of the (first) generated audio clip. */
  url: string;
  /** Provider job id (for audit). */
  jobId: string;
  /** ALL clips this generation produced (Suno returns up to 2 per task). */
  tracks: MusicTrack[];
}

const MUREKA_BASE = "https://api.mureka.ai/v1";
const SUNO_BASE = "https://api.sunoapi.org/api/v1";

/** Default Suno model — V5 ("crystal-clear audio"); override per call/param. */
export const SUNO_DEFAULT_MODEL = "V5";

// Provider create responses can be lost after the provider has accepted a
// billable job. Keep each HTTP boundary finite so ambiguity reaches the typed
// MusicError path rather than surviving until a whole-task replay.
const MUSIC_CREATE_REQUEST_TIMEOUT_MS = 120_000;
const MUSIC_POLL_REQUEST_TIMEOUT_MS = 30_000;
const MUSIC_WAV_UPGRADE_REQUEST_TIMEOUT_MS = 120_000;

function murekaKey(): string {
  const k = process.env.MUREKA_API_KEY;
  if (!k) throw new MusicError("MUREKA_API_KEY is not configured");
  return k;
}
function sunoKey(): string {
  const k = process.env.SUNO_API_KEY;
  if (!k) throw new MusicError("SUNO_API_KEY is not configured");
  return k;
}

/** True when the production music block has at least one supported provider. */
export function hasMusicProvider(): boolean {
  return Boolean(process.env.MUREKA_API_KEY || process.env.SUNO_API_KEY || hasQualifiedMiniMaxMusic3());
}

function extractAudioUrl(choice: Record<string, unknown>): string | undefined {
  // Prefer lossless (FLAC/WAV) when the provider offers it, so the highest-
  // quality master flows into assembly; fall back to mp3/stream otherwise.
  for (const k of ["flac_url", "wav_url", "url", "audio_url", "mp3_url", "stream_url"]) {
    if (typeof choice[k] === "string") return choice[k] as string;
  }
  return undefined;
}

/** Generate a lofi instrumental via Mureka and poll to completion. */
export async function generateMureka(args: {
  prompt: string;
  model?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
}): Promise<MusicResult> {
  let created: Response;
  try {
    created = await fetch(`${MUREKA_BASE}/instrumental/generate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${murekaKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: args.model ?? "auto", prompt: args.prompt }),
      signal: AbortSignal.timeout(MUSIC_CREATE_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new MusicError(
      `mureka create outcome is unknown after transport failure; not resubmitting: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  let cjson: { id?: string; status?: string; message?: string };
  try {
    cjson = (await created.json()) as typeof cjson;
  } catch (error) {
    throw new MusicError(
      `mureka create returned unreadable HTTP ${created.status}; not resubmitting`,
      {
        status: created.status,
        acceptedUnits: created.ok ? 1 : 0,
        cause: error,
      },
    );
  }
  if (!created.ok) {
    const detail = JSON.stringify(cjson).slice(0, 200);
    const quotaRejected = created.status === 429 || /quota|billing|insufficient|credit/i.test(detail);
    throw new MusicError(
      `mureka generate failed: HTTP ${created.status} ${detail}`,
      { status: created.status, safeToFallback: quotaRejected },
    );
  }
  if (!cjson.id) {
    throw new MusicError(
      `mureka accepted create without a recoverable job id: ${JSON.stringify(cjson).slice(0, 200)}`,
      { status: created.status, acceptedUnits: 1 },
    );
  }
  const id = cjson.id;
  const deadline = Date.now() + (args.timeoutMs ?? 600_000);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, args.pollIntervalMs ?? 8000));
    let res: Response;
    let json: {
      status?: string;
      choices?: Array<Record<string, unknown>>;
      failed_reason?: string;
    };
    try {
      res = await fetch(`${MUREKA_BASE}/instrumental/query/${id}`, {
        headers: { Authorization: `Bearer ${murekaKey()}` },
        signal: AbortSignal.timeout(MUSIC_POLL_REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) continue;
        throw new MusicError(`mureka query ${id} failed: HTTP ${res.status}`, {
          status: res.status,
          acceptedUnits: 1,
          acceptedJobId: id,
        });
      }
      json = (await res.json()) as typeof json;
    } catch (error) {
      if (error instanceof MusicError) throw error;
      // Polling the same accepted id is safe. A transient GET failure does not
      // create another generation, so keep recovering until the deadline.
      continue;
    }
    if (json.status === "succeeded") {
      const choices = json.choices ?? [];
      const tracks: MusicTrack[] = [];
      for (const c of choices) {
        const url = extractAudioUrl(c);
        if (url) tracks.push({ url, durationSec: typeof c["duration"] === "number" ? (c["duration"] as number) : undefined });
      }
      if (tracks.length) return { provider: "mureka", url: tracks[0].url, jobId: id, tracks };
      throw new MusicError(
        `mureka succeeded but no audio url: ${JSON.stringify(json).slice(0, 200)}`,
        { acceptedUnits: 1, acceptedJobId: id },
      );
    }
    if (json.status === "failed") {
      throw new MusicError(`mureka failed: ${json.failed_reason ?? "unknown"}`, {
        acceptedUnits: 1,
        acceptedJobId: id,
      });
    }
  }
  throw new MusicError(`mureka timed out (job ${id})`, {
    acceptedUnits: 1,
    acceptedJobId: id,
  });
}

/** Trim a prompt to a hard char cap on a word boundary. */
function trimPrompt(prompt: string, cap: number): string {
  let p = prompt ?? "";
  if (p.length > cap) {
    p = p.slice(0, cap);
    const lastSpace = p.lastIndexOf(" ");
    if (lastSpace > Math.min(200, cap / 2)) p = p.slice(0, lastSpace);
  }
  return p;
}

/**
 * Best-effort lossless WAV upgrade for a finished Suno clip. Returns the WAV
 * URL or undefined (caller falls back to the mp3 audioUrl). Never throws.
 */
async function fetchSunoWav(
  taskId: string,
  audioId: string,
  timeoutMs = 90_000,
): Promise<string | undefined> {
  try {
    const created = await fetch(`${SUNO_BASE}/wav/generate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sunoKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, audioId, callBackUrl: "https://example.com/none" }),
      // WAV is an optional paid upgrade. If its POST is ambiguous, keep the
      // already-ready MP3 instead of resubmitting the upgrade.
      signal: AbortSignal.timeout(MUSIC_WAV_UPGRADE_REQUEST_TIMEOUT_MS),
    });
    const cjson = (await created.json()) as { data?: { taskId?: string } };
    const wavTaskId = cjson.data?.taskId;
    if (!created.ok || !wavTaskId) return undefined;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 6000));
      const res = await fetch(
        `${SUNO_BASE}/wav/record-info?taskId=${encodeURIComponent(wavTaskId)}`,
        {
          headers: { Authorization: `Bearer ${sunoKey()}` },
          signal: AbortSignal.timeout(MUSIC_POLL_REQUEST_TIMEOUT_MS),
        },
      );
      if (!res.ok) continue;
      const json = (await res.json()) as Record<string, unknown>;
      const url = findWavUrl(json);
      if (url) return url;
      const s = JSON.stringify(json);
      if (/FAIL|ERROR/i.test(s) && !/PENDING|RUNNING|PROCESS/i.test(s)) return undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Recursively find a WAV url (audioWavUrl / *.wav) in a provider response. */
function findWavUrl(node: unknown): string | undefined {
  if (typeof node === "string") {
    return /^https?:\/\/\S+\.wav(\?|$)/i.test(node) ? node : undefined;
  }
  if (Array.isArray(node)) {
    for (const v of node) {
      const u = findWavUrl(v);
      if (u) return u;
    }
    return undefined;
  }
  if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    for (const [k, v] of Object.entries(o)) {
      if (/wav/i.test(k) && typeof v === "string" && /^https?:\/\//.test(v)) return v;
    }
    for (const v of Object.values(o)) {
      const u = findWavUrl(v);
      if (u) return u;
    }
  }
  return undefined;
}

/**
 * Generate music via Suno and poll to completion.
 *
 * Defaults to V5 + customMode (style field carries the full channel-DNA prompt,
 * 1000-char cap vs 480 non-custom). `wantClips: 2` waits for the task's final
 * SUCCESS so BOTH clips of the generation are returned (a generation always
 * costs the same — using both clips halves the per-track cost of a mix).
 * `preferWav` upgrades each clip to lossless WAV (best-effort).
 */
export async function generateSuno(args: {
  prompt: string;
  model?: string;
  instrumental?: boolean;
  /** Short track/mix title for custom mode (≤80 chars). */
  title?: string;
  /** 1 = return on first finished clip (fast). 2 = wait for both clips. */
  wantClips?: number;
  /** Upgrade clips to lossless WAV via the wav endpoint (default true). */
  preferWav?: boolean;
  pollIntervalMs?: number;
  timeoutMs?: number;
}): Promise<MusicResult> {
  const model = args.model ?? SUNO_DEFAULT_MODEL;
  const wantClips = Math.max(1, Math.min(2, args.wantClips ?? 1));
  const headers = {
    Authorization: `Bearer ${sunoKey()}`,
    "Content-Type": "application/json",
  };

  // CUSTOM MODE first: the style field carries the rich DNA/composer prompt
  // (1000 chars) instead of the 480-char non-custom cap. Instrumental custom
  // mode requires style + title only.
  const customBody = {
    customMode: true,
    instrumental: args.instrumental ?? true,
    model,
    style: trimPrompt(args.prompt, 950),
    title: trimPrompt(args.title?.trim() || "Instrumental Mix", 78),
    callBackUrl: "https://example.com/none",
  };
  // Legacy non-custom fallback (the pre-2026-06-10 request shape).
  const legacyBody = {
    prompt: trimPrompt(args.prompt, 480),
    customMode: false,
    instrumental: args.instrumental ?? true,
    model,
    callBackUrl: "https://example.com/none",
  };

  let taskId: string | undefined;
  for (const [bodyIndex, body] of [customBody, legacyBody].entries()) {
    let created: Response;
    try {
      created = await fetch(`${SUNO_BASE}/generate`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(MUSIC_CREATE_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new MusicError(
        `suno create outcome is unknown after transport failure; not resubmitting: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    let cjson: {
      data?: { taskId?: string };
      code?: number;
      msg?: string;
    };
    try {
      cjson = (await created.json()) as typeof cjson;
    } catch (error) {
      throw new MusicError(
        `suno create returned unreadable HTTP ${created.status}; not resubmitting`,
        {
          status: created.status,
          acceptedUnits: created.ok ? 1 : 0,
          cause: error,
        },
      );
    }
    taskId = cjson.data?.taskId;
    if (created.ok && taskId) break;

    const detail = cjson.msg ?? JSON.stringify(cjson).slice(0, 200);
    if (created.ok) {
      throw new MusicError(`suno accepted create without a recoverable task id: ${detail}`, {
        status: created.status,
        acceptedUnits: 1,
      });
    }
    // The legacy request is a schema-compatibility fallback, not a provider
    // retry. It is safe only when custom mode was explicitly rejected as an
    // invalid request before generation admission.
    const explicitSchemaRejection = bodyIndex === 0 && (created.status === 400 || created.status === 422);
    if (explicitSchemaRejection) {
      taskId = undefined;
      continue;
    }
    const quotaRejected = created.status === 429 || /quota|billing|insufficient|credit/i.test(detail);
    throw new MusicError(`suno generate failed: HTTP ${created.status} ${detail}`, {
      status: created.status,
      safeToFallback: quotaRejected,
    });
  }
  if (!taskId) {
    throw new MusicError("suno legacy request was explicitly rejected", { safeToFallback: false });
  }

  type SunoItem = { id?: string; audioUrl?: string; streamAudioUrl?: string; duration?: number };
  const deadline = Date.now() + (args.timeoutMs ?? 600_000);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, args.pollIntervalMs ?? 8000));
    let res: Response;
    let json: {
      data?: {
        status?: string;
        response?: { sunoData?: SunoItem[] };
      };
    };
    try {
      res = await fetch(
        `${SUNO_BASE}/generate/record-info?taskId=${encodeURIComponent(taskId)}`,
        {
          headers: { Authorization: `Bearer ${sunoKey()}` },
          signal: AbortSignal.timeout(MUSIC_POLL_REQUEST_TIMEOUT_MS),
        },
      );
      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) continue;
        throw new MusicError(`suno query ${taskId} failed: HTTP ${res.status}`, {
          status: res.status,
          acceptedUnits: 1,
          acceptedJobId: taskId,
        });
      }
      json = (await res.json()) as typeof json;
    } catch (error) {
      if (error instanceof MusicError) throw error;
      continue;
    }
    const status = json.data?.status;
    const items = json.data?.response?.sunoData ?? [];
    // `||`-style emptiness check: an empty-string audioUrl ("" while still
    // rendering) must fall through — `??` once returned it and crashed downloadTo("").
    const ready = items.filter((i) => (i.audioUrl ?? "").trim().length > 0);
    const finished = Boolean(status && /SUCCESS|COMPLETE|FINISH/i.test(status));
    if (ready.length >= wantClips || (finished && ready.length > 0)) {
      const chosen = ready.slice(0, Math.max(wantClips, ready.length > 1 ? 2 : 1));
      const tracks: MusicTrack[] = [];
      for (const it of chosen) {
        const mp3 = (it.audioUrl as string).trim();
        let wavUrl: string | undefined;
        if ((args.preferWav ?? true) && it.id) {
          wavUrl = await fetchSunoWav(taskId, it.id);
        }
        tracks.push({ url: wavUrl ?? mp3, wavUrl, audioId: it.id, durationSec: it.duration });
      }
      return { provider: "suno", url: tracks[0].url, jobId: taskId, tracks };
    }
    // Only accept the streaming URL once generation has actually finished.
    if (finished) {
      const streamItem = items.find((i) => (i.streamAudioUrl ?? "").trim().length > 0);
      if (streamItem) {
        const u = (streamItem.streamAudioUrl as string).trim();
        return { provider: "suno", url: u, jobId: taskId, tracks: [{ url: u }] };
      }
    }
    if (status && /fail|error|sensitive/i.test(status)) {
      throw new MusicError(`suno failed: ${status}`, {
        acceptedUnits: 1,
        acceptedJobId: taskId,
      });
    }
  }
  throw new MusicError(`suno timed out (task ${taskId})`, {
    acceptedUnits: 1,
    acceptedJobId: taskId,
  });
}

/** Provider-routed entry point with admission-safe quota fallback.
 *
 * The alternate provider is used only after an explicit quota/billing rejection
 * that proves the preferred provider did not accept a generation. Transport,
 * 5xx, missing-receipt, and accepted-job failures stop in place; falling back
 * after those outcomes could purchase the same music twice. */
export async function generateMusic(args: {
  provider?: MusicProvider;
  prompt: string;
  model?: string;
  title?: string;
  wantClips?: number;
  preferWav?: boolean;
  timeoutMs?: number;
  /** Progress/diagnostics. */
  log?: (msg: string) => void;
}): Promise<MusicResult> {
  if (args.provider === "minimax_music3") {
    throw new MusicError(
      "MiniMax-Music3 requires a fingerprint-bound channel music program; use generateMiniMaxMusic3 with an admitted program",
    );
  }
  const runSuno = () =>
    generateSuno({
      prompt: args.prompt,
      model: args.model,
      title: args.title,
      wantClips: args.wantClips,
      preferWav: args.preferWav,
      timeoutMs: args.timeoutMs,
    });
  const runMureka = () => generateMureka({ prompt: args.prompt, model: args.model, timeoutMs: args.timeoutMs });

  const preferred: Exclude<MusicProvider, "minimax_music3"> = args.provider ?? "mureka";
  // Order providers preferred-first, then drop any whose key is missing.
  const order: { name: Exclude<MusicProvider, "minimax_music3">; key: boolean; run: () => Promise<MusicResult> }[] = [
    { name: "mureka" as const, key: Boolean(process.env.MUREKA_API_KEY), run: runMureka },
    { name: "suno" as const, key: Boolean(process.env.SUNO_API_KEY), run: runSuno },
  ]
    .sort((a, b) => (a.name === preferred ? -1 : b.name === preferred ? 1 : 0))
    .filter((p) => p.key);

  if (!order.length) throw new MusicError("no music provider key configured (MUREKA_API_KEY / SUNO_API_KEY)");

  for (let index = 0; index < order.length; index++) {
    const p = order[index];
    try {
      return await p.run();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const canFallback =
        e instanceof MusicError &&
        e.safeToFallback &&
        e.acceptedUnits === 0 &&
        index < order.length - 1;
      args.log?.(
        `music: ${p.name} failed (${message.slice(0, 120)})${canFallback ? " — admission rejected, falling back" : " — stopping"}`,
      );
      if (!canFallback) throw e;
    }
  }
  throw new MusicError("all configured music providers explicitly rejected generation");
}
