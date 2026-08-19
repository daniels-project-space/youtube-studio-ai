/**
 * Final-master visual pacing evidence.
 *
 * This measures only one narrow, repeatable fact: where FFmpeg sees a strong
 * visual discontinuity in the assembled master. It deliberately does NOT call
 * a cut count "quality". A continuous camera move, drawn whiteboard sequence,
 * or generated cinematic shot can be excellent without producing a hard scene
 * marker. When the marker cadence is below a lane's calibration, the receipt
 * therefore asks for human confirmation instead of declaring the video bad.
 */
import { spawnSync } from "node:child_process";
import { z } from "zod";

const FFMPEG = process.env.FFMPEG_BIN ?? "ffmpeg";
const SAMPLE_FPS = 4;
// At 4fps the selected marker can land up to one sample after an edit. Keep a
// small deterministic grace so a cadence designed at the exact lane boundary
// is not sent to review for one decoded frame.
const MARKER_GRACE_SEC = 1 / SAMPLE_FPS + 0.05;

export const VisualPacingModeSchema = z.enum([
  "scene_rhythm",
  "calibrated_review",
  "exempt",
]);
export type VisualPacingMode = z.infer<typeof VisualPacingModeSchema>;

export const VisualPacingVerdictSchema = z.enum([
  "pass",
  "needs_human",
  "unavailable",
  "not_required",
]);
export type VisualPacingVerdict = z.infer<typeof VisualPacingVerdictSchema>;

export const VisualPacingSignalSchema = z.enum([
  "scene_rhythm_observed",
  "calibrated_scene_rhythm_observed",
  "pacing_calibration_needed",
  "pacing_exempt_static_visual_bed",
  "pacing_measurement_unavailable",
]);
export type VisualPacingSignal = z.infer<typeof VisualPacingSignalSchema>;

export const VisualPacingIntervalSchema = z.object({
  startSec: z.number().finite().nonnegative(),
  endSec: z.number().finite().nonnegative(),
  durationSec: z.number().finite().nonnegative(),
}).strict();
export type VisualPacingInterval = z.infer<typeof VisualPacingIntervalSchema>;

export const VisualPacingExclusionSchema = VisualPacingIntervalSchema.extend({
  /** Only planned title/outro cards may be omitted from programme rhythm. */
  reason: z.string().min(1),
}).strict();
export type VisualPacingExclusion = z.infer<typeof VisualPacingExclusionSchema>;

/**
 * `scene_rhythm` can establish a useful lower-bound cadence (for example a
 * Short). `calibrated_review` is for lanes where one sustained evolving shot is
 * editorially legitimate: missing markers mean "confirm with a reviewer", not
 * "this is a bad video". Ambient/music visual beds are explicitly exempt.
 */
export const VisualPacingPolicySchema = z.object({
  mode: VisualPacingModeSchema,
  /** FFmpeg `scene` score (0..1) that counts as a strong discontinuity. */
  sceneThreshold: z.number().finite().min(0).max(1),
  /** Maximum marker-free programme hold. Null is valid only for `exempt`. */
  maxMarkerHoldSec: z.number().finite().positive().nullable(),
  /** Why this cadence suits the lane; carried into the final receipt. */
  rationale: z.string().min(1),
}).superRefine((value, ctx) => {
  if (value.mode === "exempt" && value.maxMarkerHoldSec !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "exempt pacing policy must not set maxMarkerHoldSec" });
  }
  if (value.mode !== "exempt" && value.maxMarkerHoldSec === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "measured pacing policy needs maxMarkerHoldSec" });
  }
});
export type VisualPacingPolicy = z.infer<typeof VisualPacingPolicySchema>;

export const VisualPacingEvidenceSchema = z.object({
  source: z.literal("ffmpeg/select-scene"),
  /** FFmpeg process completed successfully. */
  ran: z.boolean(),
  /** A receipt was obtained or the lane explicitly exempted it. */
  usable: z.boolean(),
  enforced: z.boolean(),
  verdict: VisualPacingVerdictSchema,
  signal: VisualPacingSignalSchema,
  durationSec: z.number().finite().nonnegative(),
  policy: VisualPacingPolicySchema,
  /** Strong visual-change timestamps selected from the assembled master. */
  changeTimestampsSec: z.array(z.number().finite().nonnegative()),
  changeCount: z.number().int().nonnegative(),
  /** Raw marker-to-marker intervals before planned-card exclusions. */
  rawHoldIntervals: z.array(VisualPacingIntervalSchema),
  /** Programme intervals actually evaluated against the lane's cadence. */
  evaluatedHoldIntervals: z.array(VisualPacingIntervalSchema),
  excludedWindows: z.array(VisualPacingExclusionSchema),
  maxHoldSec: z.number().finite().nonnegative(),
  medianHoldSec: z.number().finite().nonnegative(),
  /** Null only when the lane is exempt or evidence is unavailable. */
  meetsPolicy: z.boolean().nullable(),
  detail: z.string().optional(),
}).strict();
export type VisualPacingEvidence = z.infer<typeof VisualPacingEvidenceSchema>;

export interface MeasureVisualPacingOptions {
  videoPath: string;
  durationSec: number;
  policy?: VisualPacingPolicy;
  /** Explicitly applied title/outro cards do not represent programme pacing. */
  excludedWindows?: readonly Pick<VisualPacingExclusion, "startSec" | "endSec" | "reason">[];
}

/** Conservative default for legacy callers that have not yet supplied a lane. */
export const DEFAULT_VISUAL_PACING_POLICY: VisualPacingPolicy = {
  mode: "calibrated_review",
  sceneThreshold: 0.12,
  maxMarkerHoldSec: 10,
  rationale: "Strong scene markers corroborate final-master rhythm, while a valid continuous take remains a human-review calibration case.",
};

function finite(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function interval(startSec: number, endSec: number): VisualPacingInterval | undefined {
  const start = Math.max(0, finite(startSec));
  const end = Math.max(start, finite(endSec));
  if (end - start < 0.001) return undefined;
  return { startSec: start, endSec: end, durationSec: end - start };
}

function normaliseExclusions(
  exclusions: readonly Pick<VisualPacingExclusion, "startSec" | "endSec" | "reason">[],
  durationSec: number,
): VisualPacingExclusion[] {
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
  source: VisualPacingInterval,
  exclusions: readonly VisualPacingExclusion[],
): VisualPacingInterval[] {
  let remaining: VisualPacingInterval[] = [source];
  for (const exclusion of exclusions) {
    remaining = remaining.flatMap((piece) => {
      if (exclusion.endSec <= piece.startSec || exclusion.startSec >= piece.endSec) return [piece];
      return [
        interval(piece.startSec, Math.min(piece.endSec, exclusion.startSec)),
        interval(Math.max(piece.startSec, exclusion.endSec), piece.endSec),
      ].filter((part): part is VisualPacingInterval => Boolean(part));
    });
  }
  return remaining;
}

function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function normalisePolicy(policy: VisualPacingPolicy | undefined): VisualPacingPolicy {
  const parsed = VisualPacingPolicySchema.safeParse(policy ?? DEFAULT_VISUAL_PACING_POLICY);
  // A typed caller cannot normally reach this branch. Preserve a usable,
  // conservative receipt rather than generating an unsafe executable filter if
  // a legacy runtime has put malformed data on the boundary.
  return parsed.success ? parsed.data : DEFAULT_VISUAL_PACING_POLICY;
}

function emptyEvidence(
  policy: VisualPacingPolicy,
  durationSec: number,
  verdict: "unavailable" | "not_required",
  detail?: string,
): VisualPacingEvidence {
  const exempt = verdict === "not_required";
  return {
    source: "ffmpeg/select-scene",
    ran: false,
    usable: exempt,
    enforced: !exempt,
    verdict,
    signal: exempt ? "pacing_exempt_static_visual_bed" : "pacing_measurement_unavailable",
    durationSec,
    policy,
    changeTimestampsSec: [],
    changeCount: 0,
    rawHoldIntervals: [],
    evaluatedHoldIntervals: [],
    excludedWindows: [],
    maxHoldSec: 0,
    medianHoldSec: 0,
    meetsPolicy: null,
    ...(detail ? { detail } : {}),
  };
}

/**
 * `showinfo` receives only frames that passed the `scene` expression. Parsing
 * its timestamps is less version-sensitive than machine-parsing FFmpeg's
 * human-oriented `scdet` log and works with the FFmpeg already used by QA.
 */
export function parseSceneChangeTimestamps(stderr: string, durationSec: number): number[] {
  const total = Math.max(0, finite(durationSec));
  const candidates = [...stderr.matchAll(/\bpts_time:\s*(-?(?:\d+(?:\.\d+)?|\.\d+))/g)]
    .map((match) => Math.min(total, Math.max(0, finite(match[1]))))
    .filter((timeSec) => timeSec > 0.001 && timeSec < total - 0.001)
    .sort((left, right) => left - right);
  return candidates.filter((timeSec, index) => index === 0 || timeSec - candidates[index - 1] > 0.001);
}

function holdsForChanges(changeTimestampsSec: readonly number[], durationSec: number): VisualPacingInterval[] {
  const total = Math.max(0, finite(durationSec));
  const boundaries = [0, ...changeTimestampsSec, total];
  return boundaries.slice(1).flatMap((endSec, index) => interval(boundaries[index], endSec) ? [interval(boundaries[index], endSec)!] : []);
}

/**
 * Measure final-master scene-marker rhythm. A `needs_human` verdict means the
 * lane's chosen marker cadence was not demonstrated; it is deliberately not a
 * cut-count failure because FFmpeg cannot see the quality of continuous visual
 * evolution. Callers should route that named signal to existing visual review.
 */
export function measureVisualPacing(opts: MeasureVisualPacingOptions): VisualPacingEvidence {
  const durationSec = Math.max(0, finite(opts.durationSec));
  const policy = normalisePolicy(opts.policy);
  if (policy.mode === "exempt") {
    return emptyEvidence(policy, durationSec, "not_required", "lane intentionally treats a static visual bed as valid pacing");
  }
  if (durationSec <= 0) {
    return emptyEvidence(policy, durationSec, "unavailable", "final-master duration is not a positive finite value");
  }

  const result = spawnSync(
    FFMPEG,
    [
      "-hide_banner",
      "-i", opts.videoPath,
      "-vf", `fps=${SAMPLE_FPS},select='gt(scene,${policy.sceneThreshold})',showinfo`,
      "-an",
      "-f", "null", "-",
    ],
    { encoding: "utf8", maxBuffer: 1 << 27 },
  );
  const failure = result.error?.message
    ?? (result.status === 0 ? undefined : `ffmpeg exited ${String(result.status)}`);
  if (failure) return emptyEvidence(policy, durationSec, "unavailable", failure);

  const changeTimestampsSec = parseSceneChangeTimestamps(result.stderr || "", durationSec);
  const rawHoldIntervals = holdsForChanges(changeTimestampsSec, durationSec);
  const excludedWindows = normaliseExclusions(opts.excludedWindows ?? [], durationSec);
  const evaluatedHoldIntervals = rawHoldIntervals.flatMap((hold) => subtractExclusions(hold, excludedWindows));
  const maxHoldSec = evaluatedHoldIntervals.reduce((max, hold) => Math.max(max, hold.durationSec), 0);
  const medianHoldSec = median(evaluatedHoldIntervals.map((hold) => hold.durationSec));
  const maxAllowed = policy.maxMarkerHoldSec!;
  const meetsPolicy = maxHoldSec <= maxAllowed + MARKER_GRACE_SEC;

  return {
    source: "ffmpeg/select-scene",
    ran: true,
    usable: true,
    enforced: true,
    verdict: meetsPolicy ? "pass" : "needs_human",
    signal: meetsPolicy
      ? policy.mode === "scene_rhythm" ? "scene_rhythm_observed" : "calibrated_scene_rhythm_observed"
      : "pacing_calibration_needed",
    durationSec,
    policy,
    changeTimestampsSec,
    changeCount: changeTimestampsSec.length,
    rawHoldIntervals,
    evaluatedHoldIntervals,
    excludedWindows,
    maxHoldSec,
    medianHoldSec,
    meetsPolicy,
    ...(!meetsPolicy ? {
      detail: `longest strong-marker-free programme interval ${maxHoldSec.toFixed(2)}s exceeds ${maxAllowed.toFixed(2)}s; continuous visual evolution may be valid, so confirm with the scene-aware reviewer`,
    } : {}),
  };
}
