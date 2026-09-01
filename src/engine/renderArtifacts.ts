import { z } from "zod";

import { LtxCreativeAdapterInputSchema } from "@/lib/ltxCreativeAdapter";

export const GenerationIdentitySchema = z.object({
  contractVersion: z.literal("1.0.0"),
  profileId: z.enum(["draft", "production", "hero"]),
  model: z.string().min(1),
  revision: z.string().regex(/^[a-f0-9]{40}$/),
  checkpoint: z.string().min(1),
  precision: z.enum(["bf16", "fp16"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  steps: z.number().int().positive(),
  allowFallback: z.literal(false),
});

export const StillRenderManifestSchema = z.object({
  version: z.literal("1.0.0"),
  generation: GenerationIdentitySchema,
  items: z.array(z.object({
    shotId: z.string().min(1),
    candidateIndex: z.number().int().nonnegative(),
    outputId: z.string().min(1),
    stillKey: z.string().min(1),
  })).min(1),
});

export const SelectedStillManifestSchema = z.object({
  version: z.literal("1.0.0"),
  generation: GenerationIdentitySchema,
  items: z.array(z.object({
    shotId: z.string().min(1),
    stillKey: z.string().min(1),
    candidateIndex: z.number().int().nonnegative(),
    score: z.number().min(0).max(1),
    semanticAlignment: z.number().min(0).max(1),
    continuity: z.number().min(0).max(1),
    artifactFree: z.number().min(0).max(1),
    notes: z.array(z.string()),
  })).min(1),
});

export const AssetQaReportSchema = z.object({
  version: z.literal("1.0.0"),
  required: z.literal(true),
  graderRan: z.literal(true),
  passed: z.literal(true),
  shotCount: z.number().int().positive(),
  candidateCount: z.number().int().positive(),
  selected: z.array(z.object({
    shotId: z.string().min(1),
    candidateIndex: z.number().int().nonnegative(),
    score: z.number().min(0).max(1),
    threshold: z.number().min(0).max(1),
  })).min(1),
});

export const ShotRenderManifestSchema = z.object({
  version: z.literal("1.0.0"),
  generation: GenerationIdentitySchema.extend({
    fps: z.number().int().positive(),
    guidanceScale: z.number().positive(),
    pipeline: z.literal("distilled"),
    twoStageRefine: z.literal(true),
    textEncoderCheckpoint: z.string().min(1),
    videoVaeCheckpoint: z.string().min(1),
    audioVaeCheckpoint: z.string().min(1),
    spatialUpscalerCheckpoint: z.string().min(1),
    quantization: z.literal("fp8-cast"),
    offload: z.literal("cpu"),
    spatialUpscaleFactor: z.literal(2),
    stageOneWidth: z.number().int().positive(),
    stageOneHeight: z.number().int().positive(),
    /** Worker-observed encoded dimensions after the LTX latent x2 stage. */
    outputWidth: z.number().int().positive(),
    outputHeight: z.number().int().positive(),
  }),
  durationSec: z.number().finite().positive(),
  items: z.array(z.object({
    shotId: z.string().min(1),
    clipKey: z.string().min(1),
    t0: z.number().finite().nonnegative(),
    t1: z.number().finite().positive(),
    sourceSentenceIds: z.array(z.string()).min(1),
    continuityState: z.string().min(1),
    /**
     * Exact standard-LoRA selection that created this clip. A QA replacement
     * must replay this sealed adapter rather than consult a mutable/global
     * render parameter and accidentally change the channel's visual identity.
     */
    creativeAdapter: LtxCreativeAdapterInputSchema.optional(),
    /**
     * Present only when this clip is LTX-conditioned to arrive at the
     * already-selected first frame of the following continuous shot.
     */
    terminalAnchorShotId: z.string().min(1).optional(),
    terminalStillKey: z.string().min(1).optional(),
  }).refine((item) => item.t1 > item.t0, "rendered shot t1 must follow t0").refine(
    (item) => Boolean(item.terminalAnchorShotId) === Boolean(item.terminalStillKey),
    "rendered terminal anchor id and still key must be supplied together",
  )).min(1),
});

const ShotQaGradeSchema = z.object({
  shotId: z.string().min(1),
  score: z.number().min(0).max(1),
  threshold: z.number().min(0).max(1),
  semanticAlignment: z.number().min(0).max(1),
  continuity: z.number().min(0).max(1),
  motionIntegrity: z.number().min(0).max(1),
  artifactFree: z.number().min(0).max(1),
  /** Required whenever the rendered shot had a terminalStillKey. */
  terminalFrameAlignment: z.number().min(0).max(1).optional(),
  notes: z.array(z.string()),
});

const TemporalDynamismIntervalSchema = z.object({
  startSec: z.number().finite().nonnegative(),
  endSec: z.number().finite().positive(),
  durationSec: z.number().finite().positive(),
}).refine(
  (interval) => interval.endSec > interval.startSec,
  "temporal-dynamism interval must have positive ordered duration",
);

export const LtxShotTemporalQaEvidenceSchema = z.object({
  contract: z.literal("ltx-shot-temporal-qa/v1"),
  source: z.literal("ffmpeg/freezedetect"),
  verdict: z.literal("pass"),
  maxFreezeFraction: z.number().positive().max(0.2),
  maxStaticHoldSec: z.number().positive(),
  maxFrozenHoldSec: z.number().finite().nonnegative(),
  openingFrozenHoldSec: z.number().finite().nonnegative(),
  frozenIntervals: z.array(TemporalDynamismIntervalSchema),
  violatingIntervals: z.array(TemporalDynamismIntervalSchema).length(0),
  detail: z.string().min(1).optional(),
}).superRefine((evidence, ctx) => {
  const graceSec = 0.05;
  const longestMeasured = evidence.frozenIntervals.reduce(
    (longest, interval) => Math.max(longest, interval.durationSec),
    0,
  );
  if (Math.abs(longestMeasured - evidence.maxFrozenHoldSec) > 0.01) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["maxFrozenHoldSec"],
      message: "accepted LTX temporal evidence maximum does not match its measured intervals",
    });
  }
  if (evidence.openingFrozenHoldSec > evidence.maxFrozenHoldSec + 0.01) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["openingFrozenHoldSec"],
      message: "accepted LTX opening hold cannot exceed the measured maximum hold",
    });
  }
  if (evidence.maxFrozenHoldSec > evidence.maxStaticHoldSec + graceSec) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["maxFrozenHoldSec"],
      message: "accepted LTX temporal evidence exceeds its static-hold limit",
    });
  }
});

const LegacyShotQaReportSchema = z.object({
  version: z.literal("1.0.0"),
  required: z.literal(true),
  graderRan: z.literal(true),
  passed: z.literal(true),
  shots: z.array(ShotQaGradeSchema).min(1),
});

const CurrentShotQaReportSchema = z.object({
  version: z.literal("1.1.0"),
  required: z.literal(true),
  graderRan: z.literal(true),
  passed: z.literal(true),
  shots: z.array(ShotQaGradeSchema.extend({
    temporalDynamism: LtxShotTemporalQaEvidenceSchema,
  })).min(1),
});

/**
 * v1 remains parseable so retained evidence can still be inspected. It cannot
 * authorize a new assembly: validateQualifiedShotRender requires the v1.1
 * deterministic motion receipt for every accepted LTX take.
 */
export const ShotQaReportSchema = z.discriminatedUnion("version", [
  LegacyShotQaReportSchema,
  CurrentShotQaReportSchema,
]);

export const VisualCoverageSchema = z.object({
  version: z.literal("1.0.0"),
  mappedSec: z.number().finite().positive(),
  totalSec: z.number().finite().positive(),
  ratio: z.literal(1),
  missingShotIds: z.array(z.string()).length(0),
  duplicateShotIds: z.array(z.string()).length(0),
});

export type StillRenderManifest = z.infer<typeof StillRenderManifestSchema>;
export type SelectedStillManifest = z.infer<typeof SelectedStillManifestSchema>;
export type ShotRenderManifest = z.infer<typeof ShotRenderManifestSchema>;
export type ShotQaReport = z.infer<typeof ShotQaReportSchema>;
export type VisualCoverage = z.infer<typeof VisualCoverageSchema>;

/**
 * Validate the three artifacts as one authorization proof for assembly. A QA
 * report from another render (or a coverage receipt with different timing)
 * must never authorize the supplied clip manifest.
 */
export function validateQualifiedShotRender(args: {
  manifest: unknown;
  qaReport: unknown;
  coverage: unknown;
}): {
  manifest: ShotRenderManifest;
  qaReport: ShotQaReport;
  coverage: VisualCoverage;
} {
  const manifest = ShotRenderManifestSchema.parse(args.manifest);
  const qaReport = ShotQaReportSchema.parse(args.qaReport);
  const coverage = VisualCoverageSchema.parse(args.coverage);
  if (qaReport.version !== "1.1.0") {
    throw new Error(
      "qualified shot render requires shot QA v1.1 deterministic temporal evidence; rerun qa_shots for this retained render",
    );
  }
  const epsilon = 0.02;
  const seen = new Set<string>();
  for (let index = 0; index < manifest.items.length; index++) {
    const item = manifest.items[index];
    if (seen.has(item.shotId)) throw new Error(`qualified shot render duplicates ${item.shotId}`);
    seen.add(item.shotId);
    if (index === 0 && Math.abs(item.t0) > epsilon) {
      throw new Error("qualified shot render must begin at t=0");
    }
    if (index > 0 && Math.abs(item.t0 - manifest.items[index - 1].t1) > epsilon) {
      throw new Error(`qualified shot render has a coverage gap or overlap before ${item.shotId}`);
    }
  }
  if (Math.abs(manifest.items.at(-1)!.t1 - manifest.durationSec) > epsilon) {
    throw new Error("qualified shot render does not end at its declared duration");
  }
  if (qaReport.shots.length !== manifest.items.length) {
    throw new Error("qualified shot render QA count does not match manifest count");
  }
  qaReport.shots.forEach((grade, index) => {
    const item = manifest.items[index];
    if (grade.shotId !== item.shotId) {
      throw new Error(`qualified shot render QA identity/order mismatch at ${index}`);
    }
    if (grade.score < grade.threshold) {
      throw new Error(`qualified shot render QA score is below threshold for ${grade.shotId}`);
    }
    const measuredDurationSec = grade.temporalDynamism.maxStaticHoldSec /
      grade.temporalDynamism.maxFreezeFraction;
    if (Math.abs(measuredDurationSec - (item.t1 - item.t0)) > 0.25) {
      throw new Error(
        `qualified shot render temporal evidence duration does not bind ${grade.shotId}`,
      );
    }
  });
  if (
    Math.abs(coverage.mappedSec - manifest.durationSec) > epsilon ||
    Math.abs(coverage.totalSec - manifest.durationSec) > epsilon
  ) {
    throw new Error("qualified shot render coverage receipt does not match manifest duration");
  }
  return { manifest, qaReport, coverage };
}
