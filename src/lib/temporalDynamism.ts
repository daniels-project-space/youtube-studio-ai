/**
 * Deterministic evidence for accidental frozen/near-identical holds. This is
 * deliberately separate from still-frame visual review: it measures continuity
 * across the rendered video and returns precise ranges a repair stage can own.
 */
import { spawnSync } from "node:child_process";

const FFMPEG = process.env.FFMPEG_BIN ?? "ffmpeg";
const DETECTION_MIN_SEC = 0.5;
const DEFAULT_NOISE_TOLERANCE = 0.003;

export interface TemporalDynamismInterval {
  startSec: number;
  endSec: number;
  durationSec: number;
}

export interface TemporalDynamismExclusion extends TemporalDynamismInterval {
  /** Planned intro/title/outro window removed before evaluating static holds. */
  reason: string;
}

export type TemporalDynamismVerdict = "pass" | "fail" | "unavailable" | "not_required";

export interface TemporalDynamismEvidence {
  source: "ffmpeg/freezedetect";
  ran: boolean;
  enforced: boolean;
  verdict: TemporalDynamismVerdict;
  thresholdSec: number | null;
  /** All raw FFmpeg freeze intervals, before planned-card exclusions. */
  frozenIntervals: TemporalDynamismInterval[];
  /** Portions of frozen intervals that are real programme content. */
  evaluatedIntervals: TemporalDynamismInterval[];
  /** Evaluated intervals whose duration exceeds the lane policy. */
  violatingIntervals: TemporalDynamismInterval[];
  excludedWindows: TemporalDynamismExclusion[];
  maxFrozenHoldSec: number;
  detail?: string;
}

export interface MeasureTemporalDynamismOptions {
  videoPath: string;
  durationSec: number;
  /** null disables the quality gate for intentionally static visual formats. */
  maxStaticHoldSec: number | null | undefined;
  /** Only explicitly planned cards may be excluded from continuity measurement. */
  excludedWindows?: readonly Pick<TemporalDynamismExclusion, "startSec" | "endSec" | "reason">[];
  noiseTolerance?: number;
}

function finite(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function interval(startSec: number, endSec: number): TemporalDynamismInterval | undefined {
  const start = Math.max(0, finite(startSec));
  const end = Math.max(start, finite(endSec));
  if (end - start < 0.001) return undefined;
  return { startSec: start, endSec: end, durationSec: end - start };
}

/**
 * FFmpeg emits a start event at EOF but no matching end/duration. Treat that as
 * a hold through the measured duration so a fully frozen video cannot escape.
 */
export function parseFreezedetectIntervals(stderr: string, durationSec: number): TemporalDynamismInterval[] {
  const total = Math.max(0, finite(durationSec));
  const markers = stderr.matchAll(/freeze_(start|duration|end):\s*(-?(?:\d+(?:\.\d+)?|\.\d+))/g);
  const intervals: TemporalDynamismInterval[] = [];
  let openStart: number | undefined;
  let reportedDuration: number | undefined;

  for (const marker of markers) {
    const kind = marker[1];
    const value = finite(marker[2]);
    if (kind === "start") {
      // Recover deterministically from an incomplete prior receipt rather than
      // throwing away the earlier hold.
      if (openStart !== undefined) {
        const recovered = interval(openStart, Math.min(total, Math.max(openStart, value)));
        if (recovered) intervals.push(recovered);
      }
      openStart = Math.max(0, value);
      reportedDuration = undefined;
      continue;
    }
    if (openStart === undefined) continue;
    if (kind === "duration") {
      reportedDuration = Math.max(0, value);
      continue;
    }
    const end = Math.min(total, Math.max(openStart, value, openStart + (reportedDuration ?? 0)));
    const detected = interval(openStart, end);
    if (detected) intervals.push(detected);
    openStart = undefined;
    reportedDuration = undefined;
  }

  if (openStart !== undefined) {
    const throughEnd = interval(openStart, total);
    if (throughEnd) intervals.push(throughEnd);
  }
  return intervals;
}

function normaliseExclusions(
  exclusions: readonly Pick<TemporalDynamismExclusion, "startSec" | "endSec" | "reason">[],
  durationSec: number,
): TemporalDynamismExclusion[] {
  const total = Math.max(0, finite(durationSec));
  return exclusions.flatMap((window) => {
    const clipped = interval(
      Math.min(total, Math.max(0, finite(window.startSec))),
      Math.min(total, Math.max(0, finite(window.endSec))),
    );
    return clipped ? [{ ...clipped, reason: window.reason }] : [];
  }).sort((left, right) => left.startSec - right.startSec);
}

function subtractExclusions(
  source: TemporalDynamismInterval,
  exclusions: readonly TemporalDynamismExclusion[],
): TemporalDynamismInterval[] {
  let remaining: TemporalDynamismInterval[] = [source];
  for (const exclusion of exclusions) {
    remaining = remaining.flatMap((piece) => {
      if (exclusion.endSec <= piece.startSec || exclusion.startSec >= piece.endSec) return [piece];
      return [
        interval(piece.startSec, Math.min(piece.endSec, exclusion.startSec)),
        interval(Math.max(piece.startSec, exclusion.endSec), piece.endSec),
      ].filter((part): part is TemporalDynamismInterval => Boolean(part));
    });
  }
  return remaining;
}

function emptyEvidence(
  thresholdSec: number | null,
  verdict: TemporalDynamismVerdict,
  detail?: string,
): TemporalDynamismEvidence {
  return {
    source: "ffmpeg/freezedetect",
    ran: false,
    enforced: thresholdSec !== null,
    verdict,
    thresholdSec,
    frozenIntervals: [],
    evaluatedIntervals: [],
    violatingIntervals: [],
    excludedWindows: [],
    maxFrozenHoldSec: 0,
    ...(detail ? { detail } : {}),
  };
}

export function measureTemporalDynamism(opts: MeasureTemporalDynamismOptions): TemporalDynamismEvidence {
  const threshold = finite(opts.maxStaticHoldSec, Number.NaN);
  if (!Number.isFinite(threshold) || threshold <= 0) {
    return emptyEvidence(null, "not_required", "lane allows intentionally static visual holds");
  }
  const durationSec = Math.max(0, finite(opts.durationSec));
  const noise = finite(opts.noiseTolerance, DEFAULT_NOISE_TOLERANCE);
  const result = spawnSync(
    FFMPEG,
    [
      "-hide_banner",
      "-i", opts.videoPath,
      "-vf", `fps=4,freezedetect=n=${Math.max(0, Math.min(1, noise))}:d=${DETECTION_MIN_SEC}`,
      "-an",
      "-f", "null", "-",
    ],
    { encoding: "utf8", maxBuffer: 1 << 27 },
  );
  const failure = result.error?.message
    ?? (result.status === 0 ? undefined : `ffmpeg exited ${String(result.status)}`);
  if (failure) return emptyEvidence(threshold, "unavailable", failure);

  const frozenIntervals = parseFreezedetectIntervals(result.stderr || "", durationSec);
  const excludedWindows = normaliseExclusions(opts.excludedWindows ?? [], durationSec);
  const evaluatedIntervals = frozenIntervals.flatMap((frozen) => subtractExclusions(frozen, excludedWindows));
  // FFmpeg works on decoded frame boundaries; keep a tiny grace margin so a
  // planned hold at the exact lane limit is not rejected for one frame.
  const violatingIntervals = evaluatedIntervals.filter((frozen) => frozen.durationSec > threshold + 0.05);
  const maxFrozenHoldSec = evaluatedIntervals.reduce((max, frozen) => Math.max(max, frozen.durationSec), 0);

  return {
    source: "ffmpeg/freezedetect",
    ran: true,
    enforced: true,
    verdict: violatingIntervals.length ? "fail" : "pass",
    thresholdSec: threshold,
    frozenIntervals,
    evaluatedIntervals,
    violatingIntervals,
    excludedWindows,
    maxFrozenHoldSec,
  };
}
