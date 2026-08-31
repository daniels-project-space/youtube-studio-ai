import { z } from "zod";

import { canonicalJson } from "@/lib/canonicalJson";
import { OFFICIAL_RENDER_PINS } from "@/lib/novitaFleet";
import { sha256Hex } from "@/lib/sha256";

/**
 * A creative LoRA may affect the actual pixels, so it is a sealed worker-model
 * dependency rather than a loose prompt preset.  This keeps an attractive but
 * incompatible community adapter from silently degrading an LTX take.
 */
export const LTX_CREATIVE_ADAPTER_CONTRACT_VERSION = "ltx-creative-adapter/v4" as const;
export const LTX_CREATIVE_ADAPTER_BENCHMARK_EVIDENCE_VERSION = "ltx-creative-adapter-benchmark-evidence/v1" as const;
/**
 * The upstream LTX CLI accepts repeatable --lora flags.  Three is deliberate:
 * one independently benchmarked adapter for each non-overlapping role below.
 * More adapters are not inherently better and are not admitted without a new
 * role/stack contract and benchmark suite.
 */
export const LTX_CREATIVE_ADAPTER_STACK_VERSION = "ltx-creative-adapter-stack/v2" as const;
/**
 * The official LTX guidance recommends introducing a second LoRA only when
 * its detail materially matters. Keep the direct `--lora` worker to one
 * primary adapter plus at most one complementary adapter; structural controls
 * belong on the separately pinned IC-LoRA/Comfy path.
 */
export const MAX_LTX_CREATIVE_ADAPTERS_PER_SHOT = 2 as const;
/**
 * LTX recommends keeping the total influence of combined standard LoRAs below
 * 2.0.  That lets the Studio use every independently beneficial, complementary
 * role without turning a three-adapter shot into an over-conditioned render.
 */
/** A direct two-LoRA stack must leave room for the base model to preserve motion and identity. */
export const MAX_LTX_CREATIVE_ADAPTER_COMBINED_STRENGTH = 1.5 as const;

/**
 * The Studio may select a standard adapter only for this exact direct LTX
 * worker identity.  A different worker image, base revision, or LTX runtime
 * gets a different fingerprint and cannot reuse the adapter by accident.
 */
export const DIRECT_LTX_CREATIVE_ADAPTER_RUNTIME_FINGERPRINT = sha256Hex(canonicalJson({
  version: "direct-ltx-creative-adapter-runtime/v1",
  baseModel: OFFICIAL_RENDER_PINS.ltx.model,
  baseRevision: OFFICIAL_RENDER_PINS.ltx.revision,
  runtimeRevision: OFFICIAL_RENDER_PINS.ltx.runtimeRevision,
}));

const AdapterIdSchema = z.string()
  .regex(/^ltx-creative-[a-z0-9][a-z0-9-]{1,78}$/)
  .max(80);
const TriggerTokenSchema = z.string().trim().min(1).max(80)
  .regex(/^[\p{L}\p{N}_ -]+$/u, "adapter trigger tokens must be plain prompt text");
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const BenchmarkStorageKeySchema = z.string()
  .regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9][A-Za-z0-9._/@+=:-]{1,511}$/);
const BenchmarkReceiptIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._:-]{2,159}$/i);
const IsoUtcSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/);
const CreativeAdapterRoleSchema = z.enum(["visual-style", "camera-control", "material-style"]);
const CreativeAdapterQualityMetricSchema = z.enum([
  "visual_style_coherence",
  "camera_motion_adherence",
  "material_identity_consistency",
]);
const QualityScoreSchema = z.number().finite().min(0).max(10);
const MINIMUM_ADAPTED_QUALITY_SCORE = 8;
const MINIMUM_QUALITY_GAIN = 0.5;

/**
 * A production LoRA must run at the exact intensity that was benchmarked.
 * This deliberately leaves no room to "turn it up" after a passing review:
 * stronger conditioning is a new render recipe and needs new evidence.
 */
const CalibratedAdapterStrengthSchema = z.number().finite().min(0.15).max(0.95);

const QUALITY_METRIC_FOR_ROLE = {
  "visual-style": "visual_style_coherence",
  "camera-control": "camera_motion_adherence",
  "material-style": "material_identity_consistency",
} as const;

const CreativeAdapterBenchmarkEvidenceSchema = z.object({
  version: z.literal(LTX_CREATIVE_ADAPTER_BENCHMARK_EVIDENCE_VERSION),
  /** Immutable sidecar containing the benchmark run's retained evidence. */
  evidenceManifestKey: BenchmarkStorageKeySchema,
  immutableEvidenceObjectVersionId: BenchmarkReceiptIdSchema,
  evidenceSha256: Sha256Schema,
  /** The exact reviewed LTX output, never a representative still or prompt. */
  outputVideoKey: BenchmarkStorageKeySchema,
  outputVideoSha256: Sha256Schema,
  outputDurationMs: z.number().int().positive().max(3_600_000),
  outputArtifactReceiptFingerprint: Sha256Schema,
  visualReviewReceiptFingerprint: Sha256Schema,
  reviewedAt: IsoUtcSchema,
  reviewedBy: BenchmarkReceiptIdSchema,
}).strict();

const CreativeAdapterBenchmarkSchema = z.object({
  rtx4090ProfileBenchmarked: z.literal(true),
  visualVerdict: z.literal("pass"),
  /** Exact single-adapter intensity used for the retained matched benchmark. */
  calibratedStrength: CalibratedAdapterStrengthSchema,
  /** Matched scene/seed/prompt benchmark: adapter output must beat base LTX. */
  qualityDelta: z.object({
    metric: CreativeAdapterQualityMetricSchema,
    baselineScore: QualityScoreSchema,
    adaptedScore: QualityScoreSchema,
  }).strict(),
  evidence: CreativeAdapterBenchmarkEvidenceSchema,
}).strict();

/**
 * A stack has its own matched baseline evidence. Individual LoRA benchmarks
 * are necessary but cannot prove that two otherwise-good adapters cooperate.
 */
export const LtxCreativeAdapterStackBenchmarkSchema = z.object({
  rtx4090ProfileBenchmarked: z.literal(true),
  visualVerdict: z.literal("pass"),
  /**
   * Exact adapter IDs and strengths used together for this benchmark. A stack
   * cannot borrow an individually-tested strength or reweight a good pair.
   */
  calibratedAdapters: z.array(z.object({
    id: AdapterIdSchema,
    strength: CalibratedAdapterStrengthSchema,
  }).strict()).min(2).max(MAX_LTX_CREATIVE_ADAPTERS_PER_SHOT)
    .superRefine((adapters, ctx) => {
      if (new Set(adapters.map((adapter) => adapter.id)).size !== adapters.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "stack benchmark calibrated adapters must be unique" });
      }
      const combinedStrength = adapters.reduce((total, adapter) => total + adapter.strength, 0);
      if (combinedStrength >= MAX_LTX_CREATIVE_ADAPTER_COMBINED_STRENGTH) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `stack benchmark calibrated strength must stay below ${MAX_LTX_CREATIVE_ADAPTER_COMBINED_STRENGTH}`,
        });
      }
    }),
  qualityDeltas: z.array(z.object({
    metric: CreativeAdapterQualityMetricSchema,
    baselineScore: QualityScoreSchema,
    adaptedScore: QualityScoreSchema,
  }).strict()).min(2).max(MAX_LTX_CREATIVE_ADAPTERS_PER_SHOT)
    .superRefine((deltas, ctx) => {
      if (new Set(deltas.map((delta) => delta.metric)).size !== deltas.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "stack benchmark quality metrics must be unique" });
      }
    }),
  evidence: CreativeAdapterBenchmarkEvidenceSchema,
}).strict().superRefine((benchmark, ctx) => {
  for (const [index, delta] of benchmark.qualityDeltas.entries()) {
    if (delta.adaptedScore < MINIMUM_ADAPTED_QUALITY_SCORE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["qualityDeltas", index, "adaptedScore"],
        message: "stack benchmark adapted score is below the quality floor",
      });
    }
    if (delta.adaptedScore - delta.baselineScore < MINIMUM_QUALITY_GAIN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["qualityDeltas", index],
        message: "stack benchmark does not demonstrate a material gain over base LTX",
      });
    }
  }
});

const CreativeAdapterSpecSchema = z.object({
  contractVersion: z.literal(LTX_CREATIVE_ADAPTER_CONTRACT_VERSION),
  role: CreativeAdapterRoleSchema,
  baseModel: z.string().min(1),
  baseRevision: z.string().regex(/^[a-f0-9]{40}$/),
  runtimeRevision: z.string().regex(/^[a-f0-9]{40}$/),
  triggerTokens: z.array(TriggerTokenSchema).min(1).max(8)
    .superRefine((tokens, ctx) => {
      const normalized = tokens.map((token) => token.toLocaleLowerCase());
      if (new Set(normalized).size !== normalized.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "adapter trigger tokens must be unique" });
      }
    }),
  benchmark: CreativeAdapterBenchmarkSchema,
}).strict().superRefine((adapter, ctx) => {
  const quality = adapter.benchmark.qualityDelta;
  const expectedMetric = QUALITY_METRIC_FOR_ROLE[adapter.role];
  if (quality.metric !== expectedMetric) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["benchmark", "qualityDelta", "metric"], message: "adapter benchmark quality metric does not match its role" });
  }
  if (quality.adaptedScore < MINIMUM_ADAPTED_QUALITY_SCORE) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["benchmark", "qualityDelta", "adaptedScore"], message: "adapter benchmark adapted score is below the quality floor" });
  }
  if (quality.adaptedScore - quality.baselineScore < MINIMUM_QUALITY_GAIN) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["benchmark", "qualityDelta"], message: "adapter benchmark does not demonstrate a material gain over base LTX" });
  }
});

/** The only creator-facing switch. Trigger tokens are owned by the pinned model manifest. */
export const LtxCreativeAdapterSelectionSchema = z.object({
  id: AdapterIdSchema,
  /** Exact intensity retained by the adapter's benchmark; full strength is never accepted by default. */
  strength: CalibratedAdapterStrengthSchema,
  /**
   * Studio-originated selections bind the adapter bytes they were approved
   * against. The direct worker resolves the same digest from its sealed model
   * manifest before it can create a paid GPU worker.
   */
  expectedManifestSha256: Sha256Schema.optional(),
}).strict();

export type LtxCreativeAdapterSelection = z.infer<typeof LtxCreativeAdapterSelectionSchema>;

/**
 * A Studio-selected standard-LoRA stack. It contains only complementary
 * visual-style/camera-control/material-style roles and is rejected unless the
 * exact combined strengths beat the base render for every included role.
 */
export const LtxCreativeAdapterStackSchema = z.object({
  version: z.literal(LTX_CREATIVE_ADAPTER_STACK_VERSION),
  adapters: z.array(LtxCreativeAdapterSelectionSchema).min(2)
    .superRefine((adapters, ctx) => {
      if (adapters.length > MAX_LTX_CREATIVE_ADAPTERS_PER_SHOT) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `creative adapter stack may contain at most ${MAX_LTX_CREATIVE_ADAPTERS_PER_SHOT} complementary direct-LTX adapters`,
        });
      }
      if (new Set(adapters.map((adapter) => adapter.id)).size !== adapters.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "creative adapter stack cannot repeat an adapter" });
      }
      const combinedStrength = adapters.reduce((total, adapter) => total + adapter.strength, 0);
      if (combinedStrength >= MAX_LTX_CREATIVE_ADAPTER_COMBINED_STRENGTH) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `creative adapter stack combined strength must stay below ${MAX_LTX_CREATIVE_ADAPTER_COMBINED_STRENGTH}`,
        });
      }
    }),
  benchmark: LtxCreativeAdapterStackBenchmarkSchema,
}).strict();

export type LtxCreativeAdapterStack = z.infer<typeof LtxCreativeAdapterStackSchema>;

/** Backward-compatible single adapter or a benchmarked complementary stack. */
export const LtxCreativeAdapterInputSchema = z.union([
  LtxCreativeAdapterSelectionSchema,
  LtxCreativeAdapterStackSchema,
]);
export type LtxCreativeAdapterInput = z.infer<typeof LtxCreativeAdapterInputSchema>;

export interface ResolvedLtxCreativeAdapter extends LtxCreativeAdapterSelection {
  triggerTokens: readonly string[];
  manifestSha256: string;
}

export interface ResolvedLtxCreativeAdapterStack {
  adapters: readonly ResolvedLtxCreativeAdapter[];
  /** Present only when multiple adapters passed an exact combined benchmark. */
  benchmark?: z.infer<typeof LtxCreativeAdapterStackBenchmarkSchema>;
}

const WorkerAdapterSpecSchema = z.object({
  id: AdapterIdSchema,
  kind: z.literal("file"),
  repository: z.string().min(1),
  revision: z.string().regex(/^[a-f0-9]{40}$/),
  manifestSha256: Sha256Schema,
  sourcePath: z.string().min(1),
  localPath: z.string().min(1),
  creativeAdapter: CreativeAdapterSpecSchema,
}).passthrough();

/**
 * Resolve selected adapters from the exact immutable worker manifest before a
 * render plan is constructed. Empty selections remain completely unchanged.
 */
export function resolveLtxCreativeAdapters(args: {
  selections: ReadonlyMap<string, LtxCreativeAdapterInput | undefined>;
  modelSpecs: readonly Record<string, unknown>[];
  baseModel: string;
  baseRevision: string;
  runtimeRevision: string;
}): Map<string, ResolvedLtxCreativeAdapterStack> {
  const requested = [...args.selections.entries()]
    .flatMap(([shotId, selection]) => selection ? [[shotId, LtxCreativeAdapterInputSchema.parse(selection)] as const] : []);
  if (!requested.length) return new Map();

  const specsById = new Map<string, z.infer<typeof WorkerAdapterSpecSchema>>();
  for (const raw of args.modelSpecs) {
    const parsed = WorkerAdapterSpecSchema.safeParse(raw);
    if (parsed.success) specsById.set(parsed.data.id, parsed.data);
  }

  const resolved = new Map<string, ResolvedLtxCreativeAdapterStack>();
  for (const [shotId, input] of requested) {
    const stack = "adapters" in input ? input : undefined;
    const selections: readonly LtxCreativeAdapterSelection[] = stack
      ? stack.adapters
      : [LtxCreativeAdapterSelectionSchema.parse(input)];
    const selectedRoles: string[] = [];
    const resolvedAdapters = selections.map((selection) => {
      const spec = specsById.get(selection.id);
      if (!spec) {
        throw new Error(`LTX creative adapter ${selection.id} is not present in the sealed worker model manifest for ${shotId}`);
      }
      const adapter = spec.creativeAdapter;
      if (
        spec.repository !== args.baseModel ||
        spec.revision !== args.baseRevision ||
        adapter.baseModel !== args.baseModel ||
        adapter.baseRevision !== args.baseRevision ||
        adapter.runtimeRevision !== args.runtimeRevision ||
        !spec.sourcePath.includes("/loras/") ||
        !spec.localPath.includes("/loras/")
      ) {
        throw new Error(`LTX creative adapter ${selection.id} is not pinned to the active LTX runtime for ${shotId}`);
      }
      if (!adapter.benchmark.rtx4090ProfileBenchmarked || adapter.benchmark.visualVerdict !== "pass") {
        throw new Error(`LTX creative adapter ${selection.id} has not passed its RTX 4090 visual benchmark`);
      }
      // A multi-adapter stack is a separately benchmarked recipe and may have
      // lower complementary strengths than either adapter's solo calibration.
      if (!stack && selection.strength !== adapter.benchmark.calibratedStrength) {
        throw new Error(`LTX creative adapter ${selection.id} strength does not match its exact RTX 4090 visual benchmark for ${shotId}`);
      }
      if (selection.expectedManifestSha256 && selection.expectedManifestSha256 !== spec.manifestSha256) {
        throw new Error(`LTX creative adapter ${selection.id} does not match the Studio-approved adapter bytes for ${shotId}`);
      }
      selectedRoles.push(adapter.role);
      const { expectedManifestSha256: _expectedManifestSha256, ...workerSelection } = selection;
      void _expectedManifestSha256;
      return {
        ...workerSelection,
        triggerTokens: adapter.triggerTokens,
        manifestSha256: spec.manifestSha256,
      };
    });
    if (stack) {
      if (new Set(selectedRoles).size !== selectedRoles.length) {
        throw new Error(`LTX creative adapter stack has overlapping roles for ${shotId}`);
      }
      const expectedMetrics = new Set(selectedRoles.map((role) => QUALITY_METRIC_FOR_ROLE[role as keyof typeof QUALITY_METRIC_FOR_ROLE]));
      const deltas = stack.benchmark.qualityDeltas;
      if (deltas.length !== expectedMetrics.size || deltas.some((delta) => !expectedMetrics.has(delta.metric))) {
        throw new Error(`LTX creative adapter stack benchmark must cover every selected role for ${shotId}`);
      }
      for (const delta of deltas) {
        if (delta.adaptedScore < MINIMUM_ADAPTED_QUALITY_SCORE || delta.adaptedScore - delta.baselineScore < MINIMUM_QUALITY_GAIN) {
          throw new Error(`LTX creative adapter stack does not demonstrate a material quality gain for ${shotId}`);
        }
      }
      if (!stack.benchmark.rtx4090ProfileBenchmarked || stack.benchmark.visualVerdict !== "pass") {
        throw new Error(`LTX creative adapter stack has not passed its RTX 4090 visual benchmark for ${shotId}`);
      }
      const calibrated = new Map(stack.benchmark.calibratedAdapters.map((adapter) => [adapter.id, adapter.strength]));
      if (
        calibrated.size !== selections.length
        || selections.some((selection) => calibrated.get(selection.id) !== selection.strength)
      ) {
        throw new Error(`LTX creative adapter stack strengths do not match its exact RTX 4090 visual benchmark for ${shotId}`);
      }
    }
    resolved.set(shotId, Object.freeze({
      adapters: Object.freeze(resolvedAdapters),
      ...(stack ? { benchmark: stack.benchmark } : {}),
    }));
  }
  return resolved;
}
