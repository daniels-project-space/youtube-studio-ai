import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";
import { v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { moduleSurface, configurableModules } from "@/engine/moduleRegistry";
import { validateKnobs, type KnobValues, type KnobValue } from "@/engine/customization";
import {
  isAcceptedChannelArtworkRun,
  summarizeChannelCardRuns,
} from "@/lib/channelCardProjection";
import {
  beginChannelInceptionLedger,
  checkpointChannelInceptionLedgerStage,
  claimChannelInceptionLedgerStage,
  completeChannelInceptionLedgerStage,
  failChannelInceptionLedgerStage,
  heartbeatChannelInceptionLedgerStage,
  invalidateChannelInceptionStageAndDescendants,
  type ChannelInceptionLedgerState,
  type ChannelInceptionStageDescriptor,
} from "@/engine/channelInceptionLedger";
import {
  CHANNEL_INCEPTION_MODULE_KEYS,
  CHANNEL_INCEPTION_STAGE_COST_CEILINGS_USD,
} from "@/engine/channelInceptionContracts";
import {
  assertPersistedProgramBriefIdentity,
  channelProgramBriefFingerprint,
  CHANNEL_PROGRAM_BRIEF_VERSION,
} from "@/engine/channelProgramBrief";
import {
  assertChannelProgramRouteBinding,
  channelProgramRouteFingerprint,
  parseChannelProgramRoute,
  type ChannelProgramRoute,
} from "@/engine/channelProgramRoute";
import {
  assertCreatorIntentDiagnosisBinding,
  type CreatorIntentDiagnosis,
} from "@/engine/creatorIntentDiagnosis";
import {
  assertChannelShowProfileReceiptExactComposition,
  assertChannelShowProfileReceiptPipelineCompatibility,
  channelShowProfileReceiptFingerprint,
  CHANNEL_SHOW_PROFILE_VERSION,
} from "@/engine/channelShowProfileCodec";
import { CHANNEL_COMPOSITION_RECEIPT_VERSION } from "@/engine/channelCompositionCatalog";
import { comparablePipeline } from "@/engine/channelPipelineComparable";
import { channelInceptionInvalidationRoots } from "@/engine/channelInceptionInvalidation";
import {
  assertChannelWritable,
  isChannelLocked,
  patchChannelRespectingLock,
} from "./channelLock";
import {
  assertContentLaneMatchesFamily,
  assertPipelineMatchesContentLane,
  contentLaneFingerprint,
  contentLaneForFamily,
  parseContentLane,
  resolveContentLane,
} from "@/engine/contentLane";
import { assertMinimumVideoFoundationForAutomaticFamily } from "@/engine/minimumVideoFoundation";
import { assertStyleDNAAdmissionSafety } from "@/engine/creative/styleDNAAdmission";

const MAX_INCEPTION_OUTPUT_CHARS = 16_000;
const MAX_INCEPTION_STAGES = 10;
const INCEPTION_MODULE_KEYS = new Set<string>(CHANNEL_INCEPTION_MODULE_KEYS);

const contentLaneValidator = v.object({
  version: v.literal("content-lane/v1"),
  key: v.string(),
  family: v.optional(v.string()),
  primaryRenderer: v.string(),
});

function channelContentLane(channel: {
  contentLane?: unknown;
  family?: unknown;
  pipeline?: unknown;
}) {
  const lane = resolveContentLane({
    stored: channel.contentLane,
    family: channel.family,
    pipeline: Array.isArray(channel.pipeline) ? channel.pipeline : [],
  });
  assertContentLaneMatchesFamily(lane, channel.family);
  return lane;
}

function assertProgramBriefIdentityMutation(args: {
  readonly existingIdentity: unknown;
  readonly nextIdentity: unknown;
  readonly effectiveFamily: unknown;
  /** Effective graph that the mutation is about to persist with this receipt. */
  readonly nextPipeline?: unknown;
  /** Only brand-new admitted channels may introduce their first show profile. */
  readonly allowFirstShowProfile?: boolean;
}): void {
  const allowFirstShowProfile = args.allowFirstShowProfile === true;
  const existingProgramBrief = assertPersistedProgramBriefIdentity(args.existingIdentity, {
    context: "existing channel identity",
  });
  const nextProgramBrief = assertPersistedProgramBriefIdentity(args.nextIdentity, {
    context: "next channel identity",
  });
  for (const programBrief of [existingProgramBrief, nextProgramBrief]) {
    if (programBrief && programBrief.family !== args.effectiveFamily) {
      throw new Error(
        `channel program brief family ${programBrief.family} does not match the effective channel family ${String(args.effectiveFamily)}`,
      );
    }
  }
  if (existingProgramBrief && !nextProgramBrief) {
    throw new Error("channel program brief cannot be removed by a generic channel mutation");
  }
  if (
    existingProgramBrief &&
    nextProgramBrief &&
    channelProgramBriefFingerprint(existingProgramBrief) !== channelProgramBriefFingerprint(nextProgramBrief)
  ) {
    throw new Error("channel program brief is immutable once stored; create a fresh admitted channel or fork");
  }

  const routeFromIdentity = (identity: unknown): ChannelProgramRoute | undefined => {
    if (!identity || typeof identity !== "object" || Array.isArray(identity)) return undefined;
    const rawRoute = (identity as { programRoute?: unknown }).programRoute;
    return rawRoute === undefined ? undefined : parseChannelProgramRoute(rawRoute);
  };
  const existingProgramRoute = routeFromIdentity(args.existingIdentity);
  const nextProgramRoute = routeFromIdentity(args.nextIdentity);
  if (nextProgramRoute) {
    if (!nextProgramBrief) {
      throw new Error("channel program route requires a canonical channel program brief");
    }
    assertChannelProgramRouteBinding({
      route: nextProgramRoute,
      programBrief: nextProgramBrief,
    });
  }
  if (existingProgramRoute && !nextProgramRoute) {
    throw new Error("channel program route cannot be removed by a generic channel mutation");
  }
  if (!existingProgramRoute && nextProgramRoute && !args.allowFirstShowProfile) {
    throw new Error("channel program route cannot be backfilled by a generic channel mutation; create a fresh admitted channel or fork");
  }
  if (
    existingProgramRoute &&
    nextProgramRoute &&
    channelProgramRouteFingerprint(existingProgramRoute) !== channelProgramRouteFingerprint(nextProgramRoute)
  ) {
    throw new Error("channel program route is immutable once stored; create a fresh admitted channel or fork");
  }

  const diagnosisFromIdentity = (identity: unknown): unknown => {
    if (!identity || typeof identity !== "object" || Array.isArray(identity)) return undefined;
    return (identity as { creatorIntentDiagnosis?: unknown }).creatorIntentDiagnosis;
  };
  const existingRawDiagnosis = diagnosisFromIdentity(args.existingIdentity);
  const nextRawDiagnosis = diagnosisFromIdentity(args.nextIdentity);
  const requireBoundDiagnosis = (
    rawDiagnosis: unknown,
    programBrief: typeof existingProgramBrief,
    programRoute: ChannelProgramRoute | undefined,
    context: string,
  ): CreatorIntentDiagnosis | undefined => {
    if (rawDiagnosis === undefined) return undefined;
    if (!programBrief || !programRoute) {
      throw new Error(`${context} creator intent diagnosis requires a canonical channel program brief and route`);
    }
    return assertCreatorIntentDiagnosisBinding({
      diagnosis: rawDiagnosis,
      programBrief,
      programRoute,
    });
  };
  const existingCreatorIntentDiagnosis = requireBoundDiagnosis(
    existingRawDiagnosis,
    existingProgramBrief,
    existingProgramRoute,
    "existing channel identity",
  );
  const nextCreatorIntentDiagnosis = requireBoundDiagnosis(
    nextRawDiagnosis,
    nextProgramBrief,
    nextProgramRoute,
    "next channel identity",
  );
  if (existingCreatorIntentDiagnosis && !nextCreatorIntentDiagnosis) {
    throw new Error("creator intent diagnosis cannot be removed by a generic channel mutation");
  }
  if (!existingCreatorIntentDiagnosis && nextCreatorIntentDiagnosis && !allowFirstShowProfile) {
    throw new Error("creator intent diagnosis cannot be backfilled by a generic channel mutation; create a fresh admitted channel or fork");
  }
  if (
    existingCreatorIntentDiagnosis &&
    nextCreatorIntentDiagnosis &&
    existingCreatorIntentDiagnosis.fingerprint !== nextCreatorIntentDiagnosis.fingerprint
  ) {
    throw new Error("creator intent diagnosis is immutable once stored; create a fresh admitted channel or fork");
  }

  const existingShowProfile = args.existingIdentity && typeof args.existingIdentity === "object"
    ? (args.existingIdentity as { showProfile?: unknown }).showProfile
    : undefined;
  const nextShowProfile = args.nextIdentity && typeof args.nextIdentity === "object"
    ? (args.nextIdentity as { showProfile?: unknown }).showProfile
    : undefined;
  if (nextProgramBrief && !existingProgramBrief && !nextShowProfile) {
    throw new Error("a newly admitted channel program requires a sealed channel show profile");
  }
  if (nextProgramBrief && !existingProgramBrief && !nextProgramRoute) {
    throw new Error("a newly admitted channel program requires a sealed channel program route");
  }
  if (nextProgramBrief && !existingProgramBrief && !nextCreatorIntentDiagnosis) {
    throw new Error("a newly admitted channel program requires a sealed creator intent diagnosis");
  }
  if (existingShowProfile && !nextShowProfile) {
    throw new Error("channel show profile cannot be removed by a generic channel mutation");
  }
  if (!existingShowProfile && nextShowProfile && !allowFirstShowProfile) {
    throw new Error("channel show profile cannot be backfilled by a generic channel mutation; create a fresh admitted channel or fork");
  }
  if (!nextShowProfile) {
    if (nextProgramRoute) {
      throw new Error("channel program route requires a sealed channel show profile");
    }
    return;
  }
  if (!nextProgramBrief) {
    throw new Error("channel show profile requires a canonical channel program brief");
  }
  if (args.nextPipeline === undefined) {
    throw new Error("channel show profile requires the effective pipeline being persisted");
  }
  // This pure receipt spine preserves the program/family/lane/catalog and
  // selected-capability obligations at write time. Full registry validation is
  // still repeated by the admitted executor and the pre-spend run gate.
  const profileInput = {
    profile: nextShowProfile,
    programBrief: nextProgramBrief,
    pipeline: args.nextPipeline,
  };
  const profile = allowFirstShowProfile
    ? assertChannelShowProfileReceiptExactComposition(profileInput)
    : assertChannelShowProfileReceiptPipelineCompatibility(profileInput);
  if (nextProgramRoute && !profile.programRoute) {
    throw new Error("channel program route must match the sealed channel show profile route");
  }
  if (!nextProgramRoute && profile.programRoute) {
    throw new Error("channel show profile route requires the matching durable channel program route");
  }
  if (
    nextProgramRoute &&
    profile.programRoute &&
    channelProgramRouteFingerprint(nextProgramRoute) !== channelProgramRouteFingerprint(profile.programRoute)
  ) {
    throw new Error("channel program route does not match the sealed channel show profile route");
  }
  if (
    existingShowProfile &&
    channelShowProfileReceiptFingerprint(existingShowProfile) !==
      channelShowProfileReceiptFingerprint(profile)
  ) {
    throw new Error("channel show profile is immutable once stored; create a fresh admitted channel or fork");
  }
}

function invalidatePersistedInceptionProofs(
  inception: unknown,
  roots: readonly (typeof CHANNEL_INCEPTION_MODULE_KEYS)[number][],
  callerRole: unknown,
): ChannelInceptionLedgerState | undefined {
  if (!inception || typeof inception !== "object" || roots.length === 0) return undefined;
  const ledger = structuredClone(inception) as ChannelInceptionLedgerState;
  const running = roots.filter((root) => ledger.stages?.[root]?.status === "running");
  if (running.length > 0 && callerRole !== "service") {
    throw new Error(
      `channel fields are locked while inception stage is running: ${running.join(", ")}`,
    );
  }
  let invalidated = false;
  for (const root of roots) {
    const stage = ledger.stages?.[root];
    // The service orchestrator persists a stage's own output before committing
    // its receipt. Human edits are rejected above during that short lease.
    if (!stage || stage.status === "pending" || stage.status === "running") continue;
    invalidateChannelInceptionStageAndDescendants(ledger, root);
    invalidated = true;
  }
  if (!invalidated) return undefined;
  ledger.updatedAt = Date.now();
  return ledger;
}

async function channelMutationRole(ctx: {
  auth: { getUserIdentity: () => Promise<unknown> };
}): Promise<unknown> {
  return (await ctx.auth.getUserIdentity() as { role?: unknown } | null)?.role;
}

/**
 * Typed confirmation for the unlock path, mirroring contentPlan's
 * OPERATIONAL_CALENDAR_MAINTENANCE_CONFIRMATION convention. Combined with the
 * role check below it makes unlocking unmistakably human-initiated.
 */
const CHANNEL_UNLOCK_CONFIRMATION = "UNLOCK CHANNEL";

/**
 * Lock/unlock are OPERATOR-ONLY. `identityScope` (studioFunctions) resolves the
 * caller to exactly one of "owner" | "viewer" | "service"; every automated path
 * — Trigger tasks, crons, the channel-inception orchestrator, agents — presents
 * the "service" identity, and viewers cannot mutate at all. Requiring "owner"
 * therefore leaves an interactive studio session as the ONLY reachable caller.
 */
async function requireChannelOwnerActor(
  ctx: { auth: { getUserIdentity: () => Promise<unknown> } },
  purpose: string,
): Promise<string> {
  const identity = (await ctx.auth.getUserIdentity()) as
    | { role?: unknown; subject?: unknown }
    | null;
  if (!identity || identity.role !== "owner" || typeof identity.subject !== "string") {
    throw new Error(`${purpose} requires an interactive studio owner identity`);
  }
  return identity.subject;
}

async function requireInceptionService(ctx: {
  auth: { getUserIdentity: () => Promise<unknown> };
}): Promise<void> {
  const identity = await ctx.auth.getUserIdentity() as { role?: unknown } | null;
  if (identity?.role !== "service") {
    throw new Error("channel inception ledger writes require a studio service identity");
  }
}

function assertInceptionOutputSize(value: unknown): void {
  if (value === undefined) return;
  const encoded = JSON.stringify(value);
  if (encoded === undefined || encoded.length > MAX_INCEPTION_OUTPUT_CHARS) {
    throw new Error(`channel inception output exceeds ${MAX_INCEPTION_OUTPUT_CHARS} characters`);
  }
}

function assertInceptionStageDescriptor(stage: ChannelInceptionStageDescriptor): void {
  if (!INCEPTION_MODULE_KEYS.has(stage.moduleKey)) {
    throw new Error("invalid channel inception module key");
  }
  if (
    stage.dependsOn.length > MAX_INCEPTION_STAGES - 1 ||
    new Set(stage.dependsOn).size !== stage.dependsOn.length ||
    stage.dependsOn.some(
      (dependency) => !INCEPTION_MODULE_KEYS.has(dependency) || dependency === stage.moduleKey,
    )
  ) {
    throw new Error("invalid channel inception dependencies");
  }
  if (!/^[a-f0-9]{64}$/.test(stage.inputFingerprint)) {
    throw new Error("invalid channel inception input fingerprint");
  }
  if (!stage.contractVersion.trim() || stage.contractVersion.length > 64) {
    throw new Error("invalid channel inception contract version");
  }
  if (stage.maximumCostUsd !== CHANNEL_INCEPTION_STAGE_COST_CEILINGS_USD[stage.moduleKey]) {
    throw new Error("invalid channel inception stage cost ceiling");
  }
  if (stage.stageKey !== `channel-inception/stages/${stage.moduleKey}/${stage.inputFingerprint}`) {
    throw new Error("invalid channel inception stage key");
  }
  if (
    stage.idempotencyKey !==
    `channel-inception:${stage.moduleKey}@${stage.contractVersion}:${stage.inputFingerprint}`
  ) {
    throw new Error("invalid channel inception idempotency key");
  }
}

export const channelInceptionLedgerGuardsForTests = {
  requireInceptionService,
  assertInceptionOutputSize,
  assertInceptionStageDescriptor,
  invalidatePersistedInceptionProofs,
  assertProgramBriefIdentityMutation,
};

async function projectChannelCard(ctx: QueryCtx, channel: Doc<"channels">) {
  const recentRuns = await ctx.db
    .query("runs")
    .withIndex("by_channel_thumbnail_refresh_source", (q) => q
      .eq("channelId", channel._id)
      .eq("thumbnailRefreshSourceRunId", undefined))
    .order("desc")
    .take(20);
  const acceptedRunIds = new Set(
    recentRuns.filter(isAcceptedChannelArtworkRun).map((run) => String(run._id)),
  );
  const recentThumbnails = acceptedRunIds.size > 0
    ? await ctx.db
      .query("assets")
      .withIndex("by_channel_kind", (q) => q.eq("channelId", channel._id).eq("kind", "thumbnail"))
      .order("desc")
      .take(60)
    : [];
  const latestThumbnailKey = recentThumbnails.find(
    (asset) => asset.runId && acceptedRunIds.has(String(asset.runId)),
  )?.r2Key ?? null;
  return {
    channelId: channel._id,
    channelSlug: channel.slug,
    latestThumbnailKey,
    ...summarizeChannelCardRuns(recentRuns),
  };
}

const identityValidator = v.object({
  persona: v.string(),
  // Voicecraft audition winner — persisted at inception (was silently rejected
  // by this validator before, discarding the cast voice on every channel).
  voiceCasting: v.optional(
    v.object({
      voiceId: v.string(),
      name: v.optional(v.string()),
      character: v.optional(v.string()),
      score: v.optional(v.number()),
      why: v.optional(v.string()),
      at: v.optional(v.number()),
      auditionReceipt: v.optional(v.object({
        version: v.literal("voice-casting-audition/v1"),
        ownerId: v.string(),
        channelId: v.string(),
        voiceId: v.string(),
        score: v.number(),
        judgedAt: v.number(),
        auditionedCount: v.number(),
        shortlistFingerprint: v.string(),
        verdictFingerprint: v.string(),
      })),
      coldOpenReceipt: v.optional(v.object({
        version: v.literal("voice-cold-open/v1"),
        ownerId: v.string(),
        channelId: v.string(),
        voiceId: v.string(),
        judgedAt: v.number(),
        seed: v.number(),
        textFingerprint: v.string(),
        physicsFingerprint: v.string(),
        verdictFingerprint: v.string(),
        scores: v.object({
          register: v.number(),
          pace: v.number(),
          performance: v.number(),
          clean: v.number(),
        }),
      })),
      providerSelectionReceipt: v.optional(v.object({
        version: v.literal("voice-provider-selection/v1"),
        ownerId: v.string(),
        channelId: v.string(),
        provider: v.literal("elevenlabs"),
        voiceId: v.string(),
        score: v.number(),
        selectedAt: v.number(),
        shortlistedCount: v.number(),
        shortlistFingerprint: v.string(),
        selectionFingerprint: v.string(),
      })),
      localColdOpenReceipt: v.optional(v.object({
        version: v.literal("voice-local-cold-open/v1"),
        ownerId: v.string(),
        channelId: v.string(),
        provider: v.literal("elevenlabs"),
        voiceId: v.string(),
        measuredAt: v.number(),
        textFingerprint: v.string(),
        physicsFingerprint: v.string(),
        audioFingerprint: v.string(),
        durationSec: v.number(),
        wordsPerSec: v.number(),
        integratedLufs: v.number(),
      })),
    }),
  ),
  voiceId: v.optional(v.string()),
  voiceRef: v.optional(v.string()),
  toneRefs: v.optional(v.array(v.string())),
  bannedWords: v.array(v.string()),
  requiredCallbacks: v.array(v.string()),
  styleGrammar: v.string(),
  palette: v.array(v.string()),
  thumbnailTemplate: v.string(),
  topicPool: v.array(v.string()),
  cadence: v.string(),
  nicheKey: v.optional(v.string()),
  niche: v.optional(v.string()),
  imageKey: v.optional(v.string()),
  bannerKey: v.optional(v.string()),
  thumbnailIdentity: v.optional(
    v.object({
      colorPalette: v.array(v.string()),
      visualStyle: v.string(),
      textPosition: v.string(),
      avoid: v.array(v.string()),
    }),
  ),
  // The canonical creator program is durable channel identity, not ephemeral
  // wizard text. Inception re-verifies canonical form before it can spend.
  programBrief: v.optional(
    v.object({
      version: v.literal(CHANNEL_PROGRAM_BRIEF_VERSION),
      catalogFingerprint: v.string(),
      family: v.string(),
      nicheKey: v.string(),
      subcategory: v.optional(v.string()),
      locale: v.string(),
      concept: v.string(),
      audience: v.optional(v.string()),
      sampleTopics: v.optional(v.array(v.string())),
      // The sealed route resolver owns this discriminated form. Keep Convex
      // structural here and re-parse the full canonical brief before a
      // mutation can admit or resume work, so this duplicated boundary cannot
      // drift from the engine contract.
      programIntent: v.optional(v.any()),
    }),
  ),
  // Durable route identity is deliberately separate from the brief and show
  // profile. The mutation guard proves all three agree before it persists a
  // new admission; old identities may omit it unchanged.
  programRoute: v.optional(v.any()),
  // Engine-validated sealed receipt. Keep the Convex envelope permissive so
  // historical rows remain readable; `assertProgramBriefIdentityMutation`
  // verifies the exact current derivation before any write can admit it.
  creatorIntentDiagnosis: v.optional(v.any()),
  showProfile: v.optional(
    v.object({
      version: v.literal(CHANNEL_SHOW_PROFILE_VERSION),
      programBriefFingerprint: v.string(),
      familyManifestFingerprint: v.string(),
      contentLaneFingerprint: v.string(),
      creativeCapabilityCatalogFingerprint: v.string(),
      selectedCapabilityKeys: v.array(v.string()),
      composition: v.optional(
        v.object({
          version: v.literal(CHANNEL_COMPOSITION_RECEIPT_VERSION),
          key: v.string(),
          definitionVersion: v.string(),
          definitionFingerprint: v.string(),
          family: v.string(),
          title: v.string(),
          qualityFocus: v.array(v.string()),
          fingerprint: v.string(),
        }),
      ),
      // New capability-owned composition authority. The V8-safe receipt
      // parser validates this sealed discriminated structure before any
      // durable write; keep the outer envelope permissive for historical
      // profile shapes and future immutable plan revisions.
      compositionBinding: v.optional(v.any()),
      // Parsed and bound to the canonical program brief by the V8-safe route
      // contract in the mutation guard below. A permissive outer schema keeps
      // historical rows readable without duplicating its versioned shape.
      programRoute: v.optional(v.any()),
      designedPipelineFingerprint: v.string(),
      fingerprint: v.string(),
    }),
  ),
  creativeBrief: v.optional(
    v.object({
      positioning: v.string(),
      vibe: v.string(),
      iconicMotif: v.string(),
      worksInSpace: v.array(v.string()),
      avoidInSpace: v.array(v.string()),
      activeCrew: v.array(v.string()),
      directorDoctrine: v.optional(v.string()),
      dpDoctrine: v.optional(v.string()),
      editorDoctrine: v.optional(v.string()),
      composerDoctrine: v.optional(v.string()),
      criticDoctrine: v.optional(v.string()),
      refreshedAt: v.number(),
    }),
  ),
});

// "banana" = the engine (src/lib/banana.ts); "title_card" = explicit operator
// choice; "renderer_native" = a local media-renderer still. claude_flux/
// ideogram are retired engines kept for existing rows.
const thumbnailerValidator = v.union(
  v.literal("banana"),
  v.literal("title_card"),
  v.literal("renderer_native"),
  v.literal("claude_flux"),
  v.literal("ideogram"),
);

const pipelineValidator = v.array(
  v.object({
    block: v.string(),
    params: v.optional(v.any()),
  }),
);

/**
 * Validate ONE module's operator config (`{ preset?, ...knobValues }`) against
 * its CustomizationSurface. Returns the cleaned config (preset preserved,
 * knob values defaulted/validated) or throws on illegal preset/value — so no
 * silent bad config is ever written. Unknown blockId (no surface) ⇒ rejected.
 */
function validateModuleConfig(
  blockId: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const surface = moduleSurface(blockId);
  if (!surface) throw new Error(`setModuleConfig: unknown/non-configurable module '${blockId}'`);

  const { preset, ...rest } = config as { preset?: unknown } & Record<string, unknown>;
  if (preset !== undefined) {
    if (typeof preset !== "string" || !(preset in surface.presets)) {
      throw new Error(`setModuleConfig: '${blockId}' has no preset '${String(preset)}'`);
    }
  }
  // Only knob-typed scalars are validatable; reject anything else loudly.
  const knobValues: KnobValues = {};
  for (const [k, val] of Object.entries(rest)) {
    if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
      knobValues[k] = val as KnobValue;
    } else {
      throw new Error(`setModuleConfig: '${blockId}.${k}' is not a scalar knob value`);
    }
  }
  const r = validateKnobs(surface, knobValues);
  if (!r.ok) throw new Error(`setModuleConfig: '${blockId}' invalid — ${r.errors.join("; ")}`);

  // Store ONLY the operator's explicit choices (preset + overrides), not the
  // full defaulted bag — resolveKnobs re-applies defaults at read time.
  const cleaned: Record<string, unknown> = {};
  if (typeof preset === "string") cleaned.preset = preset;
  for (const k of Object.keys(knobValues)) cleaned[k] = knobValues[k];
  return cleaned;
}

/** Validate a whole `moduleConfig` map; drops blocks that aren't configurable. */
function validateModuleConfigMap(
  map: Record<string, unknown> | undefined,
  activeBlockIds?: readonly string[],
): Record<string, unknown> | undefined {
  if (!map) return undefined;
  const configurable = new Set(configurableModules().map((m) => m.blockId));
  const active = activeBlockIds ? new Set(activeBlockIds) : undefined;
  const out: Record<string, unknown> = {};
  for (const [blockId, cfg] of Object.entries(map)) {
    if (!configurable.has(blockId)) continue; // ignore stale/unknown blocks silently
    if (active && !active.has(blockId)) {
      throw new Error(`moduleConfig: '${blockId}' is not selected in this channel pipeline`);
    }
    if (cfg && typeof cfg === "object") {
      out[blockId] = validateModuleConfig(blockId, cfg as Record<string, unknown>);
    }
  }
  return Object.keys(out).length ? out : undefined;
}

export const createChannel = mutation({
  args: {
    ownerId: v.string(),
    slug: v.string(),
    name: v.string(),
    identity: identityValidator,
    thumbnailer: v.optional(thumbnailerValidator),
    template: v.string(),
    pipeline: pipelineValidator,
    modelRouting: v.optional(v.any()),
    learningPolicyVersion: v.optional(v.number()),
    qaRubric: v.optional(v.any()),
    styleDNA: v.optional(v.any()),
    // Initial per-module operator config from the onboarding "Pipeline style"
    // step: { [blockId]: { preset?, ...knobValues } }. Validated per block
    // against its CustomizationSurface (illegal config dropped, never stored).
    moduleConfig: v.optional(v.record(v.string(), v.any())),
    // SINGLE SOURCE OF FAMILY TRUTH: persisted at creation so the architect/
    // doctor/re-architect never re-derive it from template letters (the old
    // template→family guess collapsed whiteboard/shorts into narrated_stock).
    family: v.optional(v.string()),
    // A sibling/import may supply its inherited lock, but the mutation always
    // re-derives and verifies it against the pipeline before persisting.
    contentLane: v.optional(contentLaneValidator),
    // Operator hard rail: wizard-disabled blocks the architect may NEVER
    // re-add — persisted so every later architect pass can honor it.
    disabledBlocks: v.optional(v.array(v.string())),
    budget: v.number(),
    status: v.optional(v.string()),
    groupId: v.optional(v.string()),
    language: v.optional(v.string()),
    groupRole: v.optional(v.string()),
  },
  returns: v.id("channels"),
  handler: async (ctx, args) => {
    // Idempotent upsert keyed on (ownerId, slug): a re-seed of the same
    // channel patches the existing doc instead of inserting a duplicate
    // (the prior bare-insert was the source of duplicate channels).
    const existing = await ctx.db
      .query("channels")
      .withIndex("by_owner_slug", (q) =>
        q.eq("ownerId", args.ownerId).eq("slug", args.slug),
      )
      .unique();

    const existingLane = existing ? channelContentLane(existing) : undefined;
    if (existing?.family !== undefined && args.family !== undefined && args.family !== existing.family) {
      throw new Error(
        `channel family is locked to ${existing.family}; use an explicit lane migration to change it`,
      );
    }
    const family = args.family ?? existing?.family;
    const lane = resolveContentLane({
      stored: existingLane,
      family,
      pipeline: args.pipeline,
    });
    assertContentLaneMatchesFamily(lane, family);
    assertPipelineMatchesContentLane(lane, args.pipeline);
    assertMinimumVideoFoundationForAutomaticFamily({
      family: family ?? lane.family,
      contentLane: lane,
      pipeline: args.pipeline,
    });
    assertProgramBriefIdentityMutation({
      existingIdentity: existing?.identity,
      nextIdentity: args.identity,
      effectiveFamily: family ?? lane.family,
      nextPipeline: args.pipeline,
      allowFirstShowProfile: !existing,
    });
    if (args.styleDNA !== undefined) {
      assertStyleDNAAdmissionSafety(args.styleDNA, { context: "channel creation styleDNA" });
    }
    if (
      args.contentLane !== undefined &&
      contentLaneFingerprint(parseContentLane(args.contentLane)) !== contentLaneFingerprint(lane)
    ) {
      throw new Error("supplied content lane does not match the channel's immutable family/pipeline lane");
    }

    const doc = {
      ownerId: args.ownerId,
      slug: args.slug,
      name: args.name,
      identity: args.identity,
      thumbnailer: args.thumbnailer,
      template: args.template,
      pipeline: args.pipeline,
      modelRouting: args.modelRouting,
      qaRubric: args.qaRubric,
      styleDNA: args.styleDNA,
      // Validate the onboarding-supplied module config (illegal → throws).
      moduleConfig: validateModuleConfigMap(args.moduleConfig, args.pipeline.map((entry) => entry.block)),
      family,
      contentLane: lane,
      disabledBlocks: args.disabledBlocks ?? existing?.disabledBlocks,
      budget: args.budget,
      status: args.status ?? "draft",
      groupId: args.groupId,
      language: args.language,
      groupRole: args.groupRole,
    };

    if (existing) {
      // LOCK GUARD: a re-seed of a finished channel must not rewrite it. The
      // doc lands on its editable fork head instead and we return THAT id, so
      // the caller transparently keeps working against the live version.
      const outcome = await patchChannelRespectingLock(ctx, existing._id, doc);
      return outcome.forked ? outcome.newChannelId : existing._id;
    }

    return await ctx.db.insert("channels", doc);
  },
});

/**
 * MIGRATION (additive, idempotent): make a legacy channel's IMPLICIT family
 * EXPLICIT. It writes `family` + `contentLane` and nothing else.
 *
 * Channels created before `family` was persisted work today only because
 * `inferContentLane` happens to find exactly ONE known visual producer in their
 * stored pipeline. A later pipeline edit that adds or swaps a renderer would
 * make that inference ambiguous and silently drop the channel into
 * `legacy_unclassified` — losing its style lock with no warning. This freezes
 * the lane the runtime ALREADY resolves for the channel.
 *
 * Deliberately narrow, because it runs against live channels:
 *   - Never overwrites an existing `family`; an already-classified channel is
 *     reported back untouched rather than re-labelled.
 *   - Re-derives the lane from the channel's OWN stored pipeline and REFUSES
 *     any family whose lane differs from the one resolved today, so the write
 *     cannot change runtime behaviour — it can only make it explicit.
 *   - Re-asserts the stored pipeline against the lane contract before freezing.
 *   - Idempotent: re-running on a backfilled channel is a reported no-op.
 */
export const backfillChannelFamily = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    family: v.string(),
  },
  returns: v.object({
    changed: v.boolean(),
    reason: v.string(),
    family: v.optional(v.string()),
    contentLane: v.optional(contentLaneValidator),
  }),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "channel family backfill");

    const channel = await ctx.db.get(args.channelId);
    if (!channel) throw new Error("channel not found");
    assertChannelWritable(channel, "family backfill");

    // Defensive: this migration only ever fills a hole. It must not relabel a
    // channel whose family is already known (the 4 wizard-created channels).
    if (channel.family !== undefined && channel.family !== null) {
      return {
        changed: false,
        reason:
          channel.family === args.family
            ? `no-op: family already set to ${channel.family}`
            : `refused: family already set to ${channel.family}; will not overwrite with ${args.family}`,
        family: channel.family,
        contentLane: channel.contentLane,
      };
    }

    const pipeline = Array.isArray(channel.pipeline) ? channel.pipeline : [];
    // Exactly what runPipeline resolves for this channel right now (no family).
    const currentLane = resolveContentLane({ stored: channel.contentLane, pipeline });
    const requestedLane = contentLaneForFamily(args.family);
    if (!requestedLane) throw new Error(`unknown family: ${args.family}`);
    if (requestedLane.key !== currentLane.key) {
      throw new Error(
        `refusing backfill: family ${args.family} implies lane ${requestedLane.key}, ` +
          `but this channel currently resolves to ${currentLane.key}`,
      );
    }
    assertPipelineMatchesContentLane(requestedLane, pipeline);

    await ctx.db.patch(args.channelId, { family: args.family, contentLane: requestedLane });
    return {
      changed: true,
      reason: `backfilled implicit lane ${currentLane.key} as explicit family ${args.family}`,
      family: args.family,
      contentLane: requestedLane,
    };
  },
});

/**
 * Resolve a channel by (ownerId, slug) via the by_owner_slug index.
 * Powers the /channels/[slug] detail route.
 */
export const getChannelBySlug = query({
  args: { ownerId: v.string(), slug: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("channels")
      .withIndex("by_owner_slug", (q) =>
        q.eq("ownerId", args.ownerId).eq("slug", args.slug),
      )
      .unique();
  },
});

export const listChannels = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("channels")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();
  },
});

/**
 * Bounded card projection. It summarizes the latest 20 runs independently per
 * channel and only accepts thumbnail provenance from a successful or uploaded
 * run, avoiding the Library's heavier metadata joins and failed-run artwork.
 */
export const listChannelCards = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    const channels = await ctx.db
      .query("channels")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();

    return await Promise.all(channels.map((channel) => projectChannelCard(ctx, channel)));
  },
});

/** One-channel projection for detail routes; avoids subscribing to the whole fleet. */
export const getChannelCard = query({
  args: { ownerId: v.string(), channelId: v.id("channels") },
  handler: async (ctx, args) => {
    const channel = await ctx.db.get(args.channelId);
    if (!channel || channel.ownerId !== args.ownerId) return null;
    return await projectChannelCard(ctx, channel);
  },
});

export const getChannel = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.channelId);
  },
});

/**
 * Hard-delete a channel doc. Used by the dedupe-channels maintenance script
 * after its runs have been repointed onto the kept channel.
 */
export const deleteChannel = mutation({
  args: { channelId: v.id("channels") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ch = await ctx.db.get(args.channelId);
    if (!ch) return null;
    // LOCK GUARD: a delete has no "apply the change to a v2" reading — forking
    // here would silently keep the row the caller asked to destroy. Block it;
    // the operator must unlock deliberately first.
    assertChannelWritable(ch, "deleteChannel");

    // 1. TOMBSTONE: a compact structural print (identity/pipeline/DNA/playbook
    // shapes — never run data or media) survives as the only residue.
    const compact = {
      name: ch.name,
      slug: ch.slug,
      template: ch.template,
      folder: ch.folder,
      identity: ch.identity,
      pipeline: ch.pipeline,
      schedule: ch.schedule,
      styleDNA: ch.styleDNA,
      architectReport: ch.architectReport
        ? { summary: (ch.architectReport as { summary?: string }).summary, applied: (ch.architectReport as { applied?: unknown[] }).applied }
        : undefined,
      thumbnailPlaybook: ch.thumbnailPlaybook
        ? { rules: (ch.thumbnailPlaybook as { rules?: unknown }).rules, patterns: (ch.thumbnailPlaybook as { patterns?: unknown }).patterns }
        : undefined,
      scriptPlaybook: ch.scriptPlaybook
        ? {
            hookRules: (ch.scriptPlaybook as { hookRules?: unknown }).hookRules,
            openingDevices: (ch.scriptPlaybook as { openingDevices?: unknown }).openingDevices,
            voiceRules: (ch.scriptPlaybook as { voiceRules?: unknown }).voiceRules,
          }
        : undefined,
      youtubeCreated: ch.youtubeCreated,
    };
    let snapshot = JSON.stringify(compact);
    if (snapshot.length > 60_000) {
      snapshot = JSON.stringify({ ...compact, styleDNA: undefined, thumbnailPlaybook: undefined, scriptPlaybook: undefined });
    }
    await ctx.db.insert("channelArchives", {
      ownerId: ch.ownerId,
      slug: ch.slug,
      name: ch.name,
      archivedAt: Date.now(),
      snapshot,
    });

    // 2. CASCADE: remove every row that references the channel — runs and
    // their stages/logs/assets, plan, topic memory, analytics, the YT link.
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .collect();
    for (const r of runs) {
      for (const s of await ctx.db.query("runStages").withIndex("by_run", (q) => q.eq("runId", r._id)).collect()) {
        await ctx.db.delete(s._id);
      }
      for (const lg of await ctx.db.query("runLogs").withIndex("by_run", (q) => q.eq("runId", r._id)).collect()) {
        await ctx.db.delete(lg._id);
      }
      await ctx.db.delete(r._id);
    }
    const sweep = async (table: "assets" | "topicMemory" | "videoAnalytics" | "videoReleaseProvenance" | "channelAnalytics" | "contentPlan" | "youtubeAuth", index: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await (ctx.db.query(table as any) as any)
        .withIndex(index, (q: { eq: (f: string, v: unknown) => unknown }) => q.eq("channelId", args.channelId))
        .collect();
      for (const row of rows as { _id: Parameters<typeof ctx.db.delete>[0] }[]) await ctx.db.delete(row._id);
    };
    await sweep("assets", "by_channel");
    await sweep("topicMemory", "by_channel");
    await sweep("videoAnalytics", "by_channel");
    await sweep("videoReleaseProvenance", "by_channel");
    await sweep("channelAnalytics", "by_channel_date");
    await sweep("contentPlan", "by_channel_order");
    await sweep("youtubeAuth", "by_channel");

    await ctx.db.delete(args.channelId);
    return null;
  },
});

export const updateChannel = mutation({
  args: {
    channelId: v.id("channels"),
    name: v.optional(v.string()),
    identity: v.optional(identityValidator),
    thumbnailer: v.optional(thumbnailerValidator),
    template: v.optional(v.string()),
    pipeline: v.optional(pipelineValidator),
    modelRouting: v.optional(v.any()),
    qaRubric: v.optional(v.any()),
    styleDNA: v.optional(v.any()),
    architectReport: v.optional(v.any()),
    family: v.optional(v.string()),
    disabledBlocks: v.optional(v.array(v.string())),
    // Strictly opt-in automatic Casefile case research. No sealed Program
    // Route currently admits this autonomous spend path, so enable requests
    // are rejected in the handler below until one is registered deliberately.
    casefileAutoResearchEnabled: v.optional(v.boolean()),
    thumbnailPlaybook: v.optional(v.any()),
    scriptPlaybook: v.optional(v.any()),
    // Folder filing ("" = unfile).
    folder: v.optional(v.string()),
    budget: v.optional(v.number()),
    status: v.optional(v.string()),
    schedule: v.optional(
      v.object({
        frequency: v.string(),
        days: v.optional(v.array(v.number())),
        timezone: v.optional(v.string()),
        localTime: v.optional(v.string()),
        enabled: v.optional(v.boolean()),
        approvalMode: v.optional(
          v.union(v.literal("manual"), v.literal("private_auto")),
        ),
        dailyQuota: v.optional(v.number()),
        maxConcurrent: v.optional(v.number()),
        retryMaxAttempts: v.optional(v.number()),
        retryBaseMinutes: v.optional(v.number()),
        madeForKids: v.optional(v.boolean()),
      }),
    ),
    groupId: v.optional(v.string()),
    language: v.optional(v.string()),
    groupRole: v.optional(v.string()),
    youtubeCreated: v.optional(
      v.object({
        ytChannelId: v.optional(v.string()),
        handle: v.optional(v.string()),
        url: v.optional(v.string()),
        createdAt: v.number(),
        status: v.optional(v.string()),
        avatarSet: v.optional(v.boolean()),
      }),
    ),
  },
  // A locked channel is never edited in place: the change is forked onto a v2
  // row and its id is returned so callers can see the redirect.
  returns: v.union(
    v.object({ forked: v.literal(false) }),
    v.object({ forked: v.literal(true), newChannelId: v.id("channels") }),
  ),
  handler: async (ctx, args) => {
    const { channelId, ...rest } = args;
    const existing = await ctx.db.get(channelId);
    if (!existing) throw new Error(`channel not found: ${channelId}`);
    if (rest.family !== undefined && rest.family !== existing.family && existing.family !== undefined) {
      throw new Error(
        `channel family is locked to ${existing.family}; use an explicit lane migration to change it`,
      );
    }
    const lane = channelContentLane(existing);
    // SPEND GUARD (write time, not dispatch time). Casefile's current route
    // is private-review/manual only: no sealed channel Program Route binds
    // autonomous real-case sourcing and dispatch. Refuse every enable until a
    // dedicated route is registered; turning the flag OFF remains permitted.
    if (rest.casefileAutoResearchEnabled === true) {
      throw new Error(
        "casefileAutoResearchEnabled cannot be enabled: no sealed channel Program Route currently " +
          "admits autonomous Casefile research. Use the private-review Casefile workflow instead.",
      );
    }
    const nextFamily = rest.family ?? existing.family;
    assertContentLaneMatchesFamily(lane, nextFamily);
    assertPipelineMatchesContentLane(lane, rest.pipeline ?? existing.pipeline);
    if (rest.pipeline !== undefined) {
      assertMinimumVideoFoundationForAutomaticFamily({
        family: nextFamily ?? lane.family,
        contentLane: lane,
        pipeline: rest.pipeline,
      });
    }
    assertProgramBriefIdentityMutation({
      existingIdentity: existing.identity,
      nextIdentity: rest.identity ?? existing.identity,
      effectiveFamily: nextFamily ?? lane.family,
      nextPipeline: rest.pipeline ?? existing.pipeline,
      allowFirstShowProfile: false,
    });
    // Apply this only to an incoming DNA patch.  Historical rows can remain
    // readable until an operator deliberately re-grounds them; a generic
    // update must never rewrite or reinterpret their persisted payload.
    if (rest.styleDNA !== undefined) {
      assertStyleDNAAdmissionSafety(rest.styleDNA, { context: "channel update styleDNA" });
    }
    const patch: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(rest)) {
      if (val !== undefined) patch[k] = val;
    }
    // Opportunistically migrate legacy rows to an explicit lock whenever they
    // are touched. This is a no-op for already locked channels.
    patch.contentLane = lane;
    // "" means UNFILE (optional args can't carry null).
    if (rest.folder === "") patch.folder = undefined;
    const roots = channelInceptionInvalidationRoots(existing, { ...existing, ...patch });
    if (roots.length > 0) {
      const invalidated = invalidatePersistedInceptionProofs(
        existing.inception,
        roots,
        await channelMutationRole(ctx),
      );
      if (invalidated) {
        patch.inception = invalidated;
        patch.status = "draft";
      }
    }
    // LOCK GUARD: forks onto a v2 row when this channel is marked done.
    const outcome = await patchChannelRespectingLock(ctx, channelId, patch);
    return outcome.forked
      ? { forked: true as const, newChannelId: outcome.newChannelId }
      : { forked: false as const };
  },
});

/**
 * Atomically install a compiler upgrade only if the channel still contains
 * the source pipeline the caller inspected. This prevents a background sync
 * from overwriting a newer architect/operator edit between read and write.
 */
export const updatePipelineIfCurrent = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    expectedPipeline: pipelineValidator,
    pipeline: pipelineValidator,
  },
  returns: v.object({
    state: v.union(
      v.literal("updated"),
      v.literal("current"),
      v.literal("conflict"),
      // The channel was locked: the upgrade landed on its v2 fork instead.
      v.literal("forked"),
    ),
    newChannelId: v.optional(v.id("channels")),
  }),
  handler: async (ctx, args) => {
    const channel = await ctx.db.get(args.channelId);
    if (!channel || channel.ownerId !== args.ownerId) {
      throw new Error("channel pipeline CAS ownership mismatch");
    }
    const current = channel.pipeline ?? [];
    if (comparablePipeline(current) !== comparablePipeline(args.expectedPipeline)) {
      return { state: "conflict" as const };
    }
    if (comparablePipeline(current) === comparablePipeline(args.pipeline)) {
      return { state: "current" as const };
    }
    const lane = channelContentLane(channel);
    assertPipelineMatchesContentLane(lane, args.pipeline);
    assertMinimumVideoFoundationForAutomaticFamily({
      family: channel.family ?? lane.family,
      contentLane: lane,
      pipeline: args.pipeline,
    });
    if (channel.identity?.showProfile) {
      const programBrief = assertPersistedProgramBriefIdentity(channel.identity, {
        context: "channel pipeline upgrade identity",
        requireProgramBrief: true,
      });
      assertChannelShowProfileReceiptPipelineCompatibility({
        profile: channel.identity.showProfile,
        programBrief,
        pipeline: args.pipeline,
      });
    }
    const patch: Record<string, unknown> = { pipeline: args.pipeline, contentLane: lane };
    const invalidated = invalidatePersistedInceptionProofs(
      channel.inception,
      channelInceptionInvalidationRoots(channel, { ...channel, ...patch }),
      await channelMutationRole(ctx),
    );
    if (invalidated) {
      patch.inception = invalidated;
      patch.status = "draft";
    }
    // LOCK GUARD: forks onto a v2 row when this channel is marked done.
    const outcome = await patchChannelRespectingLock(ctx, args.channelId, patch);
    if (outcome.forked) {
      return { state: "forked" as const, newChannelId: outcome.newChannelId };
    }
    return { state: "updated" as const };
  },
});

const inceptionStageDescriptorValidator = v.object({
  moduleKey: v.string(),
  dependsOn: v.array(v.string()),
  stageKey: v.string(),
  idempotencyKey: v.string(),
  inputFingerprint: v.string(),
  contractVersion: v.string(),
  maximumCostUsd: v.number(),
});

const inceptionAdmissionValidator = v.object({
  executionAuthorized: v.boolean(),
  executionCapUsd: v.number(),
  executionReceiptFingerprint: v.optional(v.string()),
  probeAuthorized: v.boolean(),
  probeCapUsd: v.number(),
  probeReceiptFingerprint: v.optional(v.string()),
  boundRequestFingerprint: v.string(),
});

/** Install/refresh the latest plan while retaining receipts for unchanged stage keys. */
export const beginChannelInception = mutation({
  args: {
    channelId: v.id("channels"),
    schemaVersion: v.string(),
    planKey: v.string(),
    requestFingerprint: v.string(),
    requestSnapshot: v.any(),
    admission: inceptionAdmissionValidator,
    stages: v.array(inceptionStageDescriptorValidator),
  },
  handler: async (ctx, args) => {
    await requireInceptionService(ctx);
    if (!args.schemaVersion.trim() || args.schemaVersion.length > 64) {
      throw new Error("invalid channel inception schema version");
    }
    if (!args.planKey.trim() || args.planKey.length > 240) throw new Error("invalid channel inception plan key");
    if (!/^[a-f0-9]{64}$/.test(args.requestFingerprint)) {
      throw new Error("invalid channel inception request fingerprint");
    }
    assertInceptionOutputSize(args.requestSnapshot);
    if (
      !Number.isFinite(args.admission.executionCapUsd) ||
      args.admission.executionCapUsd < 0 ||
      args.admission.executionCapUsd > 100 ||
      !Number.isFinite(args.admission.probeCapUsd) ||
      args.admission.probeCapUsd < 0 ||
      args.admission.probeCapUsd > 100
    ) {
      throw new Error("invalid channel inception admission cost cap");
    }
    if (args.admission.boundRequestFingerprint !== args.requestFingerprint) {
      throw new Error("channel inception admission is not bound to this request");
    }
    if (!args.stages.length || args.stages.length > MAX_INCEPTION_STAGES) {
      throw new Error(`channel inception requires 1-${MAX_INCEPTION_STAGES} planned stages`);
    }
    if (new Set(args.stages.map((stage) => stage.moduleKey)).size !== args.stages.length) {
      throw new Error("channel inception plan contains duplicate modules");
    }
    for (const stage of args.stages) assertInceptionStageDescriptor(stage as ChannelInceptionStageDescriptor);
    const channel = await ctx.db.get(args.channelId);
    if (!channel) throw new Error(`channel not found: ${args.channelId}`);
    // LOCK GUARD (block, do NOT fork). The inception ledger is a mid-flight
    // service state machine keyed on THIS channelId — the orchestrator holds it
    // across begin/claim/checkpoint/heartbeat/complete. Forking would copy the
    // channel on every ledger write while the service kept re-targeting the
    // locked parent, spawning unbounded rows and orphaning live leases. A
    // finished channel has no inception left to run, so refusing is correct.
    assertChannelWritable(channel, "channel inception ledger write");
    const inception = beginChannelInceptionLedger(
      channel.inception as ChannelInceptionLedgerState | undefined,
      {
        schemaVersion: args.schemaVersion,
        inceptionKey: args.planKey,
        requestFingerprint: args.requestFingerprint,
        requestSnapshot: args.requestSnapshot,
        admission: args.admission,
        stages: args.stages as ChannelInceptionStageDescriptor[],
      },
      Date.now(),
    );
    await ctx.db.patch(args.channelId, { inception });
    return inception;
  },
});

/** Atomically claim one content-addressed inception stage. */
export const claimChannelInceptionStage = mutation({
  args: {
    channelId: v.id("channels"),
    stage: inceptionStageDescriptorValidator,
    claimant: v.string(),
    leaseMs: v.number(),
    maximumAttempts: v.number(),
    observedOutputFingerprint: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireInceptionService(ctx);
    assertInceptionStageDescriptor(args.stage as ChannelInceptionStageDescriptor);
    const channel = await ctx.db.get(args.channelId);
    if (!channel?.inception) throw new Error("channel inception plan is not initialized");
    // LOCK GUARD (block, not fork) — see beginChannelInception for why.
    assertChannelWritable(channel, "channel inception ledger write");
    const claim = claimChannelInceptionLedgerStage({
      ledger: channel.inception as ChannelInceptionLedgerState,
      stage: args.stage as ChannelInceptionStageDescriptor,
      claimant: args.claimant,
      now: Date.now(),
      leaseMs: args.leaseMs,
      maximumAttempts: args.maximumAttempts,
      observedOutputFingerprint: args.observedOutputFingerprint,
    });
    await ctx.db.patch(args.channelId, { inception: claim.ledger });
    return {
      disposition: claim.disposition,
      outputs: claim.stage.outputs,
      status: claim.stage.status,
      attempts: claim.stage.attempts,
      leaseVersion: claim.stage.leaseVersion,
      leaseExpiresAt: claim.stage.leaseExpiresAt,
      executionPhase: claim.stage.executionPhase,
    };
  },
});

/** Complete only the exact stage lease held by this task attempt. */
export const completeChannelInceptionStage = mutation({
  args: {
    channelId: v.id("channels"),
    stage: inceptionStageDescriptorValidator,
    claimant: v.string(),
    leaseVersion: v.number(),
    status: v.union(v.literal("accepted"), v.literal("complete"), v.literal("blocked")),
    outputFingerprint: v.string(),
    outputs: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await requireInceptionService(ctx);
    assertInceptionStageDescriptor(args.stage as ChannelInceptionStageDescriptor);
    assertInceptionOutputSize(args.outputs);
    const channel = await ctx.db.get(args.channelId);
    if (!channel?.inception) throw new Error("channel inception plan is not initialized");
    // LOCK GUARD (block, not fork) — see beginChannelInception for why.
    assertChannelWritable(channel, "channel inception ledger write");
    const inception = completeChannelInceptionLedgerStage({
      ledger: channel.inception as ChannelInceptionLedgerState,
      stage: args.stage as ChannelInceptionStageDescriptor,
      claimant: args.claimant,
      leaseVersion: args.leaseVersion,
      status: args.status,
      outputs: args.outputs,
      outputFingerprint: args.outputFingerprint,
      now: Date.now(),
    });
    await ctx.db.patch(args.channelId, { inception });
    return inception.stages[args.stage.moduleKey];
  },
});

/** Persist a resumable provider/checkpoint receipt while retaining the lease. */
export const checkpointChannelInceptionStage = mutation({
  args: {
    channelId: v.id("channels"),
    stage: inceptionStageDescriptorValidator,
    claimant: v.string(),
    leaseVersion: v.number(),
    outputs: v.any(),
    executionPhase: v.optional(
      v.union(v.literal("claimed"), v.literal("provider-started")),
    ),
  },
  handler: async (ctx, args) => {
    await requireInceptionService(ctx);
    assertInceptionStageDescriptor(args.stage as ChannelInceptionStageDescriptor);
    assertInceptionOutputSize(args.outputs);
    const channel = await ctx.db.get(args.channelId);
    if (!channel?.inception) throw new Error("channel inception plan is not initialized");
    // LOCK GUARD (block, not fork) — see beginChannelInception for why.
    assertChannelWritable(channel, "channel inception ledger write");
    const inception = checkpointChannelInceptionLedgerStage({
      ledger: channel.inception as ChannelInceptionLedgerState,
      stage: args.stage as ChannelInceptionStageDescriptor,
      claimant: args.claimant,
      leaseVersion: args.leaseVersion,
      outputs: args.outputs,
      executionPhase: args.executionPhase,
      now: Date.now(),
    });
    await ctx.db.patch(args.channelId, { inception });
    return inception.stages[args.stage.moduleKey];
  },
});

/** Renew a long-running provider stage without changing its checkpoint. */
export const heartbeatChannelInceptionStage = mutation({
  args: {
    channelId: v.id("channels"),
    stage: inceptionStageDescriptorValidator,
    claimant: v.string(),
    leaseVersion: v.number(),
    leaseMs: v.number(),
  },
  handler: async (ctx, args) => {
    await requireInceptionService(ctx);
    assertInceptionStageDescriptor(args.stage as ChannelInceptionStageDescriptor);
    const channel = await ctx.db.get(args.channelId);
    if (!channel?.inception) throw new Error("channel inception plan is not initialized");
    // LOCK GUARD (block, not fork) — see beginChannelInception for why.
    assertChannelWritable(channel, "channel inception ledger write");
    const inception = heartbeatChannelInceptionLedgerStage({
      ledger: channel.inception as ChannelInceptionLedgerState,
      stage: args.stage as ChannelInceptionStageDescriptor,
      claimant: args.claimant,
      leaseVersion: args.leaseVersion,
      leaseMs: args.leaseMs,
      now: Date.now(),
    });
    await ctx.db.patch(args.channelId, { inception });
    return inception.stages[args.stage.moduleKey];
  },
});

/** Release a failed lease so an admitted Trigger retry can resume this stage. */
export const failChannelInceptionStage = mutation({
  args: {
    channelId: v.id("channels"),
    stage: inceptionStageDescriptorValidator,
    claimant: v.string(),
    leaseVersion: v.number(),
    error: v.string(),
    retryable: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireInceptionService(ctx);
    assertInceptionStageDescriptor(args.stage as ChannelInceptionStageDescriptor);
    const channel = await ctx.db.get(args.channelId);
    if (!channel?.inception) throw new Error("channel inception plan is not initialized");
    // LOCK GUARD (block, not fork) — see beginChannelInception for why.
    assertChannelWritable(channel, "channel inception ledger write");
    const inception = failChannelInceptionLedgerStage({
      ledger: channel.inception as ChannelInceptionLedgerState,
      stage: args.stage as ChannelInceptionStageDescriptor,
      claimant: args.claimant,
      leaseVersion: args.leaseVersion,
      error: args.error,
      retryable: args.retryable,
      now: Date.now(),
    });
    await ctx.db.patch(args.channelId, { inception });
    return inception.stages[args.stage.moduleKey];
  },
});

/**
 * Set ONE module's operator config on a channel. Validates `config`
 * (`{ preset?, ...knobValues }`) against the module's CustomizationSurface via
 * validateKnobs BEFORE writing — an illegal preset/knob throws and nothing is
 * persisted (no silent bad config). Powers the Settings "Pipeline modules"
 * section ("toggle captions with a click") + the onboarding step.
 *
 * Pass an empty object (`{}`) to reset the block to module defaults (the entry
 * is removed from moduleConfig, so resolveKnobs falls back to its preset/defaults).
 */
export const setModuleConfig = mutation({
  args: {
    channelId: v.id("channels"),
    blockId: v.string(),
    config: v.record(v.string(), v.any()),
  },
  // A locked channel is never edited in place: the change is forked onto a v2.
  returns: v.union(
    v.object({ forked: v.literal(false) }),
    v.object({ forked: v.literal(true), newChannelId: v.id("channels") }),
  ),
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.channelId);
    if (!existing) throw new Error(`channel not found: ${args.channelId}`);
    if (!(existing.pipeline ?? []).some((entry) => entry.block === args.blockId)) {
      throw new Error(`setModuleConfig: '${args.blockId}' is not selected in this channel pipeline`);
    }

    const next: Record<string, unknown> = { ...(existing.moduleConfig ?? {}) };
    const cleaned = validateModuleConfig(args.blockId, args.config); // throws on illegal
    if (Object.keys(cleaned).length === 0) {
      delete next[args.blockId]; // reset → fall back to defaults at read time
    } else {
      next[args.blockId] = cleaned;
    }
    const patch: Record<string, unknown> = {
      moduleConfig: Object.keys(next).length ? next : undefined,
    };
    if (JSON.stringify(existing.moduleConfig ?? {}) !== JSON.stringify(next)) {
      const invalidated = invalidatePersistedInceptionProofs(
        existing.inception,
        channelInceptionInvalidationRoots(existing, { ...existing, ...patch }),
        await channelMutationRole(ctx),
      );
      if (invalidated) {
        patch.inception = invalidated;
        patch.status = "draft";
      }
    }
    // LOCK GUARD: forks onto a v2 row when this channel is marked done.
    const outcome = await patchChannelRespectingLock(ctx, args.channelId, patch);
    return outcome.forked
      ? { forked: true as const, newChannelId: outcome.newChannelId }
      : { forked: false as const };
  },
});

/**
 * Mark a channel DONE. Explicit and manual — nothing auto-detects "finished".
 * From here every guarded write forks onto a v2 instead of touching this row.
 *
 * Operator-only (see requireChannelOwnerActor): no scheduled task, Trigger job,
 * or agent can reach it, and the same is true of unlockChannel below, keeping
 * lock and unlock symmetric.
 */
export const lockChannel = mutation({
  args: { ownerId: v.string(), channelId: v.id("channels") },
  returns: v.object({
    locked: v.literal(true),
    lockedAt: v.number(),
    lockedBy: v.string(),
    versionNumber: v.number(),
  }),
  handler: async (ctx, args) => {
    const actor = await requireChannelOwnerActor(ctx, "channels.lockChannel");
    const channel = await ctx.db.get(args.channelId);
    if (!channel || channel.ownerId !== args.ownerId) {
      throw new Error("channel lock ownership mismatch");
    }
    const versionNumber = channel.versionNumber ?? 1;
    if (isChannelLocked(channel)) {
      // Idempotent: re-locking keeps the original provenance.
      return {
        locked: true as const,
        lockedAt: channel.lockedAt ?? 0,
        lockedBy: channel.lockedBy ?? actor,
        versionNumber,
      };
    }
    const lockedAt = Date.now();
    await ctx.db.patch(args.channelId, {
      locked: true,
      lockedAt,
      lockedBy: actor,
      versionNumber,
    });
    return { locked: true as const, lockedAt, lockedBy: actor, versionNumber };
  },
});

/**
 * Release a channel lock. HUMAN-ONLY by construction — it needs both an
 * interactive "owner" identity (every automated caller authenticates as
 * "service") and the literal typed confirmation, so no scheduled/agent code
 * path can unlock a finished channel even by accident.
 */
export const unlockChannel = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    confirmation: v.string(),
  },
  returns: v.object({ locked: v.literal(false) }),
  handler: async (ctx, args) => {
    await requireChannelOwnerActor(ctx, "channels.unlockChannel");
    if (args.confirmation !== CHANNEL_UNLOCK_CONFIRMATION) {
      throw new Error(
        `channels.unlockChannel requires confirmation '${CHANNEL_UNLOCK_CONFIRMATION}'`,
      );
    }
    const channel = await ctx.db.get(args.channelId);
    if (!channel || channel.ownerId !== args.ownerId) {
      throw new Error("channel unlock ownership mismatch");
    }
    await ctx.db.patch(args.channelId, {
      locked: false,
      lockedAt: undefined,
      lockedBy: undefined,
    });
    return { locked: false as const };
  },
});

/** All channels in a multi-language group (base + siblings), for the group UI. */
export const listGroup = query({
  args: { groupId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("channels")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
  },
});
