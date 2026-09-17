import { z } from "zod";

import { MiniMaxH3OpeningMotionQaEvidenceSchema } from "@/engine/cinematicClipReview";
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
    derivation: z.object({
      version: z.literal("storyboard-atlas-crop/v1"),
      planFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      planKey: z.string().min(1),
      sourceOutputId: z.string().min(1),
      sourceStillKey: z.string().min(1),
      sourceRequestSha256: z.string().regex(/^[a-f0-9]{64}$/),
      sourceBillingReceiptId: z.string().min(1),
      sourceContentSha256: z.string().regex(/^[a-f0-9]{64}$/),
      contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
      gridSize: z.union([z.literal(2), z.literal(4), z.literal(8), z.literal(16)]),
      coordinate: z.string().regex(/^[A-P](?:[1-9]|1[0-6])$/),
      crop: z.object({
        x: z.number().int().nonnegative(),
        y: z.number().int().nonnegative(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      }).strict(),
    }).strict().optional(),
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

/** Retained records created before the H3 cutover remain inspectable. */
const LegacyLtxShotGenerationSchema = GenerationIdentitySchema.extend({
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
  /** Worker-observed encoded dimensions after the historical latent x2 stage. */
  outputWidth: z.number().int().positive(),
  outputHeight: z.number().int().positive(),
});

/**
 * The active standard cinematic route uses the sealed native H3 runtime.
 * Keep the model/runtime proof in the persisted manifest so final assembly
 * can distinguish a retained LTX run from a new H3 take without inference.
 */
const MiniMaxH3ShotGenerationSchema = GenerationIdentitySchema.extend({
  renderer: z.literal("minimax-h3"),
  provider: z.literal("novita"),
  execution: z.literal("on-demand"),
  runtimeId: z.literal("minimax-h3-turbo8-5090-v1"),
  modelManifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  fps: z.literal(24),
  frames: z.literal(124),
  /** Native source duration is distinct from the authored edit interval. */
  nativeDurationSec: z.number().finite().positive(),
});

const ShotRenderManifestItemSchema = z.object({
  shotId: z.string().min(1),
  clipKey: z.string().min(1),
  t0: z.number().finite().nonnegative(),
  t1: z.number().finite().positive(),
  sourceSentenceIds: z.array(z.string()).min(1),
  continuityState: z.string().min(1),
  /**
   * Exact standard-LoRA selection used only by retained direct-LTX clips. A
   * fresh H3 route is conditioned by the selected first frame instead.
   */
  creativeAdapter: LtxCreativeAdapterInputSchema.optional(),
  /**
   * Present only when a next-shot keyframe remains an explicit endpoint QA
   * anchor. H3 receives it as a textual/QA handoff, never as a hidden LTX
   * second-frame conditioning input.
   */
  terminalAnchorShotId: z.string().min(1).optional(),
  terminalStillKey: z.string().min(1).optional(),
  /** Actual encoded H3 source duration; assembly may trim it to t0..t1. */
  renderedDurationSec: z.number().finite().positive().optional(),
}).refine((item) => item.t1 > item.t0, "rendered shot t1 must follow t0").refine(
  (item) => Boolean(item.terminalAnchorShotId) === Boolean(item.terminalStillKey),
  "rendered terminal anchor id and still key must be supplied together",
);

export const ShotRenderManifestSchema = z.object({
  version: z.literal("1.0.0"),
  generation: z.union([LegacyLtxShotGenerationSchema, MiniMaxH3ShotGenerationSchema]),
  durationSec: z.number().finite().positive(),
  items: z.array(ShotRenderManifestItemSchema).min(1),
}).superRefine((manifest, ctx) => {
  if (!("renderer" in manifest.generation) || manifest.generation.renderer !== "minimax-h3") return;
  const nativeDuration = manifest.generation.frames / manifest.generation.fps;
  if (Math.abs(manifest.generation.nativeDurationSec - nativeDuration) > 0.08) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["generation", "nativeDurationSec"], message: "H3 native duration must bind its sealed frame/fps profile" });
  }
  for (const [index, item] of manifest.items.entries()) {
    if (item.creativeAdapter !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items", index, "creativeAdapter"], message: "fresh H3 takes cannot claim a retired LTX adapter" });
    }
    if (item.renderedDurationSec === undefined || Math.abs(item.renderedDurationSec - nativeDuration) > 0.08) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items", index, "renderedDurationSec"], message: "H3 take must retain its observed native duration" });
    }
    if (item.t1 - item.t0 > nativeDuration + 0.02) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items", index], message: "authored H3 interval exceeds its native source take" });
    }
  }
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
  maxOpeningFrozenHoldSec: z.number().positive(),
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
  if (evidence.maxOpeningFrozenHoldSec > evidence.maxStaticHoldSec + graceSec) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["maxOpeningFrozenHoldSec"],
      message: "accepted LTX opening limit cannot exceed its whole-shot static-hold limit",
    });
  }
  if (evidence.openingFrozenHoldSec > evidence.maxOpeningFrozenHoldSec + graceSec) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["openingFrozenHoldSec"],
      message: "accepted LTX temporal evidence exceeds its immediate-motion opening limit",
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
    temporalDynamism: z.union([LtxShotTemporalQaEvidenceSchema, MiniMaxH3OpeningMotionQaEvidenceSchema]),
  })).min(1),
});

/**
 * v1 remains parseable so retained evidence can still be inspected. It cannot
 * authorize a new assembly: validateQualifiedShotRender requires the v1.1
 * deterministic motion receipt for every accepted take.
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
    const isH3 = "renderer" in manifest.generation && manifest.generation.renderer === "minimax-h3";
    if (isH3 && grade.temporalDynamism.contract !== "minimax-h3-opening-motion-qa/v1") {
      throw new Error(`qualified shot render requires H3 opening-motion evidence for ${grade.shotId}`);
    }
    if (!isH3 && grade.temporalDynamism.contract !== "ltx-shot-temporal-qa/v1") {
      throw new Error(`qualified shot render requires retained LTX temporal evidence for ${grade.shotId}`);
    }
    const expectedDurationSec = isH3 ? item.renderedDurationSec : item.t1 - item.t0;
    const measuredDurationSec = grade.temporalDynamism.contract === "minimax-h3-opening-motion-qa/v1"
      ? grade.temporalDynamism.durationSec
      : grade.temporalDynamism.maxStaticHoldSec / grade.temporalDynamism.maxFreezeFraction;
    if (expectedDurationSec === undefined || Math.abs(measuredDurationSec - expectedDurationSec) > 0.25) {
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
