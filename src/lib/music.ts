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
 */

export class MusicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MusicError";
  }
}

export type MusicProvider = "mureka" | "suno";

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
  const created = await fetch(`${MUREKA_BASE}/instrumental/generate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${murekaKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: args.model ?? "auto", prompt: args.prompt }),
  });
  const cjson = (await created.json()) as { id?: string; status?: string };
  if (!created.ok || !cjson.id) {
    throw new MusicError(
      `mureka generate failed: HTTP ${created.status} ${JSON.stringify(cjson).slice(0, 200)}`,
    );
  }
  const id = cjson.id;
  const deadline = Date.now() + (args.timeoutMs ?? 600_000);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, args.pollIntervalMs ?? 8000));
    const res = await fetch(`${MUREKA_BASE}/instrumental/query/${id}`, {
      headers: { Authorization: `Bearer ${murekaKey()}` },
    });
    const json = (await res.json()) as {
      status?: string;
      choices?: Array<Record<string, unknown>>;
      failed_reason?: string;
    };
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
      );
    }
    if (json.status === "failed") {
      throw new MusicError(`mureka failed: ${json.failed_reason ?? "unknown"}`);
    }
  }
  throw new MusicError(`mureka timed out (job ${id})`);
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
    });
    const cjson = (await created.json()) as { data?: { taskId?: string } };
    const wavTaskId = cjson.data?.taskId;
    if (!created.ok || !wavTaskId) return undefined;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 6000));
      const res = await fetch(
        `${SUNO_BASE}/wav/record-info?taskId=${encodeURIComponent(wavTaskId)}`,
        { headers: { Authorization: `Bearer ${sunoKey()}` } },
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
  let lastErr = "";
  for (const body of [customBody, legacyBody]) {
    const created = await fetch(`${SUNO_BASE}/generate`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const cjson = (await created.json()) as {
      data?: { taskId?: string };
      code?: number;
      msg?: string;
    };
    taskId = cjson.data?.taskId;
    if (created.ok && taskId) break;
    lastErr = `HTTP ${created.status} ${cjson.msg ?? JSON.stringify(cjson).slice(0, 200)}`;
    taskId = undefined;
  }
  if (!taskId) throw new MusicError(`suno generate failed: ${lastErr}`);

  type SunoItem = { id?: string; audioUrl?: string; streamAudioUrl?: string; duration?: number };
  const deadline = Date.now() + (args.timeoutMs ?? 600_000);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, args.pollIntervalMs ?? 8000));
    const res = await fetch(
      `${SUNO_BASE}/generate/record-info?taskId=${encodeURIComponent(taskId)}`,
      { headers: { Authorization: `Bearer ${sunoKey()}` } },
    );
    const json = (await res.json()) as {
      data?: {
        status?: string;
        response?: { sunoData?: SunoItem[] };
      };
    };
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
      throw new MusicError(`suno failed: ${status}`);
    }
  }
  throw new MusicError(`suno timed out (task ${taskId})`);
}

/** Provider-routed entry point with automatic FALLBACK to the other provider.
 *
 *  A documentary/short must not ship silent because one music host is down or
 *  over quota (the Mureka-429 that left a doc music-less). So: try the preferred
 *  provider, and on ANY failure fall back to the other one whose key is present.
 *  Only providers with a configured key are attempted. */
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

  const preferred: MusicProvider = args.provider ?? "mureka";
  // Order providers preferred-first, then drop any whose key is missing.
  const order: { name: MusicProvider; key: boolean; run: () => Promise<MusicResult> }[] = [
    { name: "mureka" as MusicProvider, key: Boolean(process.env.MUREKA_API_KEY), run: runMureka },
    { name: "suno" as MusicProvider, key: Boolean(process.env.SUNO_API_KEY), run: runSuno },
  ]
    .sort((a, b) => (a.name === preferred ? -1 : b.name === preferred ? 1 : 0))
    .filter((p) => p.key);

  if (!order.length) throw new MusicError("no music provider key configured (MUREKA_API_KEY / SUNO_API_KEY)");

  let lastErr = "";
  for (const p of order) {
    try {
      return await p.run();
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      args.log?.(`music: ${p.name} failed (${lastErr.slice(0, 120)})${p !== order[order.length - 1] ? " — falling back" : ""}`);
    }
  }
  throw new MusicError(`all music providers failed: ${lastErr}`);
}
