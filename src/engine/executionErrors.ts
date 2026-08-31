/**
 * Structured execution-error policy shared by the engine and Trigger workers.
 *
 * Retry decisions must never depend on a single loose keyword match. Provider
 * responses often contain words such as "network" or "unavailable" inside a
 * deterministic 4xx validation body; retrying those requests only repeats the
 * same charge/failure. Explicit metadata and HTTP status always win.
 */

export type ExecutionErrorKind = "transient" | "deterministic" | "unknown";
/**
 * Where a retry is safe to perform. `durable_task` means the worker must yield
 * to a persisted scheduler/requeue rather than occupy its machine while a
 * durable external lease is still live.
 */
export type ExecutionRetryScope = "block" | "durable_task";

export interface ExecutionErrorOptions {
  status?: number;
  code?: string;
  retryable?: boolean;
  retryAfterMs?: number;
  retryScope?: ExecutionRetryScope;
  phase?: string;
}

export interface ExecutionErrorClassification {
  kind: ExecutionErrorKind;
  retryable: boolean;
  message: string;
  reason: string;
  status?: number;
  code?: string;
  retryAfterMs?: number;
  retryScope?: ExecutionRetryScope;
}

/** Error with machine-readable retry metadata for provider/runtime adapters. */
export class ExecutionError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly retryable?: boolean;
  readonly retryAfterMs?: number;
  readonly retryScope?: ExecutionRetryScope;
  readonly phase?: string;

  constructor(message: string, options: ExecutionErrorOptions = {}) {
    super(message);
    this.name = "ExecutionError";
    this.status = options.status;
    this.code = options.code;
    this.retryable = options.retryable;
    this.retryAfterMs = options.retryAfterMs;
    this.retryScope = options.retryScope;
    this.phase = options.phase;
  }
}

type RetryMetadata = {
  status?: unknown;
  statusCode?: unknown;
  $metadata?: { httpStatusCode?: unknown };
  code?: unknown;
  retryable?: unknown;
  retryAfterMs?: unknown;
  retryScope?: unknown;
  name?: unknown;
  message?: unknown;
};

const TRANSIENT_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EAI_AGAIN",
  "ENETDOWN",
  "ENETRESET",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
  "INTERNALERROR",
  "REQUESTTIMEOUT",
  "SERVICEUNAVAILABLE",
  "SLOWDOWN",
  "THROTTLING",
]);

const DETERMINISTIC_CODES = new Set([
  "EACCES",
  "ENOENT",
  "ENOTDIR",
  "EPERM",
  "ERR_INVALID_ARG_TYPE",
  "ERR_INVALID_ARG_VALUE",
]);

function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(number) ? number : undefined;
}

function statusFromMessage(message: string): number | undefined {
  const patterns = [
    /\bHTTP(?:\s+status)?\s*[:=]?\s*(\d{3})\b/i,
    /\bstatus(?:\s+code)?\s*(?:[:=]|\s)\s*(\d{3})\b/i,
    /\b(?:fal|provider|api|request|response|cdn)\b[^\n]{0,100}?\b([45]\d{2})\s*:/i,
    /^\s*([45]\d{2})\b/,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) return Number(match[1]);
  }
  return undefined;
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function result(
  kind: ExecutionErrorKind,
  message: string,
  reason: string,
  metadata: {
    status?: number;
    code?: string;
    retryAfterMs?: number;
    retryScope?: ExecutionRetryScope;
  },
): ExecutionErrorClassification {
  return {
    kind,
    retryable: kind === "transient",
    message,
    reason,
    ...metadata,
  };
}

/**
 * Classify an execution failure. The precedence is deliberate:
 * explicit retryability -> explicit status -> error code -> deterministic
 * runtime/provider signatures -> transient transport signatures -> unknown.
 */
export function classifyExecutionError(error: unknown): ExecutionErrorClassification {
  const metadata = error && typeof error === "object" ? (error as RetryMetadata) : {};
  const message =
    error instanceof Error
      ? error.message
      : typeof metadata.message === "string"
        ? metadata.message
        : String(error);
  const retryAfterMs = finiteNumber(metadata.retryAfterMs);
  const explicitStatus =
    finiteNumber(metadata.status) ??
    finiteNumber(metadata.statusCode) ??
    finiteNumber(metadata.$metadata?.httpStatusCode);
  const status = explicitStatus ?? statusFromMessage(message);
  const code = typeof metadata.code === "string" ? metadata.code.toUpperCase() : undefined;
  const retryScope = metadata.retryScope === "durable_task"
    ? "durable_task" as const
    : metadata.retryScope === "block"
      ? "block" as const
      : undefined;
  const shared = { status, code, retryAfterMs, ...(retryScope ? { retryScope } : {}) };

  if (typeof metadata.retryable === "boolean") {
    return result(
      metadata.retryable ? "transient" : "deterministic",
      message,
      "explicit retry metadata",
      shared,
    );
  }

  if (metadata.name === "AbortTaskRunError") {
    return result("deterministic", message, "task explicitly aborted retries", shared);
  }

  // A provider adapter that already spent its own bounded retry budget must not
  // be multiplied again by the engine's block-level retry loop.
  if (
    /\b(?:exhausted retries|retry budget exhausted|failed after \d+ attempts)\b/i.test(
      message,
    )
  ) {
    return result("deterministic", message, "nested provider retry budget already exhausted", shared);
  }

  if (status !== undefined) {
    if (status >= 400 && status < 500 && !isTransientStatus(status)) {
      return result("deterministic", message, `HTTP ${status} is a non-retryable client response`, shared);
    }
    if (isTransientStatus(status)) {
      return result("transient", message, `HTTP ${status} is retryable`, shared);
    }
  }

  if (code && DETERMINISTIC_CODES.has(code)) {
    return result("deterministic", message, `${code} cannot be repaired by repeating the same block`, shared);
  }
  if (code && TRANSIENT_CODES.has(code)) {
    return result("transient", message, `${code} is a transient transport failure`, shared);
  }

  if (
    /\b(unprocessable|validation error|invalid (?:request|input|argument|parameter)|malformed (?:request|input|json)|unauthori[sz]ed|forbidden|content policy|safety (?:policy|rejection)|not configured|unknown block|(?:channel|run|pipeline) not found|missing (?:api )?key|completed but no (?:video|image|audio) url|no such file|invalid data found|no matching streams?)\b/i.test(
      message,
    )
  ) {
    return result("deterministic", message, "deterministic validation, configuration, or input failure", shared);
  }

  if (
    metadata.name === "FfmpegError" &&
    /\b(?:ffmpeg|ffprobe)\b.*\b(?:exited|spawn failed)\b/i.test(message)
  ) {
    return result("deterministic", message, "render command failed for the same inputs", shared);
  }

  if (
    /\b(ECONNABORTED|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ENETDOWN|ENETRESET|ENETUNREACH|ENOTFOUND|EPIPE|ETIMEDOUT|UND_ERR_(?:CONNECT_TIMEOUT|HEADERS_TIMEOUT|SOCKET)|socket hang up|fetch failed|network error|rate.?limit(?:ed)?|overloaded|service unavailable|temporarily unavailable|too many requests|timed?\s?out|timeout(?:error)?|operation was aborted)\b/i.test(
      message,
    )
  ) {
    return result("transient", message, "transient transport or provider-capacity failure", shared);
  }

  return result("unknown", message, "no safe retry signal", shared);
}

/** Exponential backoff, honoring a provider Retry-After hint when supplied. */
export function executionRetryDelayMs(
  classification: ExecutionErrorClassification,
  retryOrdinal: number,
): number {
  if (classification.retryAfterMs !== undefined) {
    return Math.min(60_000, Math.max(0, Math.round(classification.retryAfterMs)));
  }
  return Math.min(30_000, 1000 * 2 ** Math.max(0, retryOrdinal - 1));
}
