import { z } from "zod";

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
    twoStageRefine: z.boolean(),
  }),
  durationSec: z.number().finite().positive(),
  items: z.array(z.object({
    shotId: z.string().min(1),
    clipKey: z.string().min(1),
    t0: z.number().finite().nonnegative(),
    t1: z.number().finite().positive(),
    sourceSentenceIds: z.array(z.string()).min(1),
    continuityState: z.string().min(1),
  }).refine((item) => item.t1 > item.t0, "rendered shot t1 must follow t0")).min(1),
});

export const ShotQaReportSchema = z.object({
  version: z.literal("1.0.0"),
  required: z.literal(true),
  graderRan: z.literal(true),
  passed: z.literal(true),
  shots: z.array(z.object({
    shotId: z.string().min(1),
    score: z.number().min(0).max(1),
    threshold: z.number().min(0).max(1),
    semanticAlignment: z.number().min(0).max(1),
    continuity: z.number().min(0).max(1),
    motionIntegrity: z.number().min(0).max(1),
    artifactFree: z.number().min(0).max(1),
    notes: z.array(z.string()),
  })).min(1),
});

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
    if (grade.shotId !== manifest.items[index].shotId) {
      throw new Error(`qualified shot render QA identity/order mismatch at ${index}`);
    }
    if (grade.score < grade.threshold) {
      throw new Error(`qualified shot render QA score is below threshold for ${grade.shotId}`);
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
