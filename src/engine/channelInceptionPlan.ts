import { createHash } from "node:crypto";
import type { FamilyKey } from "./families";
import {
  assertCanonicalChannelProgramBrief,
  type ChannelProgramBrief,
} from "./channelProgramBrief";
import {
  assertChannelShowProfileProgramBinding,
  channelShowProfileFingerprint,
  type ChannelShowProfile,
} from "./channelShowProfile";
import {
  CHANNEL_INCEPTION_FAMILY_POLICIES,
  CHANNEL_INCEPTION_MODULE_CONTRACTS,
  CHANNEL_INCEPTION_SCHEMA_VERSION,
  CHANNEL_INCEPTION_STAGE_COST_CEILINGS_USD,
  assertChannelInceptionContracts,
  channelInceptionContract,
  channelInceptionProbeCostCeilingUsd,
  type ChannelInceptionCostClass,
  type ChannelInceptionExecutionOwner,
  type ChannelInceptionFamilyPolicy,
  type ChannelInceptionModuleKey,
  type ChannelProbeProfile,
  type ChannelVoiceOwnership,
} from "./channelInceptionContracts";

export interface ExistingChannelIdentityAsset {
  /** Durable storage key or logical identity key. */
  assetKey: string;
  /** Immutable object digest, ETag or explicitly versioned identity fingerprint. */
  contentFingerprint: string;
}

export interface ChannelIdentityAssetIntent {
  existing?: ExistingChannelIdentityAsset;
  /** Protected assets are reused exactly and can never share a generate action. */
  protectExisting?: boolean;
  /** Generates a versioned candidate while retaining the existing asset as rollback. */
  regenerate?: boolean;
}

export interface ChannelBrandIntent {
  avatar?: ChannelIdentityAssetIntent;
  banner?: ChannelIdentityAssetIntent;
  background?: ChannelIdentityAssetIntent;
  colors?: ChannelIdentityAssetIntent;
}

export interface ChannelVoiceIntent {
  existingCastFingerprint?: string;
  protectExistingCast?: boolean;
}

export interface ChannelStarterIntent {
  topicCount?: number;
  previewCount?: number;
  acceptedTopicFingerprints?: readonly string[];
  acceptedPreviewFingerprints?: readonly string[];
}

export interface ChannelInceptionRequest {
  ownerId: string;
  /** Existing channel id or a stable provisional key for a not-yet-created channel. */
  channelRef: string;
  name: string;
  slug: string;
  family: FamilyKey;
  nicheKey: string;
  locale?: string;
  /** Caller-owned revision for the complete request; it versions the plan, not unrelated stage inputs. */
  sourceRevision: string;
  /** Fingerprint of the specialized source pipeline or designer recipe. */
  pipelineSourceFingerprint: string;
  /** Canonical hash of runtime module overrides consumed by the effective pipeline. */
  moduleConfigFingerprint?: string;
  /**
   * Immutable creator intent for this exact channel program. New plans refuse
   * to invent or normalize this at execution time: the persisted canonical
   * brief is the replayable creative authority.
   */
  programBrief: ChannelProgramBrief;
  /**
   * Immutable resolved module composition for new inception. It remains
   * optional solely to read historical snapshots; the executor never admits a
   * new or retried paid run without it.
   */
  showProfile?: ChannelShowProfile;
  brand?: ChannelBrandIntent;
  voice?: ChannelVoiceIntent;
  starter?: ChannelStarterIntent;
  /** Defaults true. False omits provider probes without weakening the other contracts. */
  includeProbe?: boolean;
}

export type ChannelIdentityAssetAction =
  | "reuse-existing"
  | "preserve-protected"
  | "generate-versioned-candidate";

export interface ResolvedChannelIdentityAssetIntent {
  slot: "avatar" | "banner" | "background" | "colors";
  action: ChannelIdentityAssetAction;
  existing: ExistingChannelIdentityAsset | null;
  overwriteExisting: false;
}

interface StarterContentPlan {
  targetCount: number;
  acceptedFingerprints: readonly string[];
  missingCount: number;
}

export interface ChannelInceptionStageParamsByKey {
  "channel-inception-research": {
    family: FamilyKey;
    nicheKey: string;
    locale: string;
    evidencePolicy: "fail-closed";
  };
  "channel-inception-positioning": {
    name: string;
    slug: string;
    family: FamilyKey;
    nicheKey: string;
    programBrief: ChannelProgramBrief;
    minimumStyleDnaConfidence: number;
    maximumUnresolvedGaps: number;
  };
  "channel-inception-seo": {
    family: FamilyKey;
    nicheKey: string;
    locale: string;
    requiresNarrativePlaybook: boolean;
    legacyRetirementPolicy: "only-after-proven-replacement";
  };
  "channel-inception-voice": {
    family: FamilyKey;
    ownership: Exclude<ChannelVoiceOwnership, "none">;
    existingCastFingerprint: string | null;
    preserveExistingCast: boolean;
    requireAuditionEvidence: boolean;
    requireColdOpenProof: true;
    coldOpenProofOwner: "channel-inception-voice" | "family-probe";
  };
  "channel-inception-avatar": {
    asset: ResolvedChannelIdentityAssetIntent;
    candidatePolicy: "content-addressed-never-overwrite";
    qaProfile: "circular-crop-and-tiny-legibility";
  };
  "channel-inception-banner": {
    banner: ResolvedChannelIdentityAssetIntent;
    background: ResolvedChannelIdentityAssetIntent;
    colors: ResolvedChannelIdentityAssetIntent;
    candidatePolicy: "content-addressed-never-overwrite";
    qaProfile: "youtube-safe-area-no-garbled-text";
  };
  "channel-inception-thumbnails": {
    family: FamilyKey;
    topics: StarterContentPlan;
    previews: StarterContentPlan;
    candidatePolicy: "content-addressed-generate-missing-only";
    requireEstablishedStyleDna: true;
  };
  "channel-inception-pipeline": {
    family: FamilyKey;
    sourcePipelineFingerprint: string;
    moduleConfigFingerprint: string;
    showProfileFingerprint: string | null;
    preserveSpecializedEntries: true;
    retireOnlyCompilerDeclaredLegacy: true;
    requireGoldenProofForGoldenLabel: true;
  };
  "channel-inception-probe": {
    family: FamilyKey;
    profile: ChannelProbeProfile;
    maximumAttempts: 2;
    publication: "disabled";
    executionAdmission: "separate-required";
  };
  "channel-inception-readiness": {
    projectionVersion: "1.0.0";
    requireAdmittedArtwork: true;
    requireAdmittedThumbnail: true;
    showEffectiveCompiledFlow: true;
    distinguishGoldenQualification: true;
  };
}

export interface ChannelInceptionStagePlan<K extends ChannelInceptionModuleKey> {
  moduleKey: K;
  contractVersion: string;
  stage: string;
  title: string;
  executionOwner: ChannelInceptionExecutionOwner;
  costClass: ChannelInceptionCostClass;
  maximumCostUsd: number;
  /** Planning never authorizes a paid or mutating execution. */
  providerCallsAuthorized: false;
  dependsOn: readonly ChannelInceptionModuleKey[];
  dependencyStageKeys: readonly string[];
  inputFingerprint: string;
  /** Content-addressed identity for this exact module input and dependency set. */
  stageKey: string;
  /** Reusing this key is mandatory before any future executor starts work. */
  idempotencyKey: string;
  qualityGates: readonly string[];
  params: ChannelInceptionStageParamsByKey[K];
}

export type AnyChannelInceptionStagePlan = {
  [K in ChannelInceptionModuleKey]: ChannelInceptionStagePlan<K>;
}[ChannelInceptionModuleKey];

export interface OmittedChannelInceptionModule {
  moduleKey: ChannelInceptionModuleKey;
  reason: "not-required-for-family" | "probe-disabled";
}

export interface ChannelInceptionPlan {
  schemaVersion: typeof CHANNEL_INCEPTION_SCHEMA_VERSION;
  mode: "plan-only";
  providerCallsAuthorized: false;
  inceptionKey: string;
  requestFingerprint: string;
  /** Canonical input persisted by the runtime so retries cannot absorb their own outputs. */
  requestSnapshot: ChannelInceptionRequest;
  /** Aggregate reservation excluding the separately admitted proof render. */
  executionCostCeilingUsd: number;
  probeCostCeilingUsd: number;
  channel: {
    ownerId: string;
    channelRef: string;
    name: string;
    slug: string;
    family: FamilyKey;
    nicheKey: string;
    locale: string;
    sourceRevision: string;
  };
  familyPolicy: ChannelInceptionFamilyPolicy;
  stages: readonly AnyChannelInceptionStagePlan[];
  omittedModules: readonly OmittedChannelInceptionModule[];
}

function stableJson(value: unknown, seen = new Set<object>()): string {
  if (value === undefined) return '{"$undefined":true}';
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Channel inception fingerprints require finite numbers");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") throw new Error(`Unsupported channel inception fingerprint value: ${typeof value}`);
  if (seen.has(value)) throw new Error("Channel inception fingerprints cannot contain cycles");
  seen.add(value);
  let result: string;
  if (Array.isArray(value)) {
    result = `[${value.map((entry) => stableJson(entry, seen)).join(",")}]`;
  } else if (value instanceof Date) {
    result = JSON.stringify(value.toISOString());
  } else {
    const object = value as Record<string, unknown>;
    result = `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key], seen)}`)
      .join(",")}}`;
  }
  seen.delete(value);
  return result;
}

/** Deterministic SHA-256 used by plans, stages and future persisted receipts. */
export function channelInceptionContentSha256(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function requireText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function requireCount(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 12) {
    throw new Error(`${field} must be an integer from 0 to 12`);
  }
  return value;
}

function normalizeFingerprints(values: readonly string[] | undefined, field: string): string[] {
  const normalized = (values ?? []).map((value) => requireText(value, field));
  return [...new Set(normalized)].sort();
}

function starterContentPlan(
  targetCount: number,
  acceptedFingerprints: readonly string[],
): StarterContentPlan {
  return {
    targetCount,
    acceptedFingerprints: [...acceptedFingerprints],
    missingCount: Math.max(0, targetCount - acceptedFingerprints.length),
  };
}

function resolveAssetIntent(
  slot: ResolvedChannelIdentityAssetIntent["slot"],
  intent: ChannelIdentityAssetIntent | undefined,
): ResolvedChannelIdentityAssetIntent {
  const existing = intent?.existing
    ? {
        assetKey: requireText(intent.existing.assetKey, `${slot}.existing.assetKey`),
        contentFingerprint: requireText(
          intent.existing.contentFingerprint,
          `${slot}.existing.contentFingerprint`,
        ),
      }
    : null;
  const protectExisting = intent?.protectExisting === true;
  const regenerate = intent?.regenerate === true;

  if (protectExisting && !existing) throw new Error(`${slot} cannot be protected without an existing asset`);
  if (protectExisting && regenerate) throw new Error(`${slot} cannot be protected and regenerated together`);

  return {
    slot,
    action: protectExisting
      ? "preserve-protected"
      : existing && !regenerate
        ? "reuse-existing"
        : "generate-versioned-candidate",
    existing,
    overwriteExisting: false,
  };
}

function stageKey(args: {
  moduleKey: ChannelInceptionModuleKey;
  contractVersion: string;
  maximumCostUsd: number;
  channelScope: { ownerId: string; channelRef: string };
  params: unknown;
  dependencyStageKeys: readonly string[];
}): { inputFingerprint: string; stageKey: string; idempotencyKey: string } {
  const inputFingerprint = channelInceptionContentSha256({
    schemaVersion: CHANNEL_INCEPTION_SCHEMA_VERSION,
    moduleKey: args.moduleKey,
    contractVersion: args.contractVersion,
    maximumCostUsd: args.maximumCostUsd,
    channelScope: args.channelScope,
    params: args.params,
    dependencyStageKeys: args.dependencyStageKeys,
  });
  return {
    inputFingerprint,
    stageKey: `channel-inception/stages/${args.moduleKey}/${inputFingerprint}`,
    idempotencyKey: `channel-inception:${args.moduleKey}@${args.contractVersion}:${inputFingerprint}`,
  };
}

/**
 * Convert a completed output digest into a collision-resistant immutable key.
 * A future executor should persist candidates here, then separately admit them.
 */
export function channelInceptionOutputKey(args: {
  stageKey: string;
  logicalOutput: string;
  contentSha256: string;
}): string {
  const stage = requireText(args.stageKey, "stageKey");
  const output = requireText(args.logicalOutput, "logicalOutput")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!output) throw new Error("logicalOutput must contain a storage-safe character");
  const digest = args.contentSha256.toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("contentSha256 must be a 64-character hex digest");
  return `${stage}/outputs/${output}/${digest}`;
}

export function channelInceptionStage<K extends ChannelInceptionModuleKey>(
  plan: ChannelInceptionPlan,
  key: K,
): ChannelInceptionStagePlan<K> | undefined {
  return plan.stages.find((stage) => stage.moduleKey === key) as ChannelInceptionStagePlan<K> | undefined;
}

/**
 * Build a deterministic, family-aware plan. This function performs no I/O,
 * reserves no spend and grants no permission to execute its provider-potential
 * stages.
 */
export function buildChannelInceptionPlan(request: ChannelInceptionRequest): ChannelInceptionPlan {
  assertChannelInceptionContracts();

  const policy = CHANNEL_INCEPTION_FAMILY_POLICIES[request.family];
  if (!policy) throw new Error(`Unsupported channel family: ${request.family}`);

  const ownerId = requireText(request.ownerId, "ownerId");
  const channelRef = requireText(request.channelRef, "channelRef");
  const name = requireText(request.name, "name");
  const slug = requireText(request.slug, "slug");
  const nicheKey = requireText(request.nicheKey, "nicheKey");
  const locale = requireText(request.locale ?? "en", "locale");
  const sourceRevision = requireText(request.sourceRevision, "sourceRevision");
  const pipelineSourceFingerprint = requireText(
    request.pipelineSourceFingerprint,
    "pipelineSourceFingerprint",
  );
  const moduleConfigFingerprint = request.moduleConfigFingerprint
    ? requireText(request.moduleConfigFingerprint, "moduleConfigFingerprint")
    : channelInceptionContentSha256({});
  const programBrief = assertCanonicalChannelProgramBrief(request.programBrief);
  if (programBrief.family !== request.family) {
    throw new Error("channel program brief family does not match the inception request");
  }
  if (programBrief.nicheKey !== nicheKey) {
    throw new Error("channel program brief niche does not match the inception request");
  }
  if (programBrief.locale !== locale) {
    throw new Error("channel program brief locale does not match the inception request");
  }
  const showProfile = request.showProfile
    ? assertChannelShowProfileProgramBinding({ profile: request.showProfile, programBrief })
    : undefined;

  if (policy.voiceOwnership === "none" && request.voice) {
    throw new Error(`${request.family} omits voice inception and cannot accept a voice intent`);
  }
  const existingCastFingerprint = request.voice?.existingCastFingerprint
    ? requireText(request.voice.existingCastFingerprint, "voice.existingCastFingerprint")
    : null;
  if (request.voice?.protectExistingCast && !existingCastFingerprint) {
    throw new Error("voice cannot be protected without an existing cast fingerprint");
  }

  const avatar = resolveAssetIntent("avatar", request.brand?.avatar);
  const banner = resolveAssetIntent("banner", request.brand?.banner);
  const background = resolveAssetIntent("background", request.brand?.background);
  const colors = resolveAssetIntent("colors", request.brand?.colors);

  const acceptedTopics = normalizeFingerprints(
    request.starter?.acceptedTopicFingerprints,
    "starter.acceptedTopicFingerprints",
  );
  const acceptedPreviews = normalizeFingerprints(
    request.starter?.acceptedPreviewFingerprints,
    "starter.acceptedPreviewFingerprints",
  );
  const topicCount = requireCount(
    request.starter?.topicCount ?? policy.starterTopicCount,
    "starter.topicCount",
  );
  const previewCount = requireCount(
    request.starter?.previewCount ?? policy.starterPreviewCount,
    "starter.previewCount",
  );
  const topics = starterContentPlan(topicCount, acceptedTopics);
  const previews = starterContentPlan(previewCount, acceptedPreviews);

  const includeProbe = request.includeProbe !== false;
  const includedKeys = new Set<ChannelInceptionModuleKey>();
  const omittedModules: OmittedChannelInceptionModule[] = [];
  for (const contract of CHANNEL_INCEPTION_MODULE_CONTRACTS) {
    if (!contract.supportedFamilies.includes(request.family)) {
      omittedModules.push({ moduleKey: contract.key, reason: "not-required-for-family" });
      continue;
    }
    if (contract.key === "channel-inception-probe" && !includeProbe) {
      omittedModules.push({ moduleKey: contract.key, reason: "probe-disabled" });
      continue;
    }
    includedKeys.add(contract.key);
  }

  const channelScope = { ownerId, channelRef };
  const stages: AnyChannelInceptionStagePlan[] = [];
  const stagesByKey = new Map<ChannelInceptionModuleKey, AnyChannelInceptionStagePlan>();

  const addStage = <K extends ChannelInceptionModuleKey>(
    moduleKey: K,
    params: ChannelInceptionStageParamsByKey[K],
    executionOwner?: ChannelInceptionExecutionOwner,
  ): void => {
    if (!includedKeys.has(moduleKey)) return;
    const contract = channelInceptionContract(moduleKey);
    const maximumCostUsd = moduleKey === "channel-inception-probe"
      ? channelInceptionProbeCostCeilingUsd(request.family)
      : CHANNEL_INCEPTION_STAGE_COST_CEILINGS_USD[moduleKey];
    const dependsOn = [
      ...contract.requiredDependencies,
      ...contract.optionalDependencies.filter((dependency) => includedKeys.has(dependency)),
    ];
    for (const dependency of contract.requiredDependencies) {
      if (!includedKeys.has(dependency)) {
        throw new Error(`${moduleKey} requires omitted module ${dependency} for ${request.family}`);
      }
    }
    const dependencyStageKeys = dependsOn.map((dependency) => {
      const dependencyStage = stagesByKey.get(dependency);
      if (!dependencyStage) throw new Error(`${moduleKey} is ordered before dependency ${dependency}`);
      return dependencyStage.stageKey;
    });
    const keys = stageKey({
      moduleKey,
      contractVersion: contract.version,
      maximumCostUsd,
      channelScope,
      params,
      dependencyStageKeys,
    });
    const stage = {
      moduleKey,
      contractVersion: contract.version,
      stage: contract.stage,
      title: contract.title,
      executionOwner: executionOwner ?? contract.defaultExecutionOwner,
      costClass: contract.costClass,
      maximumCostUsd,
      providerCallsAuthorized: false as const,
      dependsOn,
      dependencyStageKeys,
      ...keys,
      qualityGates: [...contract.gates],
      params,
    } as ChannelInceptionStagePlan<K>;
    stages.push(stage as AnyChannelInceptionStagePlan);
    stagesByKey.set(moduleKey, stage as AnyChannelInceptionStagePlan);
  };

  addStage("channel-inception-research", {
    family: request.family,
    nicheKey,
    locale,
    evidencePolicy: "fail-closed",
  });
  addStage("channel-inception-positioning", {
    name,
    slug,
    family: request.family,
    nicheKey,
    programBrief,
    minimumStyleDnaConfidence: 0.7,
    maximumUnresolvedGaps: 0,
  });
  addStage("channel-inception-seo", {
    family: request.family,
    nicheKey,
    locale,
    requiresNarrativePlaybook: policy.requiresNarrativePlaybook,
    legacyRetirementPolicy: "only-after-proven-replacement",
  });
  if (policy.voiceOwnership !== "none") {
    addStage(
      "channel-inception-voice",
      {
        family: request.family,
        ownership: policy.voiceOwnership,
        existingCastFingerprint,
        preserveExistingCast: request.voice?.protectExistingCast === true,
        requireAuditionEvidence: policy.voiceOwnership === "channel-cast",
        requireColdOpenProof: true,
        coldOpenProofOwner: policy.voiceOwnership === "family-engine"
          ? "family-probe"
          : "channel-inception-voice",
      },
      policy.voiceOwnership === "family-engine"
        ? "family-engine"
        : "channel-inception-orchestrator",
    );
  }
  addStage("channel-inception-avatar", {
    asset: avatar,
    candidatePolicy: "content-addressed-never-overwrite",
    qaProfile: "circular-crop-and-tiny-legibility",
  });
  addStage("channel-inception-banner", {
    banner,
    background,
    colors,
    candidatePolicy: "content-addressed-never-overwrite",
    qaProfile: "youtube-safe-area-no-garbled-text",
  });
  addStage("channel-inception-thumbnails", {
    family: request.family,
    topics,
    previews,
    candidatePolicy: "content-addressed-generate-missing-only",
    requireEstablishedStyleDna: true,
  });
  addStage("channel-inception-pipeline", {
    family: request.family,
    sourcePipelineFingerprint: pipelineSourceFingerprint,
    moduleConfigFingerprint,
    showProfileFingerprint: showProfile ? channelShowProfileFingerprint(showProfile) : null,
    preserveSpecializedEntries: true,
    retireOnlyCompilerDeclaredLegacy: true,
    requireGoldenProofForGoldenLabel: true,
  });
  if (includeProbe) {
    addStage("channel-inception-probe", {
      family: request.family,
      profile: policy.probeProfile,
      maximumAttempts: 2,
      publication: "disabled",
      executionAdmission: "separate-required",
    });
  }
  addStage("channel-inception-readiness", {
    projectionVersion: "1.0.0",
    requireAdmittedArtwork: true,
    requireAdmittedThumbnail: true,
    showEffectiveCompiledFlow: true,
    distinguishGoldenQualification: true,
  });

  if (stages.length !== includedKeys.size || new Set(stages.map((stage) => stage.moduleKey)).size !== stages.length) {
    throw new Error("Channel inception planning produced missing or duplicate modules");
  }
  if (new Set(stages.map((stage) => stage.stageKey)).size !== stages.length) {
    throw new Error("Channel inception planning produced duplicate stage keys");
  }

  const requestFingerprint = channelInceptionContentSha256({
    schemaVersion: CHANNEL_INCEPTION_SCHEMA_VERSION,
    ownerId,
    channelRef,
    name,
    slug,
    family: request.family,
    nicheKey,
    locale,
    sourceRevision,
    programBrief,
    showProfile: showProfile ?? null,
    pipelineSourceFingerprint,
    moduleConfigFingerprint,
    brand: { avatar, banner, background, colors },
    voice: policy.voiceOwnership === "none"
      ? null
      : { existingCastFingerprint, protectExistingCast: request.voice?.protectExistingCast === true },
    starter: { topics, previews },
    includeProbe,
  });
  const inceptionKey = `channel-inception/plans/${channelRef}/${channelInceptionContentSha256({
    requestFingerprint,
    stages: stages.map((stage) => ({ moduleKey: stage.moduleKey, stageKey: stage.stageKey })),
    omittedModules,
  })}`;

  const snapshotAsset = (
    asset: ResolvedChannelIdentityAssetIntent,
  ): ChannelIdentityAssetIntent | undefined => {
    if (!asset.existing && asset.action === "generate-versioned-candidate") return undefined;
    return {
      ...(asset.existing ? { existing: { ...asset.existing } } : {}),
      ...(asset.action === "preserve-protected" ? { protectExisting: true } : {}),
      ...(asset.action === "generate-versioned-candidate" && asset.existing
        ? { regenerate: true }
        : {}),
    };
  };
  const snapshotBrand: ChannelBrandIntent = {
    avatar: snapshotAsset(avatar),
    banner: snapshotAsset(banner),
    background: snapshotAsset(background),
    colors: snapshotAsset(colors),
  };
  const requestSnapshot: ChannelInceptionRequest = {
    ownerId,
    channelRef,
    name,
    slug,
    family: request.family,
    nicheKey,
    locale,
    sourceRevision,
    pipelineSourceFingerprint,
    moduleConfigFingerprint,
    programBrief,
    ...(showProfile ? { showProfile } : {}),
    ...(Object.values(snapshotBrand).some(Boolean) ? { brand: snapshotBrand } : {}),
    ...(policy.voiceOwnership !== "none" && existingCastFingerprint
      ? {
          voice: {
            existingCastFingerprint,
            protectExistingCast: request.voice?.protectExistingCast === true,
          },
        }
      : {}),
    starter: {
      topicCount,
      previewCount,
      acceptedTopicFingerprints: [...acceptedTopics],
      acceptedPreviewFingerprints: [...acceptedPreviews],
    },
    includeProbe,
  };
  const executionCostCeilingUsd = stages
    .filter((stage) => stage.moduleKey !== "channel-inception-probe")
    .reduce((sum, stage) => sum + stage.maximumCostUsd, 0);
  const probeCostCeilingUsd = stages.find(
    (stage) => stage.moduleKey === "channel-inception-probe",
  )?.maximumCostUsd ?? 0;

  return {
    schemaVersion: CHANNEL_INCEPTION_SCHEMA_VERSION,
    mode: "plan-only",
    providerCallsAuthorized: false,
    inceptionKey,
    requestFingerprint,
    requestSnapshot,
    executionCostCeilingUsd,
    probeCostCeilingUsd,
    channel: {
      ownerId,
      channelRef,
      name,
      slug,
      family: request.family,
      nicheKey,
      locale,
      sourceRevision,
    },
    familyPolicy: { ...policy },
    stages,
    omittedModules,
  };
}
