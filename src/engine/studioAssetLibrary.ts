import { z } from "zod";

import { canonicalJson } from "@/lib/canonicalJson";
import {
  DIRECT_LTX_CREATIVE_ADAPTER_RUNTIME_FINGERPRINT,
  LtxCreativeAdapterInputSchema,
  LtxCreativeAdapterSelectionSchema,
  LtxCreativeAdapterStackBenchmarkSchema,
  LtxCreativeAdapterStackSchema,
  LTX_CREATIVE_ADAPTER_STACK_VERSION,
  MAX_LTX_CREATIVE_ADAPTERS_PER_SHOT,
  type LtxCreativeAdapterInput,
} from "@/lib/ltxCreativeAdapter";
import { sha256Hex } from "@/lib/sha256";
import { ShotRenderManifestSchema } from "@/engine/renderArtifacts";

/**
 * An owner-operated, evidence-bound library for the *reusable instructions and
 * adapters* behind a channel—not an unsafe cross-channel media cache.  Raw
 * identity material is only ever resolvable in its owning channel/series.
 */
export const STUDIO_ASSET_LIBRARY_VERSION = "studio-asset-library/v1" as const;
export const STUDIO_ASSET_BUNDLE_VERSION = "studio-asset-bundle/v1" as const;

const SHA256 = /^[a-f0-9]{64}$/i;
const SAFE_ID = /^[a-z][a-z0-9_-]{1,95}$/;
const nonEmptyId = z.string().trim().regex(SAFE_ID, "must be a safe identifier");
const sha256 = z.string().trim().regex(SHA256, "must be a SHA-256 digest");
const CharacterRegistryIdentitiesSchema = z.array(sha256).max(3).superRefine((identities, ctx) => {
  if (new Set(identities).size !== identities.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "character registry identities cannot repeat" });
  }
  if (identities.some((identity, index) => index > 0 && identity < identities[index - 1]!)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "character registry identities must use canonical sort order" });
  }
});

export const StudioAssetScopeSchema = z.enum(["owned_studio", "channel", "series"]);
export const StudioAssetKindSchema = z.enum([
  "camera_recipe",
  "motion_recipe",
  "prompt_recipe",
  "overlay_template",
  "transition_template",
  "motion_graphics_template",
  "audio_recipe",
  "visual_treatment_recipe",
  "comfy_workflow",
  "standard_lora_adapter",
  "standard_lora_stack",
  "ic_lora_adapter",
  "control_guide",
]);
export const StudioAssetStatusSchema = z.enum(["approved", "deprecated", "revoked"]);
export const StudioAssetIdentitySensitivitySchema = z.enum(["portable", "channel", "series"]);
export const StudioControlKindSchema = z.enum([
  "reference_sheet",
  "pose",
  "depth",
  "edge",
  "motion_track",
  "reference_video",
  "spatial_upscale",
  "hdr_video",
  "dialogue_video",
  "restoration_video",
  "composition_video",
  "color_reference_video",
]);

const StudioAssetResourceSchema = z
  .object({
    r2Key: z.string().trim().min(1).max(1_024),
    contentSha256: sha256,
    contentType: z.string().trim().min(3).max(120),
    byteLength: z.number().int().positive().max(5_000_000_000),
  })
  .strict();

const StudioAssetCompatibilitySchema = z
  .object({
    families: z.array(nonEmptyId).min(1).max(24),
    contentLanes: z.array(nonEmptyId).min(1).max(16),
    moduleIds: z.array(nonEmptyId).min(1).max(24),
    treatments: z.array(nonEmptyId).max(24).default([]),
    runtimeFingerprint: sha256.optional(),
  })
  .strict();

const StudioAssetRecipeSchema = z
  .object({
    version: z.literal("studio-asset-recipe/v1"),
    promptFragments: z.array(z.string().trim().min(1).max(2_000)).max(24).default([]),
    controlValues: z.record(z.string().trim().min(1).max(96), z.string().trim().min(1).max(1_000)).default({}),
    instructionFingerprint: sha256,
  })
  .strict();

const StudioLoraBindingSchema = z
  .object({
    candidateId: nonEmptyId,
    adapterClass: z.enum(["standard_lora", "ic_lora"]),
    adapterSha256: sha256,
    benchmarkFingerprint: sha256,
    runtimeFingerprint: sha256,
    /** Required only by the currently supported direct LTX standard-LoRA path. */
    renderStrength: z.number().finite().min(0.15).max(0.95).optional(),
    controlKinds: z.array(StudioControlKindSchema).max(4).default([]),
    /**
     * Required for a trained, series-bound standard character LoRA. This is
     * intentionally separate from the channel/series labels: a revised
     * narrative plan must not silently reuse an adapter trained for a prior
     * character specification or continuity contract.
     */
    seriesBindingFingerprint: sha256.optional(),
    /**
     * Immutable accepted character-adapter registry identity. A series LoRA
     * must bind a named character, not merely a shared series label.
     */
    characterRegistryIdentity: sha256.optional(),
    /**
     * The immutable Studio entry for the exact Comfy workflow that may load an
     * IC-LoRA.  It is deliberately an asset-entry fingerprint rather than a
     * mutable workflow label, so an adapter cannot be silently retargeted.
     */
    comfyWorkflowFingerprint: sha256.optional(),
    requiresSeriesBinding: z.boolean(),
  })
  .strict();

/**
 * A stack is a reusable Studio decision, not a collection of arbitrary LoRA
 * files. It names the exact byte-bound adapter entries and carries the
 * combination's own LTX quality benchmark.
 */
const StudioLoraStackBindingSchema = z.object({
  adapterEntryFingerprints: z.array(sha256).min(2).superRefine((fingerprints, ctx) => {
    if (fingerprints.length > MAX_LTX_CREATIVE_ADAPTERS_PER_SHOT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `a direct-LTX LoRA stack may contain at most ${MAX_LTX_CREATIVE_ADAPTERS_PER_SHOT} complementary adapters`,
      });
    }
    if (new Set(fingerprints).size !== fingerprints.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a LoRA stack cannot repeat an adapter entry" });
    }
  }),
  /**
   * The complete cast identity set this exact benchmarked stack may influence.
   * Empty means a portable style/quality stack. It is not valid to trim a
   * stack at render time: the benchmark applies to this exact recipe only.
   */
  characterRegistryIdentities: CharacterRegistryIdentitiesSchema.default([]),
  runtimeFingerprint: sha256,
  benchmark: LtxCreativeAdapterStackBenchmarkSchema,
}).strict();

const StudioControlGuideBindingSchema = z
  .object({
    controlKind: StudioControlKindSchema,
    seriesBindingFingerprint: sha256,
    targetId: nonEmptyId,
  })
  .strict();

const StudioAssetApprovalSchema = z
  .object({
    provenanceFingerprint: sha256,
    qualityEvidenceFingerprint: sha256,
    qualityScore: z.number().min(0).max(100),
    approvedBy: z.string().trim().min(1).max(160),
    approvedAt: z.number().int().positive(),
  })
  .strict();

export const StudioAssetLibraryEntryCoreSchema = z
  .object({
    version: z.literal(STUDIO_ASSET_LIBRARY_VERSION),
    logicalId: nonEmptyId,
    title: z.string().trim().min(1).max(160),
    scope: StudioAssetScopeSchema,
    channelId: z.string().trim().min(1).max(160).optional(),
    seriesIdentity: nonEmptyId.optional(),
    assetKind: StudioAssetKindSchema,
    identitySensitivity: StudioAssetIdentitySensitivitySchema,
    status: StudioAssetStatusSchema,
    compatibility: StudioAssetCompatibilitySchema,
    approval: StudioAssetApprovalSchema,
    recipe: StudioAssetRecipeSchema.optional(),
    resource: StudioAssetResourceSchema.optional(),
    lora: StudioLoraBindingSchema.optional(),
    loraStack: StudioLoraStackBindingSchema.optional(),
    controlGuide: StudioControlGuideBindingSchema.optional(),
    supersedesFingerprint: sha256.optional(),
  })
  .strict();

export const StudioAssetLibraryEntrySchema = StudioAssetLibraryEntryCoreSchema.extend({
  fingerprint: sha256,
}).strict();

export type StudioAssetLibraryEntryCore = z.infer<typeof StudioAssetLibraryEntryCoreSchema>;
export type StudioAssetLibraryEntry = z.infer<typeof StudioAssetLibraryEntrySchema>;

function stable<T>(value: T): T {
  return Object.freeze(value);
}

function fingerprint(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export function studioAssetLibraryEntryFingerprint(entry: StudioAssetLibraryEntryCore): string {
  return fingerprint(StudioAssetLibraryEntryCoreSchema.parse(entry));
}

function assertScope(entry: StudioAssetLibraryEntryCore): void {
  if (entry.scope === "owned_studio") {
    if (entry.channelId || entry.seriesIdentity) {
      throw new Error("studioAssetLibrary: owned_studio entries cannot carry a channel or series identity");
    }
    if (entry.identitySensitivity !== "portable") {
      throw new Error("studioAssetLibrary: owned_studio entries must be portable, never identity-bearing");
    }
  }
  if (entry.scope === "channel") {
    if (!entry.channelId || entry.seriesIdentity) {
      throw new Error("studioAssetLibrary: channel entries require exactly a channel identity");
    }
    if (entry.identitySensitivity === "series") {
      throw new Error("studioAssetLibrary: series-sensitive material must use series scope");
    }
  }
  if (entry.scope === "series" && (!entry.channelId || !entry.seriesIdentity)) {
    throw new Error("studioAssetLibrary: series entries require both channel and series identities");
  }
}

function assertKindBinding(entry: StudioAssetLibraryEntryCore): void {
  const isLora = entry.assetKind === "standard_lora_adapter" || entry.assetKind === "ic_lora_adapter";
  const isLoraStack = entry.assetKind === "standard_lora_stack";
  if (isLora !== Boolean(entry.lora)) {
    throw new Error("studioAssetLibrary: LoRA entries require a LoRA binding and other entries cannot carry one");
  }
  if (isLoraStack !== Boolean(entry.loraStack)) {
    throw new Error("studioAssetLibrary: standard LoRA stack entries require a stack binding and other entries cannot carry one");
  }
  if (entry.assetKind === "control_guide") {
    if (!entry.resource || !entry.controlGuide || entry.scope !== "series" || entry.identitySensitivity !== "series") {
      throw new Error("studioAssetLibrary: a control guide must be byte-bound, series-scoped identity material");
    }
  } else if (entry.controlGuide) {
    throw new Error("studioAssetLibrary: only control_guide entries may carry a control-guide binding");
  }
  if (entry.assetKind === "ic_lora_adapter") {
    if (
      !entry.lora
      || entry.lora.adapterClass !== "ic_lora"
      || !entry.lora.requiresSeriesBinding
      || entry.lora.controlKinds.length === 0
      || !entry.lora.comfyWorkflowFingerprint
      || entry.lora.renderStrength !== undefined
    ) {
      throw new Error("studioAssetLibrary: IC-LoRAs require a series binding, declared controls, and an exact Comfy workflow; direct-LTX strength is not valid here");
    }
  }
  if (entry.assetKind === "standard_lora_adapter" && entry.lora?.adapterClass !== "standard_lora") {
    throw new Error("studioAssetLibrary: standard LoRA entry has an incompatible adapter class");
  }
  if (entry.assetKind === "standard_lora_adapter") {
    if (!entry.lora?.renderStrength || entry.lora.controlKinds.length || entry.lora.comfyWorkflowFingerprint) {
      throw new Error("studioAssetLibrary: direct standard LoRAs require one calibrated strength and cannot claim IC controls or a Comfy workflow");
    }
    if (entry.lora.requiresSeriesBinding && (
      entry.scope !== "series"
      || entry.identitySensitivity !== "series"
      || !entry.lora.seriesBindingFingerprint
      || !entry.lora.characterRegistryIdentity
    )) {
      throw new Error("studioAssetLibrary: a series-bound standard character LoRA requires series scope, series identity sensitivity, an exact series binding, and an accepted character registry identity");
    }
    if (!entry.lora.requiresSeriesBinding && (entry.lora.seriesBindingFingerprint || entry.lora.characterRegistryIdentity)) {
      throw new Error("studioAssetLibrary: a portable standard LoRA cannot carry a series or character binding");
    }
  }
  if (entry.assetKind === "standard_lora_stack") {
    if (
      entry.lora
      || !entry.loraStack
      || entry.loraStack.runtimeFingerprint !== DIRECT_LTX_CREATIVE_ADAPTER_RUNTIME_FINGERPRINT
      || entry.compatibility.runtimeFingerprint !== DIRECT_LTX_CREATIVE_ADAPTER_RUNTIME_FINGERPRINT
    ) {
      throw new Error("studioAssetLibrary: standard LoRA stack must be pinned to the active direct-LTX runtime and cannot carry an adapter binding");
    }
    if (
      entry.loraStack.characterRegistryIdentities.length > 0
      && (entry.scope !== "series" || entry.identitySensitivity !== "series")
    ) {
      throw new Error("studioAssetLibrary: a character-bound LoRA stack must be series-scoped identity material");
    }
  }
  if (entry.assetKind === "comfy_workflow") {
    if (
      !entry.resource
      || entry.scope !== "owned_studio"
      || entry.identitySensitivity !== "portable"
      || !entry.compatibility.runtimeFingerprint
    ) {
      throw new Error("studioAssetLibrary: a Comfy workflow must be a portable Studio asset with byte-bound content and an exact runtime");
    }
  }
  if (isLora && !entry.resource) {
    throw new Error("studioAssetLibrary: every LoRA adapter must be byte-bound to its approved resource");
  }
  if (isLora) {
    const adapter = entry.lora;
    const resource = entry.resource;
    if (!adapter || !resource) {
      throw new Error("studioAssetLibrary: every LoRA adapter must retain its exact approved resource");
    }
    if (resource.contentSha256 !== adapter.adapterSha256) {
      throw new Error("studioAssetLibrary: a LoRA resource must match the exact adapter bytes benchmarked by the worker");
    }
    if (entry.approval.qualityEvidenceFingerprint !== adapter.benchmarkFingerprint) {
      throw new Error("studioAssetLibrary: a LoRA approval must bind the exact benchmark evidence used to admit that adapter");
    }
  }
  if (entry.assetKind === "standard_lora_stack") {
    const stack = entry.loraStack;
    if (!stack) {
      throw new Error("studioAssetLibrary: a standard LoRA stack is missing its combined benchmark");
    }
    if (entry.approval.qualityEvidenceFingerprint !== stack.benchmark.evidence.visualReviewReceiptFingerprint) {
      throw new Error("studioAssetLibrary: a LoRA stack approval must bind its exact combined-stack visual benchmark");
    }
  }
  if (!entry.recipe && !entry.resource && !entry.loraStack) {
    throw new Error("studioAssetLibrary: every entry needs either a reusable recipe or byte-bound resource");
  }
}

export function createStudioAssetLibraryEntry(entry: StudioAssetLibraryEntryCore): StudioAssetLibraryEntry {
  const parsed = StudioAssetLibraryEntryCoreSchema.parse(entry);
  assertScope(parsed);
  assertKindBinding(parsed);
  return stable({ ...parsed, fingerprint: studioAssetLibraryEntryFingerprint(parsed) });
}

export function assertStudioAssetLibraryEntry(value: unknown): StudioAssetLibraryEntry {
  const parsed = StudioAssetLibraryEntrySchema.parse(value);
  const core: StudioAssetLibraryEntryCore = {
    version: parsed.version,
    logicalId: parsed.logicalId,
    title: parsed.title,
    scope: parsed.scope,
    ...(parsed.channelId ? { channelId: parsed.channelId } : {}),
    ...(parsed.seriesIdentity ? { seriesIdentity: parsed.seriesIdentity } : {}),
    assetKind: parsed.assetKind,
    identitySensitivity: parsed.identitySensitivity,
    status: parsed.status,
    compatibility: parsed.compatibility,
    approval: parsed.approval,
    ...(parsed.recipe ? { recipe: parsed.recipe } : {}),
    ...(parsed.resource ? { resource: parsed.resource } : {}),
    ...(parsed.lora ? { lora: parsed.lora } : {}),
    ...(parsed.loraStack ? { loraStack: parsed.loraStack } : {}),
    ...(parsed.controlGuide ? { controlGuide: parsed.controlGuide } : {}),
    ...(parsed.supersedesFingerprint ? { supersedesFingerprint: parsed.supersedesFingerprint } : {}),
  };
  assertScope(core);
  assertKindBinding(core);
  if (studioAssetLibraryEntryFingerprint(core) !== parsed.fingerprint) {
    throw new Error("studioAssetLibrary: entry fingerprint does not bind its immutable content");
  }
  return stable(parsed);
}

/** Browser-safe inventory: it intentionally omits R2 locations, raw adapter
 * bytes, and local worker paths while retaining enough evidence to judge if an
 * approved asset can be reused for a channel. */
export interface StudioAssetInventoryItem {
  readonly logicalId: string;
  readonly title: string;
  readonly fingerprint: string;
  readonly scope: StudioAssetLibraryEntry["scope"];
  readonly channelId?: string;
  readonly seriesIdentity?: string;
  readonly assetKind: StudioAssetLibraryEntry["assetKind"];
  readonly status: StudioAssetLibraryEntry["status"];
  readonly identitySensitivity: StudioAssetLibraryEntry["identitySensitivity"];
  readonly compatibility: StudioAssetLibraryEntry["compatibility"];
  readonly approval: Pick<StudioAssetLibraryEntry["approval"], "qualityScore" | "approvedBy" | "approvedAt">;
  readonly hasRecipe: boolean;
  readonly recipePreview: readonly string[];
  readonly resource?: Pick<NonNullable<StudioAssetLibraryEntry["resource"]>, "contentType" | "byteLength" | "contentSha256">;
  readonly lora?: Pick<NonNullable<StudioAssetLibraryEntry["lora"]>, "candidateId" | "adapterClass" | "renderStrength" | "controlKinds" | "requiresSeriesBinding" | "benchmarkFingerprint" | "runtimeFingerprint">;
  readonly loraStack?: {
    readonly adapterCount: number;
    readonly runtimeFingerprint: string;
  };
  readonly controlGuide?: Pick<NonNullable<StudioAssetLibraryEntry["controlGuide"]>, "controlKind" | "targetId">;
}

export function studioAssetLibraryInventory(
  entries: readonly StudioAssetLibraryEntry[],
): readonly StudioAssetInventoryItem[] {
  return stable(entries
    .map((entry) => stable({
      logicalId: entry.logicalId,
      title: entry.title,
      fingerprint: entry.fingerprint,
      scope: entry.scope,
      ...(entry.channelId ? { channelId: entry.channelId } : {}),
      ...(entry.seriesIdentity ? { seriesIdentity: entry.seriesIdentity } : {}),
      assetKind: entry.assetKind,
      status: entry.status,
      identitySensitivity: entry.identitySensitivity,
      compatibility: entry.compatibility,
      approval: {
        qualityScore: entry.approval.qualityScore,
        approvedBy: entry.approval.approvedBy,
        approvedAt: entry.approval.approvedAt,
      },
      hasRecipe: Boolean(entry.recipe),
      recipePreview: stable((entry.recipe?.promptFragments ?? []).slice(0, 3)),
      ...(entry.resource ? {
        resource: {
          contentType: entry.resource.contentType,
          byteLength: entry.resource.byteLength,
          contentSha256: entry.resource.contentSha256,
        },
      } : {}),
      ...(entry.lora ? {
        lora: {
          candidateId: entry.lora.candidateId,
          adapterClass: entry.lora.adapterClass,
          ...(entry.lora.renderStrength ? { renderStrength: entry.lora.renderStrength } : {}),
          controlKinds: entry.lora.controlKinds,
          ...(entry.lora.comfyWorkflowFingerprint ? { requiresComfyWorkflow: true } : {}),
          requiresSeriesBinding: entry.lora.requiresSeriesBinding,
          benchmarkFingerprint: entry.lora.benchmarkFingerprint,
          runtimeFingerprint: entry.lora.runtimeFingerprint,
        },
      } : {}),
      ...(entry.loraStack ? {
        loraStack: {
          adapterCount: entry.loraStack.adapterEntryFingerprints.length,
          runtimeFingerprint: entry.loraStack.runtimeFingerprint,
        },
      } : {}),
      ...(entry.controlGuide ? {
        controlGuide: {
          controlKind: entry.controlGuide.controlKind,
          targetId: entry.controlGuide.targetId,
        },
      } : {}),
    }))
    .sort((left, right) => left.title.localeCompare(right.title) || left.logicalId.localeCompare(right.logicalId)));
}

export const StudioAssetResolveRequestSchema = z
  .object({
    ownerId: z.string().trim().min(1).max(160),
    channelId: z.string().trim().min(1).max(160),
    seriesIdentity: nonEmptyId.optional(),
    seriesBindingFingerprint: sha256.optional(),
    family: nonEmptyId,
    contentLane: nonEmptyId,
    moduleId: nonEmptyId,
    treatment: nonEmptyId.optional(),
    runtimeFingerprint: sha256.optional(),
    requiredKinds: z.array(StudioAssetKindSchema).min(1).max(12),
    /** An all-or-nothing bundle or independent approved recipe picks. */
    selectionMode: z.enum(["all", "best_effort"]).default("all"),
    targetId: nonEmptyId.optional(),
    /** Current-episode subset of the frozen series selector. */
    acceptedCharacterRegistryIdentities: z.array(sha256).max(32).optional(),
    /**
     * Exact on-screen cast set for a direct-LTX shot. An empty set means a
     * portable recipe; undefined preserves that same portable-only behavior
     * for non-serialized callers. Character stacks are never subset-matched.
     */
    targetCharacterRegistryIdentities: CharacterRegistryIdentitiesSchema.optional(),
  })
  .strict();
export type StudioAssetResolveRequest = z.input<typeof StudioAssetResolveRequestSchema>;
type NormalizedStudioAssetResolveRequest = z.output<typeof StudioAssetResolveRequestSchema>;

export interface StudioAssetBundle {
  readonly version: typeof STUDIO_ASSET_BUNDLE_VERSION;
  readonly requestFingerprint: string;
  readonly entries: readonly StudioAssetLibraryEntry[];
  readonly fingerprint: string;
}

export type StudioAssetResolution =
  | { readonly status: "resolved"; readonly bundle: StudioAssetBundle; readonly missingKinds: readonly z.infer<typeof StudioAssetKindSchema>[] }
  | { readonly status: "no_approved_match"; readonly missingKinds: readonly z.infer<typeof StudioAssetKindSchema>[]; readonly blockers: readonly string[] }
  | { readonly status: "blocked"; readonly blockers: readonly string[] };

function entryMatchesRequest(entry: StudioAssetLibraryEntry, request: NormalizedStudioAssetResolveRequest): string | null {
  if (entry.status !== "approved") return `${entry.logicalId} is ${entry.status}`;
  if (!entry.compatibility.families.includes(request.family)) return `${entry.logicalId} is not compatible with ${request.family}`;
  if (!entry.compatibility.contentLanes.includes(request.contentLane)) return `${entry.logicalId} is not compatible with ${request.contentLane}`;
  if (!entry.compatibility.moduleIds.includes(request.moduleId)) return `${entry.logicalId} is not compatible with ${request.moduleId}`;
  if (entry.compatibility.treatments.length > 0 && !request.treatment) {
    return `${entry.logicalId} requires an explicit visual treatment`;
  }
  if (request.treatment && entry.compatibility.treatments.length > 0 && !entry.compatibility.treatments.includes(request.treatment)) {
    return `${entry.logicalId} is not compatible with treatment ${request.treatment}`;
  }
  if (entry.compatibility.runtimeFingerprint && entry.compatibility.runtimeFingerprint !== request.runtimeFingerprint) {
    return `${entry.logicalId} requires its exact approved runtime`;
  }
  if (entry.scope === "channel" && entry.channelId !== request.channelId) return `${entry.logicalId} belongs to another channel`;
  if (entry.scope === "series" && (entry.channelId !== request.channelId || entry.seriesIdentity !== request.seriesIdentity)) {
    return `${entry.logicalId} belongs to another series`;
  }
  const targetCharacters = request.targetCharacterRegistryIdentities ?? [];
  if (entry.assetKind === "standard_lora_adapter" && entry.lora?.requiresSeriesBinding) {
    if (!request.seriesBindingFingerprint) return `${entry.logicalId} requires its exact series binding`;
    if (entry.lora.seriesBindingFingerprint !== request.seriesBindingFingerprint) {
      return `${entry.logicalId} belongs to a different series binding`;
    }
    if (!entry.lora.characterRegistryIdentity) {
      return `${entry.logicalId} is missing its accepted character registry identity`;
    }
    if (!request.acceptedCharacterRegistryIdentities?.includes(entry.lora.characterRegistryIdentity)) {
      return `${entry.logicalId} is not an accepted character adapter for this episode`;
    }
    if (
      targetCharacters.length !== 1
      || targetCharacters[0] !== entry.lora.characterRegistryIdentity
    ) {
      return `${entry.logicalId} is not bound to this exact on-screen character set`;
    }
  }
  if (entry.assetKind === "standard_lora_adapter" && !entry.lora?.requiresSeriesBinding && targetCharacters.length > 0) {
    return `${entry.logicalId} is portable and cannot replace an exact character recipe`;
  }
  if (entry.assetKind === "standard_lora_stack") {
    const stackCharacters = entry.loraStack?.characterRegistryIdentities ?? [];
    if (
      stackCharacters.length !== targetCharacters.length
      || stackCharacters.some((identity, index) => identity !== targetCharacters[index])
    ) {
      return `${entry.logicalId} is not benchmarked for this exact on-screen character set`;
    }
  }
  return null;
}

function rank(entry: StudioAssetLibraryEntry): readonly [number, number] {
  if (entry.assetKind !== "standard_lora_stack" || !entry.loraStack) {
    return [entry.approval.qualityScore, 0];
  }
  // A multi-LoRA recipe is only as good as its weakest measured dimension.
  // This deliberately outranks a manually-entered approval score: a stack
  // cannot win selection because one dimension looks excellent while its
  // identity, material, or camera result regresses.
  const deltas = entry.loraStack.benchmark.qualityDeltas;
  return [
    Math.min(...deltas.map((delta) => delta.adaptedScore)) * 10,
    Math.min(...deltas.map((delta) => delta.adaptedScore - delta.baselineScore)),
  ];
}

function demonstratedReleaseFeedback(input: {
  readonly entryFingerprint: string;
  readonly request: NormalizedStudioAssetResolveRequest;
  readonly receipts: readonly unknown[];
}): { readonly sampleCount: number; readonly meanVisualScore: number | null } {
  const byMaster = new Map<string, number>();
  for (const value of input.receipts) {
    let receipt: StudioAssetReleaseUsageReceipt;
    try {
      receipt = assertStudioAssetReleaseUsageReceipt(value);
    } catch {
      // Release feedback is optional ranking evidence. A corrupt historical
      // observation must never make a candidate appear better—or block a
      // separately approved asset that was otherwise safe to resolve.
      continue;
    }
    if (
      receipt.family !== input.request.family ||
      receipt.contentLane !== input.request.contentLane ||
      receipt.treatment !== input.request.treatment ||
      receipt.quality.visualStatus !== "pass" ||
      receipt.quality.visualScore === undefined ||
      receipt.quality.visualMinimumScore === undefined ||
      receipt.quality.visualScore < receipt.quality.visualMinimumScore ||
      !receipt.uses.some((use) =>
        use.assetEntryFingerprint === input.entryFingerprint &&
        use.moduleId === input.request.moduleId,
      )
    ) {
      continue;
    }
    byMaster.set(receipt.finalMaster.sha256, receipt.quality.visualScore);
  }
  const scores = [...byMaster.values()];
  if (scores.length < 3) {
    return { sampleCount: scores.length, meanVisualScore: null };
  }
  return {
    sampleCount: scores.length,
    meanVisualScore: scores.reduce((sum, score) => sum + score, 0) / scores.length,
  };
}

function ranked(input: {
  readonly entries: readonly StudioAssetLibraryEntry[];
  readonly request: NormalizedStudioAssetResolveRequest;
  readonly releaseUsageReceipts: readonly unknown[];
}): readonly StudioAssetLibraryEntry[] {
  const feedbackByEntry = new Map(input.entries.map((entry) => [
    entry.fingerprint,
    demonstratedReleaseFeedback({
      entryFingerprint: entry.fingerprint,
      request: input.request,
      receipts: input.releaseUsageReceipts,
    }),
  ]));
  return [...input.entries].sort((left, right) => {
    const [leftFloor, leftGain] = rank(left);
    const [rightFloor, rightGain] = rank(right);
    const leftFeedback = feedbackByEntry.get(left.fingerprint)!;
    const rightFeedback = feedbackByEntry.get(right.fingerprint)!;
    return rightFloor - leftFloor
      || rightGain - leftGain
      || right.approval.qualityScore - left.approval.qualityScore
      // Observed release quality is a mature (three independently sealed
      // masters), exact-context tie-breaker only. It cannot promote a new,
      // unbenchmarked, deprecated, or lower-approved candidate over the
      // original Studio approval and adapter benchmark hierarchy.
      || (rightFeedback.meanVisualScore ?? -1) - (leftFeedback.meanVisualScore ?? -1)
      || rightFeedback.sampleCount - leftFeedback.sampleCount
      || left.fingerprint.localeCompare(right.fingerprint);
  });
}

function controlGuideFor(
  adapter: StudioAssetLibraryEntry,
  entries: readonly StudioAssetLibraryEntry[],
  request: NormalizedStudioAssetResolveRequest,
): StudioAssetLibraryEntry | null {
  if (adapter.assetKind !== "ic_lora_adapter" || !adapter.lora || !request.seriesIdentity || !request.seriesBindingFingerprint || !request.targetId) {
    return null;
  }
  const lora = adapter.lora;
  return ranked({
    entries: entries.filter((entry) => {
      if (entry.assetKind !== "control_guide" || entry.status !== "approved" || !entry.controlGuide || !entry.resource) return false;
      if (entryMatchesRequest(entry, request)) return false;
      if (entry.channelId !== request.channelId || entry.seriesIdentity !== request.seriesIdentity) return false;
      if (entry.controlGuide.seriesBindingFingerprint !== request.seriesBindingFingerprint || entry.controlGuide.targetId !== request.targetId) return false;
      return lora.controlKinds.includes(entry.controlGuide.controlKind);
    }),
    request,
    // Guide selection remains pinned by the IC-LoRA/control contract itself;
    // final-master feedback is intentionally not used to rank a guide image.
    releaseUsageReceipts: [],
  })[0] ?? null;
}

function comfyWorkflowFor(
  adapter: StudioAssetLibraryEntry,
  entries: readonly StudioAssetLibraryEntry[],
  request: NormalizedStudioAssetResolveRequest,
): StudioAssetLibraryEntry | null {
  if (adapter.assetKind !== "ic_lora_adapter" || !adapter.lora?.comfyWorkflowFingerprint) return null;
  const workflow = entries.find((entry) => entry.fingerprint === adapter.lora?.comfyWorkflowFingerprint);
  if (!workflow || workflow.assetKind !== "comfy_workflow" || !workflow.resource) return null;
  if (entryMatchesRequest(workflow, request)) return null;
  if (workflow.compatibility.runtimeFingerprint !== adapter.lora.runtimeFingerprint) return null;
  return workflow;
}

export function resolveStudioAssetLibrary(input: {
  readonly request: StudioAssetResolveRequest;
  readonly entries: readonly unknown[];
  readonly releaseUsageReceipts?: readonly unknown[];
}): StudioAssetResolution {
  let request: NormalizedStudioAssetResolveRequest;
  try {
    request = StudioAssetResolveRequestSchema.parse(input.request);
  } catch (error) {
    return { status: "blocked", blockers: [error instanceof Error ? error.message : "invalid Studio Asset Library request"] };
  }
  const parsedEntries: StudioAssetLibraryEntry[] = [];
  const blockers: string[] = [];
  for (const value of input.entries) {
    try {
      const entry = assertStudioAssetLibraryEntry(value);
      if (entry.scope === "owned_studio" || entry.channelId === request.channelId) parsedEntries.push(entry);
    } catch (error) {
      blockers.push(error instanceof Error ? error.message : "malformed Studio Asset Library entry");
    }
  }
  if (blockers.length) return { status: "blocked", blockers: stable([...new Set(blockers)]) };

  const selected: StudioAssetLibraryEntry[] = [];
  const missingKinds: z.infer<typeof StudioAssetKindSchema>[] = [];
  for (const kind of request.requiredKinds) {
    const candidates = ranked({
      entries: parsedEntries.filter((entry) => entry.assetKind === kind && !entryMatchesRequest(entry, request)),
      request,
      releaseUsageReceipts: input.releaseUsageReceipts ?? [],
    });
    const candidate = candidates[0];
    if (!candidate) {
      missingKinds.push(kind);
      continue;
    }
    selected.push(candidate);
    if (candidate.assetKind === "standard_lora_stack") {
      const stack = candidate.loraStack;
      if (!stack) {
        return { status: "blocked", blockers: [`${candidate.logicalId} is missing its immutable LoRA stack binding`] };
      }
      const stackCharacterRegistryIdentities: string[] = [];
      for (const adapterFingerprint of stack.adapterEntryFingerprints) {
        const adapter = parsedEntries.find((entry) => entry.fingerprint === adapterFingerprint);
        const mismatch = adapter ? entryMatchesRequest(adapter, request) : "is absent from this Studio inventory";
        if (
          !adapter
          || adapter.assetKind !== "standard_lora_adapter"
          || !adapter.lora
          || mismatch
        ) {
          return {
            status: "blocked",
            blockers: [`${candidate.logicalId} references an unavailable or incompatible standard LoRA ${adapterFingerprint}`],
          };
        }
        if (adapter.lora.characterRegistryIdentity) {
          stackCharacterRegistryIdentities.push(adapter.lora.characterRegistryIdentity);
        }
        selected.push(adapter);
      }
      const actualCharacters = [...stackCharacterRegistryIdentities].sort();
      if (
        actualCharacters.length !== stack.characterRegistryIdentities.length
        || actualCharacters.some((identity, index) => identity !== stack.characterRegistryIdentities[index])
      ) {
        return {
          status: "blocked",
          blockers: [`${candidate.logicalId} character set does not match its exact adapter recipe`],
        };
      }
    }
    if (candidate.assetKind === "ic_lora_adapter") {
      const guide = controlGuideFor(candidate, parsedEntries, request);
      if (!guide) {
        return {
          status: "blocked",
          blockers: [`${candidate.logicalId} requires an exact approved series control guide for this shot`],
        };
      }
      const workflow = comfyWorkflowFor(candidate, parsedEntries, request);
      if (!workflow) {
        return {
          status: "blocked",
          blockers: [`${candidate.logicalId} requires its exact approved Comfy workflow for this runtime`],
        };
      }
      selected.push(guide);
      selected.push(workflow);
    }
  }
  if (missingKinds.length && (request.selectionMode === "all" || selected.length === 0)) {
    return {
      status: "no_approved_match",
      missingKinds: stable([...new Set(missingKinds)]),
      blockers: stable(missingKinds.map((kind) => `no approved compatible ${kind} is available; create or promote one explicitly`)),
    };
  }
  const entries = stable([...new Map(selected.map((entry) => [entry.fingerprint, entry])).values()]);
  const requestFingerprint = fingerprint(request);
  const bundleCore = {
    version: STUDIO_ASSET_BUNDLE_VERSION,
    requestFingerprint,
    entryFingerprints: entries.map((entry) => entry.fingerprint),
  };
  return {
    status: "resolved",
    bundle: stable({
      version: STUDIO_ASSET_BUNDLE_VERSION,
      requestFingerprint,
      entries,
      fingerprint: fingerprint(bundleCore),
    }),
    missingKinds: stable([...new Set(missingKinds)]),
  };
}

export interface StudioAssetRecipeProjection {
  readonly version: "studio-asset-recipe-projection/v1";
  readonly cameraAddenda: readonly string[];
  readonly motionAddenda: readonly string[];
  readonly promptAddenda: readonly string[];
  readonly sourceEntryFingerprints: readonly string[];
  readonly fingerprint: string;
}

export type StudioPostproductionAssetKind =
  | "overlay_template"
  | "motion_graphics_template"
  | "audio_recipe"
  | "transition_template";
export type StudioQuoteOverlayPreset = "editorial_glass" | "ink_card" | "signal_card";
export type StudioDataInsertPreset = "clean_editorial" | "technical_grid" | "soft_paper";
/** The only intro-to-body transition effects proven by the shared assembler. */
export type StudioTransitionPreset = "hardcut" | "crossfade" | "dip_to_black";

/**
 * A consumer-specific, browser-safe recipe handoff. This is deliberately
 * narrower than a Studio asset entry: no storage coordinates, media bytes, or
 * arbitrary rendering instructions may reach an individual pipeline block.
 */
export interface StudioPostproductionRecipeProjection {
  readonly version: "studio-postproduction-recipe-projection/v1";
  readonly assetKind: StudioPostproductionAssetKind;
  readonly promptAddenda: readonly string[];
  readonly quoteOverlayPreset: StudioQuoteOverlayPreset | null;
  readonly dataInsertPreset: StudioDataInsertPreset | null;
  readonly transitionPreset: StudioTransitionPreset | null;
  readonly sourceEntryFingerprints: readonly string[];
  readonly fingerprint: string;
}

/**
 * A compact Studio approval proof for the one direct LTX standard-LoRA path
 * the current worker can execute. It deliberately excludes resource paths:
 * the renderer resolves the candidate again from its sealed worker manifest.
 */
export interface StudioLtxCreativeAdapterSelection {
  readonly version: "studio-ltx-creative-adapter-selection/v3";
  readonly selection: LtxCreativeAdapterInput;
  /** Includes the immutable stack recipe followed by its exact adapter entries. */
  readonly sourceEntryFingerprints: readonly string[];
  readonly sourceBundleFingerprint: string;
  readonly runtimeFingerprint: string;
  /** Exact series-character set influenced by this benchmarked selection. */
  readonly targetCharacterRegistryIdentities: readonly string[];
  readonly fingerprint: string;
}

const StudioLtxCreativeAdapterSelectionV3Schema = z.object({
  version: z.literal("studio-ltx-creative-adapter-selection/v3"),
  selection: LtxCreativeAdapterInputSchema,
  sourceEntryFingerprints: z.array(sha256).min(1).max(4),
  sourceBundleFingerprint: sha256,
  runtimeFingerprint: sha256,
  targetCharacterRegistryIdentities: CharacterRegistryIdentitiesSchema,
  fingerprint: sha256,
}).strict();

const StudioLtxCreativeAdapterSelectionV2Schema = z.object({
  version: z.literal("studio-ltx-creative-adapter-selection/v2"),
  selection: LtxCreativeAdapterInputSchema,
  sourceEntryFingerprints: z.array(sha256).min(1).max(4),
  sourceBundleFingerprint: sha256,
  runtimeFingerprint: sha256,
  fingerprint: sha256,
}).strict();

const StudioLtxCreativeAdapterSelectionV1Schema = z.object({
  version: z.literal("studio-ltx-creative-adapter-selection/v1"),
  selection: LtxCreativeAdapterSelectionSchema,
  sourceEntryFingerprint: sha256,
  sourceBundleFingerprint: sha256,
  runtimeFingerprint: sha256,
  fingerprint: sha256,
}).strict();

function directStandardLtxSelection(entry: StudioAssetLibraryEntry): z.infer<typeof LtxCreativeAdapterSelectionSchema> {
  const lora = entry.lora;
  if (
    !lora
    || entry.assetKind !== "standard_lora_adapter"
    || lora.adapterClass !== "standard_lora"
    || lora.controlKinds.length
    || !lora.renderStrength
    || lora.runtimeFingerprint !== DIRECT_LTX_CREATIVE_ADAPTER_RUNTIME_FINGERPRINT
    || entry.compatibility.runtimeFingerprint !== DIRECT_LTX_CREATIVE_ADAPTER_RUNTIME_FINGERPRINT
  ) {
    throw new Error("studioAssetLibrary: direct LTX adapter is not pinned to the current standard-LoRA runtime contract");
  }
  return LtxCreativeAdapterSelectionSchema.parse({
    id: lora.candidateId,
    strength: lora.renderStrength,
    expectedManifestSha256: lora.adapterSha256,
  });
}

export function studioLtxCreativeAdapterSelection(
  resolution: StudioAssetResolution | undefined,
): StudioLtxCreativeAdapterSelection | undefined {
  if (!resolution || resolution.status === "no_approved_match") return undefined;
  if (resolution.status === "blocked") {
    throw new Error(`studioAssetLibrary: blocked direct LTX adapter resolution: ${resolution.blockers.join("; ")}`);
  }
  const icControls = resolution.bundle.entries.filter((entry) => entry.assetKind === "ic_lora_adapter");
  if (icControls.length > 0) {
    // IC-LoRAs need a guide-aware, separately pinned ComfyUI/LTX worker.  Never
    // silently drop them from a mixed Studio bundle and continue with --lora.
    throw new Error("studioAssetLibrary: IC-LoRA controls require the dedicated ComfyUI/LTX worker; direct LTX --lora is blocked");
  }
  const stacks = resolution.bundle.entries.filter((entry) => entry.assetKind === "standard_lora_stack");
  const candidates = resolution.bundle.entries.filter((entry) => entry.assetKind === "standard_lora_adapter");
  if (stacks.length > 1) {
    throw new Error("studioAssetLibrary: direct LTX adapter resolution cannot choose between multiple approved LoRA stacks");
  }
  let selection: LtxCreativeAdapterInput;
  let sourceEntryFingerprints: readonly string[];
  let targetCharacterRegistryIdentities: readonly string[];
  if (stacks[0]) {
    const stackEntry = stacks[0];
    const stack = stackEntry.loraStack;
    if (!stack || stack.runtimeFingerprint !== DIRECT_LTX_CREATIVE_ADAPTER_RUNTIME_FINGERPRINT) {
      throw new Error("studioAssetLibrary: direct LTX stack is not pinned to the current standard-LoRA runtime contract");
    }
    const adaptersByFingerprint = new Map(candidates.map((entry) => [entry.fingerprint, entry]));
    const adapters = stack.adapterEntryFingerprints.map((entryFingerprint) => {
      const adapter = adaptersByFingerprint.get(entryFingerprint);
      if (!adapter) throw new Error("studioAssetLibrary: direct LTX stack is missing an exact approved adapter entry");
      return directStandardLtxSelection(adapter);
    });
    const calibratedStrengthById = new Map(
      stack.benchmark.calibratedAdapters.map((adapter) => [adapter.id, adapter.strength]),
    );
    if (
      calibratedStrengthById.size !== adapters.length
      || adapters.some((adapter) => calibratedStrengthById.get(adapter.id) !== adapter.strength)
    ) {
      throw new Error("studioAssetLibrary: direct LTX stack entry strengths do not match its exact combined benchmark");
    }
    const actualCharacters = candidates
      .map((entry) => entry.lora?.characterRegistryIdentity)
      .filter((identity): identity is string => Boolean(identity))
      .sort();
    if (
      actualCharacters.length !== stack.characterRegistryIdentities.length
      || actualCharacters.some((identity, index) => identity !== stack.characterRegistryIdentities[index])
    ) {
      throw new Error("studioAssetLibrary: direct LTX stack character set does not match its exact approved adapters");
    }
    selection = LtxCreativeAdapterStackSchema.parse({
      version: LTX_CREATIVE_ADAPTER_STACK_VERSION,
      adapters,
      benchmark: stack.benchmark,
    });
    sourceEntryFingerprints = [stackEntry.fingerprint, ...stack.adapterEntryFingerprints];
    targetCharacterRegistryIdentities = stack.characterRegistryIdentities;
  } else {
    if (candidates.length !== 1) {
      throw new Error("studioAssetLibrary: direct LTX adapter resolution requires exactly one approved standard LoRA or one approved stack");
    }
    const entry = candidates[0]!;
    selection = directStandardLtxSelection(entry);
    sourceEntryFingerprints = [entry.fingerprint];
    targetCharacterRegistryIdentities = entry.lora?.characterRegistryIdentity
      ? [entry.lora.characterRegistryIdentity]
      : [];
  }
  const core = {
    version: "studio-ltx-creative-adapter-selection/v3" as const,
    selection,
    sourceEntryFingerprints,
    sourceBundleFingerprint: resolution.bundle.fingerprint,
    runtimeFingerprint: DIRECT_LTX_CREATIVE_ADAPTER_RUNTIME_FINGERPRINT,
    targetCharacterRegistryIdentities,
  };
  return stable({ ...core, fingerprint: fingerprint(core) });
}

export function studioLtxCreativeAdapterSelectionFromUnknown(
  value: unknown,
): StudioLtxCreativeAdapterSelection | undefined {
  if (value === null || value === undefined) return undefined;
  const current = StudioLtxCreativeAdapterSelectionV3Schema.safeParse(value);
  if (current.success) {
    const { fingerprint: storedFingerprint, ...core } = current.data;
    if (fingerprint(core) !== storedFingerprint) {
      throw new Error("studioAssetLibrary: direct LTX adapter selection fingerprint does not bind its immutable content");
    }
    if (current.data.runtimeFingerprint !== DIRECT_LTX_CREATIVE_ADAPTER_RUNTIME_FINGERPRINT) {
      throw new Error("studioAssetLibrary: direct LTX adapter selection is not pinned to the active runtime");
    }
    return stable(current.data);
  }
  const v2 = StudioLtxCreativeAdapterSelectionV2Schema.safeParse(value);
  if (v2.success) {
    const { fingerprint: storedFingerprint, ...core } = v2.data;
    if (fingerprint(core) !== storedFingerprint) {
      throw new Error("studioAssetLibrary: direct LTX adapter selection fingerprint does not bind its immutable content");
    }
    if (v2.data.runtimeFingerprint !== DIRECT_LTX_CREATIVE_ADAPTER_RUNTIME_FINGERPRINT) {
      throw new Error("studioAssetLibrary: direct LTX adapter selection is not pinned to the active runtime");
    }
    const migratedCore = {
      version: "studio-ltx-creative-adapter-selection/v3" as const,
      selection: v2.data.selection,
      sourceEntryFingerprints: v2.data.sourceEntryFingerprints,
      sourceBundleFingerprint: v2.data.sourceBundleFingerprint,
      runtimeFingerprint: v2.data.runtimeFingerprint,
      targetCharacterRegistryIdentities: [],
    };
    return stable({ ...migratedCore, fingerprint: fingerprint(migratedCore) });
  }
  const parsed = StudioLtxCreativeAdapterSelectionV1Schema.parse(value);
  const { fingerprint: storedFingerprint, ...core } = parsed;
  if (fingerprint(core) !== storedFingerprint) {
    throw new Error("studioAssetLibrary: direct LTX adapter selection fingerprint does not bind its immutable content");
  }
  if (parsed.runtimeFingerprint !== DIRECT_LTX_CREATIVE_ADAPTER_RUNTIME_FINGERPRINT) {
    throw new Error("studioAssetLibrary: direct LTX adapter selection is not pinned to the active runtime");
  }
  const migratedCore = {
    version: "studio-ltx-creative-adapter-selection/v3" as const,
    selection: parsed.selection,
    sourceEntryFingerprints: [parsed.sourceEntryFingerprint],
    sourceBundleFingerprint: parsed.sourceBundleFingerprint,
    runtimeFingerprint: parsed.runtimeFingerprint,
    targetCharacterRegistryIdentities: [],
  };
  return stable({ ...migratedCore, fingerprint: fingerprint(migratedCore) });
}

/**
 * A complete per-shot decision for the standard-LTX worker. This is separate
 * from the raw Story Spine so the renderer receives only the approved adapter
 * selection—not a request to improvise an identity or alter a stack.
 */
export interface StudioLtxShotAdapterSelection {
  readonly shotId: string;
  /** Complete character set the Story Spine says is visible in this shot. */
  readonly continuityCharacterRegistryIdentities: readonly string[];
  /** Null means no exact approved character recipe exists; base/style may still be used. */
  readonly selection: StudioLtxCreativeAdapterSelection | null;
}

export interface StudioLtxShotAdapterSelections {
  readonly version: "studio-ltx-shot-adapter-selections/v1";
  readonly narrativeShotControlFingerprint: string;
  readonly shots: readonly StudioLtxShotAdapterSelection[];
  readonly fingerprint: string;
}

const StudioLtxShotAdapterSelectionSchema = z.object({
  shotId: nonEmptyId,
  continuityCharacterRegistryIdentities: CharacterRegistryIdentitiesSchema,
  // z.unknown() would make this property optional in Zod. A missing decision
  // must fail: every rendered shot needs an explicit selected recipe or null.
  selection: z.union([z.null(), z.record(z.unknown())]),
}).strict();

const StudioLtxShotAdapterSelectionsBaseSchema = z.object({
  version: z.literal("studio-ltx-shot-adapter-selections/v1"),
  narrativeShotControlFingerprint: sha256,
  shots: z.array(StudioLtxShotAdapterSelectionSchema).min(1).max(500),
}).strict();

function assertUniqueShotAdapterSelections(
  value: { readonly shots: readonly { readonly shotId: string }[] },
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  for (const shot of value.shots) {
    if (seen.has(shot.shotId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["shots"], message: "shot adapter selections cannot repeat a shot" });
      return;
    }
    seen.add(shot.shotId);
  }
}

const StudioLtxShotAdapterSelectionsContentSchema = StudioLtxShotAdapterSelectionsBaseSchema
  .superRefine(assertUniqueShotAdapterSelections);

const StudioLtxShotAdapterSelectionsSchema = StudioLtxShotAdapterSelectionsBaseSchema.extend({
  fingerprint: sha256,
}).strict().superRefine(assertUniqueShotAdapterSelections);

function normalizeShotAdapterSelections(
  content: z.infer<typeof StudioLtxShotAdapterSelectionsContentSchema>,
): StudioLtxShotAdapterSelections {
  const shots = content.shots.map((shot) => {
    const selection = studioLtxCreativeAdapterSelectionFromUnknown(shot.selection);
    if (
      selection
      && selection.targetCharacterRegistryIdentities.length > 0
      && (
        selection.targetCharacterRegistryIdentities.length !== shot.continuityCharacterRegistryIdentities.length
        || selection.targetCharacterRegistryIdentities.some(
          (identity, index) => identity !== shot.continuityCharacterRegistryIdentities[index],
        )
      )
    ) {
      throw new Error("studioAssetLibrary: a character LoRA selection must match the complete visible cast of its shot");
    }
    return stable({
      shotId: shot.shotId,
      continuityCharacterRegistryIdentities: stable([...shot.continuityCharacterRegistryIdentities]),
      selection: selection ?? null,
    });
  });
  const core = {
    version: content.version,
    narrativeShotControlFingerprint: content.narrativeShotControlFingerprint,
    shots,
  } as const;
  return stable({ ...core, fingerprint: fingerprint(core) });
}

export function createStudioLtxShotAdapterSelections(input: {
  readonly narrativeShotControlFingerprint: string;
  readonly shots: readonly StudioLtxShotAdapterSelection[];
}): StudioLtxShotAdapterSelections {
  return normalizeShotAdapterSelections(StudioLtxShotAdapterSelectionsContentSchema.parse({
    version: "studio-ltx-shot-adapter-selections/v1",
    narrativeShotControlFingerprint: input.narrativeShotControlFingerprint,
    shots: input.shots,
  }));
}

export function studioLtxShotAdapterSelectionsFromUnknown(
  value: unknown,
): StudioLtxShotAdapterSelections | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = StudioLtxShotAdapterSelectionsSchema.parse(value);
  const { fingerprint: storedFingerprint, ...content } = parsed;
  const normalized = normalizeShotAdapterSelections(content);
  if (normalized.fingerprint !== storedFingerprint) {
    throw new Error("studioAssetLibrary: per-shot LTX adapter selections do not bind immutable content");
  }
  return normalized;
}

/**
 * Certificate-safe proof that the direct LTX master was rendered with the
 * exact approved Studio adapter decisions. It binds selections to the
 * persisted shot manifest, but intentionally carries neither model paths nor
 * adapter bytes. This is provenance, not a claim that an adapter caused every
 * observed quality outcome.
 */
export const STUDIO_LTX_RELEASE_ADAPTER_BINDING_VERSION =
  "studio-ltx-release-adapter-binding/v1" as const;

const StudioLtxReleaseAdapterBindingSchema = z.object({
  version: z.literal(STUDIO_LTX_RELEASE_ADAPTER_BINDING_VERSION),
  shotRenderManifestFingerprint: sha256,
  globalSelectionFingerprint: sha256.optional(),
  perShotSelectionsFingerprint: sha256.optional(),
  sourceEntryFingerprints: z.array(sha256).min(1).max(12),
  fingerprint: sha256,
}).strict().superRefine((value, ctx) => {
  if (!value.globalSelectionFingerprint && !value.perShotSelectionsFingerprint) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Studio LTX release binding needs a global or per-shot selection" });
  }
  if (new Set(value.sourceEntryFingerprints).size !== value.sourceEntryFingerprints.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Studio LTX release binding cannot repeat source entries" });
  }
  if (value.sourceEntryFingerprints.some((entry, index) => index > 0 && entry < value.sourceEntryFingerprints[index - 1]!)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Studio LTX release binding source entries must use canonical sort order" });
  }
});

export type StudioLtxReleaseAdapterBinding = z.infer<typeof StudioLtxReleaseAdapterBindingSchema>;

export function assertStudioLtxReleaseAdapterBinding(value: unknown): StudioLtxReleaseAdapterBinding {
  const parsed = StudioLtxReleaseAdapterBindingSchema.parse(value);
  const { fingerprint: storedFingerprint, ...core } = parsed;
  if (fingerprint(core) !== storedFingerprint) {
    throw new Error("studioAssetLibrary: LTX release adapter binding fingerprint does not bind its immutable content");
  }
  return stable(parsed);
}

export function createStudioLtxReleaseAdapterBinding(input: {
  readonly shotRenderManifest: unknown;
  readonly globalSelection?: unknown;
  readonly perShotSelections?: unknown;
}): StudioLtxReleaseAdapterBinding | undefined {
  const global = studioLtxCreativeAdapterSelectionFromUnknown(input.globalSelection);
  const perShot = studioLtxShotAdapterSelectionsFromUnknown(input.perShotSelections);
  if (!global && !perShot) return undefined;

  const manifest = ShotRenderManifestSchema.parse(input.shotRenderManifest);
  const expectedByShot = new Map(perShot?.shots.map((entry) => [entry.shotId, entry]) ?? []);
  if (perShot && (expectedByShot.size !== manifest.items.length || manifest.items.some((item) => !expectedByShot.has(item.shotId)))) {
    throw new Error("studioAssetLibrary: per-shot LTX selection does not cover the persisted render manifest");
  }
  for (const item of manifest.items) {
    const scoped = expectedByShot.get(item.shotId)?.selection;
    const expected = scoped?.selection ?? global?.selection;
    if (expected && canonicalJson(item.creativeAdapter) !== canonicalJson(expected)) {
      throw new Error(`studioAssetLibrary: persisted LTX adapter does not match the approved Studio selection for ${item.shotId}`);
    }
  }

  const sourceEntryFingerprints = [...new Set([
    ...(global?.sourceEntryFingerprints ?? []),
    ...(perShot?.shots.flatMap((entry) => entry.selection?.sourceEntryFingerprints ?? []) ?? []),
  ])].sort();
  if (!sourceEntryFingerprints.length) {
    throw new Error("studioAssetLibrary: LTX release adapter binding has no approved Studio source entries");
  }
  const core = {
    version: STUDIO_LTX_RELEASE_ADAPTER_BINDING_VERSION,
    shotRenderManifestFingerprint: fingerprint(manifest),
    ...(global ? { globalSelectionFingerprint: global.fingerprint } : {}),
    ...(perShot ? { perShotSelectionsFingerprint: perShot.fingerprint } : {}),
    sourceEntryFingerprints,
  };
  return assertStudioLtxReleaseAdapterBinding({ ...core, fingerprint: fingerprint(core) });
}

/**
 * A compact final-master observation for assets actually reused by a pipeline.
 * It is deliberately correlation-only: a passing release proves the asset was
 * present under this exact lane/module and review, never that the asset alone
 * caused the quality result. Aggregation may use it to prefer repeatedly
 * demonstrated recipes without replacing approval or benchmark requirements.
 */
export const STUDIO_ASSET_RELEASE_USAGE_VERSION =
  "studio-asset-release-usage/v1" as const;

const StudioAssetReleaseUsageQualitySchema = z.object({
  hardGateReady: z.literal(true),
  calibrationComplete: z.literal(true),
  visualStatus: z.enum(["pass", "advisory", "not_measured"]),
  visualScore: z.number().finite().min(0).max(10).optional(),
  visualMinimumScore: z.number().finite().min(0).max(10).optional(),
}).strict();

const StudioAssetReleaseUsageItemSchema = z.object({
  assetEntryFingerprint: sha256,
  moduleId: nonEmptyId,
  projectionFingerprint: sha256,
}).strict();

const StudioAssetReleaseUsageReceiptCoreSchema = z.object({
  version: z.literal(STUDIO_ASSET_RELEASE_USAGE_VERSION),
  finalMaster: z.object({
    sha256,
    durationSec: z.number().finite().positive(),
  }).strict(),
  family: nonEmptyId,
  contentLane: nonEmptyId,
  treatment: nonEmptyId.optional(),
  visualReview: z.object({
    reviewFingerprint: z.string().trim().min(1).max(256),
    reviewReceiptFingerprint: sha256,
  }).strict(),
  qualityEvidence: z.object({
    bindingFingerprint: sha256,
    qualityEvidenceFingerprint: sha256,
  }).strict(),
  quality: StudioAssetReleaseUsageQualitySchema,
  uses: z.array(StudioAssetReleaseUsageItemSchema).min(1).max(48),
}).strict();

export const StudioAssetReleaseUsageReceiptSchema = StudioAssetReleaseUsageReceiptCoreSchema.extend({
  receiptFingerprint: sha256,
}).strict().superRefine((value, ctx) => {
  const seen = new Set<string>();
  for (const item of value.uses) {
    const key = `${item.assetEntryFingerprint}:${item.moduleId}`;
    if (seen.has(key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Studio asset release usage cannot repeat an asset/module pair" });
      break;
    }
    seen.add(key);
  }
});

export type StudioAssetReleaseUsageReceipt = z.infer<typeof StudioAssetReleaseUsageReceiptSchema>;

export function assertStudioAssetReleaseUsageReceipt(value: unknown): StudioAssetReleaseUsageReceipt {
  const parsed = StudioAssetReleaseUsageReceiptSchema.parse(value);
  const { receiptFingerprint: storedFingerprint, ...core } = parsed;
  if (fingerprint(core) !== storedFingerprint) {
    throw new Error("studioAssetLibrary: release usage receipt fingerprint does not bind its immutable content");
  }
  return stable(parsed);
}

export function createStudioAssetReleaseUsageReceipt(input: {
  readonly finalMaster: { readonly sha256: string; readonly durationSec: number };
  readonly family: string;
  readonly contentLane: string;
  readonly treatment?: string;
  readonly visualReview: { readonly reviewFingerprint: string; readonly reviewReceiptFingerprint: string };
  readonly qualityEvidence: {
    readonly bindingFingerprint: string;
    readonly qualityEvidenceFingerprint: string;
    readonly hardGateReady: boolean;
    readonly calibrationComplete: boolean;
    readonly visualStatus: "pass" | "advisory" | "not_measured";
    readonly visualScore?: number;
    readonly visualMinimumScore?: number;
  };
  readonly uses: readonly {
    readonly assetEntryFingerprint: string;
    readonly moduleId: string;
    readonly projectionFingerprint: string;
  }[];
}): StudioAssetReleaseUsageReceipt {
  if (!input.qualityEvidence.hardGateReady || !input.qualityEvidence.calibrationComplete) {
    throw new Error("studioAssetLibrary: release usage can only be recorded for a calibrated hard-gate-passing final master");
  }
  const uses = [...new Map(input.uses.map((item) => [
    `${item.assetEntryFingerprint}:${item.moduleId}`,
    item,
  ])).values()].sort((left, right) =>
    left.assetEntryFingerprint.localeCompare(right.assetEntryFingerprint)
    || left.moduleId.localeCompare(right.moduleId),
  );
  const core = StudioAssetReleaseUsageReceiptCoreSchema.parse({
    version: STUDIO_ASSET_RELEASE_USAGE_VERSION,
    finalMaster: input.finalMaster,
    family: input.family,
    contentLane: input.contentLane,
    ...(input.treatment ? { treatment: input.treatment } : {}),
    visualReview: input.visualReview,
    qualityEvidence: {
      bindingFingerprint: input.qualityEvidence.bindingFingerprint,
      qualityEvidenceFingerprint: input.qualityEvidence.qualityEvidenceFingerprint,
    },
    quality: {
      hardGateReady: true,
      calibrationComplete: true,
      visualStatus: input.qualityEvidence.visualStatus,
      ...(input.qualityEvidence.visualScore === undefined ? {} : { visualScore: input.qualityEvidence.visualScore }),
      ...(input.qualityEvidence.visualMinimumScore === undefined
        ? {}
        : { visualMinimumScore: input.qualityEvidence.visualMinimumScore }),
    },
    uses,
  });
  return assertStudioAssetReleaseUsageReceipt({ ...core, receiptFingerprint: fingerprint(core) });
}

const EMPTY_STUDIO_ASSET_RECIPE_PROJECTION: StudioAssetRecipeProjection = stable({
  version: "studio-asset-recipe-projection/v1",
  cameraAddenda: stable([]),
  motionAddenda: stable([]),
  promptAddenda: stable([]),
  sourceEntryFingerprints: stable([]),
  fingerprint: fingerprint({ version: "studio-asset-recipe-projection/v1", entries: [] }),
});

function emptyStudioPostproductionRecipeProjection(
  assetKind: StudioPostproductionAssetKind,
): StudioPostproductionRecipeProjection {
  const core = {
    version: "studio-postproduction-recipe-projection/v1" as const,
    assetKind,
    promptAddenda: [] as string[],
    quoteOverlayPreset: null,
    dataInsertPreset: null,
    transitionPreset: null,
    sourceEntryFingerprints: [] as string[],
  };
  return stable({ ...core, fingerprint: fingerprint(core) });
}

function quoteOverlayPreset(value: unknown): StudioQuoteOverlayPreset | null {
  return value === "editorial_glass" || value === "ink_card" || value === "signal_card" ? value : null;
}

function dataInsertPreset(value: unknown): StudioDataInsertPreset | null {
  return value === "clean_editorial" || value === "technical_grid" || value === "soft_paper" ? value : null;
}

function transitionPreset(value: unknown): StudioTransitionPreset | null {
  return value === "hardcut" || value === "crossfade" || value === "dip_to_black" ? value : null;
}

/**
 * Resolve one approved template for one explicit consumer. Presentation
 * templates can guide visual treatment, but cannot change a source claim,
 * content lane, timing, master-layout safety rule, or editing decision.
 */
export function studioPostproductionRecipeProjection(
  resolution: StudioAssetResolution | undefined,
  assetKind: StudioPostproductionAssetKind,
): StudioPostproductionRecipeProjection {
  if (!resolution || resolution.status !== "resolved") return emptyStudioPostproductionRecipeProjection(assetKind);
  const entries = resolution.bundle.entries.filter((entry) => entry.assetKind === assetKind);
  if (entries.length !== 1) return emptyStudioPostproductionRecipeProjection(assetKind);
  const entry = entries[0]!;
  const controlValues = entry.recipe?.controlValues ?? {};
  const core = {
    version: "studio-postproduction-recipe-projection/v1" as const,
    assetKind,
    promptAddenda: [...new Set(entry.recipe?.promptFragments ?? [])].slice(0, 6),
    quoteOverlayPreset: assetKind === "overlay_template" ? quoteOverlayPreset(controlValues["quoteOverlayPreset"]) : null,
    dataInsertPreset: assetKind === "motion_graphics_template" ? dataInsertPreset(controlValues["dataInsertPreset"]) : null,
    transitionPreset: assetKind === "transition_template" ? transitionPreset(controlValues["transitionPreset"]) : null,
    sourceEntryFingerprints: [entry.fingerprint],
  };
  return stable({ ...core, fingerprint: fingerprint(core) });
}

export function studioPostproductionRecipeProjectionFromUnknown(
  value: unknown,
  expectedAssetKind: StudioPostproductionAssetKind,
): StudioPostproductionRecipeProjection {
  if (!value || typeof value !== "object") return emptyStudioPostproductionRecipeProjection(expectedAssetKind);
  const candidate = value as Partial<StudioPostproductionRecipeProjection>;
  if (
    candidate.version !== "studio-postproduction-recipe-projection/v1" ||
    candidate.assetKind !== expectedAssetKind ||
    !Array.isArray(candidate.promptAddenda) ||
    !Array.isArray(candidate.sourceEntryFingerprints) ||
    typeof candidate.fingerprint !== "string"
  ) return emptyStudioPostproductionRecipeProjection(expectedAssetKind);
  const core = {
    version: candidate.version,
    assetKind: candidate.assetKind,
    promptAddenda: candidate.promptAddenda.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 6),
    quoteOverlayPreset: quoteOverlayPreset(candidate.quoteOverlayPreset),
    dataInsertPreset: dataInsertPreset(candidate.dataInsertPreset),
    transitionPreset: transitionPreset(candidate.transitionPreset),
    sourceEntryFingerprints: candidate.sourceEntryFingerprints.filter((item): item is string => SHA256.test(item)).sort(),
  };
  if (fingerprint(core) !== candidate.fingerprint) return emptyStudioPostproductionRecipeProjection(expectedAssetKind);
  return stable({ ...core, fingerprint: candidate.fingerprint });
}

/**
 * Only recipe text is passed into a planning module. Byte-bound media, LoRA
 * paths, and control guides never leak through this projection.
 */
export function studioAssetRecipeProjection(
  resolution: StudioAssetResolution | undefined,
): StudioAssetRecipeProjection {
  if (!resolution || resolution.status !== "resolved") return EMPTY_STUDIO_ASSET_RECIPE_PROJECTION;
  const cameraAddenda: string[] = [];
  const motionAddenda: string[] = [];
  const promptAddenda: string[] = [];
  for (const entry of resolution.bundle.entries) {
    const fragments = entry.recipe?.promptFragments ?? [];
    if (entry.assetKind === "camera_recipe") cameraAddenda.push(...fragments);
    if (entry.assetKind === "motion_recipe") motionAddenda.push(...fragments);
    if (entry.assetKind === "prompt_recipe" || entry.assetKind === "visual_treatment_recipe") promptAddenda.push(...fragments);
  }
  const core = {
    version: "studio-asset-recipe-projection/v1" as const,
    cameraAddenda: [...new Set(cameraAddenda)].slice(0, 8),
    motionAddenda: [...new Set(motionAddenda)].slice(0, 8),
    promptAddenda: [...new Set(promptAddenda)].slice(0, 8),
    sourceEntryFingerprints: resolution.bundle.entries.map((entry) => entry.fingerprint).sort(),
  };
  return stable({ ...core, fingerprint: fingerprint(core) });
}

export function studioAssetRecipeProjectionFromUnknown(value: unknown): StudioAssetRecipeProjection {
  if (!value || typeof value !== "object") return EMPTY_STUDIO_ASSET_RECIPE_PROJECTION;
  const candidate = value as Partial<StudioAssetRecipeProjection>;
  if (
    candidate.version !== "studio-asset-recipe-projection/v1" ||
    !Array.isArray(candidate.cameraAddenda) ||
    !Array.isArray(candidate.motionAddenda) ||
    !Array.isArray(candidate.promptAddenda) ||
    !Array.isArray(candidate.sourceEntryFingerprints) ||
    typeof candidate.fingerprint !== "string"
  ) return EMPTY_STUDIO_ASSET_RECIPE_PROJECTION;
  const core = {
    version: candidate.version,
    cameraAddenda: candidate.cameraAddenda.filter((value): value is string => typeof value === "string").slice(0, 8),
    motionAddenda: candidate.motionAddenda.filter((value): value is string => typeof value === "string").slice(0, 8),
    promptAddenda: candidate.promptAddenda.filter((value): value is string => typeof value === "string").slice(0, 8),
    sourceEntryFingerprints: candidate.sourceEntryFingerprints.filter((value): value is string => SHA256.test(value)).sort(),
  };
  if (fingerprint(core) !== candidate.fingerprint) return EMPTY_STUDIO_ASSET_RECIPE_PROJECTION;
  return stable({ ...core, fingerprint: candidate.fingerprint });
}
