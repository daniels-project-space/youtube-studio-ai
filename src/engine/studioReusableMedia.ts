import { z } from "zod";

import type { FamilyKey } from "@/engine/families";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

/**
 * Durable episode media is intentionally separate from the Studio Asset
 * Library. The latter stores creative instructions, workflows, and adapters;
 * this contract owns actual media bytes and therefore has stricter channel,
 * provenance, cadence, and timeline-share boundaries.
 */
export const STUDIO_REUSABLE_MEDIA_VERSION = "studio-reusable-media/v1" as const;
export const STUDIO_REUSABLE_MEDIA_POLICY_VERSION = "studio-reusable-media-policy/v1" as const;
export const STUDIO_REUSABLE_MEDIA_PLAN_VERSION = "studio-reusable-media-plan/v1" as const;
export const STUDIO_REUSABLE_MEDIA_USAGE_VERSION = "studio-reusable-media-usage/v1" as const;

export const STUDIO_REUSABLE_MEDIA_MAX_TIMELINE_FRACTION = 0.4 as const;
export const STUDIO_REUSABLE_MEDIA_ORIGINAL_EPISODE_CADENCE = 3 as const;

const SHA256 = /^[a-f0-9]{64}$/i;
const SAFE_ID = /^[a-z][a-z0-9_-]{1,127}$/;
const sha256 = z.string().trim().regex(SHA256, "must be a SHA-256 digest");
const safeId = z.string().trim().regex(SAFE_ID, "must be a safe identifier");
const objectKey = z.string().trim().min(1).max(2_000);

export const StudioReusableMediaKindSchema = z.enum([
  "b_roll_video",
  "ambient_video",
  "generated_visual_clip",
  "visual_still",
  "overlay_video",
]);

export const StudioReusableMediaStatusSchema = z.enum(["approved", "deprecated", "revoked"]);
export const StudioReusableMediaPolicyModeSchema = z.enum(["forbidden", "timeline", "reference_only"]);

const FamilyKeySchema = z.enum([
  "narrated_stock",
  "cinematic",
  "music_loop",
  "sleep",
  "shorts",
  "documentary_collage_short",
  "whiteboard",
  "comic",
  "loreshort",
  "quizyear",
  "illustrated_explainer",
  "children_learning",
]);

const ApprovedStockSourceSchema = z.object({
  provider: z.enum(["pexels", "pixabay"]),
  assetId: z.string().trim().min(1).max(512),
  assetUrl: z.string().url().max(2_000),
  license: z.object({
    provider: z.enum(["pexels", "pixabay"]),
    termsUrl: z.string().url().max(2_000),
    termsSnapshot: z.string().trim().min(1).max(20_000),
    termsSnapshotSha256: sha256,
    reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    attribution: z.object({
      licenseStatus: z.literal("not_required"),
      apiGuidanceStatus: z.enum(["recommended", "not_separately_reviewed"]),
      apiGuidanceUrl: z.string().url().max(2_000),
      applicationStatus: z.literal("not_automatically_applied"),
      caveat: z.string().trim().min(1).max(2_000),
    }).strict(),
  }).strict(),
}).strict();

export const StudioReusableMediaSourceSchema = z.discriminatedUnion("origin", [
  z.object({
    origin: z.literal("third_party_stock"),
    source: ApprovedStockSourceSchema,
    acquiredAt: z.number().int().positive(),
    relevanceScore: z.number().min(0).max(10),
  }).strict(),
  z.object({
    origin: z.literal("studio_generated"),
    sourceLabel: z.string().trim().min(1).max(128),
    providerReceiptFingerprint: sha256.optional(),
  }).strict(),
]);

export const StudioReusableMediaCaptureCandidateSchema = z.object({
  sourceKey: objectKey,
  contentSha256: sha256,
  byteLength: z.number().int().positive().max(5_000_000_000),
  contentType: z.literal("video/mp4"),
  durationSec: z.number().positive().max(3_600),
  title: z.string().trim().min(1).max(160),
  editorialTags: z.array(safeId).min(1).max(32),
  evergreen: z.boolean(),
  sourceEvidenceOrdinal: z.number().int().nonnegative().max(159),
  relevanceScore: z.number().min(0).max(10),
}).strict();
export type StudioReusableMediaCaptureCandidate = z.infer<typeof StudioReusableMediaCaptureCandidateSchema>;

const StudioReusableMediaResourceSchema = z.object({
  r2Key: objectKey,
  contentSha256: sha256,
  contentType: z.string().trim().min(3).max(120),
  byteLength: z.number().int().positive().max(5_000_000_000),
  durationSec: z.number().positive().max(3_600).optional(),
  width: z.number().int().positive().max(16_384).optional(),
  height: z.number().int().positive().max(16_384).optional(),
}).strict();

const StudioReusableMediaOriginSchema = z.object({
  sourceRunId: z.string().trim().min(1).max(160),
  finalMasterSha256: sha256,
  finalMasterReleaseCertificateFingerprint: sha256,
  visualReviewReceiptFingerprint: sha256,
  qualityEvidenceFingerprint: sha256,
}).strict();

const StudioReusableMediaQualitySchema = z.object({
  hardGateReady: z.literal(true),
  calibrationComplete: z.literal(true),
  finalMasterVisualScore: z.number().min(0).max(10),
  finalMasterVisualMinimumScore: z.number().min(0).max(10),
}).strict();

export const StudioReusableMediaEntryCoreSchema = z.object({
  version: z.literal(STUDIO_REUSABLE_MEDIA_VERSION),
  logicalId: safeId,
  ownerId: z.string().trim().min(1).max(160),
  channelId: z.string().trim().min(1).max(160),
  family: FamilyKeySchema,
  nicheKey: safeId.optional(),
  subcategory: safeId.optional(),
  kind: StudioReusableMediaKindSchema,
  status: StudioReusableMediaStatusSchema,
  title: z.string().trim().min(1).max(160),
  editorialTags: z.array(safeId).min(1).max(32),
  evergreen: z.boolean(),
  resource: StudioReusableMediaResourceSchema,
  source: StudioReusableMediaSourceSchema,
  origin: StudioReusableMediaOriginSchema,
  quality: StudioReusableMediaQualitySchema,
  maximumLifetimeUses: z.number().int().min(1).max(24).default(6),
  cooldownEpisodes: z.number().int().min(1).max(12).default(2),
  supersedesFingerprint: sha256.optional(),
}).strict();

export const StudioReusableMediaEntrySchema = StudioReusableMediaEntryCoreSchema.extend({
  fingerprint: sha256,
}).strict();

export type StudioReusableMediaEntryCore = z.infer<typeof StudioReusableMediaEntryCoreSchema>;
export type StudioReusableMediaEntry = z.infer<typeof StudioReusableMediaEntrySchema>;

export const StudioReusableMediaPolicyCoreSchema = z.object({
  version: z.literal(STUDIO_REUSABLE_MEDIA_POLICY_VERSION),
  family: FamilyKeySchema,
  nicheKey: safeId.optional(),
  subcategory: safeId.optional(),
  mode: StudioReusableMediaPolicyModeSchema,
  permittedKinds: z.array(StudioReusableMediaKindSchema).max(5),
  maximumTimelineFraction: z.union([z.literal(0), z.literal(STUDIO_REUSABLE_MEDIA_MAX_TIMELINE_FRACTION)]),
  originalEveryNthEpisode: z.literal(STUDIO_REUSABLE_MEDIA_ORIGINAL_EPISODE_CADENCE),
  reasonCode: z.enum([
    "channel_timeline_reuse",
    "reference_assets_only",
    "sensitive_or_source_specific",
    "family_requires_original_visuals",
    "unclassified_defaults_original",
  ]),
}).strict();

export const StudioReusableMediaPolicySchema = StudioReusableMediaPolicyCoreSchema.extend({
  fingerprint: sha256,
}).strict();
export type StudioReusableMediaPolicy = z.infer<typeof StudioReusableMediaPolicySchema>;

function fingerprint(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort() as T[];
}

function originalPolicy(input: {
  family: FamilyKey;
  nicheKey?: string;
  subcategory?: string;
  reasonCode: "sensitive_or_source_specific" | "family_requires_original_visuals" | "unclassified_defaults_original";
}): StudioReusableMediaPolicy {
  const core = StudioReusableMediaPolicyCoreSchema.parse({
    version: STUDIO_REUSABLE_MEDIA_POLICY_VERSION,
    family: input.family,
    ...(input.nicheKey ? { nicheKey: input.nicheKey } : {}),
    ...(input.subcategory ? { subcategory: input.subcategory } : {}),
    mode: "forbidden",
    permittedKinds: [],
    maximumTimelineFraction: 0,
    originalEveryNthEpisode: STUDIO_REUSABLE_MEDIA_ORIGINAL_EPISODE_CADENCE,
    reasonCode: input.reasonCode,
  });
  return Object.freeze({ ...core, fingerprint: fingerprint(core) });
}

/**
 * Reuse is opt-in by an exact format identity. Unknown and source-sensitive
 * programs stay fully original. This deliberately avoids a keyword classifier
 * that could mistake a history, crime, heist, or lore program for a generic
 * essay merely because both happen to use the narrated-stock family.
 */
export function studioReusableMediaPolicy(input: {
  family: FamilyKey;
  nicheKey?: string;
  subcategory?: string;
}): StudioReusableMediaPolicy {
  const nicheKey = input.nicheKey?.trim();
  const subcategory = input.subcategory?.trim();
  if (nicheKey === "crime" || nicheKey === "history" || input.family === "loreshort") {
    return originalPolicy({ ...input, nicheKey, subcategory, reasonCode: "sensitive_or_source_specific" });
  }
  if (input.family === "sleep") {
    const core = StudioReusableMediaPolicyCoreSchema.parse({
      version: STUDIO_REUSABLE_MEDIA_POLICY_VERSION,
      family: input.family,
      ...(nicheKey ? { nicheKey } : {}),
      ...(subcategory ? { subcategory } : {}),
      mode: "timeline",
      permittedKinds: ["ambient_video", "b_roll_video", "generated_visual_clip"],
      maximumTimelineFraction: STUDIO_REUSABLE_MEDIA_MAX_TIMELINE_FRACTION,
      originalEveryNthEpisode: STUDIO_REUSABLE_MEDIA_ORIGINAL_EPISODE_CADENCE,
      reasonCode: "channel_timeline_reuse",
    });
    return Object.freeze({ ...core, fingerprint: fingerprint(core) });
  }
  if (input.family === "music_loop" && nicheKey === "lofi") {
    const core = StudioReusableMediaPolicyCoreSchema.parse({
      version: STUDIO_REUSABLE_MEDIA_POLICY_VERSION,
      family: input.family,
      nicheKey,
      ...(subcategory ? { subcategory } : {}),
      mode: "reference_only",
      permittedKinds: ["visual_still"],
      maximumTimelineFraction: 0,
      originalEveryNthEpisode: STUDIO_REUSABLE_MEDIA_ORIGINAL_EPISODE_CADENCE,
      reasonCode: "reference_assets_only",
    });
    return Object.freeze({ ...core, fingerprint: fingerprint(core) });
  }
  const narratedTimelineAllowed = input.family === "narrated_stock" && (
    (nicheKey === "psychology" && ["stoicism", "nihilism", "philosophy"].includes(subcategory ?? ""))
    || (nicheKey === "lifestyle" && ["wellness-habits", "gratitude-series"].includes(subcategory ?? ""))
  );
  if (narratedTimelineAllowed) {
    const core = StudioReusableMediaPolicyCoreSchema.parse({
      version: STUDIO_REUSABLE_MEDIA_POLICY_VERSION,
      family: input.family,
      nicheKey,
      subcategory,
      mode: "timeline",
      permittedKinds: ["b_roll_video", "ambient_video", "generated_visual_clip"],
      maximumTimelineFraction: STUDIO_REUSABLE_MEDIA_MAX_TIMELINE_FRACTION,
      originalEveryNthEpisode: STUDIO_REUSABLE_MEDIA_ORIGINAL_EPISODE_CADENCE,
      reasonCode: "channel_timeline_reuse",
    });
    return Object.freeze({ ...core, fingerprint: fingerprint(core) });
  }
  const knownOriginalFamily = input.family !== "narrated_stock";
  return originalPolicy({
    ...input,
    nicheKey,
    subcategory,
    reasonCode: knownOriginalFamily ? "family_requires_original_visuals" : "unclassified_defaults_original",
  });
}

export function createStudioReusableMediaEntry(input: StudioReusableMediaEntryCore): StudioReusableMediaEntry {
  const core = StudioReusableMediaEntryCoreSchema.parse({
    ...input,
    editorialTags: uniqueSorted(input.editorialTags),
  });
  if (!core.resource.contentType.startsWith("video/") && core.kind !== "visual_still") {
    throw new Error("studioReusableMedia: timeline and overlay entries must be video resources");
  }
  if (core.kind === "visual_still" && !core.resource.contentType.startsWith("image/")) {
    throw new Error("studioReusableMedia: a visual still must be an image resource");
  }
  if (core.kind !== "visual_still" && core.resource.durationSec === undefined) {
    throw new Error("studioReusableMedia: reusable video media needs an exact measured duration");
  }
  if (core.quality.finalMasterVisualScore < core.quality.finalMasterVisualMinimumScore) {
    throw new Error("studioReusableMedia: a failed final master cannot approve reusable media");
  }
  if (core.source.origin === "third_party_stock" && core.source.source.provider !== core.source.source.license.provider) {
    throw new Error("studioReusableMedia: stock source and reviewed license provider must agree");
  }
  return Object.freeze({ ...core, fingerprint: fingerprint(core) });
}

export function assertStudioReusableMediaEntry(value: unknown): StudioReusableMediaEntry {
  const parsed = StudioReusableMediaEntrySchema.parse(value);
  const { fingerprint: _fingerprint, ...core } = parsed;
  void _fingerprint;
  const recreated = createStudioReusableMediaEntry(StudioReusableMediaEntryCoreSchema.parse(core));
  if (recreated.fingerprint !== parsed.fingerprint) {
    throw new Error("studioReusableMedia: entry fingerprint does not bind its immutable content");
  }
  return Object.freeze(parsed);
}

export const StudioReusableMediaSelectionRequestSchema = z.object({
  ownerId: z.string().trim().min(1).max(160),
  channelId: z.string().trim().min(1).max(160),
  runId: z.string().trim().min(1).max(160),
  family: FamilyKeySchema,
  nicheKey: safeId.optional(),
  subcategory: safeId.optional(),
  episodeOrdinal: z.number().int().positive(),
  targetTimelineSeconds: z.number().positive().max(28_800),
  perAssetMaximumScreenSeconds: z.number().positive().max(60),
  queryTags: z.array(safeId).max(48).default([]),
  kinds: z.array(StudioReusableMediaKindSchema).min(1).max(5),
}).strict();
export type StudioReusableMediaSelectionRequest = z.input<typeof StudioReusableMediaSelectionRequestSchema>;

export const StudioReusableMediaClaimRequestSchema = StudioReusableMediaSelectionRequestSchema.omit({
  episodeOrdinal: true,
}).strict();
export type StudioReusableMediaClaimRequest = z.input<typeof StudioReusableMediaClaimRequestSchema>;

export function studioReusableMediaClaimRequestFingerprint(value: StudioReusableMediaClaimRequest): string {
  const parsed = StudioReusableMediaClaimRequestSchema.parse({
    ...value,
    queryTags: uniqueSorted(value.queryTags ?? []),
    kinds: uniqueSorted(value.kinds),
  });
  return fingerprint(parsed);
}

export const StudioReusableMediaPriorUseSchema = z.object({
  assetFingerprint: sha256,
  episodeOrdinal: z.number().int().positive(),
}).strict();
export type StudioReusableMediaPriorUse = z.infer<typeof StudioReusableMediaPriorUseSchema>;

const StudioReusableMediaSelectionSchema = z.object({
  assetFingerprint: sha256,
  logicalId: safeId,
  kind: StudioReusableMediaKindSchema,
  r2Key: objectKey,
  contentSha256: sha256,
  contentType: z.string().trim().min(3).max(120),
  durationSec: z.number().positive().max(3_600),
  plannedScreenSeconds: z.number().positive().max(60),
  source: StudioReusableMediaSourceSchema,
}).strict();

export const StudioReusableMediaPlanCoreSchema = z.object({
  version: z.literal(STUDIO_REUSABLE_MEDIA_PLAN_VERSION),
  requestFingerprint: sha256,
  policy: StudioReusableMediaPolicySchema,
  ownerId: z.string().trim().min(1).max(160),
  channelId: z.string().trim().min(1).max(160),
  runId: z.string().trim().min(1).max(160),
  episodeOrdinal: z.number().int().positive(),
  originalEpisode: z.boolean(),
  targetTimelineSeconds: z.number().positive().max(28_800),
  maximumReusedTimelineSeconds: z.number().nonnegative().max(11_520),
  plannedReusedTimelineSeconds: z.number().nonnegative().max(11_520),
  plannedReusedTimelineFraction: z.number().min(0).max(STUDIO_REUSABLE_MEDIA_MAX_TIMELINE_FRACTION),
  selections: z.array(StudioReusableMediaSelectionSchema).max(24),
  blockers: z.array(z.string().trim().min(1).max(500)).max(12),
}).strict();

export const StudioReusableMediaPlanSchema = StudioReusableMediaPlanCoreSchema.extend({
  fingerprint: sha256,
}).strict();
export type StudioReusableMediaPlan = z.infer<typeof StudioReusableMediaPlanSchema>;

export const StudioReusableMediaActualUsageSchema = z.object({
  planFingerprint: sha256,
  uses: z.array(z.object({
    assetFingerprint: sha256,
    screenSeconds: z.number().positive().max(60),
  }).strict()).max(24),
  reusedTimelineSeconds: z.number().nonnegative().max(11_520),
}).strict();
export type StudioReusableMediaActualUsage = z.infer<typeof StudioReusableMediaActualUsageSchema>;

function tagScore(entry: StudioReusableMediaEntry, requested: ReadonlySet<string>): number {
  if (entry.evergreen) return 1;
  return entry.editorialTags.reduce((score, tag) => score + (requested.has(tag) ? 1 : 0), 0);
}

/** Deterministic, provider-free selection. Convex owns the episode ordinal. */
export function resolveStudioReusableMedia(input: {
  request: StudioReusableMediaSelectionRequest;
  entries: readonly unknown[];
  priorUses?: readonly StudioReusableMediaPriorUse[];
}): StudioReusableMediaPlan {
  const request = StudioReusableMediaSelectionRequestSchema.parse({
    ...input.request,
    queryTags: uniqueSorted(input.request.queryTags ?? []),
    kinds: uniqueSorted(input.request.kinds),
  });
  const policy = studioReusableMediaPolicy(request);
  const requestFingerprint = fingerprint(request);
  const originalEpisode = request.episodeOrdinal % policy.originalEveryNthEpisode === 0;
  const maximumReusedTimelineSeconds = policy.mode === "timeline" && !originalEpisode
    ? Math.floor(request.targetTimelineSeconds * policy.maximumTimelineFraction * 1_000) / 1_000
    : 0;
  const blockers: string[] = [];
  if (policy.mode === "forbidden") blockers.push(policy.reasonCode);
  if (originalEpisode) blockers.push(`episode_${request.episodeOrdinal}_is_fully_original`);
  if (policy.mode === "reference_only") blockers.push("reference_assets_do_not_replace_timeline_media");

  const priorUses = input.priorUses?.map((use) => StudioReusableMediaPriorUseSchema.parse(use)) ?? [];
  const useOrdinals = new Map<string, number[]>();
  for (const use of priorUses) {
    const ordinals = useOrdinals.get(use.assetFingerprint) ?? [];
    ordinals.push(use.episodeOrdinal);
    useOrdinals.set(use.assetFingerprint, ordinals);
  }
  const queryTags = new Set(request.queryTags);
  const candidates = input.entries
    .map((entry) => assertStudioReusableMediaEntry(entry))
    .filter((entry) => {
      if (entry.ownerId !== request.ownerId || entry.channelId !== request.channelId) return false;
      if (entry.status !== "approved" || entry.family !== request.family) return false;
      if (!request.kinds.includes(entry.kind) || !policy.permittedKinds.includes(entry.kind)) return false;
      if (entry.nicheKey && entry.nicheKey !== request.nicheKey) return false;
      if (entry.subcategory && entry.subcategory !== request.subcategory) return false;
      if (entry.origin.sourceRunId === request.runId || entry.resource.durationSec === undefined) return false;
      const ordinals = useOrdinals.get(entry.fingerprint) ?? [];
      if (ordinals.length >= entry.maximumLifetimeUses) return false;
      if (ordinals.some((ordinal) => request.episodeOrdinal - ordinal <= entry.cooldownEpisodes)) return false;
      return tagScore(entry, queryTags) > 0;
    })
    .sort((left, right) => {
      const leftUses = useOrdinals.get(left.fingerprint)?.length ?? 0;
      const rightUses = useOrdinals.get(right.fingerprint)?.length ?? 0;
      return tagScore(right, queryTags) - tagScore(left, queryTags)
        || leftUses - rightUses
        || right.quality.finalMasterVisualScore - left.quality.finalMasterVisualScore
        || left.fingerprint.localeCompare(right.fingerprint);
    });

  let remaining = maximumReusedTimelineSeconds;
  const selections: z.infer<typeof StudioReusableMediaSelectionSchema>[] = [];
  for (const entry of candidates) {
    if (remaining <= 0 || selections.length >= 24) break;
    const durationSec = entry.resource.durationSec!;
    const plannedScreenSeconds = Math.min(durationSec, request.perAssetMaximumScreenSeconds, remaining);
    if (plannedScreenSeconds <= 0) continue;
    selections.push({
      assetFingerprint: entry.fingerprint,
      logicalId: entry.logicalId,
      kind: entry.kind,
      r2Key: entry.resource.r2Key,
      contentSha256: entry.resource.contentSha256,
      contentType: entry.resource.contentType,
      durationSec,
      plannedScreenSeconds,
      source: entry.source,
    });
    remaining = Math.max(0, remaining - plannedScreenSeconds);
  }
  const plannedReusedTimelineSeconds = selections.reduce((sum, selection) => sum + selection.plannedScreenSeconds, 0);
  const core = StudioReusableMediaPlanCoreSchema.parse({
    version: STUDIO_REUSABLE_MEDIA_PLAN_VERSION,
    requestFingerprint,
    policy,
    ownerId: request.ownerId,
    channelId: request.channelId,
    runId: request.runId,
    episodeOrdinal: request.episodeOrdinal,
    originalEpisode,
    targetTimelineSeconds: request.targetTimelineSeconds,
    maximumReusedTimelineSeconds,
    plannedReusedTimelineSeconds,
    plannedReusedTimelineFraction: plannedReusedTimelineSeconds / request.targetTimelineSeconds,
    selections,
    blockers: uniqueSorted(blockers),
  });
  return Object.freeze({ ...core, fingerprint: fingerprint(core) });
}

export function assertStudioReusableMediaPlan(value: unknown): StudioReusableMediaPlan {
  const parsed = StudioReusableMediaPlanSchema.parse(value);
  const { fingerprint: _fingerprint, ...core } = parsed;
  void _fingerprint;
  if (fingerprint(StudioReusableMediaPlanCoreSchema.parse(core)) !== parsed.fingerprint) {
    throw new Error("studioReusableMedia: selection plan fingerprint mismatch");
  }
  const selectedSeconds = parsed.selections.reduce((sum, selection) => sum + selection.plannedScreenSeconds, 0);
  if (Math.abs(selectedSeconds - parsed.plannedReusedTimelineSeconds) > 0.001) {
    throw new Error("studioReusableMedia: selection durations do not match the plan total");
  }
  if (parsed.plannedReusedTimelineSeconds > parsed.maximumReusedTimelineSeconds + 0.001) {
    throw new Error("studioReusableMedia: selection exceeds its hard timeline ceiling");
  }
  if ((parsed.originalEpisode || parsed.policy.mode !== "timeline") && parsed.selections.length > 0) {
    throw new Error("studioReusableMedia: an original or non-timeline episode cannot select timeline media");
  }
  return Object.freeze(parsed);
}

export const StudioReusableMediaUsageReceiptCoreSchema = z.object({
  version: z.literal(STUDIO_REUSABLE_MEDIA_USAGE_VERSION),
  planFingerprint: sha256,
  finalMasterSha256: sha256,
  certificateFingerprint: sha256,
  episodeOrdinal: z.number().int().positive(),
  targetTimelineSeconds: z.number().positive().max(28_800),
  reusedTimelineSeconds: z.number().nonnegative().max(11_520),
  reusedTimelineFraction: z.number().min(0).max(STUDIO_REUSABLE_MEDIA_MAX_TIMELINE_FRACTION),
  uses: z.array(z.object({
    assetFingerprint: sha256,
    screenSeconds: z.number().positive().max(60),
  }).strict()).max(24),
}).strict();

export const StudioReusableMediaUsageReceiptSchema = StudioReusableMediaUsageReceiptCoreSchema.extend({
  fingerprint: sha256,
}).strict();
export type StudioReusableMediaUsageReceipt = z.infer<typeof StudioReusableMediaUsageReceiptSchema>;

export function createStudioReusableMediaUsageReceipt(input: {
  plan: unknown;
  finalMasterSha256: string;
  certificateFingerprint: string;
  actualUsage: unknown;
}): StudioReusableMediaUsageReceipt {
  const plan = assertStudioReusableMediaPlan(input.plan);
  const actualUsage = StudioReusableMediaActualUsageSchema.parse(input.actualUsage);
  if (actualUsage.planFingerprint !== plan.fingerprint) {
    throw new Error("studioReusableMedia: actual assembly usage belongs to another selection plan");
  }
  const used = uniqueSorted(actualUsage.uses.map((use) => use.assetFingerprint));
  if (used.length !== actualUsage.uses.length) {
    throw new Error("studioReusableMedia: actual assembly usage cannot repeat an asset fingerprint");
  }
  for (const use of actualUsage.uses) {
    const selection = plan.selections.find((candidate) => candidate.assetFingerprint === use.assetFingerprint);
    if (!selection) {
      throw new Error("studioReusableMedia: usage references media outside its sealed selection plan");
    }
    if (use.screenSeconds > selection.plannedScreenSeconds + 0.001) {
      throw new Error("studioReusableMedia: actual screen time exceeds its sealed per-asset plan");
    }
  }
  const reusedTimelineSeconds = actualUsage.uses.reduce((sum, use) => sum + use.screenSeconds, 0);
  if (Math.abs(reusedTimelineSeconds - actualUsage.reusedTimelineSeconds) > 0.001) {
    throw new Error("studioReusableMedia: actual assembly usage total is inconsistent");
  }
  if (reusedTimelineSeconds > plan.maximumReusedTimelineSeconds + 0.001) {
    throw new Error("studioReusableMedia: actual assembly usage exceeds the hard timeline ceiling");
  }
  if (plan.originalEpisode && reusedTimelineSeconds > 0) {
    throw new Error("studioReusableMedia: every third episode must remain fully original");
  }
  const core = StudioReusableMediaUsageReceiptCoreSchema.parse({
    version: STUDIO_REUSABLE_MEDIA_USAGE_VERSION,
    planFingerprint: plan.fingerprint,
    finalMasterSha256: input.finalMasterSha256,
    certificateFingerprint: input.certificateFingerprint,
    episodeOrdinal: plan.episodeOrdinal,
    targetTimelineSeconds: plan.targetTimelineSeconds,
    reusedTimelineSeconds,
    reusedTimelineFraction: reusedTimelineSeconds / plan.targetTimelineSeconds,
    uses: actualUsage.uses
      .map((use) => ({ ...use }))
      .sort((left, right) => left.assetFingerprint.localeCompare(right.assetFingerprint)),
  });
  return Object.freeze({ ...core, fingerprint: fingerprint(core) });
}

export function assertStudioReusableMediaUsageReceipt(value: unknown): StudioReusableMediaUsageReceipt {
  const parsed = StudioReusableMediaUsageReceiptSchema.parse(value);
  const { fingerprint: receiptFingerprint, ...core } = parsed;
  if (fingerprint(StudioReusableMediaUsageReceiptCoreSchema.parse(core)) !== receiptFingerprint) {
    throw new Error("studioReusableMedia: usage receipt fingerprint mismatch");
  }
  if (new Set(parsed.uses.map((use) => use.assetFingerprint)).size !== parsed.uses.length) {
    throw new Error("studioReusableMedia: usage receipt cannot repeat an asset fingerprint");
  }
  const exactSeconds = parsed.uses.reduce((sum, use) => sum + use.screenSeconds, 0);
  if (Math.abs(exactSeconds - parsed.reusedTimelineSeconds) > 0.001) {
    throw new Error("studioReusableMedia: usage receipt asset timings do not match its total");
  }
  const fraction = parsed.reusedTimelineSeconds / parsed.targetTimelineSeconds;
  if (Math.abs(fraction - parsed.reusedTimelineFraction) > 0.000_001) {
    throw new Error("studioReusableMedia: usage duration and fraction disagree");
  }
  if (parsed.reusedTimelineFraction > STUDIO_REUSABLE_MEDIA_MAX_TIMELINE_FRACTION) {
    throw new Error("studioReusableMedia: usage exceeds the hard 40% ceiling");
  }
  return Object.freeze(parsed);
}

export interface StudioReusableMediaInventoryItem {
  readonly logicalId: string;
  readonly fingerprint: string;
  readonly channelId: string;
  readonly family: FamilyKey;
  readonly kind: z.infer<typeof StudioReusableMediaKindSchema>;
  readonly title: string;
  readonly status: z.infer<typeof StudioReusableMediaStatusSchema>;
  readonly editorialTags: readonly string[];
  readonly evergreen: boolean;
  readonly durationSec?: number;
  readonly contentType: string;
  readonly qualityScore: number;
  readonly maximumLifetimeUses: number;
  readonly cooldownEpisodes: number;
  readonly sourceOrigin: z.infer<typeof StudioReusableMediaSourceSchema>["origin"];
}

/** Browser-safe: no R2 key, provider asset URL, license body, or certificate key. */
export function studioReusableMediaInventory(entries: readonly unknown[]): readonly StudioReusableMediaInventoryItem[] {
  return Object.freeze(
    entries
      .map((value) => assertStudioReusableMediaEntry(value))
      .map((entry) => Object.freeze({
        logicalId: entry.logicalId,
        fingerprint: entry.fingerprint,
        channelId: entry.channelId,
        family: entry.family,
        kind: entry.kind,
        title: entry.title,
        status: entry.status,
        editorialTags: entry.editorialTags,
        evergreen: entry.evergreen,
        ...(entry.resource.durationSec === undefined ? {} : { durationSec: entry.resource.durationSec }),
        contentType: entry.resource.contentType,
        qualityScore: entry.quality.finalMasterVisualScore,
        maximumLifetimeUses: entry.maximumLifetimeUses,
        cooldownEpisodes: entry.cooldownEpisodes,
        sourceOrigin: entry.source.origin,
      }))
      .sort((left, right) => left.title.localeCompare(right.title) || left.fingerprint.localeCompare(right.fingerprint)),
  );
}
