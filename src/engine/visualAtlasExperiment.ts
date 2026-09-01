import { z } from "zod";

import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

export const VISUAL_ATLAS_EXPERIMENT_VERSION = "visual-atlas-experiment/v1" as const;
export const VISUAL_ATLAS_QUALIFICATION_VERSION = "visual-atlas-qualification/v1" as const;

export const VISUAL_ATLAS_GRID_SIZES = [2, 4, 8, 16] as const;
export type VisualAtlasGridSize = (typeof VISUAL_ATLAS_GRID_SIZES)[number];

export const CHARACTER_ANGLE_ATLAS_VIEWS = [
  "front_full",
  "three_quarter_left_full",
  "profile_left_full",
  "back_full",
  "three_quarter_right_full",
  "profile_right_full",
  "front_face_neutral",
  "front_face_smile",
  "front_face_concern",
  "three_quarter_face_left",
  "three_quarter_face_right",
  "hands_front_back",
  "wardrobe_front",
  "wardrobe_back",
  "silhouette_front",
  "silhouette_profile",
] as const;
export type CharacterAngleAtlasView = (typeof CHARACTER_ANGLE_ATLAS_VIEWS)[number];

const FingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const OwnedIdSchema = z.string().trim().min(1).max(320);
const BoundedTextSchema = z.string().trim().min(1).max(1_600);

export const VisualAtlasIdentityAnchorSchema = z.object({
  id: OwnedIdSchema,
  role: z.enum([
    "line_language",
    "palette",
    "recurring_subject",
    "setting",
    "wardrobe",
    "material",
    "motif",
    "color_grade",
    "other",
  ]),
  instruction: BoundedTextSchema,
  sourceFingerprint: FingerprintSchema,
}).strict();
export type VisualAtlasIdentityAnchor = z.infer<typeof VisualAtlasIdentityAnchorSchema>;

const VisualAtlasFrameSchema = z.object({
  frameId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,119}$/u),
  sequenceIndex: z.number().int().min(0).max(255),
  shot: z.enum(["extreme_wide", "wide", "medium", "close", "detail", "orthographic"]),
  description: BoundedTextSchema,
  persistentIdentityAnchorIds: z.array(OwnedIdSchema).min(1).max(32),
  visualElementIds: z.array(OwnedIdSchema).min(1).max(64),
  characterIds: z.array(OwnedIdSchema).max(16),
  motion: z.object({
    camera: BoundedTextSchema,
    subject: BoundedTextSchema,
    environment: BoundedTextSchema,
    beginsAtFrameZero: z.literal(true),
  }).strict(),
}).strict();

export type VisualAtlasFrame = z.infer<typeof VisualAtlasFrameSchema>;

const VisualAtlasVariantSchema = z.object({
  gridSize: z.union([z.literal(2), z.literal(4), z.literal(8), z.literal(16)]),
  canvasPixels: z.number().int().min(512).max(16_384),
  capacityPerSheet: z.number().int().positive(),
  sheetCount: z.number().int().positive(),
  tilePixels: z.number().int().positive(),
  minimumTilePixels: z.number().int().min(128).max(2_048),
  geometryStatus: z.enum(["renderable", "geometry_blocked"]),
  blocker: z.string().trim().min(1).max(500).optional(),
  plannedProviderCalls: z.number().int().positive(),
}).strict().superRefine((variant, issue) => {
  if (variant.capacityPerSheet !== variant.gridSize ** 2) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "atlas capacity must equal gridSize squared" });
  }
  if (variant.tilePixels !== Math.floor(variant.canvasPixels / variant.gridSize)) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "atlas tile pixels do not match canvas/grid geometry" });
  }
  const shouldRender = variant.tilePixels >= variant.minimumTilePixels;
  if ((variant.geometryStatus === "renderable") !== shouldRender) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "atlas geometry status does not match effective tile resolution" });
  }
  if (variant.geometryStatus === "geometry_blocked" && !variant.blocker) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "a geometry-blocked atlas requires a blocker" });
  }
  if (variant.geometryStatus === "renderable" && variant.blocker) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "a renderable atlas cannot carry a geometry blocker" });
  }
  if (variant.plannedProviderCalls !== variant.sheetCount) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "each atlas sheet must map to exactly one planned provider call" });
  }
});

export type VisualAtlasVariant = z.infer<typeof VisualAtlasVariantSchema>;

const VisualAtlasExperimentBodySchema = z.object({
  version: z.literal(VISUAL_ATLAS_EXPERIMENT_VERSION),
  useCase: z.enum(["storyboard_sequence", "character_angles"]),
  ownerId: OwnedIdSchema,
  channelId: OwnedIdSchema,
  channelIdentityFingerprint: FingerprintSchema,
  sourcePlanFingerprint: FingerprintSchema,
  identityAnchors: z.array(VisualAtlasIdentityAnchorSchema).min(1).max(32),
  persistentIdentityAnchorIds: z.array(OwnedIdSchema).min(1).max(32),
  frameCount: z.number().int().min(1).max(256),
  frames: z.array(VisualAtlasFrameSchema).min(1).max(256),
  canvasPixels: z.number().int().min(512).max(16_384),
  minimumTilePixels: z.number().int().min(128).max(2_048),
  variants: z.array(VisualAtlasVariantSchema).length(VISUAL_ATLAS_GRID_SIZES.length),
  baseline: z.object({
    method: z.literal("independent_frame_generation"),
    plannedProviderCalls: z.number().int().positive(),
    framePixels: z.number().int().positive(),
  }).strict(),
  selectionPolicy: z.object({
    qualityMustMeetOrBeatBaseline: z.literal(true),
    continuityMustMeetOrBeatBaseline: z.literal(true),
    identityCoverageRequired: z.literal(1),
    visualElementCoverageRequired: z.literal(1),
    humanReviewRequired: z.literal(true),
    lowerObservedCostRequired: z.literal(true),
  }).strict(),
}).strict();

function experimentFingerprint(
  value: z.infer<typeof VisualAtlasExperimentBodySchema>,
): string {
  return sha256Hex(canonicalJson(value));
}

export const VisualAtlasExperimentPlanSchema = VisualAtlasExperimentBodySchema.extend({
  fingerprint: FingerprintSchema,
}).strict().superRefine((plan, issue) => {
  const { fingerprint, ...body } = plan;
  if (fingerprint !== experimentFingerprint(body)) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "visual-atlas experiment fingerprint is invalid" });
  }
  if (plan.frameCount !== plan.frames.length || plan.baseline.plannedProviderCalls !== plan.frames.length) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "visual-atlas frame count/baseline does not match its frames" });
  }
  const frameIds = new Set(plan.frames.map((frame) => frame.frameId));
  const indexes = new Set(plan.frames.map((frame) => frame.sequenceIndex));
  if (frameIds.size !== plan.frames.length || indexes.size !== plan.frames.length) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "visual-atlas frame ids and sequence indexes must be unique" });
  }
  const expectedIndexes = plan.frames.map((_, index) => index);
  if (plan.frames.some((frame, index) => frame.sequenceIndex !== expectedIndexes[index])) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "visual-atlas frames must be ordered by a gap-free sequence index" });
  }
  const requiredAnchors = new Set(plan.persistentIdentityAnchorIds);
  const definedAnchors = new Set(plan.identityAnchors.map((anchor) => anchor.id));
  if (definedAnchors.size !== plan.identityAnchors.length) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "visual-atlas identity anchor ids must be unique" });
  }
  const undefinedPersistent = [...requiredAnchors].filter((anchor) => !definedAnchors.has(anchor));
  if (undefinedPersistent.length) {
    issue.addIssue({
      code: z.ZodIssueCode.custom,
      message: `visual-atlas persistent identity anchor(s) are undefined: ${undefinedPersistent.join(", ")}`,
    });
  }
  for (const frame of plan.frames) {
    const frameAnchors = new Set(frame.persistentIdentityAnchorIds);
    const missing = [...requiredAnchors].filter((anchor) => !frameAnchors.has(anchor));
    if (missing.length) {
      issue.addIssue({
        code: z.ZodIssueCode.custom,
        message: `frame ${frame.frameId} drops persistent channel identity anchor(s): ${missing.join(", ")}`,
      });
    }
  }
  const variantGrids = plan.variants.map((variant) => variant.gridSize);
  if (variantGrids.join("|") !== VISUAL_ATLAS_GRID_SIZES.join("|")) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "visual-atlas plan must compare 2x2, 4x4, 8x8, and 16x16 in order" });
  }
  for (const variant of plan.variants) {
    const expectedSheets = Math.ceil(plan.frameCount / variant.capacityPerSheet);
    if (variant.sheetCount !== expectedSheets) {
      issue.addIssue({ code: z.ZodIssueCode.custom, message: `${variant.gridSize}x${variant.gridSize} sheet count is invalid` });
    }
  }
  if (plan.useCase === "character_angles") {
    const expected = [...CHARACTER_ANGLE_ATLAS_VIEWS];
    const actual = plan.frames.map((frame) => frame.frameId);
    if (actual.join("|") !== expected.join("|")) {
      issue.addIssue({ code: z.ZodIssueCode.custom, message: "character-angle atlas must contain the canonical sixteen views in order" });
    }
  }
});

export type VisualAtlasExperimentPlan = z.infer<typeof VisualAtlasExperimentPlanSchema>;

export interface CreateVisualAtlasExperimentInput {
  readonly useCase: "storyboard_sequence" | "character_angles";
  readonly ownerId: string;
  readonly channelId: string;
  readonly channelIdentityFingerprint: string;
  readonly sourcePlanFingerprint: string;
  readonly identityAnchors: readonly VisualAtlasIdentityAnchor[];
  readonly frames: readonly VisualAtlasFrame[];
  readonly canvasPixels?: number;
  readonly minimumTilePixels?: number;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function createVisualAtlasExperimentPlan(
  input: CreateVisualAtlasExperimentInput,
): VisualAtlasExperimentPlan {
  const canvasPixels = Math.max(512, Math.min(16_384, Math.floor(input.canvasPixels ?? 2_048)));
  const minimumTilePixels = Math.max(128, Math.min(2_048, Math.floor(input.minimumTilePixels ?? 512)));
  const identityAnchors = input.identityAnchors.map((anchor) => VisualAtlasIdentityAnchorSchema.parse(anchor));
  const persistentIdentityAnchorIds = unique(identityAnchors.map((anchor) => anchor.id));
  const frames = input.frames.map((frame, sequenceIndex) => VisualAtlasFrameSchema.parse({
    ...frame,
    sequenceIndex,
    persistentIdentityAnchorIds: unique(frame.persistentIdentityAnchorIds),
    visualElementIds: unique(frame.visualElementIds),
    characterIds: unique(frame.characterIds),
  }));
  const variants = VISUAL_ATLAS_GRID_SIZES.map((gridSize): VisualAtlasVariant => {
    const capacityPerSheet = gridSize ** 2;
    const sheetCount = Math.ceil(frames.length / capacityPerSheet);
    const tilePixels = Math.floor(canvasPixels / gridSize);
    const renderable = tilePixels >= minimumTilePixels;
    return VisualAtlasVariantSchema.parse({
      gridSize,
      canvasPixels,
      capacityPerSheet,
      sheetCount,
      tilePixels,
      minimumTilePixels,
      geometryStatus: renderable ? "renderable" : "geometry_blocked",
      ...(renderable ? {} : {
        blocker:
          `${gridSize}x${gridSize} at ${canvasPixels}px yields ${tilePixels}px cells; ` +
          `the quality floor is ${minimumTilePixels}px. Raise the canvas to at least ${gridSize * minimumTilePixels}px before spending.`,
      }),
      plannedProviderCalls: sheetCount,
    });
  });
  const body: z.infer<typeof VisualAtlasExperimentBodySchema> = {
    version: VISUAL_ATLAS_EXPERIMENT_VERSION,
    useCase: input.useCase,
    ownerId: input.ownerId,
    channelId: input.channelId,
    channelIdentityFingerprint: input.channelIdentityFingerprint,
    sourcePlanFingerprint: input.sourcePlanFingerprint,
    identityAnchors,
    persistentIdentityAnchorIds,
    frameCount: frames.length,
    frames,
    canvasPixels,
    minimumTilePixels,
    variants,
    baseline: {
      method: "independent_frame_generation",
      plannedProviderCalls: frames.length,
      framePixels: canvasPixels,
    },
    selectionPolicy: {
      qualityMustMeetOrBeatBaseline: true,
      continuityMustMeetOrBeatBaseline: true,
      identityCoverageRequired: 1,
      visualElementCoverageRequired: 1,
      humanReviewRequired: true,
      lowerObservedCostRequired: true,
    },
  };
  return Object.freeze(VisualAtlasExperimentPlanSchema.parse({
    ...body,
    fingerprint: experimentFingerprint(body),
  }));
}

export function createCharacterAngleAtlasExperiment(input: {
  readonly ownerId: string;
  readonly channelId: string;
  readonly channelIdentityFingerprint: string;
  readonly characterSpecFingerprint: string;
  readonly characterId: string;
  readonly identityAnchors: readonly VisualAtlasIdentityAnchor[];
  readonly visualElementIds: readonly string[];
  readonly canvasPixels?: number;
  readonly minimumTilePixels?: number;
}): VisualAtlasExperimentPlan {
  const characterId = OwnedIdSchema.parse(input.characterId);
  const identityAnchors = input.identityAnchors.map((anchor) => VisualAtlasIdentityAnchorSchema.parse(anchor));
  const identityAnchorIds = unique(identityAnchors.map((anchor) => anchor.id));
  const visualElements = unique(input.visualElementIds);
  const frames = CHARACTER_ANGLE_ATLAS_VIEWS.map((view, sequenceIndex): VisualAtlasFrame => ({
    frameId: view,
    sequenceIndex,
    shot: view.includes("face") || view.includes("hands") ? "detail" : "orthographic",
    description:
      `${view.replaceAll("_", " ")} of the same recurring character; preserve face geometry, age, ` +
      "body proportions, hair shape, wardrobe construction, palette, materials, accessories, and silhouette exactly.",
    persistentIdentityAnchorIds: identityAnchorIds,
    visualElementIds: visualElements,
    characterIds: [characterId],
    motion: {
      camera: "locked orthographic reference view with no perspective drift",
      subject: "stable reference pose readable from the first frame",
      environment: "plain neutral reference background with no text or props",
      beginsAtFrameZero: true,
    },
  }));
  return createVisualAtlasExperimentPlan({
    useCase: "character_angles",
    ownerId: input.ownerId,
    channelId: input.channelId,
    channelIdentityFingerprint: input.channelIdentityFingerprint,
    sourcePlanFingerprint: input.characterSpecFingerprint,
    identityAnchors,
    frames,
    canvasPixels: input.canvasPixels,
    minimumTilePixels: input.minimumTilePixels,
  });
}

export interface VisualAtlasCellAddress {
  readonly sheetIndex: number;
  readonly row: number;
  readonly column: number;
  readonly coordinate: string;
  readonly crop: readonly [x: number, y: number, width: number, height: number];
}

/** Deterministic A1..P16 mapping; labels belong to metadata, never the generated pixels. */
export function visualAtlasCellAddress(
  planInput: unknown,
  gridSize: VisualAtlasGridSize,
  frameIndex: number,
): VisualAtlasCellAddress {
  const plan = VisualAtlasExperimentPlanSchema.parse(planInput);
  const variant = plan.variants.find((candidate) => candidate.gridSize === gridSize);
  if (!variant) throw new Error(`visual-atlas plan does not contain ${gridSize}x${gridSize}`);
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= plan.frames.length) {
    throw new Error(`visual-atlas frame index ${frameIndex} is outside 0..${plan.frames.length - 1}`);
  }
  const localIndex = frameIndex % variant.capacityPerSheet;
  const row = Math.floor(localIndex / gridSize);
  const column = localIndex % gridSize;
  return Object.freeze({
    sheetIndex: Math.floor(frameIndex / variant.capacityPerSheet),
    row,
    column,
    coordinate: `${String.fromCharCode(65 + row)}${column + 1}`,
    crop: [
      column * variant.tilePixels,
      row * variant.tilePixels,
      variant.tilePixels,
      variant.tilePixels,
    ] as const,
  });
}

const AtlasArtifactSchema = z.object({
  sheetIndex: z.number().int().min(0).max(255),
  r2Key: BoundedTextSchema,
  contentSha256: FingerprintSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  byteLength: z.number().int().positive(),
}).strict();

const CropArtifactSchema = z.object({
  frameId: OwnedIdSchema,
  sheetIndex: z.number().int().min(0).max(255),
  coordinate: z.string().regex(/^[A-P](?:[1-9]|1[0-6])$/u),
  r2Key: BoundedTextSchema,
  contentSha256: FingerprintSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  byteLength: z.number().int().positive(),
  identityAnchorCoverage: z.number().min(0).max(1),
  visualElementCoverage: z.number().min(0).max(1),
  legibilityScore: z.number().min(0).max(1),
  continuityScore: z.number().min(0).max(1),
}).strict();

const VisualAtlasQualificationBodySchema = z.object({
  version: z.literal(VISUAL_ATLAS_QUALIFICATION_VERSION),
  planFingerprint: FingerprintSchema,
  gridSize: z.union([z.literal(2), z.literal(4), z.literal(8), z.literal(16)]),
  provider: z.literal("attested_novita_image_worker"),
  providerCalls: z.number().int().positive(),
  observedCostUsd: z.number().nonnegative(),
  observedRuntimeSec: z.number().positive(),
  atlasArtifacts: z.array(AtlasArtifactSchema).min(1).max(256),
  crops: z.array(CropArtifactSchema).min(1).max(256),
  reviewer: z.object({
    kind: z.literal("human_visual_review"),
    reviewerId: OwnedIdSchema,
    reviewReceiptFingerprint: FingerprintSchema,
    verdict: z.enum(["pass", "fail"]),
    notes: BoundedTextSchema,
  }).strict(),
  aggregate: z.object({
    qualityScore: z.number().min(0).max(1),
    continuityScore: z.number().min(0).max(1),
    identityAnchorCoverage: z.number().min(0).max(1),
    visualElementCoverage: z.number().min(0).max(1),
  }).strict(),
}).strict();

function qualificationFingerprint(
  value: z.infer<typeof VisualAtlasQualificationBodySchema>,
): string {
  return sha256Hex(canonicalJson(value));
}

export const VisualAtlasQualificationReceiptSchema = VisualAtlasQualificationBodySchema.extend({
  fingerprint: FingerprintSchema,
}).strict().superRefine((receipt, issue) => {
  const { fingerprint, ...body } = receipt;
  if (fingerprint !== qualificationFingerprint(body)) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "visual-atlas qualification fingerprint is invalid" });
  }
});

export type VisualAtlasQualificationReceipt = z.infer<typeof VisualAtlasQualificationReceiptSchema>;

export function createVisualAtlasQualificationReceipt(input: {
  readonly plan: unknown;
  readonly gridSize: VisualAtlasGridSize;
  readonly providerCalls: number;
  readonly observedCostUsd: number;
  readonly observedRuntimeSec: number;
  readonly atlasArtifacts: readonly unknown[];
  readonly crops: readonly unknown[];
  readonly reviewer: unknown;
}): VisualAtlasQualificationReceipt {
  const plan = VisualAtlasExperimentPlanSchema.parse(input.plan);
  const variant = plan.variants.find((candidate) => candidate.gridSize === input.gridSize);
  if (!variant) throw new Error(`visual-atlas plan does not contain ${input.gridSize}x${input.gridSize}`);
  if (variant.geometryStatus !== "renderable") {
    throw new Error(variant.blocker ?? `${input.gridSize}x${input.gridSize} is geometry-blocked`);
  }
  const atlasArtifacts = z.array(AtlasArtifactSchema).length(variant.sheetCount).parse(input.atlasArtifacts);
  const crops = z.array(CropArtifactSchema).length(plan.frameCount).parse(input.crops);
  const reviewer = VisualAtlasQualificationBodySchema.shape.reviewer.parse(input.reviewer);
  if (input.providerCalls !== variant.plannedProviderCalls) {
    throw new Error("visual-atlas observed provider calls do not match the sealed variant");
  }
  const sheetIndexes = new Set(atlasArtifacts.map((artifact) => artifact.sheetIndex));
  if (sheetIndexes.size !== variant.sheetCount || [...sheetIndexes].some((index) => index >= variant.sheetCount)) {
    throw new Error("visual-atlas artifacts do not cover each planned sheet exactly once");
  }
  const cropIds = new Set(crops.map((crop) => crop.frameId));
  if (cropIds.size !== plan.frameCount || plan.frames.some((frame) => !cropIds.has(frame.frameId))) {
    throw new Error("visual-atlas crops do not cover each planned frame exactly once");
  }
  for (const [frameIndex, frame] of plan.frames.entries()) {
    const crop = crops.find((candidate) => candidate.frameId === frame.frameId)!;
    const address = visualAtlasCellAddress(plan, input.gridSize, frameIndex);
    if (crop.sheetIndex !== address.sheetIndex || crop.coordinate !== address.coordinate) {
      throw new Error(`visual-atlas crop ${crop.frameId} is not bound to its deterministic cell address`);
    }
    if (crop.width !== variant.tilePixels || crop.height !== variant.tilePixels) {
      throw new Error(`visual-atlas crop ${crop.frameId} does not preserve the sealed tile geometry`);
    }
  }
  const mean = (pick: (crop: z.infer<typeof CropArtifactSchema>) => number) =>
    crops.reduce((total, crop) => total + pick(crop), 0) / crops.length;
  const aggregate = {
    qualityScore: mean((crop) => crop.legibilityScore),
    continuityScore: mean((crop) => crop.continuityScore),
    identityAnchorCoverage: Math.min(...crops.map((crop) => crop.identityAnchorCoverage)),
    visualElementCoverage: Math.min(...crops.map((crop) => crop.visualElementCoverage)),
  };
  const body: z.infer<typeof VisualAtlasQualificationBodySchema> = {
    version: VISUAL_ATLAS_QUALIFICATION_VERSION,
    planFingerprint: plan.fingerprint,
    gridSize: input.gridSize,
    provider: "attested_novita_image_worker",
    providerCalls: input.providerCalls,
    observedCostUsd: input.observedCostUsd,
    observedRuntimeSec: input.observedRuntimeSec,
    atlasArtifacts,
    crops,
    reviewer,
    aggregate,
  };
  return Object.freeze(VisualAtlasQualificationReceiptSchema.parse({
    ...body,
    fingerprint: qualificationFingerprint(body),
  }));
}

export type VisualAtlasSelectionDecision = Readonly<{
  decision: "qualified" | "rejected";
  reasons: readonly string[];
  selectedGridSize?: VisualAtlasGridSize;
  savings?: Readonly<{ providerCalls: number; costUsd: number; runtimeSec: number }>;
}>;

/**
 * Selects an atlas only from two real, human-reviewed render receipts. It is
 * impossible to replace independent production frames from geometry or prompt
 * claims alone.
 */
export function selectVisualAtlasCandidate(input: {
  readonly plan: unknown;
  readonly baseline: unknown;
  readonly candidate: unknown;
}): VisualAtlasSelectionDecision {
  const plan = VisualAtlasExperimentPlanSchema.parse(input.plan);
  const baseline = VisualAtlasQualificationReceiptSchema.parse(input.baseline);
  const candidate = VisualAtlasQualificationReceiptSchema.parse(input.candidate);
  if (baseline.planFingerprint !== plan.fingerprint || candidate.planFingerprint !== plan.fingerprint) {
    throw new Error("visual-atlas qualification receipts do not bind the selected experiment plan");
  }
  const reasons = [
    baseline.reviewer.verdict !== "pass" ? "independent-frame baseline did not pass human review" : "",
    candidate.reviewer.verdict !== "pass" ? "atlas candidate did not pass human review" : "",
    candidate.aggregate.qualityScore < baseline.aggregate.qualityScore
      ? "atlas crop quality is below the independent-frame baseline"
      : "",
    candidate.aggregate.continuityScore < baseline.aggregate.continuityScore
      ? "atlas sequence continuity is below the independent-frame baseline"
      : "",
    candidate.aggregate.identityAnchorCoverage < 1
      ? "at least one atlas crop drops a persistent channel identity anchor"
      : "",
    candidate.aggregate.visualElementCoverage < 1
      ? "at least one atlas crop drops a required visual element"
      : "",
    candidate.providerCalls >= baseline.providerCalls
      ? "atlas candidate does not reduce observed provider calls"
      : "",
    candidate.observedCostUsd >= baseline.observedCostUsd
      ? "atlas candidate does not reduce observed render cost"
      : "",
  ].filter(Boolean);
  if (reasons.length) return Object.freeze({ decision: "rejected", reasons });
  return Object.freeze({
    decision: "qualified",
    reasons: [],
    selectedGridSize: candidate.gridSize,
    savings: {
      providerCalls: baseline.providerCalls - candidate.providerCalls,
      costUsd: baseline.observedCostUsd - candidate.observedCostUsd,
      runtimeSec: baseline.observedRuntimeSec - candidate.observedRuntimeSec,
    },
  });
}
