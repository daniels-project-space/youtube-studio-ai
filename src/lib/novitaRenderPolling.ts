export const NOVITA_RENDER_JOB_STORAGE_KEY =
  "youtube-studio-ai:novita-render:pending:v1";

export const NOVITA_RENDER_STATUS_MIN_MS = 20_000;
export const NOVITA_RENDER_STATUS_MAX_MS = 60_000;
export const NOVITA_RENDER_STATUS_TIMEOUT_MS = 24 * 60 * 60 * 1_000;
const NOVITA_RENDER_HANDLE_MAX_AGE_MS = 48 * 60 * 60 * 1_000;

export type NovitaRenderProfileId = "draft" | "production" | "hero";
export type NovitaRenderPhase = "image" | "video";

export interface PersistedNovitaRenderJob {
  version: 1;
  jobId: string;
  phase: NovitaRenderPhase;
  profileId: NovitaRenderProfileId;
  startedAt: number;
}

interface StorageReader {
  getItem(key: string): string | null;
  removeItem(key: string): void;
}

interface StorageWriter extends StorageReader {
  setItem(key: string, value: string): void;
}

export function isPersistedNovitaRenderJob(
  value: unknown,
): value is PersistedNovitaRenderJob {
  if (!value || typeof value !== "object") return false;
  const job = value as Partial<PersistedNovitaRenderJob>;
  return job.version === 1 &&
    typeof job.jobId === "string" &&
    /^(image|video)-[a-f0-9]{32}$/.test(job.jobId) &&
    (job.phase === "image" || job.phase === "video") &&
    job.jobId.startsWith(`${job.phase}-`) &&
    (job.profileId === "draft" ||
      job.profileId === "production" ||
      job.profileId === "hero") &&
    typeof job.startedAt === "number" &&
    Number.isFinite(job.startedAt) &&
    job.startedAt > 0;
}

export function loadPersistedNovitaRenderJob(
  storage: StorageReader,
  now = Date.now(),
): PersistedNovitaRenderJob | null {
  const raw = storage.getItem(NOVITA_RENDER_JOB_STORAGE_KEY);
  if (!raw || raw.length > 2_048) {
    if (raw) storage.removeItem(NOVITA_RENDER_JOB_STORAGE_KEY);
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !isPersistedNovitaRenderJob(parsed) ||
      parsed.startedAt > now + 60_000 ||
      now - parsed.startedAt > NOVITA_RENDER_HANDLE_MAX_AGE_MS
    ) {
      storage.removeItem(NOVITA_RENDER_JOB_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    storage.removeItem(NOVITA_RENDER_JOB_STORAGE_KEY);
    return null;
  }
}

export function persistNovitaRenderJob(
  storage: StorageWriter,
  job: PersistedNovitaRenderJob,
): void {
  if (!isPersistedNovitaRenderJob(job)) {
    throw new Error("invalid Novita render recovery handle");
  }
  // This deliberately stores only the sanitized bridge identity. Prompts,
  // cookies, signatures, provider credentials, and output URLs never persist.
  storage.setItem(NOVITA_RENDER_JOB_STORAGE_KEY, JSON.stringify(job));
}

export function clearPersistedNovitaRenderJob(storage: StorageReader): void {
  storage.removeItem(NOVITA_RENDER_JOB_STORAGE_KEY);
}

/** Align status traffic with bridge batching, then back off unchanged jobs. */
export function novitaRenderPollDelayMs(args: {
  statusBatchSeconds?: number | null;
  elapsedMs: number;
  unchangedPolls: number;
}): number {
  const attested = Number.isFinite(args.statusBatchSeconds)
    ? Math.max(0, Number(args.statusBatchSeconds)) * 1_000
    : 0;
  let delay = Math.max(NOVITA_RENDER_STATUS_MIN_MS, attested);
  if (args.unchangedPolls >= 3) delay = Math.max(delay, 40_000);
  if (args.unchangedPolls >= 8 || args.elapsedMs >= 30 * 60_000) {
    delay = Math.max(delay, NOVITA_RENDER_STATUS_MAX_MS);
  }
  return Math.min(NOVITA_RENDER_STATUS_MAX_MS, Math.round(delay));
}
