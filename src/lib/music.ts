/**
 * Music generation — Mureka (default) + Suno (fallback). Both produce a lofi
 * instrumental track; the assemble block loops it under the video.
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
 * Suno contract (sunoapi.org style; fallback path):
 *   POST https://api.sunoapi.org/api/v1/generate -> { data: { taskId } }
 *   GET  https://api.sunoapi.org/api/v1/generate/record-info?taskId=... -> sunoData[].audioUrl
 */

export class MusicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MusicError";
  }
}

export type MusicProvider = "mureka" | "suno";

export interface MusicResult {
  provider: MusicProvider;
  /** Remote URL of the generated audio. */
  url: string;
  /** Provider job id (for audit). */
  jobId: string;
}

const MUREKA_BASE = "https://api.mureka.ai/v1";
const SUNO_BASE = "https://api.sunoapi.org/api/v1";

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
      for (const c of choices) {
        const url = extractAudioUrl(c);
        if (url) return { provider: "mureka", url, jobId: id };
      }
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

/** Generate music via Suno (fallback) and poll to completion. */
export async function generateSuno(args: {
  prompt: string;
  model?: string;
  instrumental?: boolean;
  pollIntervalMs?: number;
  timeoutMs?: number;
}): Promise<MusicResult> {
  const created = await fetch(`${SUNO_BASE}/generate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sunoKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: args.prompt,
      customMode: false,
      instrumental: args.instrumental ?? true,
      model: args.model ?? "V4",
      callBackUrl: "https://example.com/none",
    }),
  });
  const cjson = (await created.json()) as {
    data?: { taskId?: string };
    code?: number;
    msg?: string;
  };
  const taskId = cjson.data?.taskId;
  if (!created.ok || !taskId) {
    throw new MusicError(
      `suno generate failed: HTTP ${created.status} ${cjson.msg ?? JSON.stringify(cjson).slice(0, 200)}`,
    );
  }
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
        response?: { sunoData?: Array<{ audioUrl?: string; streamAudioUrl?: string }> };
      };
    };
    const status = json.data?.status;
    const items = json.data?.response?.sunoData ?? [];
    const url = items.find((i) => i.audioUrl || i.streamAudioUrl);
    if (url) {
      return {
        provider: "suno",
        url: (url.audioUrl ?? url.streamAudioUrl) as string,
        jobId: taskId,
      };
    }
    if (status && /fail|error|sensitive/i.test(status)) {
      throw new MusicError(`suno failed: ${status}`);
    }
  }
  throw new MusicError(`suno timed out (task ${taskId})`);
}

/** Provider-routed entry point. */
export async function generateMusic(args: {
  provider?: MusicProvider;
  prompt: string;
  model?: string;
  timeoutMs?: number;
}): Promise<MusicResult> {
  if ((args.provider ?? "mureka") === "suno") {
    return generateSuno({
      prompt: args.prompt,
      model: args.model,
      timeoutMs: args.timeoutMs,
    });
  }
  return generateMureka({
    prompt: args.prompt,
    model: args.model,
    timeoutMs: args.timeoutMs,
  });
}
