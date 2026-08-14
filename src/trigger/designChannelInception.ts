import { admitProviderTaskOwner } from "@/lib/providerTaskOwnerAdmission";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { synthChannelConcept } from "@/lib/conceptSynth";
import { generateChannelArtAsset } from "@/lib/channelArt";
import { designPipeline, enforceLengthContract, type DesignOptions } from "@/engine/designer";
import type { PipelineEntry } from "@/engine/types";
import {
  FAMILIES,
  familyProductionReadiness,
  productionReadyFamilyFallback,
  type FamilyKey,
} from "@/engine/families";
import { getArchetype } from "@/engine/archetypes";
import { getNiche } from "@/lib/nicheCatalog";
import { refreshNicheResearchCore } from "@/lib/nicheResearch";
import {
  channelResearchEvidenceFingerprint,
  validateChannelResearchEvidence,
  type ChannelResearchEvidence,
} from "@/lib/channelResearchEvidence";
import { optimizeTopics } from "@/lib/topicOptimizer";
import { channelPrefix, headObjectMetadata } from "@/lib/storage";
import {
  planWeekArtifactHeadMatches,
  type PlanWeekArtifactReceipt,
  type PlanWeekProviderRenderReceipt,
} from "@/lib/planWeekRenderReceipt";
import { synthShowBible } from "@/engine/creative/showBible";
import {
  synthStyleDNA,
  buildQualityBar,
  ESTABLISHED_CONFIDENCE,
} from "@/engine/creative/styleDNA";
import { architectPipeline } from "@/engine/creative/architect";
import {
  CHANNEL_INCEPTION_SETUP_COST_CEILING_USD,
  channelInceptionProbeCostCeilingUsd,
} from "@/engine/channelInceptionContracts";
import { channelInceptionSlug } from "@/lib/channelInceptionIdentity";
import {
  channelPublishConfiguration,
  replaceChannelPublishPolicy,
} from "@/lib/channelPublishPolicy";
import {
  channelDesignApprovalSubject,
  issueStudioActionApproval,
  pipelineProbeApprovalSubject,
  verifyStudioActionApproval,
  youtubeChannelApprovalSubject,
  youtubeChannelCreationRequestKey,
  youtubeChannelIntentApprovalSubject,
  type StudioActionApprovalReceipt,
} from "@/lib/studioActionApproval";
import {
  normalizeYoutubeChannelName,
  normalizeYoutubeHandle,
  suggestYoutubeHandle,
} from "@/lib/youtubeChannelCreationClaim";
import {
  CHANNEL_INCEPTION_PROBE_CHECKPOINT_VERSION,
  MAX_CHANNEL_INCEPTION_PROBE_ATTEMPTS,
  MAX_CHANNEL_INCEPTION_PROBE_COST_USD,
  assessChannelInceptionProbeQuality,
  resolveChannelInceptionProbeHolisticReview,
  freezeChannelInceptionProbeContext,
  freezeChannelInceptionProbeInput,
  prepareChannelInceptionProbeAttempt,
  referenceChannelInceptionProbeAttempt,
  reconcileChannelInceptionProbeAttempt,
  summarizeChannelInceptionProbeSpend,
  assertChannelInceptionProbeAttempt,
  channelInceptionProbeEffectiveBudgetUsd,
  channelInceptionProbeObservedSpend,
  type ChannelInceptionProbeAttemptCheckpoint,
  type ChannelInceptionProbeAttemptReference,
  type ChannelInceptionProbeQualityEvidence,
} from "@/lib/channelInceptionProbe";
import {
  makeVoicecraftAuditionEvidence,
  validateVoiceQualityEvidence,
} from "@/lib/voiceReadiness";
import {
  makeVoiceCastingAuditionReceipt,
  makeVoiceColdOpenReceipt,
  validateVoiceCastingReadinessReceipt,
  voiceCastingOutputFingerprint,
  type VoiceCastingAuditionReceipt,
  type VoiceColdOpenReceipt,
} from "@/lib/voiceCastingReceipt";
import {
  positioningIdentityProjection,
  seoIdentityProjection,
} from "@/engine/channelInceptionInvalidation";
import {
  buildChannelInceptionPlan,
  channelInceptionContentSha256,
  channelInceptionStage,
  type ChannelInceptionRequest,
} from "@/engine/channelInceptionPlan";
import {
  resolveChannelInceptionExecutionAdmission,
  runChannelInceptionStage,
  type ChannelInceptionExecutionControls,
} from "@/engine/channelInceptionLedger";
import { compilePipeline, completePipelineForPolicy } from "@/engine/pipelineCompiler";
import { validatePipeline } from "@/engine/validate";
import { registerAllBlocks } from "@/engine/blocks";
import {
  convexChannelInceptionLedger,
  initializeChannelInceptionLedger,
} from "@/trigger/channelInceptionLedgerAdapter";

export interface DesignChannelArgs extends Omit<DesignOptions, "family"> {
  ownerId?: string;
  name?: string;
  family: FamilyKey;
  cadence?: string;
  days?: number[];
  budget?: number;
  approveSetupSpend?: boolean;
  setupBudgetUsd?: number;
  persona?: string;
  palette?: string[];
  autoYoutube?: boolean;
  /** Exact provider identity displayed before the external-action approval. */
  requestedYoutubeName?: string;
  requestedYoutubeHandle?: string;
  runProbe?: boolean;
  inceptionApproval?: StudioActionApprovalReceipt;
  probeApproval?: StudioActionApprovalReceipt;
  publishingApproval?: StudioActionApprovalReceipt;
  youtubeCreationApproval?: StudioActionApprovalReceipt;
  exampleClipUrl?: string;
  moduleConfig?: Record<string, Record<string, unknown>>;
  /** Stable across automatic retries; Trigger run id is the default. */
  requestKey?: string;
}

export interface DesignChannelRuntime {
  runId: string;
  attempt: number;
}

interface VoiceCastingSlim {
  voiceId: string;
  name?: string;
  character?: string;
  score: number;
  why?: string;
  at: number;
  auditionReceipt?: VoiceCastingAuditionReceipt;
  coldOpenReceipt?: VoiceColdOpenReceipt;
}

interface ChannelIdentityState {
  persona: string;
  voiceId?: string;
  voiceCasting?: VoiceCastingSlim;
  voiceRef?: string;
  toneRefs?: string[];
  bannedWords: string[];
  requiredCallbacks: string[];
  styleGrammar: string;
  palette: string[];
  thumbnailTemplate: string;
  topicPool: string[];
  cadence: string;
  niche?: string;
  imageKey?: string;
  bannerKey?: string;
  thumbnailIdentity?: {
    colorPalette: string[];
    visualStyle: string;
    textPosition: string;
    avoid: string[];
  };
  creativeBrief?: Awaited<ReturnType<typeof synthShowBible>>;
}

type StyleDNA = Awaited<ReturnType<typeof synthStyleDNA>>;
type QualityBar = ReturnType<typeof buildQualityBar>;
type ShowBible = Awaited<ReturnType<typeof synthShowBible>>;

interface PositioningState {
  name: string;
  identity: ChannelIdentityState;
  styleDNA: StyleDNA;
  qualityBar: QualityBar;
  creativeBrief: ShowBible;
  competitorCount: number;
}

interface ProbeOutcome {
  ok: boolean;
  attempts: number;
  error?: string;
  quality?: ChannelInceptionProbeQualityEvidence;
  /** Exact durable PipelineInvocationSnapshot SHA proven by the child run. */
  pipelineFingerprint?: string;
  /** Channel pipeline + moduleConfig fingerprint used for readiness invalidation. */
  productionFingerprint?: string;
  invocationSha256?: string;
  runId?: string;
  dispatchEnvelopeFingerprint?: string;
  actualSpendUsd?: number;
}

interface ProbeArtifactReview {
  source: "qa_visual";
  quality: ChannelInceptionProbeQualityEvidence;
  feel?: { summary?: string };
  defects?: string[];
  thumbnailCritique?: string;
  seo?: { title?: string; description?: string; tags?: string[] };
}

interface ProbeRunStage {
  block?: string;
  status?: unknown;
  cost?: unknown;
  error?: unknown;
  outputs?: Record<string, unknown>;
}

interface ProbeCheckpoint {
  version?: typeof CHANNEL_INCEPTION_PROBE_CHECKPOINT_VERSION;
  stageCapUsd?: number;
  actualSpendUsd?: number;
  committedSpendUsd?: number;
  attempts?: ChannelInceptionProbeAttemptReference[];
  repairsApplied?: number[];
  review?: ProbeArtifactReview;
  quality?: ChannelInceptionProbeQualityEvidence;
  dialInAttempted?: boolean;
}

interface ReadinessProjection {
  status: "paused" | "draft";
  blockers: string[];
  effectiveModules: string[];
  avatarKey?: string;
  bannerKey?: string;
  acceptedThumbnailCount: number;
  probe: ProbeOutcome;
  goldenQualified: false;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function assertStarterPlanChildSucceeded(result: {
  ok: boolean;
  error?: unknown;
}): void {
  if (!result.ok) {
    throw new Error(`starter plan child failed: ${errorMessage(result.error)}`);
  }
}

function asIdentity(value: unknown): ChannelIdentityState {
  return value as ChannelIdentityState;
}

async function currentChannel(
  convex: ConvexHttpClient,
  channelId: Id<"channels">,
) {
  const channel = await convex.query(api.channels.getChannel, { channelId });
  if (!channel) throw new Error(`channel not found: ${channelId}`);
  return channel;
}

async function mergeIdentity(
  convex: ConvexHttpClient,
  channelId: Id<"channels">,
  patch: Partial<ChannelIdentityState>,
): Promise<ChannelIdentityState> {
  const channel = await currentChannel(convex, channelId);
  const identity = { ...asIdentity(channel.identity), ...patch };
  await convex.mutation(api.channels.updateChannel, { channelId, identity });
  return identity;
}

type ProvenReadyPlanRow = {
  _id: Id<"contentPlan">;
  topic: string;
  thumbnailKey?: string;
  generationAttempt?: number;
  usageCheckpointKey?: string;
  planWeekArtifactReceipt?: PlanWeekArtifactReceipt;
  planWeekProviderReceipt?: PlanWeekProviderRenderReceipt;
};

type ProvenReadyPlanPage = {
  page: ProvenReadyPlanRow[];
  continueCursor: string;
  isDone: boolean;
};

const READY_PLAN_PAGE_SIZE = 8;
const READY_PLAN_RESULT_LIMIT = 24;
const STARTER_PREVIEW_TARGET = 5;

function readyPlanArtifactFingerprint(row: ProvenReadyPlanRow): string | undefined {
  const key = row.thumbnailKey?.trim();
  const checkpointKey = row.usageCheckpointKey?.trim();
  const artifact = row.planWeekArtifactReceipt;
  const provider = row.planWeekProviderReceipt;
  if (!key || !checkpointKey || !artifact || !provider ||
      !Number.isInteger(row.generationAttempt)) return undefined;
  return channelInceptionContentSha256({
    itemId: String(row._id),
    attempt: row.generationAttempt,
    checkpointKey,
    thumbnailKey: key,
    providerRequestSha256: provider.requestSha256,
    artifactSha256: artifact.sha256,
    etag: artifact.etag,
    artifactCreatedAt: artifact.createdAt,
  });
}

export function starterPlanDispatchDecision(args: {
  targetCount: number;
  approvedMissingCount: number;
  acceptedFingerprints: readonly string[];
  liveFingerprints: readonly string[];
  checkpointPhase?: unknown;
}): { missingCount: number } {
  const live = new Set(args.liveFingerprints);
  if (args.acceptedFingerprints.some((fingerprint) => !live.has(fingerprint))) {
    throw new Error(
      "artifact_repair_required: an artifact accepted by this plan is no longer live; " +
      "a fresh approved plan intent is required",
    );
  }
  const missingCount = Math.max(0, args.targetCount - live.size);
  if (missingCount > args.approvedMissingCount) {
    throw new Error("artifact_repair_required: live starter evidence exceeds the approved repair scope");
  }
  if (missingCount > 0 && args.checkpointPhase === "starter-plan-child-finished") {
    throw new Error(
      "artifact_repair_required: the paid starter child completed without a recoverable admitted slate; " +
      "a fresh approved plan intent is required",
    );
  }
  return { missingCount };
}

export async function readyPlanSnapshot(
  convex: ConvexHttpClient,
  ownerId: string,
  channelId: Id<"channels">,
  readHead: typeof headObjectMetadata = headObjectMetadata,
) {
  const liveRows: ProvenReadyPlanRow[] = [];
  const liveFingerprints = new Set<string>();
  let databaseProvenCount = 0;
  let missingCount = 0;
  let transientCount = 0;
  let cursor: string | null = null;
  let isDone = false;
  while (!isDone && liveRows.length < READY_PLAN_RESULT_LIMIT) {
    const result: ProvenReadyPlanPage = await convex.query(
      api.contentPlan.listProvenReadyPlanPage,
      {
      ownerId,
      channelId,
      paginationOpts: { numItems: READY_PLAN_PAGE_SIZE, cursor },
      },
    );
    const page = result.page;
    databaseProvenCount += page.length;
    const checks = await Promise.all(page.map(async (row) => {
      const fingerprint = readyPlanArtifactFingerprint(row);
      const key = row.thumbnailKey?.trim();
      const checkpointKey = row.usageCheckpointKey?.trim();
      const artifact = row.planWeekArtifactReceipt;
      const provider = row.planWeekProviderReceipt;
      if (!fingerprint || !key || !checkpointKey || !artifact || !provider) {
        return { state: "missing" as const };
      }
      try {
        const head = await readHead(key);
        return planWeekArtifactHeadMatches({ head, checkpointKey, provider, artifact })
          ? { state: "live" as const, fingerprint, row }
          : { state: "missing" as const };
      } catch {
        return { state: "transient" as const };
      }
    }));
    for (const check of checks) {
      if (check.state === "missing") missingCount += 1;
      if (check.state === "transient") transientCount += 1;
      if (check.state === "live" && !liveFingerprints.has(check.fingerprint)) {
        liveFingerprints.add(check.fingerprint);
        liveRows.push(check.row);
      }
    }
    cursor = result.continueCursor;
    isDone = result.isDone;
  }
  return {
    rows: liveRows.slice(0, READY_PLAN_RESULT_LIMIT),
    databaseProvenCount,
    missingCount,
    transientCount,
  };
}

async function readyPlanRows(
  convex: ConvexHttpClient,
  ownerId: string,
  channelId: Id<"channels">,
) {
  const snapshot = await readyPlanSnapshot(convex, ownerId, channelId);
  if (snapshot.transientCount > 0 && snapshot.rows.length < STARTER_PREVIEW_TARGET) {
    throw new Error(
      "starter artifact verification temporarily unavailable; paid replacement dispatch is paused",
    );
  }
  return snapshot.rows;
}

async function groundingSignals(
  convex: ConvexHttpClient,
  ownerId: string,
  niche: string | undefined,
) {
  if (!niche) {
    return {
      competitorCount: 0,
      titles: [] as string[],
      powerWords: [] as string[],
      thumbnailStyleGuide: undefined,
      databank: undefined,
      topVideos: [] as { videoId: string; title: string; views: number }[],
      competitorContext: "",
    };
  }
  const [nicheIntel, competitors, databank] = await Promise.all([
    convex.query(api.seo.getNiche, { ownerId, niche }).catch(() => null),
    convex.query(api.competitors.listCompetitors, { ownerId, niche }).catch(() => []),
    convex.query(api.seo.getDatabank, { ownerId, niche }).catch(() => null),
  ]);
  const topVideos = (competitors as {
    topVideos?: { videoId?: string; title: string; views: number }[];
  }[])
    .flatMap((competitor) => competitor.topVideos ?? [])
    .sort((left, right) => right.views - left.views)
    .slice(0, 24)
    .map((video, index) => ({
      videoId: video.videoId?.trim() || `research-${index}`,
      title: video.title,
      views: video.views,
    }));
  const titles = topVideos.slice(0, 15).map((video) => video.title);
  const powerWords = ((nicheIntel as { powerWords?: { word: string }[] } | null)?.powerWords ?? [])
    .map((entry) => entry.word)
    .slice(0, 14);
  const thumbnailStyleGuide = (nicheIntel as {
    thumbnailStyleGuide?: {
      dominantColors?: string[];
      hasTextOverlayPct?: number;
      notes?: string;
    };
  } | null)?.thumbnailStyleGuide;
  const competitorContext = [
    titles.length ? `Top titles:\n${titles.join("\n")}` : "",
    powerWords.length ? `Power words: ${powerWords.join(", ")}` : "",
  ].filter(Boolean).join("\n\n");
  return {
    competitorCount: (competitors as unknown[]).length,
    titles,
    powerWords,
    thumbnailStyleGuide,
    databank: (databank as {
      thumbnailRules?: string[];
      hookPatterns?: string[];
      competitorGaps?: string[];
      titleTemplates?: string[];
    } | null) ?? undefined,
    topVideos,
    competitorContext,
  };
}

function customizePipelineFromDna(
  source: readonly PipelineEntry[],
  identity: ChannelIdentityState,
  styleDNA: StyleDNA,
): { pipeline: PipelineEntry[]; changed: string[] } {
  const pacingText = `${styleDNA.narrative?.pacing ?? ""} ${styleDNA.narrative?.delivery ?? ""}`.toLowerCase();
  const gap = /sleep|meditat|hypnot|very slow|drowsy/.test(pacingText) ? 1.8
    : /slow|gentle|calm|soothing|unhurried/.test(pacingText) ? 1.5
      : /fast|energetic|punchy|rapid|urgent/.test(pacingText) ? 0.6
        : undefined;
  const scriptStyle = (styleDNA.narrative?.scriptStyle ?? "").toLowerCase();
  const style = /crime|mystery|tension|noir/.test(scriptStyle) ? "crime"
    : /meditat|sleep|hypnot|guided/.test(scriptStyle) ? "meditation"
      : /short|punchy|rapid/.test(scriptStyle) ? "shorts"
        : undefined;
  const grammar = `${identity.styleGrammar} ${styleDNA.recurringSubject ?? ""}`.toLowerCase();
  const backgroundHex = (identity.palette[0] ?? "").replace("#", "");
  const dark = /^[0-9a-f]{6}$/i.test(backgroundHex)
    ? (
      parseInt(backgroundHex.slice(0, 2), 16) +
      parseInt(backgroundHex.slice(2, 4), 16) +
      parseInt(backgroundHex.slice(4, 6), 16)
    ) / 3 < 110
    : false;
  const wantsChalk = /chalk|blackboard|chalkboard|dark academic|dark-academic|noir/.test(grammar) || dark;
  const changed: string[] = [];
  const pipeline = source.map((entry) => {
    const params: Record<string, unknown> = { ...(entry.params ?? {}) };
    if (entry.block === "narration_tts" && gap !== undefined && params.sentenceGapSec === undefined) {
      params.sentenceGapSec = gap;
      changed.push(`narration_tts.sentenceGapSec=${gap}`);
    }
    if (entry.block === "script_gen") {
      if (gap !== undefined && params.sentenceGapSec === undefined) params.sentenceGapSec = gap;
      if (style && (params.style === undefined || params.style === "generic")) {
        params.style = style;
        changed.push(`script_gen.style=${style}`);
      }
    }
    if (entry.block === "whiteboard_scribe") {
      if (params.palette === undefined && identity.palette.length) params.palette = identity.palette;
      if (params.boardMode === undefined && wantsChalk) {
        params.boardMode = "chalk";
        changed.push("whiteboard_scribe.boardMode=chalk");
      }
    }
    return { block: entry.block, params: Object.keys(params).length ? params : undefined };
  });
  return { pipeline, changed };
}

function wireVoiceReadiness(
  source: readonly PipelineEntry[],
  cast: VoiceCastingSlim | undefined,
  ownerId: string,
  channelId: Id<"channels">,
): { pipeline: PipelineEntry[]; wired: string[] } {
  const pipeline = source.map((entry) => ({
    block: entry.block,
    ...(entry.params ? { params: { ...entry.params } } : {}),
  }));
  const voiceCastingValidation = {
    cast,
    ownerId,
    channelId: String(channelId),
  };
  if (!validateVoiceCastingReadinessReceipt(voiceCastingValidation)) return { pipeline, wired: [] };
  const qualifiedCast = voiceCastingValidation.cast;
  const wired: string[] = [];
  const voiceCastEvidence = makeVoicecraftAuditionEvidence({
    channelId: String(channelId),
    provider: "elevenlabs",
    voiceId: qualifiedCast.voiceId,
    castScore: qualifiedCast.score,
    castJudgedAt: qualifiedCast.at,
  });
  const narration = pipeline.find((entry) => entry.block === "narration_tts");
  if (narration) {
    const params = (narration.params ?? {}) as Record<string, unknown>;
    if (params.qualityProfile !== "draft" && (!params.ttsProvider || params.ttsProvider === "elevenlabs")) {
      narration.params = {
        ...params,
        ttsProvider: "elevenlabs",
        elevenVoiceId: qualifiedCast.voiceId,
        voiceCastScore: qualifiedCast.score,
        voiceCastEvidence,
        voiceColdOpenEvidence: qualifiedCast.coldOpenReceipt,
        voiceReadinessStatus: "qualified",
      };
      wired.push("narration_tts");
    }
  }
  const whiteboard = pipeline.find((entry) => entry.block === "whiteboard_scribe");
  if (whiteboard) {
    whiteboard.params = {
      ...(whiteboard.params ?? {}),
      ttsProvider: "elevenlabs",
      elevenVoiceId: qualifiedCast.voiceId,
      voiceCastScore: qualifiedCast.score,
      voiceCastEvidence,
      voiceColdOpenEvidence: qualifiedCast.coldOpenReceipt,
      voiceReadinessStatus: "qualified",
    };
    wired.push("whiteboard_scribe");
  }
  return { pipeline, wired };
}

function validatePipelineVoiceWiring(
  pipeline: readonly PipelineEntry[],
  cast: VoiceCastingSlim | undefined,
  ownerId: string,
  channelId: Id<"channels">,
): { ok: true } | { ok: false; reason: string } {
  const validation = { cast, ownerId, channelId: String(channelId) };
  if (!validateVoiceCastingReadinessReceipt(validation)) {
    return { ok: false, reason: "qualified audition and cold-open voice proof is missing" };
  }
  const qualified = validation.cast;
  const consumers = pipeline.filter(
    (entry) => entry.block === "narration_tts" || entry.block === "whiteboard_scribe",
  );
  if (consumers.length === 0) {
    return { ok: false, reason: "effective pipeline does not consume the selected channel voice" };
  }
  for (const consumer of consumers) {
    const params = (consumer.params ?? {}) as Record<string, unknown>;
    const evidence = validateVoiceQualityEvidence({
      evidence: params["voiceCastEvidence"],
      channelId: String(channelId),
      provider: "elevenlabs",
      voiceId: qualified.voiceId,
      castScore: qualified.score,
    });
    if (
      params["ttsProvider"] !== "elevenlabs" ||
      params["elevenVoiceId"] !== qualified.voiceId ||
      params["voiceCastScore"] !== qualified.score ||
      params["voiceReadinessStatus"] !== "qualified" ||
      channelInceptionContentSha256(params["voiceColdOpenEvidence"]) !==
        channelInceptionContentSha256(qualified.coldOpenReceipt) ||
      !evidence.ok
    ) {
      return { ok: false, reason: `${consumer.block} is not wired to the admitted channel voice proof` };
    }
  }
  return { ok: true };
}

function buildProbePipeline(source: readonly PipelineEntry[]): PipelineEntry[] {
  const dropped = new Set([
    "upload_draft",
    "notify",
    "cleanup",
    "shorts_spinoff",
    "crosspost",
    "emit_bundle",
  ]);
  return source
    .filter((entry) => !dropped.has(entry.block))
    .map((entry) => {
      const params: Record<string, unknown> = { ...(entry.params ?? {}) };
      if (entry.block === "topic_select") {
        params.dryRun = true;
        params.targetSeconds = 60;
      }
      if (entry.block === "script_gen") {
        params.maxSeconds = 60;
        params.endWithSummary = false;
      }
      if (entry.block === "length_check") {
        params.minSeconds = 20;
        params.maxSeconds = 220;
      }
      if (entry.block === "music") params.trackCount = 1;
      if (entry.block === "gen_footage") params.maxClips = 6;
      if (entry.block === "stock_footage") params.signatureGenClips = 0;
      if (entry.block === "visual_inserts") params.maxInserts = 1;
      if (entry.block === "quote_overlays") params.maxQuotes = 1;
      if (entry.block === "assemble") params.durationSec = 120;
      if (entry.block === "whiteboard_scribe") {
        params.targetSeconds = 60;
        params.width = 1280;
      }
      if (entry.block === "motion_comic") {
        params.panels = 4;
        params.width = 1280;
      }
      return { block: entry.block, params: Object.keys(params).length ? params : undefined };
    });
}

function effectivePipelineFingerprint(channel: {
  pipeline?: unknown;
  moduleConfig?: unknown;
}): string {
  return channelInceptionContentSha256({
    pipeline: channel.pipeline ?? [],
    moduleConfig: channel.moduleConfig ?? {},
  });
}

interface ChannelPipelineCertification {
  version: "channel-inception-pipeline-certification/v1";
  family: FamilyKey;
  requestFingerprint: string;
  pipelineSourceFingerprint: string;
  pipelineFingerprint: string;
  moduleConfigFingerprint: string;
  disabledBlocksFingerprint: string;
  compilationFingerprint: string;
  compilationPolicyId: string;
  compilationPolicyVersion: string;
  certificationFingerprint: string;
}

function certifyChannelPipeline(args: {
  pipeline: PipelineEntry[];
  moduleConfig: Record<string, Record<string, unknown>>;
  disabledBlocks: string[];
  family: FamilyKey;
  requestFingerprint: string;
  pipelineSourceFingerprint: string;
}): ChannelPipelineCertification {
  registerAllBlocks();
  const completed = completePipelineForPolicy(args.pipeline);
  if (
    completed.inserted.length ||
    completed.retired.length ||
    channelInceptionContentSha256(completed.entries) !==
      channelInceptionContentSha256(args.pipeline)
  ) {
    throw new Error("pipeline still contains legacy modules or policy gaps");
  }
  if (args.pipeline.some((entry) => args.disabledBlocks.includes(entry.block))) {
    throw new Error("pipeline contains an operator-disabled module");
  }
  const compilation = compilePipeline(validatePipeline(args.pipeline));
  const claims = {
    version: "channel-inception-pipeline-certification/v1" as const,
    family: args.family,
    requestFingerprint: args.requestFingerprint,
    pipelineSourceFingerprint: args.pipelineSourceFingerprint,
    pipelineFingerprint: channelInceptionContentSha256(args.pipeline),
    moduleConfigFingerprint: channelInceptionContentSha256(args.moduleConfig),
    disabledBlocksFingerprint: channelInceptionContentSha256([...args.disabledBlocks].sort()),
    compilationFingerprint: compilation.fingerprint,
    compilationPolicyId: compilation.policyId,
    compilationPolicyVersion: compilation.policyVersion,
  };
  return {
    ...claims,
    certificationFingerprint: channelInceptionContentSha256(claims),
  };
}

function pipelineCertificationMatches(
  actual: unknown,
  expected: ChannelPipelineCertification,
): boolean {
  if (!actual || typeof actual !== "object") return false;
  return channelInceptionContentSha256(actual) === channelInceptionContentSha256(expected);
}

async function inceptionStageOutputs(
  convex: ConvexHttpClient,
  channelId: Id<"channels">,
  moduleKey: string,
): Promise<unknown> {
  const channel = await currentChannel(convex, channelId);
  return (channel as unknown as {
    inception?: { stages?: Record<string, { outputs?: unknown }> };
  }).inception?.stages?.[moduleKey]?.outputs;
}

/**
 * Project the child run's already-paid golden QA into a compact review. The
 * previous implementation downloaded the artifacts and bought a second video
 * watch plus thumbnail critique outside the probe's $3 authority.
 */
function reviewProbeArtifacts(stages: readonly ProbeRunStage[]): ProbeArtifactReview {
  const successfulOutput = (...blocks: string[]): Record<string, unknown> => {
    for (const block of blocks) {
      const match = stages
        .find((candidate) => candidate.block === block && candidate.status === "ok");
      if (match?.outputs) return match.outputs;
    }
    return {};
  };
  const qaOutput = successfulOutput("qa_visual");
  const quality = assessChannelInceptionProbeQuality(qaOutput);
  const qaReport = qaOutput.qaReport && typeof qaOutput.qaReport === "object"
    ? qaOutput.qaReport as Record<string, unknown>
    : {};
  const holisticReview = resolveChannelInceptionProbeHolisticReview(qaReport) ?? {};
  const thumbnail = qaReport.thumbnail && typeof qaReport.thumbnail === "object"
    ? qaReport.thumbnail as Record<string, unknown>
    : {};
  const review: ProbeArtifactReview = {
    source: "qa_visual",
    quality,
    ...(typeof holisticReview.summary === "string" ? { feel: { summary: holisticReview.summary } } : {}),
    ...(Array.isArray(holisticReview.defects)
      ? {
        defects: holisticReview.defects.map((candidate) => {
          if (!candidate || typeof candidate !== "object") return String(candidate);
          const defect = candidate as Record<string, unknown>;
          return `[${String(defect.severity ?? "unknown")}] ${String(defect.issue ?? "")}`;
        }).slice(0, 8),
      }
      : {}),
    ...(typeof thumbnail.score === "number"
      ? {
        thumbnailCritique: `${thumbnail.score}/10${
          Array.isArray(thumbnail.issues) && thumbnail.issues.length
            ? ` — ${thumbnail.issues.slice(0, 2).join("; ")}`
            : ""
        }`,
      }
      : {}),
  };
  const metadata = successfulOutput("metadata");
  if (metadata.title) {
    review.seo = {
      title: String(metadata.title),
      description: String(metadata.description ?? "").slice(0, 300),
      tags: Array.isArray(metadata.tags)
        ? metadata.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 15)
        : undefined,
    };
  }
  return review;
}

export async function executeDesignChannel(
  payload: DesignChannelArgs,
  runtime: DesignChannelRuntime,
) {
  const log = (message: string, extra?: Record<string, unknown>) =>
    console.log(`[design-channel] ${message}`, extra ?? "");
  const family = FAMILIES[payload.family];
  if (!family) throw new Error(`unknown family: ${payload.family}`);
  const runtimeReadiness = familyProductionReadiness(payload.family);
  if (!runtimeReadiness.productionReady) {
    const fallback = productionReadyFamilyFallback(payload.family);
    throw new Error(
      `${family.label} cannot start channel inception because its production path is unavailable: ` +
      `${runtimeReadiness.blockers.join(" ")}` +
      (fallback
        ? ` Choose ${FAMILIES[fallback].label} after its own admission check.`
        : " No no-Gemini production-family fallback is registered."),
    );
  }
  // No creator-time Gemini prerequisite: admission above rejects any family
  // whose autonomous planning path still depends on it.
  await bootstrapSecrets(log);

  const ownerId = admitProviderTaskOwner({
    requestedOwnerId: payload.ownerId,
    configuredOwnerId: process.env.STUDIO_OWNER_ID,
    runtime: process.env.NODE_ENV,
    developmentFallbackOwnerId: process.env.NEXT_PUBLIC_OWNER_ID ?? "owner_daniel",
  });
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  const convex = new ConvexHttpClient(url);
  const niche = getNiche(payload.nicheKey ?? "");
  const requestKey = payload.requestKey?.trim() || runtime.runId;
  const requestedYoutubeName = normalizeYoutubeChannelName(
    payload.requestedYoutubeName ?? "",
  );
  const requestedYoutubeHandle = normalizeYoutubeHandle(
    payload.requestedYoutubeHandle ?? "",
  );
  // Stable across Trigger attempts so a hard-killed attempt can immediately
  // reclaim its own checkpointed stage; unrelated runs still observe `busy`.
  const claimant = runtime.runId;
  const approvalSubject = channelDesignApprovalSubject(
    ownerId,
    payload as unknown as Record<string, unknown>,
  );
  const requestedSetupCapUsd = payload.approveSetupSpend === true
    ? payload.setupBudgetUsd ?? 0
    : 0;
  const inceptionApprovalValid =
    payload.approveSetupSpend === true &&
    requestedSetupCapUsd === CHANNEL_INCEPTION_SETUP_COST_CEILING_USD &&
    verifyStudioActionApproval(payload.inceptionApproval, {
      action: "channel-inception-execute",
      ownerId,
      subject: approvalSubject,
      maximumCostUsd: CHANNEL_INCEPTION_SETUP_COST_CEILING_USD,
    }) &&
    payload.inceptionApproval.maxCostUsd === CHANNEL_INCEPTION_SETUP_COST_CEILING_USD;
  const requestedProbeCapUsd = Math.min(
    Math.max(payload.budget ?? family.defaultRunBudgetUsd ?? 5, 0),
    channelInceptionProbeCostCeilingUsd(payload.family),
  );
  const probeApproved = payload.runProbe === true && verifyStudioActionApproval(payload.probeApproval, {
    action: "channel-inception-probe",
    ownerId,
    subject: approvalSubject,
    maximumCostUsd: requestedProbeCapUsd,
  }) && payload.probeApproval.maxCostUsd === requestedProbeCapUsd;
  const publishingApproved = payload.approvedForPublish === true && verifyStudioActionApproval(
    payload.publishingApproval,
    {
      action: "channel-publish",
      ownerId,
      subject: approvalSubject,
    },
  );
  const youtubeCreationIdentityExact =
    payload.autoYoutube === true &&
    requestedYoutubeName.length > 0 &&
    requestedYoutubeName === normalizeYoutubeChannelName(payload.name ?? "") &&
    requestedYoutubeHandle === suggestYoutubeHandle(requestedYoutubeName);
  const youtubeCreationApproved = youtubeCreationIdentityExact && verifyStudioActionApproval(
    payload.youtubeCreationApproval,
    {
      action: "youtube-channel-create",
      ownerId,
      subject: youtubeChannelIntentApprovalSubject({
        ownerId,
        intentKey: requestKey,
        name: requestedYoutubeName,
        handle: requestedYoutubeHandle,
      }),
    },
  );

  const design = designPipeline({
    family: payload.family,
    nicheKey: payload.nicheKey,
    subcategory: payload.subcategory,
    lengthMinutes: payload.lengthMinutes,
    locale: payload.locale,
    footageTheme: payload.footageTheme,
    voiceFx: payload.voiceFx,
    publishMode: payload.publishMode ?? "draft",
    approvedForPublish: publishingApproved,
    seriesTitle: payload.seriesTitle,
    seriesCount: payload.seriesCount,
    sourceReferences: payload.sourceReferences,
    claimEvidence: payload.claimEvidence,
    toggles: payload.toggles,
    paramOverrides: payload.paramOverrides,
  });
  // Preserve the exact design resolution: an omitted operator duration may
  // intentionally use a valid niche preset rather than the generic family default.
  const lengthSeconds = design.episodeLengthSeconds;
  const withLengthLaw = (pipeline: PipelineEntry[]): PipelineEntry[] => {
    const result = enforceLengthContract(pipeline, lengthSeconds, payload.family);
    if (result.changed.length) log(`length law re-pinned: ${result.changed.join(", ")}`);
    return result.pipeline;
  };
  const baseName = payload.name?.trim() || `${niche?.label ?? payload.nicheKey ?? "New"} ${family.label}`;
  const slug = channelInceptionSlug(baseName, requestKey);
  const archetype = getArchetype(family.archetypeKey);
  const disabledBlocks = [
    payload.toggles?.shorts === false ? "shorts_spinoff" : "",
    payload.toggles?.crosspost === false ? "crosspost" : "",
    payload.toggles?.quotes === false ? "quote_overlays" : "",
    payload.toggles?.notify === false ? "notify" : "",
  ].filter(Boolean);

  const existingAtStart = await convex.query(api.channels.getChannelBySlug, { ownerId, slug });
  if (existingAtStart?.family && existingAtStart.family !== payload.family) {
    throw new Error(`inception key already belongs to family ${existingAtStart.family}`);
  }
  // RESUME HOLE: `createChannel` below is the ONLY writer in this flow that
  // stamps `family`/`contentLane`, and the `existingAtStart?._id ??`
  // short-circuit skips it entirely whenever a row already sits on this slug.
  // A row that predates persisted families (or one seeded by a path that
  // omitted it) would therefore be carried through every stage and finish
  // inception with an IMPLICIT, pipeline-inferred lane — reintroducing on a
  // freshly built channel exactly the fragility the backfill migration exists
  // to close. Stamp it explicitly before any stage runs.
  //
  // `backfillChannelFamily` is the right tool rather than a raw patch: it is
  // idempotent, never overwrites an existing family, re-derives the lane from
  // this row's OWN stored pipeline, and REFUSES any family whose lane differs
  // from the one already resolved today. So it can only make current behaviour
  // explicit, never change it — and the refusal makes an implicit-family
  // mismatch as loud as the explicit-family mismatch rejected just above.
  // Locked rows are skipped: the migration's writability guard refuses them and
  // the fork path owns that case.
  if (existingAtStart && !existingAtStart.family && existingAtStart.locked !== true) {
    const stamped = await convex.mutation(api.channels.backfillChannelFamily, {
      ownerId,
      channelId: existingAtStart._id,
      family: payload.family,
    });
    log(`resumed channel carried an implicit family: ${stamped.reason}`);
  }
  const provisionalIdentity: ChannelIdentityState = existingAtStart
    ? asIdentity(existingAtStart.identity)
    : {
        persona: payload.persona?.trim() || `Evidence-grounded ${family.label} channel`,
        styleGrammar: `${family.label}; identity pending Channel Inception positioning`,
        palette: payload.palette?.length ? payload.palette : ["#111827", "#F59E0B", "#F8FAFC"],
        topicPool: [],
        bannedWords: [],
        requiredCallbacks: [],
        cadence: payload.cadence ?? "weekly",
        niche: niche?.label ?? payload.nicheKey,
        thumbnailTemplate: family.defaultThumbnailStyle,
      };
  const channelId = existingAtStart?._id ?? await convex.mutation(api.channels.createChannel, {
    ownerId,
    slug,
    name: baseName,
    identity: provisionalIdentity,
    thumbnailer: family.defaultThumbnailStyle,
    template: archetype.template,
    pipeline: design.pipeline,
    family: payload.family,
    contentLane: design.contentLane,
    disabledBlocks,
    budget: payload.budget ?? family.defaultRunBudgetUsd ?? 5,
    status: "draft",
  });
  log(existingAtStart ? "resuming existing channel inception" : "created resumable draft shell", {
    channelId,
    slug,
    family: payload.family,
  });

  if (payload.cadence) {
    await convex.mutation(api.channels.updateChannel, {
      channelId,
      schedule: { frequency: payload.cadence, days: payload.days },
    });
  }

  // A missing template or unavailable runtime cannot pass an end-to-end proof.
  // Persist only the deterministic shell and stop before research/model/art/
  // thumbnail spend. The entrypoint above rejects known blocked families;
  // retain this guard for resumed or future dynamic capability changes.
  if (!design.available || !design.productionReady) {
    const blockers = [
      `${family.label} production engine or runtime is not available`,
      ...design.runtimeBlockers,
      ...design.warnings,
    ];
    await convex.mutation(api.channels.updateChannel, {
      channelId,
      status: "draft",
      architectReport: {
        summary: "zero-spend draft: family engine or runtime unavailable",
        applied: [],
        rejected: [],
        missingCapabilities: [],
        groundingActions: [],
        blockers,
      },
    });
    log("family unavailable; stopped before every provider-capable inception stage");
    return {
      ok: true,
      channelId,
      slug,
      name: baseName,
      family: payload.family,
      status: "draft" as const,
      probe: { ok: false, attempts: 0, error: "family engine or runtime unavailable" },
      zeroSpendDraft: true,
      blockers,
      warnings: design.warnings,
    };
  }

  const existingChannel = await currentChannel(convex, channelId);
  const existingIdentity = asIdentity(existingChannel.identity);
  const acceptedRows = await readyPlanRows(convex, ownerId, channelId);
  const acceptedTopicFingerprints = acceptedRows.map((row) =>
    channelInceptionContentSha256(row.topic));
  const acceptedPreviewFingerprints = acceptedRows
    .map(readyPlanArtifactFingerprint)
    .filter((fingerprint): fingerprint is string => Boolean(fingerprint));
  const previousInception = (existingChannel as unknown as {
    inception?: { requestSnapshot?: unknown; admission?: unknown };
  }).inception;
  const previousSnapshot = previousInception?.requestSnapshot;
  const requestedModuleConfig = structuredClone(payload.moduleConfig ?? {});
  const requestedModuleConfigFingerprint = channelInceptionContentSha256(
    requestedModuleConfig,
  );
  const previousStarter = previousSnapshot && typeof previousSnapshot === "object"
    ? (previousSnapshot as Partial<ChannelInceptionRequest>).starter
    : undefined;
  const previousPreviewFingerprints: string[] = Array.isArray(
    previousStarter?.acceptedPreviewFingerprints,
  )
    ? previousStarter.acceptedPreviewFingerprints.filter(
        (fingerprint): fingerprint is string => typeof fingerprint === "string",
      )
    : [];
  const currentPreviewFingerprintSet = new Set(acceptedPreviewFingerprints);
  const canResumeSnapshot = Boolean(
    previousSnapshot &&
    typeof previousSnapshot === "object" &&
    (previousSnapshot as Partial<ChannelInceptionRequest>).ownerId === ownerId &&
    (previousSnapshot as Partial<ChannelInceptionRequest>).channelRef === String(channelId) &&
    (previousSnapshot as Partial<ChannelInceptionRequest>).slug === slug &&
    (previousSnapshot as Partial<ChannelInceptionRequest>).family === payload.family &&
    (previousSnapshot as Partial<ChannelInceptionRequest>).sourceRevision === requestKey &&
    (previousSnapshot as Partial<ChannelInceptionRequest>).moduleConfigFingerprint ===
      requestedModuleConfigFingerprint &&
    previousPreviewFingerprints.every((fingerprint) => currentPreviewFingerprintSet.has(fingerprint)),
  );
  const currentRequest: ChannelInceptionRequest = {
    ownerId,
    channelRef: String(channelId),
    name: existingChannel.name,
    slug,
    family: payload.family,
    nicheKey: existingIdentity.niche ?? niche?.label ?? payload.nicheKey ?? "unknown",
    locale: payload.locale ?? "en",
    sourceRevision: requestKey,
    pipelineSourceFingerprint: channelInceptionContentSha256(design.pipeline),
    moduleConfigFingerprint: requestedModuleConfigFingerprint,
    identityBrief: [payload.persona, payload.subcategory, payload.exampleClipUrl].filter(Boolean).join(" | "),
    brand: {
      ...(existingIdentity.imageKey ? {
        avatar: {
          existing: {
            assetKey: existingIdentity.imageKey,
            contentFingerprint: channelInceptionContentSha256(existingIdentity.imageKey),
          },
          protectExisting: true,
        },
      } : {}),
      ...(existingIdentity.bannerKey ? {
        banner: {
          existing: {
            assetKey: existingIdentity.bannerKey,
            contentFingerprint: channelInceptionContentSha256(existingIdentity.bannerKey),
          },
          protectExisting: true,
        },
      } : {}),
      ...(existingIdentity.palette.length ? {
        colors: {
          existing: {
            assetKey: "identity.palette",
            contentFingerprint: channelInceptionContentSha256(existingIdentity.palette),
          },
          protectExisting: true,
        },
      } : {}),
    },
    ...(existingIdentity.voiceCasting && payload.family !== "music_loop" ? {
      voice: {
        existingCastFingerprint: channelInceptionContentSha256(existingIdentity.voiceCasting),
        protectExistingCast: true,
      },
    } : {}),
    starter: {
      topicCount: 5,
      previewCount: 5,
      acceptedTopicFingerprints,
      acceptedPreviewFingerprints,
    },
    includeProbe: probeApproved,
  };
  const plan = buildChannelInceptionPlan(
    canResumeSnapshot
      ? previousSnapshot as ChannelInceptionRequest
      : currentRequest,
  );
  if (canResumeSnapshot) log("restored immutable inception request snapshot for retry");
  const executionReceiptFingerprint = payload.inceptionApproval
    ? channelInceptionContentSha256(payload.inceptionApproval)
    : undefined;
  const probeReceiptFingerprint = payload.probeApproval
    ? channelInceptionContentSha256(payload.probeApproval)
    : undefined;
  const admission = resolveChannelInceptionExecutionAdmission({
    requestFingerprint: plan.requestFingerprint,
    submitted: {
      executionFresh:
        inceptionApprovalValid &&
        (payload.inceptionApproval?.maxCostUsd ?? 0) >= plan.executionCostCeilingUsd,
      executionCapUsd: payload.inceptionApproval?.maxCostUsd ?? 0,
      executionReceiptFingerprint,
      probeFresh:
        probeApproved &&
        (payload.probeApproval?.maxCostUsd ?? 0) > 0 &&
        (payload.probeApproval?.maxCostUsd ?? 0) <= plan.probeCostCeilingUsd,
      probeCapUsd: payload.probeApproval?.maxCostUsd ?? 0,
      probeReceiptFingerprint,
    },
    persisted: previousInception?.admission as Parameters<
      typeof resolveChannelInceptionExecutionAdmission
    >[0]["persisted"],
  });
  await initializeChannelInceptionLedger({ convex, channelId, plan, admission });
  for (const [blockId, config] of Object.entries(requestedModuleConfig)) {
    await convex.mutation(api.channels.setModuleConfig, { channelId, blockId, config });
  }
  const canonicalModuleConfig = (await currentChannel(convex, channelId) as {
    moduleConfig?: Record<string, Record<string, unknown>>;
  }).moduleConfig ?? {};
  if (
    channelInceptionContentSha256(canonicalModuleConfig) !==
      plan.requestSnapshot.moduleConfigFingerprint
  ) {
    throw new Error("persisted module configuration does not match the admitted request");
  }
  if (!admission.executionAuthorized) {
    const blockers = ["provider execution requires a fresh authenticated inception approval"];
    await convex.mutation(api.channels.updateChannel, {
      channelId,
      status: "draft",
      architectReport: {
        summary: "plan-only draft: provider execution not admitted",
        applied: [],
        rejected: [],
        missingCapabilities: [],
        groundingActions: [],
        blockers,
      },
    });
    return {
      ok: true,
      channelId,
      slug,
      name: existingChannel.name,
      family: payload.family,
      status: "draft" as const,
      probe: { ok: false, attempts: 0, error: "probe not admitted" },
      inceptionKey: plan.inceptionKey,
      planOnly: true,
      blockers,
      warnings: design.warnings,
    };
  }
  const ledger = convexChannelInceptionLedger({ convex, channelId, claimant });
  const runStage = async <T>(
    moduleKey: Parameters<typeof runChannelInceptionStage<T>>[0]["moduleKey"],
    options: Omit<Parameters<typeof runChannelInceptionStage<T>>[0], "plan" | "moduleKey" | "ledger">,
  ): Promise<T> => {
    const result = await runChannelInceptionStage({
      plan,
      moduleKey,
      ledger,
      ...options,
      fingerprint: options.fingerprint ?? ((persisted) =>
        channelInceptionContentSha256(persisted.value)),
      retryableOnError: runtime.attempt < 3,
    });
    log(`${moduleKey}: ${result.disposition}`);
    return result.value;
  };

  const loadResearchEvidence = async (): Promise<{
    value: ChannelResearchEvidence;
    evidence: { research: ChannelResearchEvidence };
    outputFingerprint: string;
  } | undefined> => {
    const channel = await currentChannel(convex, channelId);
    const identity = asIdentity(channel.identity);
    const expectedNiche = plan.requestSnapshot.nicheKey.trim();
    if (!identity.niche || identity.niche !== expectedNiche) return undefined;
    const [nicheIntel, competitors] = await Promise.all([
      convex.query(api.seo.getNiche, { ownerId, niche: expectedNiche }),
      convex.query(api.competitors.listCompetitors, { ownerId, niche: expectedNiche }),
    ]);
    const research = validateChannelResearchEvidence({
      ownerId,
      niche: expectedNiche,
      nicheIntel,
      competitors,
    });
    return research
      ? {
          value: research,
          evidence: { research },
          outputFingerprint: channelResearchEvidenceFingerprint(research),
        }
      : undefined;
  };
  await runStage("channel-inception-research", {
    loadCompleted: loadResearchEvidence,
    adoptExisting: loadResearchEvidence,
    execute: async () => {
      const identity = asIdentity((await currentChannel(convex, channelId)).identity);
      if (!identity.niche || identity.niche !== plan.requestSnapshot.nicheKey) {
        throw new Error("research niche does not match the admitted channel request");
      }
      const result = await refreshNicheResearchCore({
        ownerId,
        niche: identity.niche,
        channelId,
      }, log);
      if (!result.ok || result.skipped === "no_youtube_key") {
        throw new Error(`research evidence unavailable (${result.skipped ?? "unknown"})`);
      }
      const persisted = await loadResearchEvidence();
      if (!persisted) {
        throw new Error(
          `research produced insufficient evidence (${result.videosAnalysed ?? 0} videos, ` +
          `${result.competitorCount ?? 0} competitors)`,
        );
      }
      return persisted;
    },
  });

  const loadPositioning = async (): Promise<{
    value: PositioningState;
    evidence?: unknown;
    outputFingerprint: string;
  } | undefined> => {
    const channel = await currentChannel(convex, channelId);
    const identity = asIdentity(channel.identity);
    const styleDNA = channel.styleDNA as StyleDNA | undefined;
    const qualityBar = channel.qaRubric as QualityBar | undefined;
    if (!styleDNA || styleDNA.confidence < ESTABLISHED_CONFIDENCE || styleDNA.groundingGaps.length) return undefined;
    if (!qualityBar || !identity.creativeBrief) return undefined;
    const signals = await groundingSignals(convex, ownerId, identity.niche);
    const value: PositioningState = {
      name: channel.name,
      identity,
      styleDNA,
      qualityBar,
      creativeBrief: identity.creativeBrief,
      competitorCount: signals.competitorCount,
    };
    return {
      value,
      evidence: { adopted: true, confidence: styleDNA.confidence },
      outputFingerprint: channelInceptionContentSha256({
        ...value,
        identity: positioningIdentityProjection(identity),
      }),
    };
  };
  const positioning = await runStage("channel-inception-positioning", {
    maximumAttempts: 3,
    loadCompleted: loadPositioning,
    adoptExisting: loadPositioning,
    execute: async () => {
      const seed = [
        niche?.label ?? payload.nicheKey,
        payload.subcategory,
        payload.name,
        `${family.label} format`,
      ].filter(Boolean).join(" — ");
      const concept = await synthChannelConcept(seed, undefined, log);
      const name = payload.name?.trim() || concept.name;
      const selfText = [
        payload.name ?? "",
        concept.name,
        payload.persona ?? concept.persona,
        niche?.label ?? "",
        payload.subcategory ?? "",
        ...concept.topicPool,
      ].join(" ").toLowerCase();
      const bannedWords = (concept.bannedWords ?? []).filter((word) => {
        const clashes = Boolean(word) && selfText.includes(word.toLowerCase());
        if (clashes) log(`identity lint dropped self-colliding banned word: ${word}`);
        return !clashes;
      });
      const previous = asIdentity((await currentChannel(convex, channelId)).identity);
      const identity: ChannelIdentityState = {
        ...previous,
        persona: payload.persona ?? concept.persona,
        styleGrammar: concept.styleGrammar,
        palette: payload.palette?.length ? payload.palette : concept.palette,
        topicPool: concept.topicPool,
        bannedWords,
        requiredCallbacks: previous.requiredCallbacks ?? [],
        cadence: payload.cadence ?? concept.cadence,
        niche: niche?.label ?? concept.niche,
        voiceId: concept.voiceId,
        thumbnailTemplate: family.defaultThumbnailStyle,
      };
      let exampleClipNotes: string | undefined;
      if (payload.exampleClipUrl?.trim()) {
        const { analyzeClip } = await import("@/lib/clipAnalysis");
        const analysis = await analyzeClip(payload.exampleClipUrl.trim());
        if (analysis.couldAnalyze) {
          exampleClipNotes = [
            analysis.visualStyle ? `visual style: ${analysis.visualStyle}` : "",
            analysis.pacing ? `pacing: ${analysis.pacing}` : "",
            analysis.hasNarration
              ? `narration tone: ${analysis.narrationTone ?? "unspecified"}`
              : "no narration",
            analysis.musicRole !== "none" ? `music role: ${analysis.musicRole}` : "",
            analysis.captionStyle ? `captions: ${analysis.captionStyle}` : "",
            analysis.thumbnailStyle ? `thumbnail style: ${analysis.thumbnailStyle}` : "",
            analysis.notes,
          ].filter(Boolean).join("; ");
        }
      }
      const signals = await groundingSignals(convex, ownerId, identity.niche);
      const now = Date.now();
      const styleDNA = await synthStyleDNA({
        family: payload.family,
        name,
        niche: identity.niche,
        persona: identity.persona,
        styleGrammar: identity.styleGrammar,
        palette: identity.palette,
        competitorTitles: signals.titles,
        powerWords: signals.powerWords,
        thumbnailStyleGuide: signals.thumbnailStyleGuide,
        databank: signals.databank,
        exampleClipNotes,
        now,
        log,
      });
      if (styleDNA.confidence < ESTABLISHED_CONFIDENCE || styleDNA.groundingGaps.length) {
        throw new Error(
          `Style DNA is not established (confidence ${styleDNA.confidence}, ` +
          `${styleDNA.groundingGaps.length} unresolved gap(s))`,
        );
      }
      const qualityBar = buildQualityBar(payload.family, styleDNA, now);
      const creativeBrief = await synthShowBible({
        family: payload.family,
        name,
        niche: identity.niche,
        persona: identity.persona,
        styleGrammar: identity.styleGrammar,
        competitorContext: signals.competitorContext,
        motifHint: styleDNA.recurringSubject || undefined,
        now,
        log,
      });
      identity.creativeBrief = creativeBrief;
      await convex.mutation(api.channels.updateChannel, {
        channelId,
        name,
        identity,
        styleDNA,
        qaRubric: qualityBar,
      });
      const value: PositioningState = {
        name,
        identity,
        styleDNA,
        qualityBar,
        creativeBrief,
        competitorCount: signals.competitorCount,
      };
      return {
        value,
        evidence: {
          confidence: styleDNA.confidence,
          groundingGaps: styleDNA.groundingGaps,
          competitorCount: signals.competitorCount,
        },
        outputFingerprint: channelInceptionContentSha256({
          ...value,
          identity: positioningIdentityProjection(identity),
        }),
      };
    },
  });

  const loadSeo = async () => {
    const channel = await currentChannel(convex, channelId);
    const identity = asIdentity(channel.identity);
    const needsScript = plan.familyPolicy.requiresNarrativePlaybook;
    if (identity.topicPool.length < 5 || (needsScript && !channel.scriptPlaybook)) return undefined;
    return {
      value: identity,
      evidence: { topics: identity.topicPool.length, scriptPlaybook: Boolean(channel.scriptPlaybook) },
      outputFingerprint: channelInceptionContentSha256({
        identity: seoIdentityProjection(identity),
        scriptPlaybook: needsScript ? channel.scriptPlaybook : null,
      }),
    };
  };
  const seoIdentity = await runStage("channel-inception-seo", {
    loadCompleted: loadSeo,
    adoptExisting: existingAtStart ? loadSeo : undefined,
    execute: async () => {
      const channel = await currentChannel(convex, channelId);
      const identity = asIdentity(channel.identity);
      const optimized = await optimizeTopics({
        convex,
        ownerId,
        channelId,
        keyPrefix: channelPrefix(ownerId, slug),
        count: 24,
        identity,
        log,
      });
      const topicPool = Array.from(new Set([
        ...identity.topicPool,
        ...optimized.map((entry) => entry.topic),
      ]));
      let scriptPlaybook = channel.scriptPlaybook;
      if (plan.familyPolicy.requiresNarrativePlaybook) {
        const signals = await groundingSignals(convex, ownerId, identity.niche);
        const { distillScriptPlaybook } = await import("@/lib/scriptLab");
        scriptPlaybook = await distillScriptPlaybook({
          refs: signals.topVideos,
          dna: positioning.styleDNA,
          channelName: positioning.name,
          positioning: positioning.creativeBrief.positioning,
          log,
        });
      }
      const nextIdentity = { ...identity, topicPool };
      await convex.mutation(api.channels.updateChannel, {
        channelId,
        identity: nextIdentity,
        ...(scriptPlaybook ? { scriptPlaybook } : {}),
      });
      return {
        value: nextIdentity,
        evidence: {
          optimizedTopics: optimized.length,
          topicPool: topicPool.length,
          narrativePlaybook: Boolean(scriptPlaybook),
        },
        outputFingerprint: channelInceptionContentSha256({
          identity: seoIdentityProjection(nextIdentity),
          scriptPlaybook: plan.familyPolicy.requiresNarrativePlaybook ? scriptPlaybook : null,
        }),
      };
    },
  });

  let voiceCasting: VoiceCastingSlim | undefined;
  const voiceStage = channelInceptionStage(plan, "channel-inception-voice");
  if (voiceStage) {
    if (plan.familyPolicy.voiceOwnership === "family-engine") {
      const delegatedVoiceProof = {
        value: undefined,
        evidence: {
          ownership: "family-engine",
          coldOpenProofOwner: "family-probe",
          auditionEvidenceRequiredHere: false,
        },
        completionStatus: "accepted" as const,
      };
      await runStage("channel-inception-voice", {
        loadCompleted: async () => delegatedVoiceProof,
        adoptExisting: async () => delegatedVoiceProof,
        execute: async () => delegatedVoiceProof,
      });
    } else {
      const loadVoice = async () => {
        const cast = asIdentity((await currentChannel(convex, channelId)).identity).voiceCasting;
        const validation = {
          cast,
          ownerId,
          channelId: String(channelId),
        };
        return validateVoiceCastingReadinessReceipt(validation)
          ? {
              value: validation.cast,
              evidence: {
                auditionReceipt: validation.cast.auditionReceipt,
                coldOpenReceipt: validation.cast.coldOpenReceipt,
              },
              outputFingerprint: voiceCastingOutputFingerprint(validation.cast),
            }
          : undefined;
      };
      voiceCasting = await runStage("channel-inception-voice", {
        maximumAttempts: 3,
        loadCompleted: loadVoice,
        adoptExisting: loadVoice,
        execute: async () => {
          const { castVoice, gateColdOpen } = await import("@/lib/voicecraft");
          const cast = await castVoice({
            convex,
            ownerId,
            channelName: positioning.name,
            niche: seoIdentity.niche,
            persona: seoIdentity.persona,
            register: JSON.stringify(positioning.styleDNA.narrative ?? {}),
            log,
          });
          if (!cast || cast.score < 7) throw new Error("voice audition did not produce a qualified winner");
          const judgedAt = Date.now();
          const auditionReceipt = makeVoiceCastingAuditionReceipt({
            ownerId,
            channelId: String(channelId),
            voiceId: cast.voiceId,
            score: cast.score,
            judgedAt,
            auditioned: cast.auditioned,
            verdict: {
              winner: cast.voiceId,
              score: cast.score,
              why: cast.why,
              physics: cast.physics,
            },
          });
          const sampleTopic = seoIdentity.topicPool[0] ?? seoIdentity.niche;
          const coldOpenText =
            `${sampleTopic} looks simple until one overlooked detail changes the whole picture. ` +
            `Follow that detail carefully, because it reveals what most explanations leave out.`;
          const coldOpen = await gateColdOpen({
            text: coldOpenText,
            elevenVoiceId: cast.voiceId,
            physics: cast.physics,
            seed: 4242,
            log,
          });
          const slim: VoiceCastingSlim = {
            voiceId: cast.voiceId,
            name: cast.name,
            character: cast.character.slice(0, 300),
            score: cast.score,
            why: cast.why.slice(0, 300),
            at: judgedAt,
            auditionReceipt,
            coldOpenReceipt: makeVoiceColdOpenReceipt({
              ownerId,
              channelId: String(channelId),
              voiceId: cast.voiceId,
              judgedAt: Date.now(),
              seed: coldOpen.seed,
              text: coldOpenText,
              physics: cast.physics,
              verdict: coldOpen.verdict,
            }),
          };
          await mergeIdentity(convex, channelId, { voiceCasting: slim });
          return {
            value: slim,
            evidence: {
              auditionReceipt: slim.auditionReceipt,
              coldOpenReceipt: slim.coldOpenReceipt,
            },
            outputFingerprint: voiceCastingOutputFingerprint(slim),
          };
        },
      });
    }
  }

  const avatarStage = channelInceptionStage(plan, "channel-inception-avatar")!;
  const bannerStage = channelInceptionStage(plan, "channel-inception-banner")!;
  const artIdentity = {
    name: positioning.name,
    persona: positioning.identity.persona,
    styleGrammar: positioning.identity.styleGrammar,
    palette: positioning.identity.palette,
    niche: positioning.identity.niche,
    iconicMotif: positioning.creativeBrief.iconicMotif,
    vibe: positioning.creativeBrief.vibe,
  };
  const loadAvatar = async () => {
    const imageKey = asIdentity((await currentChannel(convex, channelId)).identity).imageKey;
    return imageKey ? { value: imageKey, evidence: { imageKey, protected: true } } : undefined;
  };
  await runStage("channel-inception-avatar", {
    maximumAttempts: 3,
    loadCompleted: loadAvatar,
    adoptExisting: loadAvatar,
    execute: async () => {
      const imageKey = await generateChannelArtAsset(
        ownerId,
        slug,
        "avatar",
        artIdentity,
        log,
        {
          version: { avatar: avatarStage.inputFingerprint.slice(0, 20) },
          maxProviderSpendUsd: avatarStage.maximumCostUsd,
          providerLifecycle: {
            ownerId,
            channelId,
            runId: runtime.runId,
            blockId: "channel-inception-avatar",
          },
        },
      );
      await mergeIdentity(convex, channelId, { imageKey });
      return { value: imageKey, evidence: { imageKey } };
    },
  });
  const loadBanner = async () => {
    const bannerKey = asIdentity((await currentChannel(convex, channelId)).identity).bannerKey;
    return bannerKey ? { value: bannerKey, evidence: { bannerKey, protected: true } } : undefined;
  };
  await runStage("channel-inception-banner", {
    maximumAttempts: 3,
    loadCompleted: loadBanner,
    adoptExisting: loadBanner,
    execute: async () => {
      const bannerKey = await generateChannelArtAsset(
        ownerId,
        slug,
        "banner",
        artIdentity,
        log,
        {
          version: { banner: bannerStage.inputFingerprint.slice(0, 20) },
          maxProviderSpendUsd: bannerStage.maximumCostUsd,
          providerLifecycle: {
            ownerId,
            channelId,
            runId: runtime.runId,
            blockId: "channel-inception-banner",
          },
        },
      );
      await mergeIdentity(convex, channelId, { bannerKey });
      return { value: bannerKey, evidence: { bannerKey } };
    },
  });

  const thumbnailStage = channelInceptionStage(plan, "channel-inception-thumbnails")!;
  const loadThumbnails = async () => {
    const channel = await currentChannel(convex, channelId);
    const rows = await readyPlanRows(convex, ownerId, channelId);
    const withThumbnails = rows.filter((row: { thumbnailKey?: string }) => Boolean(row.thumbnailKey));
    if (!channel.thumbnailPlaybook || withThumbnails.length < thumbnailStage.params.previews.targetCount) return undefined;
    const thumbnailKeys = withThumbnails
      .map((row: { thumbnailKey?: string }) => row.thumbnailKey!)
      .sort()
      .slice(0, thumbnailStage.params.previews.targetCount);
    const artifactFingerprints = withThumbnails
      .map((row) => readyPlanArtifactFingerprint(row))
      .filter((fingerprint): fingerprint is string => Boolean(fingerprint))
      .sort()
      .slice(0, thumbnailStage.params.previews.targetCount);
    if (artifactFingerprints.length < thumbnailStage.params.previews.targetCount) return undefined;
    return {
      value: { playbook: channel.thumbnailPlaybook, ready: thumbnailKeys.length },
      evidence: {
        ready: thumbnailKeys.length,
        playbook: true,
        thumbnailKeys,
        artifactFingerprints,
      },
      outputFingerprint: channelInceptionContentSha256({
        playbook: channel.thumbnailPlaybook,
        artifactFingerprints,
      }),
    };
  };
  const dispatchStarterPlan = async (
    playbook: { patterns?: unknown[]; source?: unknown },
    controls: ChannelInceptionExecutionControls,
    checkpoint?: unknown,
  ) => {
    const targetCount = thumbnailStage.params.previews.targetCount;
    const before = await readyPlanSnapshot(convex, ownerId, channelId);
    if (before.transientCount > 0 && before.rows.length < targetCount) {
      throw new Error(
        "starter artifact verification temporarily unavailable; paid replacement dispatch is paused",
      );
    }
    const checkpointPhase = checkpoint && typeof checkpoint === "object"
      ? (checkpoint as { phase?: unknown }).phase
      : undefined;
    const liveFingerprints = before.rows
      .map(readyPlanArtifactFingerprint)
      .filter((fingerprint): fingerprint is string => Boolean(fingerprint));
    const dispatch = starterPlanDispatchDecision({
      targetCount,
      approvedMissingCount: thumbnailStage.params.previews.missingCount,
      acceptedFingerprints: thumbnailStage.params.previews.acceptedFingerprints,
      liveFingerprints,
      checkpointPhase,
    });
    if (dispatch.missingCount > 0) {
      await controls.checkpoint({
        phase: "starter-plan-dispatch",
        childRequestKey: thumbnailStage.idempotencyKey,
      });
      const { idempotencyKeys, tasks } = await import("@trigger.dev/sdk");
      const idempotencyKey = await idempotencyKeys.create(
        `${thumbnailStage.idempotencyKey}:plan-week-ahead:${runtime.runId}:attempt-${runtime.attempt}`,
        { scope: "global" },
      );
      const childResult = await tasks.triggerAndWait(
        "plan-week-ahead",
        {
          ownerId,
          channelId,
          count: dispatch.missingCount,
          requestKey: thumbnailStage.idempotencyKey,
          budgetCapUsd: thumbnailStage.maximumCostUsd,
        },
        { idempotencyKey },
      );
      assertStarterPlanChildSucceeded(childResult);
      await controls.checkpoint({
        phase: "starter-plan-child-finished",
        childRequestKey: thumbnailStage.idempotencyKey,
      });
    }
    const completed = await loadThumbnails();
    if (!completed) {
      const after = await readyPlanSnapshot(convex, ownerId, channelId);
      if (after.transientCount > 0 && after.rows.length < targetCount) {
        throw new Error(
          "starter artifact verification temporarily unavailable after child completion",
        );
      }
      const ready = after.rows.length;
      throw new Error(
        `artifact_repair_required: starter slate incomplete (${ready}/${targetCount} live admitted thumbnails); ` +
        "a fresh approved plan intent is required",
      );
    }
    return {
      ...completed,
      evidence: {
        ...completed.evidence,
        patterns: playbook.patterns?.length ?? 0,
        source: playbook.source,
      },
    };
  };
  await runStage("channel-inception-thumbnails", {
    maximumAttempts: 3,
    providerStart: "explicit",
    loadCompleted: loadThumbnails,
    adoptExisting: existingAtStart ? loadThumbnails : undefined,
    recover: async (checkpoint, controls) => {
      const completed = await loadThumbnails();
      if (completed) return completed;
      const channel = await currentChannel(convex, channelId);
      if (!channel.thumbnailPlaybook) return undefined;
      return dispatchStarterPlan(channel.thumbnailPlaybook, controls, checkpoint);
    },
    execute: async (_checkpoint, controls) => {
      const {
        acquireReferences,
        buildStyleDnaPlaybook,
        distillPlaybook,
        verifyReferences,
      } = await import("@/lib/thumbnailLab");
      const { makeRunTempDir } = await import("@/lib/files");
      const positioningText = positioning.creativeBrief.positioning || seoIdentity.persona;
      await controls.markProviderStarted({ phase: "thumbnail-lab" });
      let fresh: Awaited<ReturnType<typeof acquireReferences>> = [];
      try {
        fresh = await acquireReferences({
          channelName: positioning.name,
          positioning: positioningText,
          niche: seoIdentity.niche,
          log,
        });
      } catch (error) {
        log(`thumbnail references unavailable; using Style DNA: ${errorMessage(error)}`);
      }
      const temp = await makeRunTempDir(`lab_${slug}`);
      let playbook;
      try {
        const refs = await verifyReferences({
          candidates: fresh,
          channelName: positioning.name,
          positioning: positioningText,
          tmpDir: temp,
          log,
        });
        playbook = await distillPlaybook({
          refs,
          dna: positioning.styleDNA,
          channelName: positioning.name,
          positioning: positioningText,
          log,
        });
      } catch (error) {
        playbook = buildStyleDnaPlaybook({
          dna: positioning.styleDNA,
          family: payload.family,
          channelName: positioning.name,
          now: Date.now(),
        });
        log(`thumbnail lab used established Style DNA foundation: ${errorMessage(error)}`);
      }
      await convex.mutation(api.channels.updateChannel, { channelId, thumbnailPlaybook: playbook });
      return dispatchStarterPlan(playbook, controls, _checkpoint);
    },
  });

  const loadPipeline = async () => {
    const channel = await currentChannel(convex, channelId);
    if (!channel.architectReport || !channel.pipeline?.length) return undefined;
    const moduleConfig = (channel as {
      moduleConfig?: Record<string, Record<string, unknown>>;
    }).moduleConfig ?? {};
    let certification: ChannelPipelineCertification;
    try {
      certification = certifyChannelPipeline({
        pipeline: channel.pipeline as PipelineEntry[],
        moduleConfig,
        disabledBlocks,
        family: payload.family,
        requestFingerprint: plan.requestFingerprint,
        pipelineSourceFingerprint: plan.requestSnapshot.pipelineSourceFingerprint ?? "",
      });
    } catch {
      return undefined;
    }
    const persistedCertification = (channel.architectReport as {
      inceptionCertification?: unknown;
    }).inceptionCertification;
    if (!pipelineCertificationMatches(persistedCertification, certification)) return undefined;
    return {
      value: channel.pipeline as PipelineEntry[],
      evidence: {
        blocks: channel.pipeline.length,
        fingerprint: channelInceptionContentSha256(channel.pipeline),
        certification,
      },
      outputFingerprint: channelInceptionContentSha256({
        pipeline: channel.pipeline,
        moduleConfig,
        certification,
      }),
    };
  };
  const effectivePipeline = await runStage("channel-inception-pipeline", {
    maximumAttempts: 3,
    loadCompleted: loadPipeline,
    adoptExisting: existingAtStart ? loadPipeline : undefined,
    execute: async () => {
      const customized = customizePipelineFromDna(design.pipeline, positioning.identity, positioning.styleDNA);
      if (customized.changed.length) log(`pipeline customized from DNA: ${customized.changed.join(", ")}`);
      const architect = await architectPipeline({
        family: payload.family,
        channelName: positioning.name,
        niche: seoIdentity.niche,
        persona: seoIdentity.persona,
        pipeline: customized.pipeline,
        dna: positioning.styleDNA,
        bible: positioning.creativeBrief,
        qualityBar: positioning.qualityBar,
        competitorCount: positioning.competitorCount,
        disabledBlocks,
        voiceCasting: voiceCasting
          ? {
              voiceId: voiceCasting.voiceId,
              name: voiceCasting.name ?? voiceCasting.voiceId,
              character: voiceCasting.character ?? "channel narrator",
              why: voiceCasting.why ?? "qualified audition winner",
            }
          : null,
        log,
      });
      let pipeline = architect?.pipeline ?? customized.pipeline;
      let report = architect?.report;

      const forgeable = report?.missingCapabilities.slice(0, 2) ?? [];
      if (forgeable.length) {
        try {
          const { authorForgedModule } = await import("@/engine/forge/forge");
          const { registerForgedSpecs } = await import("@/engine/forge/runtime");
          const { toolFromForgedSpec } = await import("@/engine/creative/architect");
          const forgedTools = [];
          for (const capability of forgeable) {
            const result = await authorForgedModule({
              capability,
              channelName: positioning.name,
              niche: seoIdentity.niche,
              dna: positioning.styleDNA,
              log,
            });
            if ("error" in result) continue;
            await convex.mutation(api.forgedModules.save, {
              ownerId,
              blockId: result.spec.id,
              spec: result.spec,
              status: "active",
              forChannelId: channelId,
              capability: capability.name,
            });
            registerForgedSpecs([result.spec]);
            forgedTools.push(toolFromForgedSpec(result.spec));
          }
          if (forgedTools.length) {
            const second = await architectPipeline({
              family: payload.family,
              channelName: positioning.name,
              niche: seoIdentity.niche,
              persona: seoIdentity.persona,
              pipeline,
              dna: positioning.styleDNA,
              bible: positioning.creativeBrief,
              qualityBar: positioning.qualityBar,
              competitorCount: positioning.competitorCount,
              disabledBlocks,
              forgedTools,
              log,
            });
            if (second) {
              pipeline = second.pipeline;
              report = Object.assign({}, second.report, {
                forged: forgedTools.map((tool) => tool.block),
              });
            }
          }
        } catch (error) {
          log(`forge loop failed without replacing the validated floor: ${errorMessage(error)}`);
        }
      }
      const completed = completePipelineForPolicy(withLengthLaw(pipeline)).entries;
      const wired = wireVoiceReadiness(completed, voiceCasting, ownerId, channelId);
      const channelBeforePersist = await currentChannel(convex, channelId);
      const moduleConfig = (channelBeforePersist as {
        moduleConfig?: Record<string, Record<string, unknown>>;
      }).moduleConfig ?? {};
      if (
        channelInceptionContentSha256(moduleConfig) !==
          plan.requestSnapshot.moduleConfigFingerprint
      ) {
        throw new Error("module configuration changed before pipeline certification");
      }
      const certification = certifyChannelPipeline({
        pipeline: wired.pipeline,
        moduleConfig,
        disabledBlocks,
        family: payload.family,
        requestFingerprint: plan.requestFingerprint,
        pipelineSourceFingerprint: plan.requestSnapshot.pipelineSourceFingerprint ?? "",
      });
      await convex.mutation(api.channels.updateChannel, {
        channelId,
        pipeline: wired.pipeline,
        architectReport: {
          ...(report ?? {
            summary: "deterministic family pipeline retained",
            applied: [],
            rejected: [],
            missingCapabilities: [],
            groundingActions: [],
          }),
          inceptionCertification: certification,
        },
      });
      return {
        value: wired.pipeline,
        evidence: {
          blocks: wired.pipeline.length,
          wiredVoiceModules: wired.wired,
          fingerprint: channelInceptionContentSha256(wired.pipeline),
          preservesSpecializedEntries: true,
          certification,
        },
        outputFingerprint: channelInceptionContentSha256({
          pipeline: wired.pipeline,
          moduleConfig,
          certification,
        }),
      };
    },
  });

  let probeOutcome: ProbeOutcome = {
    ok: false,
    attempts: 0,
    error: design.available ? "probe not run" : "family engine unavailable",
  };
  const probeStage = channelInceptionStage(plan, "channel-inception-probe");
  if (probeStage) {
    const stageCapUsd = Math.min(
      probeStage.maximumCostUsd,
      admission.probeCapUsd,
      MAX_CHANNEL_INCEPTION_PROBE_COST_USD,
    );
    const parentProbeApproval = payload.probeApproval;
    if (!parentProbeApproval || stageCapUsd <= 0) {
      throw new Error("probe execution requires its persisted signed cost admission");
    }
    const executeProbe = async (
      checkpoint: unknown,
      controls: ChannelInceptionExecutionControls,
    ) => {
      const prior = checkpoint as ProbeCheckpoint | undefined;
      if (
        prior?.version !== undefined &&
        prior.version !== CHANNEL_INCEPTION_PROBE_CHECKPOINT_VERSION
      ) {
        throw new Error("unsupported channel inception probe checkpoint version");
      }
      const attempts = structuredClone(prior?.attempts ?? []);
      const repairsApplied = [...(prior?.repairsApplied ?? [])];
      let review = prior?.review;
      let quality = prior?.quality;
      let dialInAttempted = prior?.dialInAttempted === true;
      let spend = summarizeChannelInceptionProbeSpend(attempts, stageCapUsd);
      if (
        (prior?.stageCapUsd !== undefined && prior.stageCapUsd !== stageCapUsd) ||
        (prior?.actualSpendUsd !== undefined &&
          Math.abs(prior.actualSpendUsd - spend.actualSpendUsd) > Number.EPSILON) ||
        (prior?.committedSpendUsd !== undefined &&
          Math.abs(prior.committedSpendUsd - spend.committedSpendUsd) > Number.EPSILON)
      ) {
        throw new Error("probe durable spend checkpoint does not reconcile");
      }
      let providerCheckpointed = attempts.length > 0;
      const checkpointProbe = async (providerStart = false) => {
        spend = summarizeChannelInceptionProbeSpend(attempts, stageCapUsd);
        const next: ProbeCheckpoint = {
          version: CHANNEL_INCEPTION_PROBE_CHECKPOINT_VERSION,
          stageCapUsd,
          actualSpendUsd: spend.actualSpendUsd,
          committedSpendUsd: spend.committedSpendUsd,
          attempts,
          repairsApplied,
          ...(review ? { review } : {}),
          ...(quality ? { quality } : {}),
          dialInAttempted,
        };
        if (providerStart && !providerCheckpointed) {
          await controls.markProviderStarted(next);
          providerCheckpointed = true;
        } else {
          await controls.checkpoint(next);
        }
      };
      const { tasks, idempotencyKeys } = await import("@trigger.dev/sdk");
      let outcome: ProbeOutcome = { ok: false, attempts: attempts.length };

      for (
        let attemptNumber = 1;
        attemptNumber <= Math.min(
          probeStage.params.maximumAttempts,
          MAX_CHANNEL_INCEPTION_PROBE_ATTEMPTS,
        );
        attemptNumber++
      ) {
        let reference = attempts[attemptNumber - 1];
        let envelope: ChannelInceptionProbeAttemptCheckpoint;
        let probeRunId: Id<"runs">;

        if (reference) {
          probeRunId = reference.runId as Id<"runs">;
          const existingRun = await convex.query(api.runs.getRun, { runId: probeRunId });
          const persistedEnvelope = existingRun?.probeDispatchEnvelope as
            | ChannelInceptionProbeAttemptCheckpoint
            | undefined;
          if (!persistedEnvelope) {
            throw new Error("probe attempt reference has no durable dispatch envelope");
          }
          envelope = persistedEnvelope;
          assertChannelInceptionProbeAttempt(envelope);
          if (
            envelope.attempt !== attemptNumber ||
            envelope.dispatchEnvelopeFingerprint !== reference.dispatchEnvelopeFingerprint ||
            envelope.approvalFingerprint !== reference.approvalFingerprint ||
            envelope.maximumCostUsd !== reference.maximumCostUsd ||
            envelope.input.productionFingerprint !== reference.productionFingerprint
          ) {
            throw new Error("probe attempt reference does not match its durable dispatch envelope");
          }
        } else {
          spend = summarizeChannelInceptionProbeSpend(attempts, stageCapUsd);
          if (spend.activeAttempt !== undefined) {
            throw new Error("cannot allocate another probe child while authority is committed");
          }
          const maximumCostUsd = spend.remainingAuthorityUsd;
          if (maximumCostUsd <= Number.EPSILON) break;
          probeRunId = await convex.mutation(api.runs.createProbeRun, {
            ownerId,
            channelId,
            dispatchKey: `${probeStage.idempotencyKey}:attempt:${attemptNumber}`,
          });
          const preclaimedRun = await convex.query(api.runs.getRun, { runId: probeRunId });
          const preclaimedEnvelope = preclaimedRun?.probeDispatchEnvelope as
            | ChannelInceptionProbeAttemptCheckpoint
            | undefined;
          if (preclaimedEnvelope) {
            // Crash-after-claim recovery: the run row is the write-once source
            // of truth even when the parent stage checkpoint was not reached.
            assertChannelInceptionProbeAttempt(preclaimedEnvelope);
            if (
              preclaimedEnvelope.attempt !== attemptNumber ||
              preclaimedEnvelope.ownerId !== ownerId ||
              preclaimedEnvelope.channelId !== String(channelId) ||
              preclaimedEnvelope.runId !== String(probeRunId) ||
              preclaimedEnvelope.maximumCostUsd !== maximumCostUsd
            ) {
              throw new Error("preclaimed probe dispatch does not match the active stage authority");
            }
            envelope = preclaimedEnvelope;
          } else {
            const channelSnapshot = await currentChannel(convex, channelId);
            const pipelineOverride = buildProbePipeline(
              (channelSnapshot.pipeline ?? effectivePipeline) as PipelineEntry[],
            );
            const moduleConfigOverride = structuredClone(
              (channelSnapshot as {
                moduleConfig?: Record<string, Record<string, unknown>>;
              }).moduleConfig ?? {},
            );
            const input = freezeChannelInceptionProbeInput({
              pipelineOverride,
              moduleConfigOverride,
              invocationContext: freezeChannelInceptionProbeContext({
                ownerId,
                family: payload.family,
                channel: channelSnapshot,
              }),
              productionFingerprint: effectivePipelineFingerprint(channelSnapshot),
            });
            const approval = issueStudioActionApproval({
              action: "channel-inception-probe",
              ownerId,
              subject: pipelineProbeApprovalSubject({
                ownerId,
                channelId: String(channelId),
                runId: String(probeRunId),
                pipelineOverrideFingerprint: input.overrideFingerprint,
                maximumCostUsd,
              }),
              actor: parentProbeApproval.actor,
              evidence: `Bound child probe for ${parentProbeApproval.evidence}`,
              maxCostUsd: maximumCostUsd,
            });
            const prepared = prepareChannelInceptionProbeAttempt({
              attempt: attemptNumber,
              ownerId,
              channelId: String(channelId),
              runId: String(probeRunId),
              input,
              maximumCostUsd,
              approval,
            });
            const claimed = await convex.mutation(api.runs.claimProbeDispatchEnvelope, {
              ownerId,
              channelId,
              runId: probeRunId,
              envelope: prepared,
              fingerprint: prepared.dispatchEnvelopeFingerprint,
            });
            envelope = claimed.envelope as ChannelInceptionProbeAttemptCheckpoint;
            assertChannelInceptionProbeAttempt(envelope);
            if (
              claimed.fingerprint !== prepared.dispatchEnvelopeFingerprint ||
              envelope.dispatchEnvelopeFingerprint !== prepared.dispatchEnvelopeFingerprint
            ) {
              throw new Error("durable probe dispatch claim returned a different envelope");
            }
          }
          reference = referenceChannelInceptionProbeAttempt(envelope);
          attempts[attemptNumber - 1] = reference;
          // This checkpoint is durable before the Trigger boundary. A crash or
          // lost response therefore reuses this run, receipt, input and cap.
          await checkpointProbe(true);
        }

        let run = await convex.query(api.runs.getRun, { runId: probeRunId });
        if (run?.status !== "ok" && run?.status !== "failed" && run?.status !== "canceled") {
          const idempotencyKey = await idempotencyKeys.create(
            `${probeStage.idempotencyKey}:${probeRunId}`,
            { scope: "global" },
          );
          let dispatchError: unknown;
          try {
            await tasks.triggerAndWait(
              "run-pipeline",
              {
                channelId,
                runId: probeRunId,
                pipelineOverride: envelope.input.pipelineOverride,
                moduleConfigOverride: envelope.input.moduleConfigOverride,
                probeInvocationContext: envelope.input.invocationContext,
                probeAdmission: {
                  maximumCostUsd: envelope.maximumCostUsd,
                  approval: envelope.approval,
                  dispatchEnvelopeFingerprint: envelope.dispatchEnvelopeFingerprint,
                },
              },
              { concurrencyKey: String(channelId), idempotencyKey },
            );
          } catch (error) {
            dispatchError = error;
          }
          run = await convex.query(api.runs.getRun, { runId: probeRunId });
          if (
            run?.status !== "ok" &&
            run?.status !== "failed" &&
            run?.status !== "canceled"
          ) {
            throw dispatchError ?? new Error(
              "probe child response was lost before terminal reconciliation; retry will reattach",
            );
          }
        }
        if (!run) throw new Error("probe child run disappeared during reconciliation");

        const invocationSha256 = String(run.pipelineInvocationSha256 ?? "") || undefined;
        const invocation = run.pipelineInvocationSnapshot as {
          budgetUsd?: number;
          budgetAdmission?: {
            maximumCostUsd?: number;
            receiptFingerprint?: string;
            pipelineOverrideFingerprint?: string;
          };
        } | undefined;
        const frozenBudget = Number(invocation?.budgetUsd);
        const expectedFrozenBudget = channelInceptionProbeEffectiveBudgetUsd(
          envelope.input.invocationContext,
          envelope.maximumCostUsd,
        );
        if (
          invocationSha256 &&
          (!/^[a-f0-9]{64}$/.test(invocationSha256) ||
            !Number.isFinite(frozenBudget) ||
            frozenBudget !== expectedFrozenBudget ||
            invocation?.budgetAdmission?.maximumCostUsd !== envelope.maximumCostUsd ||
            invocation?.budgetAdmission?.receiptFingerprint !== envelope.approvalFingerprint ||
            invocation?.budgetAdmission?.pipelineOverrideFingerprint !==
              envelope.input.overrideFingerprint)
        ) {
          throw new Error("probe child invocation snapshot escaped its frozen dispatch envelope");
        }
        if (
          run.status === "failed" &&
          (run.leaseRecoveryPending === true ||
            /resuming the exact durable invocation/i.test(String(run.error ?? "")))
        ) {
          throw new Error(
            "probe child has a recoverable exact invocation; same-run recovery must finish before reconciliation",
          );
        }
        const terminalStatus = run.status as "ok" | "failed" | "canceled";
        const spendStages = await convex.query(api.runStages.listRunStages, {
          runId: probeRunId,
        }) as ProbeRunStage[];
        const actualSpendUsd = channelInceptionProbeObservedSpend({
          maximumCostUsd: envelope.maximumCostUsd,
          runCostTotal: run.costTotal,
          runStatus: terminalStatus,
          runError: run.error,
          stages: spendStages,
        });
        const reconciled = reconcileChannelInceptionProbeAttempt({
          attempt: envelope,
          status: terminalStatus,
          actualSpendUsd,
          ...(invocationSha256 ? { invocationSha256 } : {}),
        });
        attempts[attemptNumber - 1] = referenceChannelInceptionProbeAttempt(reconciled);
        await checkpointProbe();

        if (terminalStatus === "ok") {
          const qaStage = spendStages.find(
            (stage) => stage.block === "qa_visual" && stage.status === "ok",
          );
          quality = assessChannelInceptionProbeQuality(qaStage?.outputs);
          review = reviewProbeArtifacts(spendStages);
          outcome = {
            ok: quality.status === "accepted",
            attempts: attemptNumber,
            ...(quality.status === "rejected"
              ? { error: `golden probe QA rejected: ${quality.reasons.join("; ").slice(0, 260)}` }
              : {}),
            quality,
            pipelineFingerprint: reconciled.invocationSha256,
            productionFingerprint: reconciled.input.productionFingerprint,
            invocationSha256: reconciled.invocationSha256,
            runId: reconciled.runId,
            dispatchEnvelopeFingerprint: reconciled.dispatchEnvelopeFingerprint,
            actualSpendUsd: summarizeChannelInceptionProbeSpend(attempts, stageCapUsd)
              .actualSpendUsd,
          };
          await checkpointProbe();
          if (!dialInAttempted) {
            // Review is evidence only. Mutating the graph here would sever the
            // artifact from the exact invocation snapshot that passed.
            dialInAttempted = true;
            await checkpointProbe();
          }
          break;
        }

        const error = String(run.error ?? "unknown probe failure");
        outcome = {
          ok: false,
          attempts: attemptNumber,
          error: error.slice(0, 300),
          actualSpendUsd: summarizeChannelInceptionProbeSpend(attempts, stageCapUsd)
            .actualSpendUsd,
        };
        if (
          attemptNumber < probeStage.params.maximumAttempts &&
          summarizeChannelInceptionProbeSpend(attempts, stageCapUsd).remainingAuthorityUsd >
            Number.EPSILON &&
          !repairsApplied.includes(attemptNumber)
        ) {
          const failedBlock = (spendStages as { block?: string; status?: unknown }[])
            .find((stage) => stage.status === "failed")?.block;
          const fix = await architectPipeline({
            family: payload.family,
            channelName: positioning.name,
            niche: seoIdentity.niche,
            persona: seoIdentity.persona,
            pipeline: ((await currentChannel(convex, channelId)).pipeline ?? effectivePipeline) as PipelineEntry[],
            dna: positioning.styleDNA,
            bible: positioning.creativeBrief,
            qualityBar: positioning.qualityBar,
            competitorCount: positioning.competitorCount,
            disabledBlocks,
            probeReport: { ok: false, error, failedBlock },
            log,
          });
          if (fix) {
            await convex.mutation(api.channels.updateChannel, {
              channelId,
              pipeline: completePipelineForPolicy(withLengthLaw(fix.pipeline)).entries,
              architectReport: {
                ...fix.report,
                probeFix: { attempt: attemptNumber, error: error.slice(0, 200), failedBlock },
              },
            });
          }
          repairsApplied.push(attemptNumber);
          await checkpointProbe();
        }
      }
      spend = summarizeChannelInceptionProbeSpend(attempts, stageCapUsd);
      return {
        value: outcome,
        evidence: {
          probe: outcome,
          version: CHANNEL_INCEPTION_PROBE_CHECKPOINT_VERSION,
          stageCapUsd,
          actualSpendUsd: spend.actualSpendUsd,
          committedSpendUsd: spend.committedSpendUsd,
          attempts,
          repairsApplied,
          ...(review ? { review } : {}),
          ...(quality ? { quality } : {}),
          dialInAttempted,
        },
      };
    };
    probeOutcome = await runStage("channel-inception-probe", {
      maximumAttempts: 3,
      providerStart: "explicit",
      loadCompleted: async () => {
        const outputs = await inceptionStageOutputs(convex, channelId, "channel-inception-probe");
        const probe = (outputs as { probe?: ProbeOutcome } | undefined)?.probe;
        return probe ? { value: probe, evidence: outputs } : undefined;
      },
      execute: executeProbe,
      recover: executeProbe,
    });
  }

  const readiness = await runStage("channel-inception-readiness", {
    // Readiness is a live projection over mutable channel state. Re-evaluate it
    // on every coordinator run instead of trusting a historical projection.
    loadCompleted: async () => undefined,
    execute: async () => {
      const channel = await currentChannel(convex, channelId);
      const identity = asIdentity(channel.identity);
      const plans = await readyPlanRows(convex, ownerId, channelId);
      const acceptedThumbnailCount = plans.filter((row: { thumbnailKey?: string }) => Boolean(row.thumbnailKey)).length;
      const blockers: string[] = [];
      const dna = channel.styleDNA as StyleDNA | undefined;
      if (!design.available) blockers.push("family engine is not available");
      if (!dna || dna.confidence < ESTABLISHED_CONFIDENCE || dna.groundingGaps.length) {
        blockers.push("Style DNA is not established");
      }
      if (!identity.creativeBrief) blockers.push("Show Bible is missing");
      if (!identity.imageKey) blockers.push("accepted avatar is missing");
      if (!identity.bannerKey) blockers.push("accepted banner is missing");
      if (!channel.thumbnailPlaybook) blockers.push("thumbnail playbook is missing");
      if (acceptedThumbnailCount < thumbnailStage.params.previews.targetCount) {
        blockers.push(`starter thumbnails incomplete (${acceptedThumbnailCount}/${thumbnailStage.params.previews.targetCount})`);
      }
      if (
        plan.familyPolicy.voiceOwnership === "channel-cast" &&
        !validateVoiceCastingReadinessReceipt({
          cast: identity.voiceCasting,
          ownerId,
          channelId: String(channelId),
        })
      ) {
        blockers.push("qualified audition and cold-open voice proof is missing");
      } else if (plan.familyPolicy.voiceOwnership === "channel-cast") {
        const voiceWiring = validatePipelineVoiceWiring(
          channel.pipeline ?? [],
          identity.voiceCasting,
          ownerId,
          channelId,
        );
        if (!voiceWiring.ok) blockers.push(voiceWiring.reason);
      }
      if (!probeStage) blockers.push("end-to-end validation render was not explicitly admitted");
      else if (
        probeOutcome.quality?.status !== "accepted" ||
        probeOutcome.quality.reasons.length > 0 ||
        !/^[a-f0-9]{64}$/.test(probeOutcome.quality.qaEvidenceFingerprint)
      ) {
        blockers.push("validation render is missing explicit accepted golden QA evidence");
      } else if (!probeOutcome.ok) blockers.push("bounded end-to-end probe did not pass");
      else if (
        !probeOutcome.invocationSha256 ||
        probeOutcome.pipelineFingerprint !== probeOutcome.invocationSha256 ||
        !probeOutcome.runId ||
        !probeOutcome.dispatchEnvelopeFingerprint
      ) {
        blockers.push("validation render is missing its exact invocation proof");
      } else if (probeOutcome.productionFingerprint !== effectivePipelineFingerprint(channel)) {
        blockers.push("pipeline or module configuration changed after the validation render");
      }
      if (!channel.pipeline?.length) blockers.push("effective pipeline is missing");
      const projection: ReadinessProjection = {
        status: blockers.length ? "draft" : "paused",
        blockers,
        effectiveModules: (channel.pipeline ?? []).map((entry: { block: string }) => entry.block),
        avatarKey: identity.imageKey,
        bannerKey: identity.bannerKey,
        acceptedThumbnailCount,
        probe: probeOutcome,
        // Catalog mapping remains distinct from immutable Golden promotion.
        goldenQualified: false,
      };
      await convex.mutation(api.channels.updateChannel, {
        channelId,
        status: projection.status,
      });
      return {
        value: projection,
        evidence: { projection },
        completionStatus: blockers.length ? "blocked" : "complete",
      };
    },
  });

  if (!payload.cadence) {
    const channel = await currentChannel(convex, channelId);
    const report = channel.architectReport as {
      schedule?: { frequency: string; days?: number[] };
      budgetAllocation?: string;
    } | undefined;
    if (report?.schedule) {
      await convex.mutation(api.channels.updateChannel, {
        channelId,
        schedule: { frequency: report.schedule.frequency, days: report.schedule.days },
      });
    }
  }

  if (readiness.status === "paused" && youtubeCreationApproved) {
    try {
      const { idempotencyKeys, tasks } = await import("@trigger.dev/sdk");
      const creationRequestKey = youtubeChannelCreationRequestKey({
        ownerId,
        channelId: String(channelId),
        intentKey: requestKey,
        name: requestedYoutubeName,
        handle: requestedYoutubeHandle,
      });
      const approval = issueStudioActionApproval({
        action: "youtube-channel-create",
        ownerId,
        subject: youtubeChannelApprovalSubject({
          ownerId,
          channelId: String(channelId),
          requestKey: creationRequestKey,
          name: requestedYoutubeName,
          handle: requestedYoutubeHandle,
        }),
        actor: payload.youtubeCreationApproval!.actor,
        evidence: payload.youtubeCreationApproval!.evidence,
      });
      const idempotencyKey = await idempotencyKeys.create(
        `youtube-create-channel:${creationRequestKey}`,
      );
      await tasks.trigger(
        "youtube-create-channel",
        {
          name: requestedYoutubeName,
          handle: requestedYoutubeHandle,
          channelId,
          ownerId,
          requestKey: creationRequestKey,
          approval,
        },
        { idempotencyKey },
      );
      log("auto-create: triggered YouTube channel creation");
    } catch (error) {
      log(`auto-create trigger failed without changing readiness: ${errorMessage(error)}`);
    }
  }

  let publishPolicyWarning: string | undefined;
  const finalChannel = await currentChannel(convex, channelId);
  const publishConfiguration = channelPublishConfiguration(finalChannel.pipeline);
  if (
    readiness.status === "paused" &&
    publishConfiguration.actions.length &&
    publishingApproved
  ) {
    try {
      await replaceChannelPublishPolicy({
        ownerId,
        channelId,
        channel: finalChannel,
        allowedActions: publishConfiguration.actions,
        actor: payload.publishingApproval!.actor,
        evidence: payload.publishingApproval!.evidence,
        convex,
      });
    } catch (error) {
      publishPolicyWarning = `external publishing remains blocked: ${errorMessage(error)}`;
      log(publishPolicyWarning);
    }
  }

  return {
    ok: true,
    channelId,
    slug,
    name: positioning.name,
    family: payload.family,
    status: readiness.status,
    probe: probeOutcome,
    inceptionKey: plan.inceptionKey,
    resumed: Boolean(existingAtStart),
    blockers: readiness.blockers,
    warnings: publishPolicyWarning
      ? [...design.warnings, publishPolicyWarning]
      : design.warnings,
  };
}
