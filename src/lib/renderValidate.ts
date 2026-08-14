/**
 * DETERMINISTIC render gate — no LLM, never flaky. The evidence-backed visual
 * reviewer handles subjective issues separately; the hard pass/fail is decided
 * here from signals + plan facts the pipeline already knows:
 *
 *   - DEAD AIR / dropped segment / empty insert  = a long (>=2.5s) BLACK segment
 *     anywhere except the very end (the outro legitimately fades to black). Tuned
 *     long enough that legit chapter/quote fades (~0.3-0.8s) are NOT flagged.
 *   - intro/title card present (plan fact).
 *   - accidental frozen / near-identical programme holds, with exact FFmpeg
 *     intervals returned for the owning renderer to repair.
 *
 * Reliable + instant. Detecting "card present but text missing" is left to the
 * evidence-backed visual review / optional OCR — signal stats cannot establish it.
 */
import { spawnSync } from "node:child_process";
import {
  measureTemporalDynamism,
  type TemporalDynamismEvidence,
} from "./temporalDynamism";

const FFMPEG = process.env.FFMPEG_BIN ?? "ffmpeg";

export interface RVDefect {
  severity: "critical" | "major";
  tSec?: number;
  issue: string;
}
export interface RenderValidateResult {
  ran: boolean;
  verdict: "pass" | "fail";
  defects: RVDefect[];
  temporalDynamism: TemporalDynamismEvidence;
}

/**
 * Per-channel context for the deterministic gate.
 *
 * IMPORTANT — read before extending: this gate is deliberately NOT model-graded
 * and NOT taste-driven. `contentLaneKey` is honoured because "how long may the
 * frame legitimately stay near-black" is a real, deterministic, lane-dependent
 * fact (a night-time ambient loop holds darkness far longer than a 45s Short).
 * `criticDoctrine` is accepted only so the run's evidence records that the
 * channel's doctrine was in scope at this stage; it is prose, and prose must
 * never flip a deterministic pass/fail — the doctrine does its real work in
 * `visualReview.reviewRender`, which is the model-graded holistic gate.
 */
export interface RenderValidateChannelContext {
  contentLaneKey?: string;
  criticDoctrine?: string;
  /** Explicit override; wins over the lane default when finite and > 0. */
  blackSegmentMinSec?: number;
  /** `null` disables static-hold enforcement for intentional ambient formats. */
  maxStaticHoldSec?: number | null;
}

/** Lane-dependent dead-air threshold. Unknown lanes keep the historic 2.5s. */
const DEFAULT_BLACK_MIN_SEC = 2.5;
const LANE_BLACK_MIN_SEC: Readonly<Record<string, number>> = {
  music_loop: 6,
  ambient_guided: 6,
  short_form: 1.2,
  documentary_collage_short: 1.2,
};

export async function validateRender(opts: {
  videoPath: string;
  durationSec: number;
  introSec?: number;
  tailSec?: number;
  introApplied?: boolean;
  outroApplied?: boolean;
  channel?: RenderValidateChannelContext;
  log?: (m: string) => void;
}): Promise<RenderValidateResult> {
  const log = opts.log ?? (() => {});
  const tail = opts.tailSec ?? 4;
  const defects: RVDefect[] = [];
  const override = Number(opts.channel?.blackSegmentMinSec);
  const blackMinSec = Number.isFinite(override) && override > 0
    ? override
    : LANE_BLACK_MIN_SEC[opts.channel?.contentLaneKey ?? ""] ?? DEFAULT_BLACK_MIN_SEC;

  let blackCheckRan = true;
  try {
    // Decode at 4fps for speed; only segments >= blackMinSec of black count as
    // dead air (2.5s generic; see LANE_BLACK_MIN_SEC for the lane overrides).
    const bd = spawnSync(
      FFMPEG,
      // pix_th 0.04 = only near-TRUE-black pixels count. The old 0.10 flagged
      // legitimate crushed-blacks night footage (an on-DNA aerial city-at-night
      // read as "dead air") — encoder-black / empty segments still trip it.
      ["-i", opts.videoPath, "-vf", `fps=4,blackdetect=d=${blackMinSec}:pix_th=0.04`, "-an", "-f", "null", "-"],
      { encoding: "utf8", maxBuffer: 1 << 27 },
    );
    if (bd.error || bd.status !== 0) {
      throw new Error(bd.error?.message ?? `ffmpeg exited ${String(bd.status)}`);
    }
    for (const m of (bd.stderr || "").matchAll(/black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)/g)) {
      const start = +m[1];
      const end = +m[2];
      const d = +m[3];
      const atVeryEnd = end > opts.durationSec - (tail + 2);
      if (!atVeryEnd) {
        defects.push({ severity: "critical", tSec: start, issue: `dead air: ${d.toFixed(1)}s black at ${start.toFixed(1)}s (empty insert / dropped segment)` });
      }
    }
  } catch (e) {
    blackCheckRan = false;
    const detail = e instanceof Error ? e.message : String(e);
    // `ran: false` is useful receipt metadata, but callers must not need to
    // remember to interpret it before using the verdict as a release decision.
    // Treat a missing black/dead-air measurement as a deterministic-gate
    // failure here so every consumer gets the same fail-closed answer.
    defects.push({
      severity: "critical",
      issue: `black/dead-air evidence unavailable: ${detail}`,
    });
    log(`validateRender: black-segment measurement unavailable: ${detail}`);
  }

  // Only explicit, successfully-applied planned cards are excluded. A generic
  // start/end margin would make an accidental frozen title or outro invisible.
  const plannedCardWindows = [
    ...(opts.introApplied === true && Number(opts.introSec) > 0
      ? [{ startSec: 0, endSec: Number(opts.introSec), reason: "planned intro/title card" }]
      : []),
    ...(opts.outroApplied === true && Number(opts.tailSec) > 0
      ? [{
          startSec: Math.max(0, opts.durationSec - Number(opts.tailSec)),
          endSec: opts.durationSec,
          reason: "planned outro card",
        }]
      : []),
  ];
  const temporalDynamism = measureTemporalDynamism({
    videoPath: opts.videoPath,
    durationSec: opts.durationSec,
    maxStaticHoldSec: opts.channel?.maxStaticHoldSec,
    excludedWindows: plannedCardWindows,
  });
  if (temporalDynamism.verdict === "unavailable") {
    defects.push({
      severity: "critical",
      issue: `temporal dynamism evidence unavailable (${temporalDynamism.source}): ${temporalDynamism.detail ?? "unknown ffmpeg failure"}`,
    });
  }
  for (const frozen of temporalDynamism.violatingIntervals) {
    defects.push({
      severity: "critical",
      tSec: frozen.startSec,
      issue: `static visual hold: ${frozen.durationSec.toFixed(1)}s at ${frozen.startSec.toFixed(1)}–${frozen.endSec.toFixed(1)}s exceeds ${temporalDynamism.thresholdSec?.toFixed(1)}s lane maximum (${temporalDynamism.source}; repair this interval)`,
    });
  }

  if (opts.introApplied === false) {
    defects.push({ severity: "major", tSec: 0, issue: "no intro/title card was applied" });
  }

  const crit = defects.filter((d) => d.severity === "critical").length;
  const verdict: "pass" | "fail" = crit >= 1 ? "fail" : "pass";
  const laneNote = opts.channel?.contentLaneKey
    ? ` [lane ${opts.channel.contentLaneKey}, dead-air >=${blackMinSec}s, static-hold ${temporalDynamism.thresholdSec === null ? "exempt" : `<=${temporalDynamism.thresholdSec}s / observed ${temporalDynamism.maxFrozenHoldSec.toFixed(1)}s`}${opts.channel.criticDoctrine ? ", doctrine in scope (advisory only — this gate is deterministic)" : ""}]`
    : "";
  log(`validateRender: ${defects.length} defect(s) (critical ${crit})${laneNote} → ${verdict.toUpperCase()}`);
  return {
    ran: blackCheckRan && (!temporalDynamism.enforced || temporalDynamism.ran),
    verdict,
    defects,
    temporalDynamism,
  };
}
