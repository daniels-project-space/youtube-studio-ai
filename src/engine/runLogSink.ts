/**
 * Convex-backed log sink — streams the runner's `ctx.log` lines into the
 * `runLogs` table so the run detail page can render a live console. This is the
 * logging analogue of {@link makeConvexSink} (which persists block stages).
 *
 * Lines are buffered in memory and flushed in batches (every ~1s OR every ~25
 * lines, whichever comes first) via the `appendRunLogs` mutation, so a chatty
 * pipeline never pays one round-trip per line. `flush()` drains synchronously
 * (block boundaries, run end).
 *
 * RESILIENCE CONTRACT: a failed flush MUST NOT crash the run. Every flush is
 * guarded; on error the batch is logged via console.warn and dropped, and the
 * run proceeds. Logs are best-effort telemetry, never a hard dependency.
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export type RunLogLevel = "info" | "warn" | "error";

interface BufferedLine {
  block?: string;
  level: string;
  message: string;
  at: number;
  seq: number;
}

export interface RunLogSink {
  /** Buffer one line; auto-flushes when the batch is full. */
  log: (level: RunLogLevel, message: string, block?: string) => void;
  /** Drain the buffer now (block boundaries / run end). Never throws. */
  flush: () => Promise<void>;
}

const FLUSH_INTERVAL_MS = 1000;
const FLUSH_BATCH_SIZE = 25;

export function makeRunLogSink(
  client: ConvexHttpClient,
  ownerId: string,
  runId: string,
): RunLogSink {
  let buffer: BufferedLine[] = [];
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Serialise flushes so batches keep their relative (at, seq) order.
  let inflight: Promise<void> = Promise.resolve();

  function clearTimer(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  async function drain(): Promise<void> {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    try {
      await client.mutation(api.runLogs.appendRunLogs, {
        ownerId,
        runId: runId as Id<"runs">,
        lines: batch.map((l) => ({
          block: l.block,
          level: l.level,
          message: l.message,
          at: l.at,
          seq: l.seq,
        })),
      });
    } catch (e) {
      // Best-effort: a failed flush must not crash the run.
      console.warn(
        `[runLogSink] flush of ${batch.length} line(s) failed (dropped):`,
        e instanceof Error ? e.message : e,
      );
    }
  }

  function flush(): Promise<void> {
    clearTimer();
    // Chain onto the inflight flush so ordering is preserved.
    inflight = inflight.then(drain, drain);
    return inflight;
  }

  function scheduleFlush(): void {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, FLUSH_INTERVAL_MS);
  }

  return {
    log(level, message, block) {
      buffer.push({ block, level, message, at: Date.now(), seq: seq++ });
      if (buffer.length >= FLUSH_BATCH_SIZE) {
        void flush();
      } else {
        scheduleFlush();
      }
    },
    flush,
  };
}

/**
 * Infer a log level from a runner message. The engine's `log` callback is a
 * plain `(msg, extra)` with no explicit level, so we classify by content:
 * "failed"/"error"/"FATAL" → error, "warn"/"non-fatal"/"continuing" → warn,
 * else info. Conservative — only obvious signals are escalated.
 */
export function inferLevel(message: string): RunLogLevel {
  const m = message.toLowerCase();
  if (/\b(failed|fatal|error)\b/.test(m)) return "error";
  if (/\b(warn|non-fatal|continuing|expired|retry)\b/.test(m)) return "warn";
  return "info";
}

/**
 * Build a tee'd `log` callback matching the runner's `(msg, extra) => void`
 * signature: it forwards to `consoleLog` (unchanged behaviour) AND mirrors the
 * line into the given {@link RunLogSink}. Teeing the single top-level callback
 * captures every block's `ctx.log` output, since the runner threads this one
 * callback into every block context.
 */
export function teeLog(
  sink: RunLogSink,
  consoleLog: (msg: string, extra?: Record<string, unknown>) => void,
): (msg: string, extra?: Record<string, unknown>) => void {
  return (msg, extra) => {
    consoleLog(msg, extra);
    const text =
      extra && Object.keys(extra).length > 0
        ? `${msg} ${JSON.stringify(extra)}`
        : msg;
    sink.log(inferLevel(msg), text);
  };
}
