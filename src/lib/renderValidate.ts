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
 *   - final-master scene-marker pacing evidence. This is deliberately a
 *     calibrated review signal rather than a universal cut-count quality gate:
 *     a good sustained evolving shot need not contain a hard edit.
 *
 * Decode-bound. Detecting "card present but text missing" is left to the
 * evidence-backed visual review / optional OCR — signal stats cannot establish it.
 */
import { spawnSync } from "node:child_process";
import { stat } from "node:fs/promises";
import { sha256ShotAnalysisSource } from "./shotAnalysis";
import { assertMusicLoopReviewCoverage, type MusicLoopReviewCoverage } from "./musicLoopReviewCoverage";
import {
  measureTemporalDynamism,
  type TemporalDynamismEvidence,
} from "./temporalDynamism";
import {
  measureVisualPacing,
  type VisualPacingEvidence,
  type VisualPacingPolicy,
} from "./visualPacing";

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
  visualPacing: VisualPacingEvidence;
  blackFrameEvidence?: {
    version: "repeated-music-black-evidence/v1";
    sourceSha256: string;
    sourceDurationSec: number;
    decodedDurationSec: 90;
    pixelThreshold: 0.04;
    sampleFps: 4;
    minimumBlackSec: number;
    bodyPacketTemplateSha256: string;
  };
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
  /** Lane-owned final-master scene-marker calibration. */
  visualPacingPolicy?: VisualPacingPolicy;
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
  /** Fresh review proof from this master, not a pipeline parameter or cached hint. */
  musicLoopReview?: { coverage: MusicLoopReviewCoverage; frameTimes: readonly number[] };
}): Promise<RenderValidateResult> {
  const log = opts.log ?? (() => {});
  const tail = opts.tailSec ?? 4;
  const defects: RVDefect[] = [];
  const override = Number(opts.channel?.blackSegmentMinSec);
  const blackMinSec = Number.isFinite(override) && override > 0
    ? override
    : LANE_BLACK_MIN_SEC[opts.channel?.contentLaneKey ?? ""] ?? DEFAULT_BLACK_MIN_SEC;

  let blackCheckRan = true;
  let blackFrameEvidence: RenderValidateResult["blackFrameEvidence"];
  try {
    // Two body units expose both in-unit darkness and wrap-spanning darkness.
    // Larger custom thresholds retain the ordinary whole-programme scan.
    const useRepetition = opts.musicLoopReview !== undefined && blackMinSec <= 30;
    const deadline = Date.now() + 180_000;
    const signal = useRepetition ? AbortSignal.timeout(180_000) : undefined;
    let loopProof: MusicLoopReviewCoverage | undefined;
    let initialStat: Awaited<ReturnType<typeof stat>> | undefined;
    if (useRepetition) {
      if (opts.channel?.contentLaneKey !== "music_loop" || opts.channel.maxStaticHoldSec !== null ||
        opts.channel.visualPacingPolicy?.mode !== "exempt") {
        throw new Error("repeated black-frame scan requires the explicit music-loop lane exemptions");
      }
      initialStat = await stat(opts.videoPath);
      if (!initialStat.isFile()) throw new Error("repeated black-frame scan requires a regular local master");
      const sourceSha256 = await sha256ShotAnalysisSource(opts.videoPath, { signal });
      loopProof = assertMusicLoopReviewCoverage({ coverage: opts.musicLoopReview!.coverage,
        source: { sha256: sourceSha256, durationSec: opts.durationSec, byteLength: initialStat.size },
        frameTimes: opts.musicLoopReview!.frameTimes });
    }
    // Decode at 4fps for speed; only segments >= blackMinSec of black count as
    // dead air (2.5s generic; see LANE_BLACK_MIN_SEC for the lane overrides).
    const bd = spawnSync(
      FFMPEG,
      // pix_th 0.04 = only near-TRUE-black pixels count. The old 0.10 flagged
      // legitimate crushed-blacks night footage (an on-DNA aerial city-at-night
      // read as "dead air") — encoder-black / empty segments still trip it.
      ["-hide_banner", "-nostats", "-i", opts.videoPath, ...(loopProof ? ["-t", "90"] : []),
        "-vf", `fps=4,blackdetect=d=${blackMinSec}:pix_th=0.04`, "-an", "-f", "null", "-"],
      { encoding: "utf8", maxBuffer: loopProof ? 64 * 1024 : 1 << 27,
        ...(loopProof ? { timeout: Math.max(1, deadline - Date.now()), killSignal: "SIGKILL" as const } : {}) },
    );
    if (bd.error || bd.status !== 0) {
      throw new Error(bd.error?.message ?? `ffmpeg exited ${String(bd.status)}`);
    }
    if (loopProof) {
      if (Date.now() >= deadline || await sha256ShotAnalysisSource(opts.videoPath, { signal }) !== loopProof.repetition.masterSha256) {
        throw new Error("repeated black-frame source changed or exceeded its deadline");
      }
      const after = await stat(opts.videoPath);
      if (after.size !== initialStat!.size || after.ino !== initialStat!.ino || after.dev !== initialStat!.dev || after.mtimeMs !== initialStat!.mtimeMs) {
        throw new Error("repeated black-frame source identity changed during decode");
      }
      blackFrameEvidence = { version: "repeated-music-black-evidence/v1", sourceSha256: loopProof.repetition.masterSha256,
        sourceDurationSec: opts.durationSec, decodedDurationSec: 90, pixelThreshold: 0.04, sampleFps: 4,
        minimumBlackSec: blackMinSec, bodyPacketTemplateSha256: loopProof.repetition.bodyPacketTemplateSha256 };
      log(`validateRender: black/dead-air scan decoded 90s with exact-master repetition proof for ${opts.durationSec}s`);
    }
    for (const m of (bd.stderr || "").matchAll(/black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)/g)) {
      const start = +m[1];
      const end = +m[2];
      const d = +m[3];
      const atVeryEnd = start > 0 && start >= Math.max(0, opts.durationSec - (tail + 2)) && end > opts.durationSec - (tail + 2);
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

  const visualPacing = measureVisualPacing({
    videoPath: opts.videoPath,
    durationSec: opts.durationSec,
    policy: opts.channel?.visualPacingPolicy,
    excludedWindows: plannedCardWindows,
  });
  if (visualPacing.verdict === "unavailable") {
    defects.push({
      severity: "critical",
      issue: `visual pacing evidence unavailable (${visualPacing.source}): ${visualPacing.detail ?? "unknown ffmpeg failure"}`,
    });
  } else if (visualPacing.verdict === "needs_human") {
    // This is intentionally NOT a deterministic defect. FFmpeg can establish
    // that it did not see strong discontinuities, but it cannot tell an
    // excellent sustained move from a poorly paced master. qa_visual owns the
    // lane-calibrated human-review decision and carries this receipt forward.
    log(`validateRender: visual pacing ${visualPacing.signal}: ${visualPacing.detail ?? "review required"}`);
  }

  if (opts.introApplied === false) {
    defects.push({ severity: "major", tSec: 0, issue: "no intro/title card was applied" });
  }

  const crit = defects.filter((d) => d.severity === "critical").length;
  const verdict: "pass" | "fail" = crit >= 1 ? "fail" : "pass";
  const laneNote = opts.channel?.contentLaneKey
    ? ` [lane ${opts.channel.contentLaneKey}, dead-air >=${blackMinSec}s, static-hold ${temporalDynamism.thresholdSec === null ? "exempt" : `<=${temporalDynamism.thresholdSec}s / observed ${temporalDynamism.maxFrozenHoldSec.toFixed(1)}s`}, pacing ${visualPacing.verdict} (${visualPacing.changeCount} markers, max-hold ${visualPacing.maxHoldSec.toFixed(1)}s)${opts.channel.criticDoctrine ? ", doctrine in scope (advisory only — this gate is deterministic)" : ""}]`
    : "";
  log(`validateRender: ${defects.length} defect(s) (critical ${crit})${laneNote} → ${verdict.toUpperCase()}`);
  return {
    ran: blackCheckRan &&
      (!temporalDynamism.enforced || temporalDynamism.ran) &&
      (!visualPacing.enforced || visualPacing.ran),
    verdict,
    defects,
    temporalDynamism,
    visualPacing,
    ...(blackFrameEvidence ? { blackFrameEvidence } : {}),
  };
}
