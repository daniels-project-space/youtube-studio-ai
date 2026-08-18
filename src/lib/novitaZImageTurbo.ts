/**
 * Direct public adapter for Novita's Z-Image Turbo model.
 *
 * This intentionally does not use the project's GPU-fleet bridge: a still
 * fallback must be able to run with the scoped NOVITA_API_KEY alone. Keep the
 * request small, explicit, and provider-neutral so non-thumbnail visual lanes
 * never drift back to FAL/Nano Banana as a hidden fallback.
 */

const NOVITA_Z_IMAGE_TURBO_ENDPOINT = "https://api.novita.ai/v3/async/z-image-turbo";
const NOVITA_TASK_RESULT_ENDPOINT = "https://api.novita.ai/v3/async/task-result";
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

type FetchFn = typeof fetch;
type Sleep = (ms: number) => Promise<void>;

export interface NovitaZImageTurboRequest {
  prompt: string;
  /** Documentary roles use 9:16 / 4:5; generic callers commonly use 16:9. */
  aspectRatio?: string;
  seed?: number;
  /** Bounded wall-clock budget for the submit-and-poll operation. */
  timeoutMs?: number;
}

export interface NovitaZImageTurboImage {
  bytes: Buffer;
  model: "z-image-turbo";
  taskId: string;
}

interface AdapterDependencies {
  fetchFn?: FetchFn;
  sleep?: Sleep;
  now?: () => number;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Novita's documented Z-Image Turbo sizes are capped at 1536px per edge. */
export function novitaZImageTurboSize(aspectRatio?: string): string {
  switch ((aspectRatio ?? "").replace(/\s/g, "")) {
    case "9:16":
      return "864*1536";
    case "4:5":
      return "1024*1280";
    case "1:1":
      return "1024*1024";
    case "3:2":
      return "1536*1024";
    case "16:9":
    default:
      return "1536*864";
  }
}

export function hasNovitaZImageTurbo(): boolean {
  return Boolean(process.env.NOVITA_API_KEY?.trim());
}

function responseError(stage: "submit" | "poll" | "download", status: number, body: string): Error {
  const detail = body.replace(/\s+/g, " ").slice(0, 320);
  return new Error(`novita z-image-turbo ${stage} failed with HTTP ${status}${detail ? `: ${detail}` : ""}`);
}

async function jsonResponse(response: Response, stage: "submit" | "poll"): Promise<Record<string, unknown>> {
  const body = await response.text();
  if (!response.ok) throw responseError(stage, response.status, body);
  try {
    const parsed = record(JSON.parse(body));
    if (!parsed) throw new Error("expected a JSON object");
    return parsed;
  } catch (error) {
    throw new Error(`novita z-image-turbo ${stage} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function imageBase64(task: Record<string, unknown>): string | null {
  const images = Array.isArray(task.images) ? task.images : [];
  const image = record(images[0]);
  if (!image) return null;
  return text(image.image_base64) ?? text(image.base64) ?? text(image.image);
}

function imageUrl(task: Record<string, unknown>): string | null {
  const images = Array.isArray(task.images) ? task.images : [];
  const image = record(images[0]);
  if (!image) return null;
  return text(image.image_url) ?? text(image.url);
}

function decodeImageBase64(value: string): Buffer {
  const payload = value.startsWith("data:") ? value.slice(value.indexOf(",") + 1) : value;
  const bytes = Buffer.from(payload, "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    throw new Error("novita z-image-turbo returned image bytes outside the 1B..30MiB contract");
  }
  return bytes;
}

async function downloadImage(url: string, fetchFn: FetchFn): Promise<Buffer> {
  const response = await fetchFn(url);
  if (!response.ok) throw responseError("download", response.status, await response.text());
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    throw new Error("novita z-image-turbo downloaded image bytes outside the 1B..30MiB contract");
  }
  return bytes;
}

/**
 * Submit one Z-Image Turbo still and wait for its terminal result. The public
 * API has no negative-prompt field, so caller-level prompt construction owns
 * all visual exclusions.
 */
export async function generateNovitaZImageTurbo(
  args: NovitaZImageTurboRequest,
  dependencies: AdapterDependencies = {},
): Promise<NovitaZImageTurboImage> {
  const apiKey = process.env.NOVITA_API_KEY?.trim();
  if (!apiKey) throw new Error("novita z-image-turbo requires NOVITA_API_KEY");
  if (!args.prompt.trim()) throw new Error("novita z-image-turbo requires a non-empty prompt");

  const fetchFn = dependencies.fetchFn ?? fetch;
  const wait = dependencies.sleep ?? sleep;
  const now = dependencies.now ?? Date.now;
  const timeoutMs = Math.max(10_000, Math.min(args.timeoutMs ?? 300_000, 600_000));
  const deadline = now() + timeoutMs;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  const seed = Number.isFinite(args.seed) ? Math.trunc(args.seed!) : undefined;
  const submit = await fetchFn(NOVITA_Z_IMAGE_TURBO_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({
      prompt: args.prompt,
      size: novitaZImageTurboSize(args.aspectRatio),
      ...(seed === undefined ? {} : { seed }),
      enable_base64_output: true,
    }),
  });
  const submitted = await jsonResponse(submit, "submit");
  const taskId = text(submitted.task_id) ?? text(record(submitted.data)?.task_id);
  if (!taskId) throw new Error("novita z-image-turbo submit response did not include task_id");

  while (now() <= deadline) {
    const poll = await fetchFn(`${NOVITA_TASK_RESULT_ENDPOINT}?task_id=${encodeURIComponent(taskId)}`, { headers });
    const payload = await jsonResponse(poll, "poll");
    const task = record(payload.task) ?? record(payload.data) ?? payload;
    const status = text(task.status) ?? text(task.task_status) ?? "";
    if (/^(TASK_STATUS_SUCCEED|SUCCEED|SUCCESS)$/i.test(status)) {
      const base64 = imageBase64(task);
      const bytes = base64 ? decodeImageBase64(base64) : await downloadImage(imageUrl(task) ?? "", fetchFn);
      if (!base64 && !imageUrl(task)) {
        throw new Error("novita z-image-turbo succeeded without an image result");
      }
      return { bytes, model: "z-image-turbo", taskId };
    }
    if (/^(TASK_STATUS_FAILED|FAILED|FAILURE|CANCELED|CANCELLED)$/i.test(status)) {
      throw new Error(`novita z-image-turbo task ${taskId} failed${text(task.reason) ? `: ${text(task.reason)}` : ""}`);
    }
    await wait(1_250);
  }
  throw new Error(`novita z-image-turbo task ${taskId} timed out after ${timeoutMs}ms`);
}
