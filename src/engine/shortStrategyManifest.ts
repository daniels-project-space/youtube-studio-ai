import { z } from "zod";

/**
 * A standalone contract for the native-vertical, source-backed documentary
 * Short lane. The pipeline registers its strategy artifact and execution
 * blocks; this module remains the portable, validation-only contract shared
 * by the planner, renderer, and scene-quality gate.
 */
export const SHORT_STRATEGY_MANIFEST_VERSION = "1.0.0" as const;

/** The intended authored-story cadence for the documentary collage format. */
export const RECOMMENDED_SHORT_BEAT_COUNT = { min: 5, max: 7 } as const;

const identifier = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "must be a stable identifier");
const nonEmptyText = z.string().trim().min(1);
const finiteSeconds = z.number().finite().nonnegative();
const unitInterval = z.number().finite().min(0).max(1);

export const ShortOriginSchema = z.enum(["direct_short", "documentary_spinoff"]);
export type ShortOrigin = z.infer<typeof ShortOriginSchema>;

export const ShortSourceTypeSchema = z.enum([
  "primary",
  "reporting",
  "archive",
  "dataset",
  "internal_research",
]);

export const ShortSourceSchema = z.object({
  id: identifier,
  type: ShortSourceTypeSchema,
  title: nonEmptyText.max(300),
  citation: nonEmptyText.max(1_000),
  url: z.string().url().optional(),
  publisher: nonEmptyText.max(200).optional(),
  accessedAt: nonEmptyText.max(80).optional(),
}).strict();
export type ShortSource = z.infer<typeof ShortSourceSchema>;

export const ShortClaimKindSchema = z.enum(["fact", "context", "interpretation"]);

/** A source excerpt/locator that directly supports one Short claim. */
export const ShortClaimEvidenceSchema = z.object({
  sourceId: identifier,
  excerpt: nonEmptyText.max(2_000),
  locator: nonEmptyText.max(500).optional(),
}).strict();
export type ShortClaimEvidence = z.infer<typeof ShortClaimEvidenceSchema>;

export const ShortClaimSchema = z.object({
  id: identifier,
  kind: ShortClaimKindSchema,
  text: nonEmptyText.max(600),
  sourceIds: z.array(identifier).min(1).max(8),
  evidence: z.array(ShortClaimEvidenceSchema).min(1).max(8),
}).strict();
export type ShortClaim = z.infer<typeof ShortClaimSchema>;

export const AssetKindSchema = z.enum([
  "image",
  "video",
  "illustration",
  "data_graphic",
  "audio",
]);

export const AssetLicenseKindSchema = z.enum([
  "licensed",
  "public_domain",
  "creative_commons",
  "owned",
  "generated",
  "editorial_review_required",
]);

export const AssetProvenanceSchema = z.object({
  license: AssetLicenseKindSchema,
  sourceId: identifier.optional(),
  licenseUrl: z.string().url().optional(),
  generationReceiptId: identifier.optional(),
  attribution: nonEmptyText.max(500).optional(),
}).strict().superRefine((provenance, ctx) => {
  if (
    ["licensed", "creative_commons", "public_domain", "editorial_review_required"].includes(provenance.license)
    && !provenance.sourceId
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceId"],
      message: `${provenance.license} assets require a source reference`,
    });
  }

  if (provenance.license === "generated" && !provenance.generationReceiptId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["generationReceiptId"],
      message: "generated assets require a generation receipt reference",
    });
  }
});

export const ShortAssetSchema = z.object({
  id: identifier,
  kind: AssetKindSchema,
  description: nonEmptyText.max(500),
  provenance: AssetProvenanceSchema,
  claimIds: z.array(identifier).max(8).default([]),
}).strict();
export type ShortAsset = z.infer<typeof ShortAssetSchema>;

export const ShortLayerRoleSchema = z.enum([
  "background",
  "primary",
  "support",
  "data",
  "type",
  "texture",
]);

export const ShortSceneLayerSchema = z.object({
  id: identifier,
  role: ShortLayerRoleSchema,
  assetId: identifier.optional(),
  content: nonEmptyText.max(500).optional(),
  opacity: unitInterval.default(1),
}).strict().superRefine((layer, ctx) => {
  if (!layer.assetId && !layer.content) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "a scene layer requires an asset reference or explicit overlay content",
    });
  }
});

export const MotionFamilySchema = z.enum([
  "push_in",
  "pull_out",
  "pan",
  "parallax",
  "drift",
  "reveal",
  "stagger",
  "punch_in",
  "hold",
  "match_cut",
]);

export const MotionRecipeSchema = z.object({
  family: MotionFamilySchema,
  easing: z.enum(["linear", "ease_in", "ease_out", "ease_in_out", "spring"]).default("ease_in_out"),
  startPercent: unitInterval.default(0),
  endPercent: unitInterval.default(1),
  intensity: unitInterval.default(0.5),
  subjectLayerId: identifier.optional(),
}).strict().superRefine((motion, ctx) => {
  if (motion.endPercent <= motion.startPercent) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endPercent"],
      message: "motion endPercent must be after startPercent",
    });
  }
});

export const ShortSceneSchema = z.object({
  id: identifier,
  durationSec: z.number().finite().min(0.5).max(15),
  primaryVisualEvent: nonEmptyText.max(500),
  layers: z.array(ShortSceneLayerSchema).min(1).max(6),
  motion: z.object({
    primary: MotionRecipeSchema,
    ambient: MotionRecipeSchema.optional(),
  }).strict(),
  caption: z.object({
    text: nonEmptyText.max(300),
    placement: z.enum(["top", "center", "lower_third"]),
    maxLines: z.number().int().min(1).max(3).default(2),
  }).strict(),
}).strict().superRefine((scene, ctx) => {
  const primaryLayers = scene.layers.filter((layer) => layer.role === "primary");
  if (primaryLayers.length !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["layers"],
      message: "a scene must define exactly one primary layer",
    });
  }

  const layerIds = new Set(scene.layers.map((layer) => layer.id));
  for (const [motionKey, motion] of Object.entries(scene.motion)) {
    if (motion?.subjectLayerId && !layerIds.has(motion.subjectLayerId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["motion", motionKey, "subjectLayerId"],
        message: "motion subjectLayerId must reference a layer in the same scene",
      });
    }
  }
});
export type ShortScene = z.infer<typeof ShortSceneSchema>;

export const ShortNarrationSchema = z.object({
  text: nonEmptyText.max(800),
  delivery: z.enum(["measured", "urgent", "reflective", "skeptical", "neutral"]).default("measured"),
}).strict();

export const ShortSfxCueSchema = z.object({
  cue: nonEmptyText.max(160),
  assetId: identifier.optional(),
  offsetSec: finiteSeconds.default(0),
  gainDb: z.number().finite().min(-48).max(12).default(-12),
}).strict();

export const ShortBeatAudioSchema = z.object({
  narration: ShortNarrationSchema,
  musicCue: z.enum(["intro", "build", "tension", "release", "outro", "none"]).default("none"),
  sfx: z.array(ShortSfxCueSchema).max(4).default([]),
}).strict();

export const ShortBeatRoleSchema = z.enum([
  "hook",
  "context",
  "conflict",
  "escalation",
  "reversal",
  "payoff",
  "cta",
]);

export const ShortBeatSchema = z.object({
  id: identifier,
  order: z.number().int().positive(),
  role: ShortBeatRoleSchema,
  timing: z.object({
    startSec: finiteSeconds,
    endSec: z.number().finite().positive(),
  }).strict().superRefine((timing, ctx) => {
    if (timing.endSec <= timing.startSec) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endSec"],
        message: "beat endSec must be after startSec",
      });
    }
  }),
  claimIds: z.array(identifier).min(1).max(6),
  scene: ShortSceneSchema,
  audio: ShortBeatAudioSchema,
}).strict();
export type ShortBeat = z.infer<typeof ShortBeatSchema>;

export const ShortAudioMixPlanSchema = z.object({
  narratorProfile: nonEmptyText.max(160),
  musicAssetId: identifier.optional(),
  targetLufs: z.number().finite().min(-30).max(-10).default(-16),
  musicDuckUnderNarrationDb: z.number().finite().min(-36).max(-3).default(-14),
  truePeakDb: z.number().finite().min(-12).max(0).default(-1),
}).strict();
export type ShortAudioMixPlan = z.infer<typeof ShortAudioMixPlanSchema>;

export const SHORT_QA_CHECKS = [
  "caption_safe_zone",
  "claim_provenance",
  "asset_provenance",
  "narration_timing",
  "motion_alignment",
  "audio_mix",
  "visual_legibility",
  "no_baked_text",
] as const;
export const ShortQaCheckNameSchema = z.enum(SHORT_QA_CHECKS);
export type ShortQaCheckName = z.infer<typeof ShortQaCheckNameSchema>;

export const REQUIRED_SHORT_QA_CHECKS = [
  "caption_safe_zone",
  "claim_provenance",
  "asset_provenance",
  "narration_timing",
  "motion_alignment",
  "audio_mix",
  "visual_legibility",
  "no_baked_text",
] as const satisfies readonly ShortQaCheckName[];

export const ShortQaPlanSchema = z.object({
  hardGates: z.array(ShortQaCheckNameSchema).min(REQUIRED_SHORT_QA_CHECKS.length),
  sceneChecks: z.array(z.object({
    beatId: identifier,
    checks: z.array(ShortQaCheckNameSchema).min(1),
  }).strict()).min(RECOMMENDED_SHORT_BEAT_COUNT.min).max(RECOMMENDED_SHORT_BEAT_COUNT.max),
}).strict().superRefine((plan, ctx) => {
  const hardGates = new Set(plan.hardGates);
  for (const required of REQUIRED_SHORT_QA_CHECKS) {
    if (!hardGates.has(required)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["hardGates"],
        message: `missing required Short QA hard gate: ${required}`,
      });
    }
  }
});

export const ShortQaReceiptSchema = z.object({
  status: z.enum(["pending", "passed", "failed"]),
  checks: z.array(z.object({
    name: ShortQaCheckNameSchema,
    status: z.enum(["passed", "failed", "skipped"]),
    detail: nonEmptyText.max(1_000),
    score: z.number().finite().min(0).max(10).optional(),
  }).strict()).default([]),
  blockers: z.array(nonEmptyText.max(500)).default([]),
}).strict();

export const ShortQaSchema = z.object({
  plan: ShortQaPlanSchema,
  receipt: ShortQaReceiptSchema.optional(),
}).strict();
export type ShortQa = z.infer<typeof ShortQaSchema>;

export const DocumentarySourceWindowSchema = z.object({
  startSec: finiteSeconds,
  endSec: z.number().finite().positive(),
}).strict().superRefine((window, ctx) => {
  if (window.endSec <= window.startSec) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endSec"],
      message: "documentary source window endSec must be after startSec",
    });
  }
});

export const DocumentarySpinoffSourceSchema = z.object({
  documentaryId: identifier,
  title: nonEmptyText.max(300),
  sourceVideoId: identifier.optional(),
  sourceWindow: DocumentarySourceWindowSchema,
  storyBeatIds: z.array(identifier).min(1).max(20),
}).strict();
export type DocumentarySpinoffSource = z.infer<typeof DocumentarySpinoffSourceSchema>;

export const ShortStrategyBriefSchema = z.object({
  shortId: identifier,
  origin: ShortOriginSchema,
  channelId: identifier,
  headline: nonEmptyText.max(100),
  premise: nonEmptyText.max(500),
  targetDurationSec: z.number().finite().min(15).max(60),
  aspectRatio: z.literal("9:16"),
  treatmentPreset: nonEmptyText.max(120),
  sourceDocumentary: DocumentarySpinoffSourceSchema.optional(),
}).strict().superRefine((strategy, ctx) => {
  if (strategy.origin === "documentary_spinoff" && !strategy.sourceDocumentary) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceDocumentary"],
      message: "documentary spinoffs require a source documentary window",
    });
  }
  if (strategy.origin === "direct_short" && strategy.sourceDocumentary) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceDocumentary"],
      message: "direct Shorts must not claim a documentary source window",
    });
  }
});
export type ShortStrategyBrief = z.infer<typeof ShortStrategyBriefSchema>;

const candidateScore = z.number().finite().min(0).max(1);

export const ShortCandidateScoreSchema = z.object({
  hookStrength: candidateScore,
  selfContainment: candidateScore,
  factualClarity: candidateScore,
  visualPotential: candidateScore,
  novelty: candidateScore,
  completionPotential: candidateScore,
}).strict();
export type ShortCandidateScore = z.infer<typeof ShortCandidateScoreSchema>;

export const ShortCandidateSchema = z.object({
  id: identifier,
  origin: ShortOriginSchema,
  hook: nonEmptyText.max(300),
  premise: nonEmptyText.max(500),
  estimatedDurationSec: z.number().finite().min(15).max(60),
  score: ShortCandidateScoreSchema,
  sourceDocumentary: DocumentarySpinoffSourceSchema.optional(),
}).strict().superRefine((candidate, ctx) => {
  if (candidate.origin === "documentary_spinoff" && !candidate.sourceDocumentary) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceDocumentary"],
      message: "documentary-spinoff candidates require a source documentary window",
    });
  }
  if (candidate.origin === "direct_short" && candidate.sourceDocumentary) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceDocumentary"],
      message: "direct-Short candidates must not include a documentary source window",
    });
  }
});
export type ShortCandidate = z.infer<typeof ShortCandidateSchema>;

export const ShortCandidateSetSchema = z.object({
  id: identifier,
  version: z.literal(SHORT_STRATEGY_MANIFEST_VERSION),
  candidates: z.array(ShortCandidateSchema).min(1).max(20),
}).strict().superRefine((set, ctx) => {
  addDuplicateIdIssues(ctx, set.candidates.map((candidate) => candidate.id), ["candidates"], "candidate");
});
export type ShortCandidateSet = z.infer<typeof ShortCandidateSetSchema>;

export const ShortCandidateSelectionSchema = z.object({
  candidateSetId: identifier,
  selectedCandidateId: identifier,
  rankedCandidateIds: z.array(identifier).min(1).max(20),
  rationale: nonEmptyText.max(1_000),
}).strict();
export type ShortCandidateSelection = z.infer<typeof ShortCandidateSelectionSchema>;

export const ShortStrategyManifestSchema = z.object({
  version: z.literal(SHORT_STRATEGY_MANIFEST_VERSION),
  strategy: ShortStrategyBriefSchema,
  sources: z.array(ShortSourceSchema).min(1).max(50),
  claims: z.array(ShortClaimSchema).min(1).max(50),
  assets: z.array(ShortAssetSchema).max(50).default([]),
  beats: z.array(ShortBeatSchema)
    .min(RECOMMENDED_SHORT_BEAT_COUNT.min)
    .max(RECOMMENDED_SHORT_BEAT_COUNT.max),
  audioMix: ShortAudioMixPlanSchema,
  qa: ShortQaSchema,
  candidateSet: ShortCandidateSetSchema.optional(),
  candidateSelection: ShortCandidateSelectionSchema.optional(),
}).strict().superRefine((manifest, ctx) => {
  addDuplicateIdIssues(ctx, manifest.sources.map((source) => source.id), ["sources"], "source");
  addDuplicateIdIssues(ctx, manifest.claims.map((claim) => claim.id), ["claims"], "claim");
  addDuplicateIdIssues(ctx, manifest.assets.map((asset) => asset.id), ["assets"], "asset");
  addDuplicateIdIssues(ctx, manifest.beats.map((beat) => beat.id), ["beats"], "beat");

  const sourceIds = new Set(manifest.sources.map((source) => source.id));
  const claimIds = new Set(manifest.claims.map((claim) => claim.id));
  const assetIds = new Set(manifest.assets.map((asset) => asset.id));
  const beatIds = new Set(manifest.beats.map((beat) => beat.id));

  manifest.claims.forEach((claim, claimIndex) => {
    claim.sourceIds.forEach((sourceId, sourceIndex) => {
      if (!sourceIds.has(sourceId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["claims", claimIndex, "sourceIds", sourceIndex],
          message: `claim ${claim.id} references unknown source ${sourceId}`,
        });
      }
    });
    addDuplicateIdIssues(
      ctx,
      claim.evidence.map((evidence) => evidence.sourceId),
      ["claims", claimIndex, "evidence"],
      `claim ${claim.id} evidence source`,
    );
    const evidenceSourceIds = new Set(claim.evidence.map((evidence) => evidence.sourceId));
    claim.evidence.forEach((evidence, evidenceIndex) => {
      if (!sourceIds.has(evidence.sourceId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["claims", claimIndex, "evidence", evidenceIndex, "sourceId"],
          message: `claim ${claim.id} evidence references unknown source ${evidence.sourceId}`,
        });
      }
    });
    if (
      evidenceSourceIds.size !== claim.sourceIds.length ||
      claim.sourceIds.some((sourceId) => !evidenceSourceIds.has(sourceId))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["claims", claimIndex, "sourceIds"],
        message: `claim ${claim.id} sourceIds must exactly match its evidence source IDs`,
      });
    }
  });

  manifest.assets.forEach((asset, assetIndex) => {
    if (asset.provenance.sourceId && !sourceIds.has(asset.provenance.sourceId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assets", assetIndex, "provenance", "sourceId"],
        message: `asset ${asset.id} references unknown source ${asset.provenance.sourceId}`,
      });
    }
    asset.claimIds.forEach((claimId, claimIndex) => {
      if (!claimIds.has(claimId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["assets", assetIndex, "claimIds", claimIndex],
          message: `asset ${asset.id} references unknown claim ${claimId}`,
        });
      }
    });
  });

  const orderedBeats = [...manifest.beats].sort((left, right) => left.order - right.order);
  orderedBeats.forEach((beat, expectedIndex) => {
    if (beat.order !== expectedIndex + 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["beats"],
        message: "beat order must be contiguous and start at 1",
      });
    }

    const expectedStart = expectedIndex === 0 ? 0 : orderedBeats[expectedIndex - 1].timing.endSec;
    if (!approximatelyEqual(beat.timing.startSec, expectedStart)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["beats", manifest.beats.indexOf(beat), "timing", "startSec"],
        message: "beats must be contiguous, beginning at 0 seconds",
      });
    }

    const beatDuration = beat.timing.endSec - beat.timing.startSec;
    if (!approximatelyEqual(beat.scene.durationSec, beatDuration)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["beats", manifest.beats.indexOf(beat), "scene", "durationSec"],
        message: "scene durationSec must match the beat timing window",
      });
    }

    beat.claimIds.forEach((claimId, claimIndex) => {
      if (!claimIds.has(claimId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["beats", manifest.beats.indexOf(beat), "claimIds", claimIndex],
          message: `beat ${beat.id} references unknown claim ${claimId}`,
        });
      }
    });

    beat.scene.layers.forEach((layer, layerIndex) => {
      if (layer.assetId && !assetIds.has(layer.assetId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["beats", manifest.beats.indexOf(beat), "scene", "layers", layerIndex, "assetId"],
          message: `scene ${beat.scene.id} references unknown asset ${layer.assetId}`,
        });
      }
    });

    beat.audio.sfx.forEach((cue, cueIndex) => {
      if (cue.assetId && !assetIds.has(cue.assetId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["beats", manifest.beats.indexOf(beat), "audio", "sfx", cueIndex, "assetId"],
          message: `SFX cue references unknown asset ${cue.assetId}`,
        });
      }
      if (cue.offsetSec > beatDuration) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["beats", manifest.beats.indexOf(beat), "audio", "sfx", cueIndex, "offsetSec"],
          message: "SFX cue offsetSec must fall inside its beat",
        });
      }
    });
  });

  const finalBeat = orderedBeats.at(-1);
  if (finalBeat && !approximatelyEqual(finalBeat.timing.endSec, manifest.strategy.targetDurationSec)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["strategy", "targetDurationSec"],
      message: "targetDurationSec must match the end of the final beat",
    });
  }

  if (manifest.audioMix.musicAssetId && !assetIds.has(manifest.audioMix.musicAssetId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["audioMix", "musicAssetId"],
      message: `audioMix references unknown music asset ${manifest.audioMix.musicAssetId}`,
    });
  }

  addDuplicateIdIssues(ctx, manifest.qa.plan.sceneChecks.map((sceneCheck) => sceneCheck.beatId), ["qa", "plan", "sceneChecks"], "scene QA beat");
  const qaBeatIds = new Set(manifest.qa.plan.sceneChecks.map((sceneCheck) => sceneCheck.beatId));
  manifest.qa.plan.sceneChecks.forEach((sceneCheck, index) => {
    if (!beatIds.has(sceneCheck.beatId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["qa", "plan", "sceneChecks", index, "beatId"],
        message: `scene QA references unknown beat ${sceneCheck.beatId}`,
      });
    }
  });
  manifest.beats.forEach((beat, beatIndex) => {
    if (!qaBeatIds.has(beat.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["beats", beatIndex, "id"],
        message: `beat ${beat.id} is missing scene-level QA coverage`,
      });
    }
  });

  if (manifest.qa.receipt?.status === "passed") {
    const passedChecks = new Set(
      manifest.qa.receipt.checks.filter((check) => check.status === "passed").map((check) => check.name),
    );
    manifest.qa.plan.hardGates.forEach((hardGate) => {
      if (!passedChecks.has(hardGate)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["qa", "receipt"],
          message: `a passed QA receipt must include a passed ${hardGate} hard gate`,
        });
      }
    });
  }

  if (manifest.candidateSelection && !manifest.candidateSet) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["candidateSelection"],
      message: "candidateSelection requires its candidateSet",
    });
  }
  if (manifest.candidateSet && manifest.candidateSelection) {
    addCandidateSelectionIssues(ctx, manifest.candidateSet, manifest.candidateSelection, ["candidateSelection"]);
  }
});
export type ShortStrategyManifest = z.infer<typeof ShortStrategyManifestSchema>;
export type ShortStrategyManifestInput = z.input<typeof ShortStrategyManifestSchema>;

export function parseShortStrategyManifest(input: unknown): ShortStrategyManifest {
  return ShortStrategyManifestSchema.parse(input);
}

export function validateShortStrategyManifest(input: unknown) {
  return ShortStrategyManifestSchema.safeParse(input);
}

/** Creates a direct Short while preventing an accidental documentary clip contract. */
export function createDirectShortStrategyManifest(
  input: Omit<ShortStrategyManifestInput, "version" | "strategy"> & {
    strategy: Omit<z.input<typeof ShortStrategyBriefSchema>, "origin" | "sourceDocumentary">;
  },
): ShortStrategyManifest {
  return parseShortStrategyManifest({
    ...input,
    version: SHORT_STRATEGY_MANIFEST_VERSION,
    strategy: { ...input.strategy, origin: "direct_short" },
  });
}

/** Creates a documentary-derived Short with an explicit source-window contract. */
export function createDocumentarySpinoffStrategyManifest(
  input: Omit<ShortStrategyManifestInput, "version" | "strategy"> & {
    strategy: Omit<z.input<typeof ShortStrategyBriefSchema>, "origin"> & {
      sourceDocumentary: z.input<typeof DocumentarySpinoffSourceSchema>;
    };
  },
): ShortStrategyManifest {
  return parseShortStrategyManifest({
    ...input,
    version: SHORT_STRATEGY_MANIFEST_VERSION,
    strategy: { ...input.strategy, origin: "documentary_spinoff" },
  });
}

/** Returns beats in timeline order without mutating the persisted manifest. */
export function renderOrderedShortBeats(manifest: ShortStrategyManifest): ShortBeat[] {
  return [...manifest.beats].sort((left, right) => left.order - right.order);
}

export function shortRenderDurationSec(manifest: ShortStrategyManifest): number {
  return renderOrderedShortBeats(manifest).at(-1)?.timing.endSec ?? 0;
}

export function isDocumentarySpinoff(manifest: ShortStrategyManifest): boolean {
  return manifest.strategy.origin === "documentary_spinoff";
}

/** A transparent, equal-weight candidate score; editorial approval remains external. */
export function scoreShortCandidate(candidate: ShortCandidate): number {
  const scores = Object.values(candidate.score);
  return scores.reduce((total, score) => total + score, 0) / scores.length;
}

/** Deterministic ordering supports an auditable candidate-set artifact. */
export function rankShortCandidates(candidates: readonly ShortCandidate[]): ShortCandidate[] {
  return [...candidates].sort((left, right) => {
    const scoreDelta = scoreShortCandidate(right) - scoreShortCandidate(left);
    return scoreDelta === 0 ? left.id.localeCompare(right.id) : scoreDelta;
  });
}

export function createShortCandidateSelection(
  candidateSetInput: ShortCandidateSet,
  selectedCandidateId: string,
  rationale: string,
): ShortCandidateSelection {
  const candidateSet = ShortCandidateSetSchema.parse(candidateSetInput);
  if (!candidateSet.candidates.some((candidate) => candidate.id === selectedCandidateId)) {
    throw new Error(`Cannot select unknown Short candidate ${selectedCandidateId}`);
  }
  return ShortCandidateSelectionSchema.parse({
    candidateSetId: candidateSet.id,
    selectedCandidateId,
    rankedCandidateIds: rankShortCandidates(candidateSet.candidates).map((candidate) => candidate.id),
    rationale,
  });
}

export function selectedShortCandidate(
  candidateSetInput: ShortCandidateSet,
  selectionInput: ShortCandidateSelection,
): ShortCandidate {
  const candidateSet = ShortCandidateSetSchema.parse(candidateSetInput);
  const selection = ShortCandidateSelectionSchema.parse(selectionInput);
  const issues: string[] = [];
  collectCandidateSelectionIssues(candidateSet, selection, issues);
  if (issues.length > 0) {
    throw new Error(`Invalid Short candidate selection: ${issues.join("; ")}`);
  }
  return candidateSet.candidates.find((candidate) => candidate.id === selection.selectedCandidateId)!;
}

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 0.05;
}

function addDuplicateIdIssues(
  ctx: z.RefinementCtx,
  ids: readonly string[],
  path: Array<string | number>,
  label: string,
): void {
  const seen = new Set<string>();
  ids.forEach((id, index) => {
    if (seen.has(id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, index],
        message: `duplicate ${label} id ${id}`,
      });
    }
    seen.add(id);
  });
}

function addCandidateSelectionIssues(
  ctx: z.RefinementCtx,
  candidateSet: ShortCandidateSet,
  selection: ShortCandidateSelection,
  path: Array<string | number>,
): void {
  const issues: string[] = [];
  collectCandidateSelectionIssues(candidateSet, selection, issues);
  issues.forEach((message) => {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
  });
}

function collectCandidateSelectionIssues(
  candidateSet: ShortCandidateSet,
  selection: ShortCandidateSelection,
  issues: string[],
): void {
  if (selection.candidateSetId !== candidateSet.id) {
    issues.push(`selection targets ${selection.candidateSetId}, not ${candidateSet.id}`);
  }

  const candidateIds = candidateSet.candidates.map((candidate) => candidate.id);
  const candidateIdSet = new Set(candidateIds);
  if (!candidateIdSet.has(selection.selectedCandidateId)) {
    issues.push(`selected candidate ${selection.selectedCandidateId} is absent from the candidate set`);
  }
  if (selection.rankedCandidateIds.length !== candidateIds.length) {
    issues.push("rankedCandidateIds must include every candidate exactly once");
  }
  if (new Set(selection.rankedCandidateIds).size !== selection.rankedCandidateIds.length) {
    issues.push("rankedCandidateIds contains duplicates");
  }
  selection.rankedCandidateIds.forEach((id) => {
    if (!candidateIdSet.has(id)) {
      issues.push(`ranked candidate ${id} is absent from the candidate set`);
    }
  });
}
