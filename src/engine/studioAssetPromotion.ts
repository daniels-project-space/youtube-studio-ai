import { z } from "zod";

import {
  createStudioAssetLibraryEntry,
  type StudioAssetLibraryEntry,
  type StudioAssetLibraryEntryCore,
} from "@/engine/studioAssetLibrary";
import {
  assertStudioPostproductionDecisionReceipt,
  type StudioPostproductionDecisionReceipt,
} from "@/engine/studioPostproductionDecision";
import { VisualMatterManifestSchema, type VisualMatterManifest } from "@/engine/visualMatter";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

/**
 * A pending candidate is the only automatic promotion output.  It records a
 * recipe that was actually used by a passing final master, but it is neither
 * resolvable nor transferable until the owner explicitly approves it.
 */
export const STUDIO_ASSET_PROMOTION_CANDIDATE_VERSION = "studio-asset-promotion-candidate/v1" as const;

const SHA256 = /^[a-f0-9]{64}$/iu;
const SAFE_ID = /^[a-z][a-z0-9_-]{1,95}$/u;
const nonEmptyId = z.string().trim().regex(SAFE_ID, "must be a safe identifier");
const sha256 = z.string().trim().regex(SHA256, "must be a SHA-256 digest");
const r2Key = z.string().trim().min(1).max(1_024);

const CandidateAssetKindSchema = z.enum([
  "camera_recipe",
  "motion_recipe",
  "prompt_recipe",
  "visual_treatment_recipe",
  "transition_template",
]);

const CandidateRecipeSchema = z.object({
  version: z.literal("studio-asset-recipe/v1"),
  promptFragments: z.array(z.string().trim().min(1).max(2_000)).min(1).max(24),
  controlValues: z.record(z.string().trim().min(1).max(96), z.string().trim().min(1).max(1_000)),
  instructionFingerprint: sha256,
}).strict();

const CandidateProposalSchema = z.object({
  logicalId: nonEmptyId,
  title: z.string().trim().min(1).max(160),
  assetKind: CandidateAssetKindSchema,
  /** Automatic candidates are intentionally usable only by their source channel. */
  scope: z.literal("channel"),
  channelId: z.string().trim().min(1).max(160),
  identitySensitivity: z.literal("channel"),
  compatibility: z.object({
    families: z.array(nonEmptyId).length(1),
    contentLanes: z.array(nonEmptyId).length(1),
    moduleIds: z.tuple([z.enum(["visual_matter", "timeline_assemble"])]),
    treatments: z.array(nonEmptyId).max(1),
  }).strict(),
  recipe: CandidateRecipeSchema,
}).strict();

const CandidateOriginCommonSchema = z.object({
  finalMasterReleaseCertificateKey: r2Key,
  finalMasterReleaseCertificateFingerprint: sha256,
  finalMasterSha256: sha256,
  qualityEvidenceFingerprint: sha256,
  visualReviewReceiptFingerprint: sha256,
  /** Normalized 0–100 visual quality score, never a self-assigned score. */
  visualQualityScore: z.number().finite().min(0).max(100),
  visualMinimumScore: z.number().finite().min(0).max(100),
}).strict();

const VisualMatterCandidateOriginSchema = CandidateOriginCommonSchema.extend({
  visualMatterRevision: sha256,
  referencePackFingerprint: sha256.optional(),
}).strict();

const PostproductionCandidateOriginSchema = CandidateOriginCommonSchema.extend({
  /** Exact sealed timeline decision that selected this template. */
  postproductionDecisionFingerprint: sha256,
  postproductionModuleId: z.literal("timeline_assemble"),
}).strict();

const CandidateOriginSchema = z.union([
  VisualMatterCandidateOriginSchema,
  PostproductionCandidateOriginSchema,
]);

const StudioAssetPromotionCandidateCoreBaseSchema = z.object({
  version: z.literal(STUDIO_ASSET_PROMOTION_CANDIDATE_VERSION),
  ownerId: z.string().trim().min(1).max(160),
  channelId: z.string().trim().min(1).max(160),
  runId: z.string().trim().min(1).max(160),
  origin: CandidateOriginSchema,
  proposal: CandidateProposalSchema,
}).strict();

function assertCandidateChannelAndQuality(candidate: z.infer<typeof StudioAssetPromotionCandidateCoreBaseSchema>, ctx: z.RefinementCtx): void {
  if (candidate.proposal.channelId !== candidate.channelId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["proposal", "channelId"],
      message: "a Studio asset candidate must remain bound to its source channel",
    });
  }
  if (candidate.origin.visualQualityScore < candidate.origin.visualMinimumScore) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["origin", "visualQualityScore"],
      message: "a Studio asset candidate requires a passing final-master visual score",
    });
  }
  const moduleId = candidate.proposal.compatibility.moduleIds[0];
  const isPostproduction = candidate.proposal.assetKind === "transition_template";
  if (isPostproduction) {
    if (moduleId !== "timeline_assemble" || !("postproductionDecisionFingerprint" in candidate.origin)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["proposal", "compatibility", "moduleIds"],
        message: "a transition candidate requires a sealed timeline-assemble decision",
      });
    }
  } else if (moduleId !== "visual_matter" || !("visualMatterRevision" in candidate.origin)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["proposal", "compatibility", "moduleIds"],
      message: "a visual recipe candidate requires Visual Matter final-master provenance",
    });
  }
}

export const StudioAssetPromotionCandidateCoreSchema = StudioAssetPromotionCandidateCoreBaseSchema
  .superRefine(assertCandidateChannelAndQuality);

export const StudioAssetPromotionCandidateSchema = StudioAssetPromotionCandidateCoreBaseSchema
  .extend({ candidateFingerprint: sha256 })
  .strict()
  .superRefine(assertCandidateChannelAndQuality);

export type StudioAssetPromotionCandidateCore = z.infer<typeof StudioAssetPromotionCandidateCoreSchema>;
export type StudioAssetPromotionCandidate = z.infer<typeof StudioAssetPromotionCandidateSchema>;

export interface StudioAssetPromotionCandidateInventoryItem {
  readonly candidateFingerprint: string;
  readonly title: string;
  readonly assetKind: z.infer<typeof CandidateAssetKindSchema>;
  readonly channelId: string;
  readonly family: string;
  readonly contentLane: string;
  readonly treatment?: string;
  readonly visualQualityScore: number;
  readonly visualMinimumScore: number;
  readonly finalMasterSha256: string;
  readonly finalMasterReleaseCertificateFingerprint: string;
}

function fingerprint(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

function stable<T>(value: T): T {
  return Object.freeze(value);
}

function candidateRecipe(promptFragments: readonly string[], controlValues: Record<string, string>) {
  const fragments = [...new Set(promptFragments.map((fragment) => fragment.trim()).filter(Boolean))].slice(0, 24);
  if (!fragments.length) throw new Error("Studio asset candidate needs at least one reviewed recipe instruction");
  const core = {
    version: "studio-asset-recipe/v1" as const,
    promptFragments: fragments,
    controlValues,
  };
  return stable({ ...core, instructionFingerprint: fingerprint(core) });
}

function candidateId(kind: z.infer<typeof CandidateAssetKindSchema>, candidateFingerprint: string): string {
  return `verified_${kind.replace("_recipe", "")}_${candidateFingerprint.slice(0, 18)}`;
}

function titleFor(kind: z.infer<typeof CandidateAssetKindSchema>, treatment?: string): string {
  const suffix = treatment ? ` · ${treatment.replaceAll("_", " ")}` : "";
  if (kind === "camera_recipe") return `Verified channel camera language${suffix}`;
  if (kind === "motion_recipe") return `Verified channel motion language${suffix}`;
  if (kind === "prompt_recipe") return `Verified channel visual language${suffix}`;
  if (kind === "transition_template") return "Verified channel transition language";
  return `Verified channel treatment lock${suffix}`;
}

function proposalFor(input: {
  readonly kind: z.infer<typeof CandidateAssetKindSchema>;
  readonly channelId: string;
  readonly family: string;
  readonly contentLane: string;
  readonly manifest: VisualMatterManifest;
  readonly candidateFingerprint: string;
}) {
  const treatment = input.manifest.treatment?.key;
  const board = input.manifest.moodBoard;
  const storyboard = input.manifest.storyboard;
  const common = {
    channelWorld: input.manifest.channelWorld,
    palette: board.palette.join(", "),
    lighting: board.lighting,
  };
  const recipe = input.kind === "camera_recipe"
    ? candidateRecipe(
        [board.lighting, ...storyboard.map((frame) => frame.promptAddendum)],
        { ...common, scope: "camera language only; story and character identity remain route-owned" },
      )
    : input.kind === "motion_recipe"
      ? candidateRecipe(
          storyboard.map((frame) => frame.motionAddendum),
          { channelWorld: input.manifest.channelWorld, scope: "motion grammar only; beat timing remains route-owned" },
        )
      : input.kind === "prompt_recipe"
        ? candidateRecipe(
            [board.visualPrompt, ...input.manifest.settings.map((setting) => setting.stylePrompt)],
            { ...common, scope: "visual grammar only; no character or source-claim reuse" },
          )
        : candidateRecipe(
            [input.manifest.treatment?.label ?? "visual treatment", board.visualPrompt],
            {
              treatment: input.manifest.treatment?.key ?? "route-owned treatment",
              requiredReferences: (input.manifest.treatment?.requiredReferenceKinds ?? []).join(", "),
              scope: "treatment grammar only; renderer admission remains separate",
            },
          );
  return stable({
    logicalId: candidateId(input.kind, input.candidateFingerprint),
    title: titleFor(input.kind, treatment),
    assetKind: input.kind,
    scope: "channel" as const,
    channelId: input.channelId,
    identitySensitivity: "channel" as const,
    compatibility: {
      families: [input.family],
      contentLanes: [input.contentLane],
      moduleIds: ["visual_matter"] as ["visual_matter"],
      treatments: treatment ? [treatment] : [],
    },
    recipe,
  });
}

function postproductionProposalFor(input: {
  readonly channelId: string;
  readonly family: string;
  readonly contentLane: string;
  readonly decision: StudioPostproductionDecisionReceipt;
  readonly candidateFingerprint: string;
}) {
  const recipe = candidateRecipe(
    [`Channel-approved transition preset: ${input.decision.transitionPreset}`],
    {
      transitionPreset: input.decision.transitionPreset,
      scope: "transition grammar only; cut timing, captions, and narrative remain route-owned",
    },
  );
  return stable({
    logicalId: candidateId("transition_template", input.candidateFingerprint),
    title: titleFor("transition_template"),
    assetKind: "transition_template" as const,
    scope: "channel" as const,
    channelId: input.channelId,
    identitySensitivity: "channel" as const,
    compatibility: {
      families: [input.family],
      contentLanes: [input.contentLane],
      moduleIds: ["timeline_assemble"] as ["timeline_assemble"],
      treatments: [],
    },
    recipe,
  });
}

/**
 * Derive up to four channel-only candidates from the exact Visual Matter plan
 * that survived production final-master review.  An approved Studio recipe
 * already used in this run is intentionally not re-proposed.
 */
export function createStudioAssetPromotionCandidates(input: {
  readonly ownerId: string;
  readonly channelId: string;
  readonly runId: string;
  readonly family: string;
  readonly contentLane: string;
  readonly finalMasterReleaseCertificateKey: string;
  readonly finalMasterReleaseCertificateFingerprint: string;
  readonly finalMasterSha256: string;
  readonly qualityEvidenceFingerprint: string;
  readonly visualReviewReceiptFingerprint: string;
  readonly visualQualityScore: number;
  readonly visualMinimumScore: number;
  readonly visualMatter: unknown;
  readonly sourceEntryFingerprints: readonly string[];
}): readonly StudioAssetPromotionCandidate[] {
  const manifest = VisualMatterManifestSchema.parse(input.visualMatter);
  if (manifest.status === "disabled" || input.sourceEntryFingerprints.length > 0) return [];
  const treatment = manifest.treatment?.key;
  const kinds: z.infer<typeof CandidateAssetKindSchema>[] = [
    "camera_recipe",
    "motion_recipe",
    "prompt_recipe",
    ...(treatment ? ["visual_treatment_recipe" as const] : []),
  ];
  return stable(kinds.map((kind) => {
    const provisional = {
      version: STUDIO_ASSET_PROMOTION_CANDIDATE_VERSION,
      ownerId: input.ownerId,
      channelId: input.channelId,
      runId: input.runId,
      origin: {
        finalMasterReleaseCertificateKey: input.finalMasterReleaseCertificateKey,
        finalMasterReleaseCertificateFingerprint: input.finalMasterReleaseCertificateFingerprint,
        finalMasterSha256: input.finalMasterSha256,
        qualityEvidenceFingerprint: input.qualityEvidenceFingerprint,
        visualReviewReceiptFingerprint: input.visualReviewReceiptFingerprint,
        visualQualityScore: input.visualQualityScore,
        visualMinimumScore: input.visualMinimumScore,
        visualMatterRevision: manifest.revision,
        ...(manifest.referencePackFingerprint ? { referencePackFingerprint: manifest.referencePackFingerprint } : {}),
      },
      kind,
    };
    const candidateFingerprint = fingerprint(provisional);
    const core = StudioAssetPromotionCandidateCoreSchema.parse({
      version: STUDIO_ASSET_PROMOTION_CANDIDATE_VERSION,
      ownerId: input.ownerId,
      channelId: input.channelId,
      runId: input.runId,
      origin: provisional.origin,
      proposal: proposalFor({
        kind,
        channelId: input.channelId,
        family: input.family,
        contentLane: input.contentLane,
        manifest,
        candidateFingerprint,
      }),
    });
    const sealed = stable({ ...core, candidateFingerprint: fingerprint(core) });
    return StudioAssetPromotionCandidateSchema.parse(sealed);
  }));
}

/**
 * A post-production template is promotable only when the frozen channel
 * configuration actually selected it and the resulting master passed QA.
 * Pipeline defaults and already-approved Studio assets are deliberately never
 * promoted here: the former is not an operator-owned asset and the latter is
 * already represented by its exact source-entry receipt.
 */
export function createStudioPostproductionPromotionCandidates(input: {
  readonly ownerId: string;
  readonly channelId: string;
  readonly runId: string;
  readonly family: string;
  readonly contentLane: string;
  readonly finalMasterReleaseCertificateKey: string;
  readonly finalMasterReleaseCertificateFingerprint: string;
  readonly finalMasterSha256: string;
  readonly qualityEvidenceFingerprint: string;
  readonly visualReviewReceiptFingerprint: string;
  readonly visualQualityScore: number;
  readonly visualMinimumScore: number;
  readonly decision: unknown;
}): readonly StudioAssetPromotionCandidate[] {
  const decision = assertStudioPostproductionDecisionReceipt(input.decision);
  if (decision.selectionSource !== "operator_module_config") return [];
  const origin = {
    finalMasterReleaseCertificateKey: input.finalMasterReleaseCertificateKey,
    finalMasterReleaseCertificateFingerprint: input.finalMasterReleaseCertificateFingerprint,
    finalMasterSha256: input.finalMasterSha256,
    qualityEvidenceFingerprint: input.qualityEvidenceFingerprint,
    visualReviewReceiptFingerprint: input.visualReviewReceiptFingerprint,
    visualQualityScore: input.visualQualityScore,
    visualMinimumScore: input.visualMinimumScore,
    postproductionDecisionFingerprint: decision.receiptFingerprint,
    postproductionModuleId: decision.moduleId,
  };
  const provisional = {
    version: STUDIO_ASSET_PROMOTION_CANDIDATE_VERSION,
    ownerId: input.ownerId,
    channelId: input.channelId,
    runId: input.runId,
    origin,
    kind: "transition_template" as const,
  };
  const candidateFingerprint = fingerprint(provisional);
  const core = StudioAssetPromotionCandidateCoreSchema.parse({
    version: STUDIO_ASSET_PROMOTION_CANDIDATE_VERSION,
    ownerId: input.ownerId,
    channelId: input.channelId,
    runId: input.runId,
    origin,
    proposal: postproductionProposalFor({
      channelId: input.channelId,
      family: input.family,
      contentLane: input.contentLane,
      decision,
      candidateFingerprint,
    }),
  });
  const sealed = stable({ ...core, candidateFingerprint: fingerprint(core) });
  return stable([StudioAssetPromotionCandidateSchema.parse(sealed)]);
}

export function assertStudioAssetPromotionCandidate(value: unknown): StudioAssetPromotionCandidate {
  const parsed = StudioAssetPromotionCandidateSchema.parse(value);
  const core: StudioAssetPromotionCandidateCore = {
    version: parsed.version,
    ownerId: parsed.ownerId,
    channelId: parsed.channelId,
    runId: parsed.runId,
    origin: parsed.origin,
    proposal: parsed.proposal,
  };
  if (fingerprint(core) !== parsed.candidateFingerprint) {
    throw new Error("Studio asset promotion candidate fingerprint does not bind its immutable content");
  }
  return stable(parsed);
}

/** Only an explicit owner approval can turn a pending candidate into an entry. */
export function approveStudioAssetPromotionCandidate(input: {
  readonly candidate: unknown;
  readonly approvedBy: string;
  readonly approvedAt: number;
}): StudioAssetLibraryEntry {
  const candidate = assertStudioAssetPromotionCandidate(input.candidate);
  const approvedBy = input.approvedBy.trim();
  if (!approvedBy) throw new Error("Studio asset promotion approval requires the approving owner");
  if (!Number.isInteger(input.approvedAt) || input.approvedAt <= 0) {
    throw new Error("Studio asset promotion approval requires a valid approval time");
  }
  const proposal = candidate.proposal;
  const entry: StudioAssetLibraryEntryCore = {
    version: "studio-asset-library/v1",
    logicalId: proposal.logicalId,
    title: proposal.title,
    scope: proposal.scope,
    channelId: proposal.channelId,
    assetKind: proposal.assetKind,
    identitySensitivity: proposal.identitySensitivity,
    status: "approved",
    compatibility: proposal.compatibility,
    approval: {
      provenanceFingerprint: candidate.origin.finalMasterReleaseCertificateFingerprint,
      qualityEvidenceFingerprint: candidate.origin.qualityEvidenceFingerprint,
      qualityScore: candidate.origin.visualQualityScore,
      approvedBy,
      approvedAt: input.approvedAt,
    },
    recipe: proposal.recipe,
  };
  return createStudioAssetLibraryEntry(entry);
}

/** Browser-safe candidate projection. No prompt text, R2 key, or stored bytes leave the server. */
export function studioAssetPromotionCandidateInventory(
  candidates: readonly StudioAssetPromotionCandidate[],
): readonly StudioAssetPromotionCandidateInventoryItem[] {
  return stable(candidates
    .map((candidate) => stable({
      candidateFingerprint: candidate.candidateFingerprint,
      title: candidate.proposal.title,
      assetKind: candidate.proposal.assetKind,
      channelId: candidate.channelId,
      family: candidate.proposal.compatibility.families[0]!,
      contentLane: candidate.proposal.compatibility.contentLanes[0]!,
      ...(candidate.proposal.compatibility.treatments[0]
        ? { treatment: candidate.proposal.compatibility.treatments[0] }
        : {}),
      visualQualityScore: candidate.origin.visualQualityScore,
      visualMinimumScore: candidate.origin.visualMinimumScore,
      finalMasterSha256: candidate.origin.finalMasterSha256,
      finalMasterReleaseCertificateFingerprint: candidate.origin.finalMasterReleaseCertificateFingerprint,
    }))
    .sort((left, right) => left.title.localeCompare(right.title) || left.candidateFingerprint.localeCompare(right.candidateFingerprint)));
}
