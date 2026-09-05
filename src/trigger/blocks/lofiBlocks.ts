/**
 * Template C (Lofi) blocks — the 10-step pipeline that turns a channel topic
 * into a finished, looped lofi video uploaded as a YouTube PRIVATE draft.
 *
 * Data flow (store keys), in pipeline order:
 *   topic_select  → topic
 *   scene_planner → scenes sceneMusicPrompt
 *   keyframes     → f1Url f1Key motionPrompt
 *   loop_clips    → loopRawKey loopRawUrl + two seam proofs
 *   upscale       → loopUnitKey loopUnitUrl loopUnitUpscaled loopUnitResolution
 *   music         → musicKey musicProvider musicUrl
 *   metadata      → title description tags
 *   assemble      → videoKey videoLocalPath videoDurationSec
 *   intro_card    → introApplied introMode (+ overrides videoKey/videoLocalPath)
 *   qa_light      → qaPassed qaReport
 *   thumbnail     → thumbnailKey
 *   upload_draft  → youtubeVideoId watchUrl youtubePrivacy
 *   notify        → notified
 *
 * The Kling prompt CONSTITUTION (src/engine/prompt/constitution.ts) is appended
 * to every i2v call via composeKlingPrompt; FLUX stills via composeFluxPrompt.
 * The REAL upscale (Topaz on the loop UNIT) lives in the upscale block; the
 * Remotion intro card (LofiIntroV2) is overlaid by intro_card.
 *
 * Heavy blocks (keyframes/loop_clips/upscale/music/assemble) are gated and run
 * the REAL CLIs/APIs. Everything is addressed by R2 key + remote URL; ffmpeg
 * operates on per-run temp files. No mocks — failures are loud.
 *
 * FRUGALITY (M1): durations are short. The single param that scales to a 2-hour
 * production video is the channel pipeline's `assemble.params.durationSec`
 * (and `music.params.durationSec`) — set them to 7200 for a 2h render.
 */
import { COST_PATCH_KEY, type Block, type StageContext } from "@/engine/types";
import { familyDurationContract, familyTimeScalingContract } from "@/engine/families";
import { getVisualBrief, getMusicBrief } from "@/engine/creative/brief";
import { studioPostproductionRecipeProjectionFromUnknown } from "@/engine/studioAssetLibrary";
import { PRICE, shortsSpinoffReleaseEvidenceCost } from "@/engine/pricing";
import { novitaCostEnvelope, requireNovitaStageBudget } from "@/lib/novitaCostEnvelope";
import { laneQualityPolicy, resolveContentLane } from "@/engine/contentLane";
import { certifiedFamilyAdmission } from "@/engine/certifiedFamilyAdmission";
import { requireAutomaticPackageToOpeningReceipt } from "@/engine/packageToOpening";
import {
  createShortsOpeningEvidence,
  planShortsOpeningCaptionEvidence,
} from "@/engine/shortsOpeningEvidence";
import {
  channelProgramRouteRunSeedFingerprint,
  parseChannelProgramRouteRunSeed,
  type ChannelProgramRouteRunSeed,
} from "@/engine/channelProgramRoute";
import {
  assertOriginalMusicProgramPlanBinding,
  createOriginalMusicProgramPlan,
  type OriginalMusicProgramPlan,
} from "@/engine/originalMusicProgram";
import {
  createChannelMusicProgram,
  type ChannelMusicProgram,
} from "@/engine/channelMusicProgram";
import { EpisodeGraphSchema } from "@/engine/episodeGraph";
import { StorySpineSchema } from "@/engine/storySpine";
import {
  bindNarrativeEpisodeToSeries,
  planNarrativeShortsExpansion,
} from "@/engine/narrativeSeriesIntelligence";
import {
  assertScenarioVisualTreatmentThumbnailProvenance,
  resolveScenarioVisualTreatmentForNewVisualArtifact,
  type ScenarioVisualTreatmentThumbnailProvenance,
} from "@/engine/scenarioVisualTreatment";
import { assertChildContentRenderEvidence } from "@/trigger/blocks/childrenSafetyBlocks";
import { assertQuizShortReleaseReceiptForUpload } from "@/trigger/blocks/quizShortReleaseBlocks";
import { assessProductionEditorialAcceptance, QualityEvidenceSchema } from "@/engine/qualityEvidence";
import {
  assertFinalMasterReleaseCertificate,
  createFinalMasterReleaseCertificate,
  createFinalMasterReleaseCertificateReference,
  createVisualReviewReleaseReceipt,
  FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
  finalMasterReleaseCertificateKey,
  parseFinalMasterReleaseCertificateBytes,
  retainedFinalMasterReleaseObjectKeys,
  verifyFinalMasterReleaseEvidenceForLocalUpload,
  verifyFinalMasterReleaseEvidenceObjects,
  visualReviewReleaseReceiptKey,
  type FinalMasterReleaseCertificate,
} from "@/lib/finalMasterReleaseCertificate";
import { scheduleRunArtifactRetention } from "@/lib/runArtifactRetention";
import {
  assertFinalMasterNarrationTranscriptAuditBinding,
  FINAL_MASTER_NARRATION_TRANSCRIPT_AUDIT_VERSION,
  finalMasterNarrationTranscriptAuditObjectKey,
  parseFinalMasterNarrationTranscriptAuditBytes,
  prepareFinalMasterNarrationTranscriptAudit,
  proveNarrationTranscript,
  sealFinalMasterNarrationSemanticEvidence,
  sha256NarrationTranscriptSource,
} from "@/lib/narrationTranscriptProof";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { renderNovitaI2V, renderNovitaImage } from "@/lib/novitaMedia";
import { LtxCreativeAdapterInputSchema } from "@/lib/ltxCreativeAdapter";
import {
  generateMureka,
  generateSuno,
  MusicError,
  selfLoopAudio,
  withMusicGenerationCost,
  type MusicProvider,
  type MusicTrack,
} from "@/lib/music";
import {
  assertPinnedMiniMaxMusic3Receipt,
  generateMiniMaxMusic3,
  type MiniMaxMusic3Receipt,
} from "@/lib/minimaxMusic3";
import { requireInternalQuerySecret, requireYouTubeConnector } from "@/lib/youtubeConnector";
import { notifyDraftReady } from "@/lib/telegram";
import { seamlessLoopUnit, composeLoopSourceUnit, composeWithIntro, composeMusicLoopDeblur, measureLoopSeamDiff, measureVideoBoundaryDiff, measureAudio, probe, makeVerticalClip, burnCaptions, captionCuesFromTimings, crossfadeConcatAudio, masterAudioTransparentGain, type CaptionCue } from "@/lib/ffmpeg";
import { channelVisualReviewProfile, reviewRender, type VisualReviewResult } from "@/lib/visualReview";
import {
  proveOnScreenText,
  sha256OnScreenTextSource,
  type TimedOnScreenTextCue,
} from "@/lib/onScreenTextProof";
import { hasAyrshareKey, crosspost as ayrCrosspost } from "@/lib/ayrshare";
import { parseJsonLoose } from "@/lib/gemini";
import { hasAnthropicKey } from "@/lib/anthropic";
import { hasNonGoogleVisionKey, visionLocal, VISION_GATE_MAX_TOKENS } from "@/lib/vision";
import { craftTopics, loadOutlierBank } from "@/lib/topicraft";
import { produceAndCritique } from "@/engine/critiqueLoop";
import { agentJson } from "@/agents/mastra";
import { loadPerformanceContext } from "@/lib/performance";
import { renderStoryStateForPrompt } from "@/lib/seriesStoryState";
import { ExecutionError } from "@/engine/executionErrors";
import {
  continueReservedSerializedProgramEpisode,
  parseSerializedProgramEpisodeMemoryKey,
  serializedProgramEpisodeIdentity,
  serializedProgramEpisodeMemoryKey,
  type SerializedProgramEpisodeReservationAuthority,
} from "@/lib/serializedProgramEpisode";
import {
  assertNarrativeSeriesNoGenericTopicFastPath,
  assertNarrativeSeriesRunAdmission,
  NARRATIVE_SERIES_RUN_SELECTOR_SEED_KEY,
  parseNarrativeSeriesRunSelector,
} from "@/lib/narrativeSeriesRunAdmission";
import { getNarrativeSeriesPlanRecord } from "@/lib/narrativeSeriesStateRuntime";
import { createNarrativeShortOrigin, type NarrativeShortOrigin } from "@/lib/narrativeShortOrigin";
import { z } from "zod";

/**
 * Topic-chunk structured-output schema (validated on both Mastra + REST).
 * The arcSummary/newPlotBeat/unresolvedThreads/entities fields are only
 * populated by the SERIES MODE continuation prompt (topic_select, below);
 * every other caller of this schema simply gets the zod defaults ("" / []).
 */
const producerTopicSchema = z.object({
  candidates: z
    .array(
      z.object({
        topic: z.string(),
        angle: z.string().optional().default(""),
        arcSummary: z.string().optional().default(""),
        newPlotBeat: z.string().optional().default(""),
        unresolvedThreads: z.array(z.string()).optional().default([]),
        entities: z
          .array(z.object({ name: z.string(), role: z.string() }))
          .optional()
          .default([]),
      }),
    )
    .optional()
    .default([]),
});
import {
  makeRunTempDir,
  downloadTo,
  DURABLE_RENDER_OUTPUT_DOWNLOAD_TIMEOUT_MS,
  readBytes,
  writeBytes,
} from "@/lib/files";
import { putObject, putObjectFromFile, getObjectBytes, getObjectIntegrity, headObjectMetadata, publicUrl } from "@/lib/storage";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import { join } from "node:path";
import { access, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  composeKlingPrompt,
  composeFluxPrompt,
} from "@/engine/prompt/constitution";
import {
  planScenes,
  type SceneSpec,
  type SceneLibraryEntry,
} from "@/engine/prompt/scenePlanner";
import { buildChapters } from "@/lib/metacraft";
import {
  bytesSha256,
  dispatchPublishIntent,
  fileSha256,
  publishMetadataSha256,
} from "@/lib/publishDispatcher";
import {
  buildPublishIdempotencyKey,
  YOUTUBE_UPLOAD_SCOPES,
} from "@/lib/publishingPolicy";
import {
  assertScheduledPublishIsFuture,
  resolveScheduledPublishAtMs,
} from "@/lib/scheduledPlanRuntime";
import { uploadDurableVideo } from "@/lib/youtubeDurableUpload";
import {
  evaluateChannelPublishAction,
  requireChannelPublishAction,
  type ChannelPublishDecision,
} from "@/lib/channelPublishPolicy";

// Accepted Mureka/Suno jobs do not expose a durable replay receipt yet. Keep
// their output transfer bounded so a stalled provider body reaches this block's
// existing cost-carrying terminal catch instead of the whole-task timeout.
const MUSIC_PROVIDER_OUTPUT_DOWNLOAD_TIMEOUT_MS = 300_000;
const MINIMAX_MUSIC3_DESCRIPTION_DISCLOSURE =
  "Music generated with MiniMax-Music3. This video contains AI-generated audio.";

/* ----------------------------- helpers --------------------------------- */

function convex(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  return new ConvexHttpClient(url);
}

function str(ctx: StageContext, key: string): string {
  const v = ctx.store[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`lofi: expected non-empty string store["${key}"], got ${JSON.stringify(v)}`);
  }
  return v;
}

function opt(ctx: StageContext, key: string): string | undefined {
  const v = ctx.store[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Normalize a topic for hard duplicate detection (never trust the model). */
function normalizeTopic(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function routeSeedForTopicSelection(ctx: StageContext): ChannelProgramRouteRunSeed | undefined {
  const raw = ctx.store["channelProgramRoute"];
  if (raw === undefined) return undefined;
  const route = parseChannelProgramRouteRunSeed(raw);
  if (!route.requiredBlocks.includes("topic_select")) {
    throw new Error(
      `topic_select: frozen channel program route ${route.routeKey} is owned by a different planner`,
    );
  }
  if (route.directives.claimMode === "certified_quiz_facts") {
    throw new Error("topic_select: certified QuizYear routes must use quiz_topic_plan");
  }
  return route;
}

/**
 * The original-music plan is mandatory only for the new route-owned music
 * foundation. Historical channel pipelines remain replayable, but cannot gain
 * automatic admission until they migrate to the sealed route.
 */
function musicProgramForCurrentRoute(
  ctx: StageContext,
  topic: string,
): OriginalMusicProgramPlan | undefined {
  const route = routeSeedForTopicSelection(ctx);
  if (!route?.requiredBlocks.includes("music_program_plan")) return undefined;
  return assertOriginalMusicProgramPlanBinding({
    plan: ctx.store["musicProgramPlan"],
    route,
    topic,
  });
}

function routeTopicDirective(route: ChannelProgramRouteRunSeed | undefined): string | undefined {
  if (!route) return undefined;
  return [
    `FROZEN CHANNEL PROGRAM ROUTE: ${route.routeKey}.`,
    `Viewer job: ${route.directives.viewerJob}`,
    `Claim mode: ${route.directives.claimMode}.`,
    "TOPIC RULES (non-negotiable):",
    ...route.directives.topicRules.map((rule) => `- ${rule}`),
    route.context.audience ? `Audience: ${route.context.audience}.` : "",
    route.context.sampleTopics?.length
      ? `Creator-declared program examples (use as bounded fit evidence, never copy blindly): ${route.context.sampleTopics.join(" | ")}`
      : "",
  ].filter(Boolean).join("\n");
}

function seriesProgramForTopicSelection(
  ctx: StageContext,
  route: ChannelProgramRouteRunSeed | undefined,
): { seriesTitle?: string; seriesCount: number } {
  // Some deterministic/runtime test contexts omit the optional parameter bag.
  // Treat that exactly like an unconfigured legacy series; sealed routes still
  // fail closed below unless their compiler-owned values are present.
  const params = ctx.params ?? {};
  const configuredTitle = (params["seriesTitle"] as string | undefined)?.trim();
  const configuredCount = Number(params["seriesCount"] ?? 0) || 0;
  const sealed = route?.serializedProgram;
  if (!sealed) return { seriesTitle: configuredTitle, seriesCount: configuredCount };
  if (
    configuredTitle !== sealed.seriesTitle ||
    configuredCount !== (sealed.seriesCount ?? 0)
  ) {
    throw new Error(
      `topic_select: route ${route?.routeKey ?? "unknown"} serialized_program/v1 does not match frozen topic_select params`,
    );
  }
  return {
    seriesTitle: sealed.seriesTitle,
    seriesCount: sealed.seriesCount ?? 0,
  };
}

function assertSerializedProgramFastPathAdmission(
  route: ChannelProgramRouteRunSeed | undefined,
  source: "planned" | "reused",
): void {
  if (!route?.serializedProgram) return;
  throw new Error(
    `topic_select: ${source} topic requires a verified serialized_program_episode/v1 receipt; ` +
    "direct serialized-program fast paths are not admitted",
  );
}

function serializedProgramEpisodeAuthority(
  client: ConvexHttpClient,
): SerializedProgramEpisodeReservationAuthority {
  return {
    claim: async (input) => await client.mutation(api.serializedProgramEpisodes.claimNext, {
      ownerId: input.ownerId,
      channelId: input.channelId as Id<"channels">,
      seriesIdentity: input.seriesIdentity.value,
      routeFingerprint: input.seriesIdentity.routeFingerprint,
      routeRunSeedFingerprint: input.routeRunSeedFingerprint,
      seriesTitle: input.seriesIdentity.seriesTitle,
      ...(input.seriesIdentity.seriesCount === undefined
        ? {}
        : { seriesCount: input.seriesIdentity.seriesCount }),
      runId: input.runId as Id<"runs">,
    }),
    complete: async (input) => await client.mutation(api.serializedProgramEpisodes.complete, {
      ownerId: input.ownerId,
      channelId: input.channelId as Id<"channels">,
      seriesIdentity: input.seriesIdentity.value,
      routeFingerprint: input.seriesIdentity.routeFingerprint,
      routeRunSeedFingerprint: input.routeRunSeedFingerprint,
      seriesTitle: input.seriesIdentity.seriesTitle,
      ...(input.seriesIdentity.seriesCount === undefined
        ? {}
        : { seriesCount: input.seriesIdentity.seriesCount }),
      runId: input.runId as Id<"runs">,
      claimToken: input.claimToken,
      episodeNumber: input.episodeNumber,
      topic: input.topic,
      topicMemoryKey: input.topicMemoryKey,
      storyState: {
        ...(input.storyState.arcSummary === undefined
          ? {}
          : { arcSummary: input.storyState.arcSummary }),
        newPlotBeat: input.storyState.newPlotBeat,
        ...(input.storyState.unresolvedThreads === undefined
          ? {}
          : { unresolvedThreads: [...input.storyState.unresolvedThreads] }),
        ...(input.storyState.newEntities === undefined
          ? {}
          : {
              newEntities: input.storyState.newEntities.map((entity) => ({
                name: entity.name,
                role: entity.role,
              })),
            }),
      },
    }),
    release: async (input) => await client.mutation(api.serializedProgramEpisodes.release, {
      ownerId: input.ownerId,
      channelId: input.channelId as Id<"channels">,
      seriesIdentity: input.seriesIdentity.value,
      routeFingerprint: input.seriesIdentity.routeFingerprint,
      routeRunSeedFingerprint: input.routeRunSeedFingerprint,
      seriesTitle: input.seriesIdentity.seriesTitle,
      ...(input.seriesIdentity.seriesCount === undefined
        ? {}
        : { seriesCount: input.seriesIdentity.seriesCount }),
      runId: input.runId as Id<"runs">,
      claimToken: input.claimToken,
    }),
  };
}

/**
 * The selected narrative horizon is resolved before the generic planner or
 * any fast path. The only durable write remains the existing serial claim /
 * completion transaction, now supplied with a preplanned immutable episode
 * rather than a run-time generated subtitle.
 */
async function continueFrozenNarrativeSeriesEpisode(input: {
  readonly ctx: StageContext;
  readonly client: ConvexHttpClient;
  readonly route: ChannelProgramRouteRunSeed;
  readonly identity: NonNullable<ReturnType<typeof serializedProgramEpisodeIdentity>>;
}): Promise<{ readonly topic: string }> {
  const selector = parseNarrativeSeriesRunSelector(
    input.ctx.store[NARRATIVE_SERIES_RUN_SELECTOR_SEED_KEY],
  );
  const record = await getNarrativeSeriesPlanRecord({
    client: input.client,
    ownerId: input.ctx.ownerId,
    channelId: input.ctx.channelId as Id<"channels">,
    fingerprint: selector.seriesPlanFingerprint,
  });
  if (
    !record ||
    record.ownerId !== input.ctx.ownerId ||
    String(record.channelId) !== input.ctx.channelId ||
    record.fingerprint !== selector.seriesPlanFingerprint
  ) {
    throw new Error("topic_select: narrative series selector has no matching immutable owner-scoped plan");
  }
  const admission = assertNarrativeSeriesRunAdmission({
    selector,
    plan: record.plan,
    ownerId: input.ctx.ownerId,
    channelId: input.ctx.channelId,
    routeSeed: input.route,
  });
  const continuation = await continueReservedSerializedProgramEpisode({
    authority: serializedProgramEpisodeAuthority(input.client),
    claim: {
      ownerId: input.ctx.ownerId,
      channelId: input.ctx.channelId,
      seriesIdentity: input.identity,
      routeRunSeedFingerprint: selector.routeRunSeedFingerprint,
      runId: input.ctx.runId,
    },
    generate: async (episodeNumber) => {
      const planned = admission.plan.episodes.find((episode) => episode.episodeNumber === episodeNumber);
      if (!planned) {
        throw new Error(
          `topic_select: narrative series plan horizon has no immutable episode ${episodeNumber}; refusing a generic continuation`,
        );
      }
      assertTopicFitsProgramRoute(input.route, planned.topic, "series");
      return {
        topic: planned.topic,
        topicMemoryKey: serializedProgramEpisodeMemoryKey({
          identity: input.identity,
          episodeNumber,
          topic: planned.topic,
        }),
        storyState: {
          newPlotBeat: `${planned.narrativeFunction}: ${planned.premise}`,
          unresolvedThreads: [],
        },
        value: planned,
      };
    },
  });
  if (continuation.kind === "generated") {
    input.ctx.log(
      `topic_select(narrative series): frozen episode ${continuation.episodeNumber}` +
        `${input.identity.seriesCount ? `/${input.identity.seriesCount}` : ""} "${continuation.topic}"`,
    );
    return { topic: continuation.topic };
  }
  if (continuation.kind === "completed") {
    const planned = admission.plan.episodes.find((episode) => episode.episodeNumber === continuation.episodeNumber);
    if (!planned || normalizeTopic(planned.topic) !== normalizeTopic(continuation.topic)) {
      throw new Error("topic_select: completed serialized episode does not match the frozen narrative series plan");
    }
    input.ctx.log(
      `topic_select(narrative series): replayed frozen episode ${continuation.episodeNumber} "${continuation.topic}"`,
    );
    return { topic: continuation.topic };
  }
  if (continuation.kind === "busy") {
    throw new ExecutionError(
      `topic_select: narrative series episode claim is in progress; retry after ${continuation.retryAfterMs}ms without another provider call`,
      {
        code: "SERIALIZED_EPISODE_BUSY",
        retryable: true,
        retryAfterMs: continuation.retryAfterMs,
        retryScope: "durable_task",
        phase: "topic_select",
      },
    );
  }
  throw new Error(
    "topic_select: the frozen narrative series is complete; refusing a generic topic after its sealed horizon",
  );
}

function topicMemoryDisplayTopic(key: string): string {
  return parseSerializedProgramEpisodeMemoryKey(key)?.topic ?? key;
}

type TopicRouteSource = "planned" | "reused" | "series" | "crafted";

function assertTopicFitsProgramRoute(
  route: ChannelProgramRouteRunSeed | undefined,
  topic: string,
  source: TopicRouteSource,
): void {
  if (!route) return;
  if (!topic.trim()) throw new Error(`topic_select: ${source} topic is empty for route ${route.routeKey}`);
  if (route.family === "quizyear" || route.directives.claimMode === "certified_quiz_facts") {
    throw new Error(`topic_select: ${source} topic bypasses the certified QuizYear planner`);
  }
  if (
    route.directives.claimMode === "fictional_scenario_no_external_claims" &&
    /\b(?:breaking|latest|today|current events?|news|forecast)\b/i.test(topic)
  ) {
    throw new Error(
      `topic_select: ${source} topic conflicts with the fictional-scenario route's no-real-world-claims contract`,
    );
  }
}

/**
 * A route failure must happen before topic history changes. In particular, the
 * series path records durable topic/arc state, so it cannot defer this guard
 * until after its write merely because ordinary Topicraft candidates are
 * already checked in memory.
 */
export async function persistTopicAfterRouteValidation(input: {
  readonly route: ChannelProgramRouteRunSeed | undefined;
  readonly topic: string;
  readonly source: TopicRouteSource;
  readonly dryRun: boolean;
  readonly persist: () => Promise<void>;
}): Promise<void> {
  assertTopicFitsProgramRoute(input.route, input.topic, input.source);
  if (!input.dryRun) await input.persist();
}

/**
 * Record the chosen topic in topic memory — FATAL on failure. An unrecorded
 * topic silently breaks the no-repeat guarantee on every future run, so the
 * run must not proceed past selection without the write confirmed.
 */
async function recordTopicMemory(
  c: ConvexHttpClient,
  ctx: StageContext,
  topic: string,
): Promise<void> {
  await c.mutation(api.topicMemory.recordTopic, {
    ownerId: ctx.ownerId,
    channelId: ctx.channelId as Id<"channels">,
    key: topic,
  });
  ctx.log(`topic_select: recorded "${topic.slice(0, 80)}" in topic memory`);
}

function styleGrammar(ctx: StageContext): string {
  const sg = (ctx.store["styleGrammar"] as string | undefined) ?? "";
  // Cinematographer (crew) brief blends its look + motion language into every
  // keyframe/scene prompt so the visuals match the channel's vibe.
  const vb = getVisualBrief(ctx.store);
  const extra = [vb?.promptStyle, vb?.motion].map((s) => (s ?? "").trim()).filter(Boolean).join(". ");
  return [sg, extra].filter(Boolean).join(". ");
}

/** Channel visual-style preset key (drives the Kling/Flux constitution). */
function visualStyle(ctx: StageContext): string {
  return (
    (ctx.params["visualStyle"] as string | undefined) ??
    (ctx.store["visualStyle"] as string | undefined) ??
    "lofi"
  );
}

/** Read the planned scenes from the store (scene_planner output). */
function scenesFromStore(ctx: StageContext): SceneSpec[] {
  const s = ctx.store["scenes"] as SceneSpec[] | undefined;
  if (!Array.isArray(s) || s.length === 0) {
    throw new Error("lofi: store[\"scenes\"] missing — scene_planner must run first");
  }
  return s;
}

/** True if a local file path exists and is readable. */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Record an asset row in Convex (best-effort metadata index). */
async function recordAsset(
  ctx: StageContext,
  kind: string,
  r2Key: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    await convex().mutation(api.assets.recordAsset, {
      ownerId: ctx.ownerId,
      channelId: ctx.channelId as Id<"channels">,
      runId: ctx.runId as Id<"runs">,
      kind,
      r2Key,
      meta,
    });
  } catch (e) {
    ctx.log(`recordAsset(${kind}) failed (non-fatal): ${e instanceof Error ? e.message : e}`);
  }
}

async function appendMusicGenerationDisclosure(
  ctx: StageContext,
  description: string,
): Promise<string> {
  if (ctx.store["musicProvider"] !== "minimax_music3") return description;
  const programKey = str(ctx, "channelMusicProgramKey");
  const receiptKey = str(ctx, "musicRuntimeReceiptKey");
  const [programBytes, receiptBytes] = await Promise.all([
    getObjectBytes(programKey),
    getObjectBytes(receiptKey),
  ]);
  let program: unknown;
  let receipt: unknown;
  try {
    program = JSON.parse(Buffer.from(programBytes).toString("utf8"));
    receipt = JSON.parse(Buffer.from(receiptBytes).toString("utf8"));
  } catch (error) {
    throw new Error(
      `MiniMax-Music3 disclosure evidence is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const admitted = assertPinnedMiniMaxMusic3Receipt(receipt, program);
  if (description.includes(MINIMAX_MUSIC3_DESCRIPTION_DISCLOSURE)) return description;
  ctx.log(
    `publish package: appended required ${admitted.license.uiAttribution} generated-audio disclosure ` +
    `from runtime receipt ${admitted.requestKey.slice(0, 12)}`,
  );
  return `${description.trim()}\n\n${MINIMAX_MUSIC3_DESCRIPTION_DISCLOSURE}`;
}

/* --------------------------- 1. topic_select ---------------------------- */

export const topicSelect: Block = {
  id: "topic_select",
  consumes: [],
  produces: ["topic", "topicBet"],
  run: async (ctx) => {
    // The sealed run seed is consulted before EVERY fast path. A scheduled
    // plan or render-group reuse is still an episode of this exact program;
    // neither may bypass the route's planner/claim-mode boundary.
    const programRoute = routeSeedForTopicSelection(ctx);
    const programDirective = routeTopicDirective(programRoute);
    // This is intentionally before every fast path and any Convex write: a
    // mutable module setting may never retitle or lengthen a sealed series.
    const seriesProgram = seriesProgramForTopicSelection(ctx, programRoute);
    const serializedEpisodeIdentity = serializedProgramEpisodeIdentity(programRoute);
    const narrativeSelector = ctx.store[NARRATIVE_SERIES_RUN_SELECTOR_SEED_KEY] === undefined
      ? undefined
      : parseNarrativeSeriesRunSelector(ctx.store[NARRATIVE_SERIES_RUN_SELECTOR_SEED_KEY]);
    // A scheduler-claimed plan item is committed intent, not a candidate to
    // exclude. Use it verbatim without another model call; completion records
    // topic memory only after the full pipeline succeeds.
    const plannedTopic = ctx.store["plannedTopic"] as string | undefined;
    // RENDER-GROUP REUSE: a language sibling renders the SAME topic as the base
    // (shared video, different language) — skip selection + history recording.
    const reuseTopic = ctx.store["reuseTopic"] as string | undefined;
    if (narrativeSelector) {
      if (!serializedEpisodeIdentity || !programRoute) {
        throw new Error("topic_select: narrative series selector requires a sealed serialized_program/v1 route");
      }
      // This runs before the generic fast paths and before topic-memory/list
      // queries. A persisted plan owns the next episode, not contentPlan.
      assertNarrativeSeriesNoGenericTopicFastPath({
        selector: narrativeSelector,
        plannedTopic,
        reuseTopic,
      });
      if (ctx.params["dryRun"] === true) {
        throw new Error(
          "topic_select: narrative series selector requires a durable episode reservation; dry-run continuation is not admitted",
        );
      }
      return await continueFrozenNarrativeSeriesEpisode({
        ctx,
        client: convex(),
        route: programRoute,
        identity: serializedEpisodeIdentity,
      });
    }
    if (typeof plannedTopic === "string" && plannedTopic.trim()) {
      assertSerializedProgramFastPathAdmission(programRoute, "planned");
      assertTopicFitsProgramRoute(programRoute, plannedTopic, "planned");
      ctx.log(`topic_select: CLAIMED plan topic "${plannedTopic}"`);
      return { topic: plannedTopic };
    }
    if (typeof reuseTopic === "string" && reuseTopic.trim()) {
      assertSerializedProgramFastPathAdmission(programRoute, "reused");
      assertTopicFitsProgramRoute(programRoute, reuseTopic, "reused");
      ctx.log(`topic_select: REUSED base topic "${reuseTopic}"`);
      return { topic: reuseTopic };
    }
    // Director-chosen, identity-aligned, non-repeating topic (Phase 1).
    // The non-Google creative planner proposes and ranks evidence-backed
    // candidates; a HARD no-repeat check runs
    // in code (never trusted to the model). `policy` param:
    //   "no_repeat"     — must always be a brand-new topic (error if impossible)
    //   "prefer_fresh"  — dedup; may recycle the pool when exhausted (default)
    const c = convex();
    const channelId = ctx.channelId as Id<"channels">;
    const policy =
      (ctx.params["policy"] as string | undefined) === "no_repeat"
        ? "no_repeat"
        : "prefer_fresh";

    // Channel identity (store seeds first; fall back to the channel doc).
    const channel = await c
      .query(api.channels.getChannel, { channelId })
      .catch(() => null);
    const id = (channel?.identity ?? {}) as {
      persona?: string;
      niche?: string;
      styleGrammar?: string;
      topicPool?: string[];
      bannedWords?: string[];
    };
    const channelName = opt(ctx, "channelName") ?? channel?.name ?? "this channel";
    const persona = opt(ctx, "persona") ?? id.persona ?? "";
    const niche = opt(ctx, "niche") ?? id.niche ?? "";
    const style = (ctx.store["styleGrammar"] as string | undefined) ?? id.styleGrammar ?? "";
    const pool = (ctx.store["topicPool"] as string[] | undefined) ?? id.topicPool ?? [];
    const bannedWords = (id.bannedWords ?? []).filter(Boolean);

    // Used-topic history — FATAL if unreadable: selecting blind against an
    // unknown history is how channels repeat themselves. The content plan
    // (plan-week-ahead queue) is committed intent and counts as taken too.
    const [usedRows, planRows] = await Promise.all([
      c.query(api.topicMemory.listForChannel, { channelId }) as Promise<Array<{ key: string }>>,
      c
        .query(api.contentPlan.listPlan, { ownerId: ctx.ownerId, channelId })
        .catch((e) => {
          ctx.log(`topic_select: plan query failed (continuing without plan): ${e instanceof Error ? e.message : e}`);
          return [] as Array<{ topic: string }>;
        }),
    ]);
    const rememberedTopics = usedRows.map((row) => topicMemoryDisplayTopic(row.key));
    const plannedTopics = (planRows as Array<{ topic: string }>).map((p) => p.topic);
    const usedNorm = new Set([
      ...rememberedTopics.map(normalizeTopic),
      ...plannedTopics.map(normalizeTopic),
    ]);
    const recentList = rememberedTopics.slice(-40);
    // Phase 7: bias toward topics like past high-retention winners ("" until enough data).
    const perfCtx = await loadPerformanceContext(ctx.keyPrefix);

    // SERIES MODE — an ordered, numbered run (e.g. "7 Days of Stoic Calm"). The
    // episode number = how many of this series already exist + 1; each episode
    // gets a unique subtitle that continues the arc. When the series is finished
    // (epNum > seriesCount) we fall through to normal topic generation so the
    // channel keeps publishing. Episode order is encoded in the (clean) title.
    //
    // Phase 4 (episodic continuity): beyond avoiding title repetition, the
    // continuation call is now grounded in REAL prior plot content — a running
    // arc summary, unresolved narrative threads, and known entities (name +
    // one-line ROLE, never wardrobe/appearance) — read from the Convex
    // `seriesStoryState` table. The SAME LLM call that proposes the next
    // subtitle also proposes the updated story state, written back immediately
    // alongside the existing topic-memory commit — so the write never depends
    // on a downstream "finalization" step that doesn't exist for every family
    // sharing this block. A series with no seriesStoryState row yet (first
    // episode, or a non-series channel) behaves exactly as before: the prompt
    // simply omits the "story so far" section and the write below just starts
    // one.
    const { seriesTitle, seriesCount } = seriesProgram;
    if (serializedEpisodeIdentity) {
      if (!programRoute) {
        throw new Error("topic_select: serialized_program/v1 is missing its frozen route seed");
      }
      const routeRunSeedFingerprint = channelProgramRouteRunSeedFingerprint(programRoute);
      if (ctx.params["dryRun"] === true) {
        throw new Error(
          "topic_select: serialized_program/v1 requires a durable episode reservation; dry-run continuation is not admitted",
        );
      }
      const serializedPrior = usedRows
        .map((row) => parseSerializedProgramEpisodeMemoryKey(row.key))
        .filter((entry) => entry?.identity.value === serializedEpisodeIdentity.value)
        .sort((a, b) => a!.episodeNumber - b!.episodeNumber)
        .map((entry) => entry!.topic)
        .slice(-40);
      const continuation = await continueReservedSerializedProgramEpisode({
        authority: serializedProgramEpisodeAuthority(c),
        claim: {
          ownerId: ctx.ownerId,
          channelId: String(channelId),
          seriesIdentity: serializedEpisodeIdentity,
          routeRunSeedFingerprint,
          runId: ctx.runId,
        },
        generate: async (episodeNumber) => {
          if (!hasAnthropicKey()) {
            throw new Error(
              "topic_select: serialized_program/v1 requires OPENROUTER_API_KEY; refusing a generic Part-N fallback",
            );
          }
          const label = serializedEpisodeIdentity.seriesCount
            ? `Part ${episodeNumber} of ${serializedEpisodeIdentity.seriesCount}`
            : `Part ${episodeNumber}`;
          const existingStoryState = await c
            .query(api.seriesStoryState.getForSeriesIdentity, {
              channelId,
              seriesIdentity: serializedEpisodeIdentity.value,
            })
            .catch((e) => {
              ctx.log(`topic_select(serialized series): story-state read failed (continuing without it): ${e instanceof Error ? e.message : e}`);
              return null;
            });
          const storyContext = renderStoryStateForPrompt(existingStoryState);
          const out = await agentJson({
            role: "producer",
            schema: producerTopicSchema,
            log: ctx.log,
            prompt:
              `You are planning episode ${episodeNumber} of an ordered YouTube series titled "${serializedEpisodeIdentity.seriesTitle}"` +
              (serializedEpisodeIdentity.seriesCount
                ? ` (a ${serializedEpisodeIdentity.seriesCount}-part series).`
                : ".") + "\n" +
              `Channel "${channelName}" — persona: ${persona || "n/a"}; niche: ${niche || "n/a"}; style: ${style || "n/a"}.\n` +
              (programDirective ? `${programDirective}\n\n` : "") +
              `Episodes already published (CONTINUE the arc, do NOT repeat):\n${serializedPrior.join("\n") || "(none yet — this is episode 1)"}\n\n` +
              (storyContext
                ? `STORY SO FAR (use this — not just the titles above — to continue REAL plot/thematic content):\n${storyContext}\n\n`
                : "") +
              `Propose the SINGLE best focus for episode ${episodeNumber}: a specific, compelling SUBTITLE (the episode's unique theme — not the series name) and a one-line angle. ` +
              `It must build on prior episodes and fit the whole series. ` +
              `Also update the running story state: a short 2-4 sentence ARC SUMMARY covering everything through THIS episode, ` +
              `a one-line PLOT BEAT capturing what this specific episode adds, the UPDATED list of unresolved narrative threads ` +
              `(open questions/promises still to pay off), and any newly introduced entities (name + one-line ROLE only — never wardrobe or appearance). ` +
              `Return STRICT JSON {"candidates":[{"topic":string,"angle":string,"arcSummary":string,"newPlotBeat":string,"unresolvedThreads":string[],"entities":[{"name":string,"role":string}]}]}.`,
            // Reasoning route: the ceiling must cover the thinking AND the list.
            // Measured — a 5-item list failed at 500 and passed at 1000; an 8-item
            // ranking failed at 1500 and passed at 2500. See
            // scripts/audit-json-contract-ceilings.ts.
            maxTokens: 2500,
            temperature: 0.8,
          });
          const candidate = out.candidates?.[0];
          const subtitle = (candidate?.topic ?? "").trim().replace(/^["']|["']$/g, "");
          if (!subtitle) {
            throw new Error(
              "topic_select: serialized_program/v1 continuation returned no valid episode subtitle; claim released for retry",
            );
          }
          const topic = `${serializedEpisodeIdentity.seriesTitle} — ${label}: ${subtitle}`;
          assertTopicFitsProgramRoute(programRoute, topic, "series");
          const angle = (candidate?.angle ?? "").trim();
          const subtitleBeat = `${label}: ${subtitle}${angle ? ` — ${angle}` : ""}`;
          return {
            topic,
            topicMemoryKey: serializedProgramEpisodeMemoryKey({
              identity: serializedEpisodeIdentity,
              episodeNumber,
              topic,
            }),
            storyState: {
              ...(candidate?.arcSummary?.trim()
                ? { arcSummary: candidate.arcSummary.trim() }
                : {}),
              newPlotBeat: candidate?.newPlotBeat?.trim() || subtitleBeat,
              ...(candidate?.unresolvedThreads?.length
                ? {
                    unresolvedThreads: candidate.unresolvedThreads
                      .map((thread) => thread.trim())
                      .filter(Boolean),
                  }
                : {}),
              ...(candidate?.entities?.length
                ? {
                    newEntities: candidate.entities
                      .map((entity) => ({ name: (entity.name ?? "").trim(), role: (entity.role ?? "").trim() }))
                      .filter((entity) => entity.name),
                  }
                : {}),
            },
            value: {
              label,
              subtitle,
              angle,
              arcSummary: (candidate?.arcSummary ?? "").trim(),
              newPlotBeat: (candidate?.newPlotBeat ?? "").trim(),
              unresolvedThreads: (candidate?.unresolvedThreads ?? []).map((thread) => thread.trim()).filter(Boolean),
              entities: (candidate?.entities ?? [])
                .map((entity) => ({ name: (entity.name ?? "").trim(), role: (entity.role ?? "").trim() }))
                .filter((entity) => entity.name),
            },
          };
        },
      });
      if (continuation.kind === "generated") {
        ctx.log(
          `topic_select(serialized series): "${continuation.topic}" ` +
          `(episode ${continuation.episodeNumber}${serializedEpisodeIdentity.seriesCount ? `/${serializedEpisodeIdentity.seriesCount}` : ""})`,
        );
        return { topic: continuation.topic };
      }
      if (continuation.kind === "completed") {
        ctx.log(`topic_select(serialized series): replayed "${continuation.topic}" (episode ${continuation.episodeNumber})`);
        return { topic: continuation.topic };
      }
      if (continuation.kind === "busy") {
        throw new ExecutionError(
          `topic_select: serialized_program/v1 episode claim is in progress; retry after ${continuation.retryAfterMs}ms without another provider call`,
          {
            code: "SERIALIZED_EPISODE_BUSY",
            retryable: true,
            retryAfterMs: continuation.retryAfterMs,
            retryScope: "durable_task",
            phase: "topic_select",
          },
        );
      }
      ctx.log(
        `topic_select(serialized series): "${serializedEpisodeIdentity.seriesTitle}" complete ` +
        `(${serializedEpisodeIdentity.seriesCount ?? "open"}) — falling through to normal topics`,
      );
    }
    if (seriesTitle && !serializedEpisodeIdentity) {
      const doneCount = usedRows.filter((r) => r.key.includes(seriesTitle)).length;
      const epNum = doneCount + 1;
      if (!(seriesCount > 0 && epNum > seriesCount)) {
        const label = seriesCount > 0 ? `Part ${epNum} of ${seriesCount}` : `Part ${epNum}`;
        const prior = recentList.filter((t) => t.includes(seriesTitle));
        const existingStoryState = await c
          .query(api.seriesStoryState.getForSeries, { channelId, seriesTitle })
          .catch((e) => {
            ctx.log(`topic_select(series): story-state read failed (continuing without it): ${e instanceof Error ? e.message : e}`);
            return null;
          });
        const storyContext = renderStoryStateForPrompt(existingStoryState);
        let subtitle = "";
        let angle = "";
        let arcSummaryOut = "";
        let newPlotBeatOut = "";
        let unresolvedThreadsOut: string[] = [];
        let entitiesOut: { name: string; role: string }[] = [];
        if (hasAnthropicKey()) {
          try {
            const out = await agentJson({
              role: "producer",
              schema: producerTopicSchema,
              log: ctx.log,
              prompt:
                `You are planning episode ${epNum} of an ordered YouTube series titled "${seriesTitle}"` +
                (seriesCount > 0 ? ` (a ${seriesCount}-part series).` : ".") + "\n" +
                `Channel "${channelName}" — persona: ${persona || "n/a"}; niche: ${niche || "n/a"}; style: ${style || "n/a"}.\n` +
                (programDirective ? `${programDirective}\n\n` : "") +
                `Episodes already published (CONTINUE the arc, do NOT repeat):\n${prior.join("\n") || "(none yet — this is episode 1)"}\n\n` +
                (storyContext
                  ? `STORY SO FAR (use this — not just the titles above — to continue REAL plot/thematic content):\n${storyContext}\n\n`
                  : "") +
                `Propose the SINGLE best focus for episode ${epNum}: a specific, compelling SUBTITLE (the episode's unique theme — not the series name) and a one-line angle. ` +
                `It must build on prior episodes and fit the whole series. ` +
                `Also update the running story state: a short 2-4 sentence ARC SUMMARY covering everything through THIS episode, ` +
                `a one-line PLOT BEAT capturing what this specific episode adds, the UPDATED list of unresolved narrative threads ` +
                `(open questions/promises still to pay off), and any newly introduced entities (name + one-line ROLE only — never wardrobe or appearance). ` +
                `Return STRICT JSON {"candidates":[{"topic":string,"angle":string,"arcSummary":string,"newPlotBeat":string,"unresolvedThreads":string[],"entities":[{"name":string,"role":string}]}]}.`,
              // Reasoning route: the ceiling must cover the thinking AND the list.
              // Measured — a 5-item list failed at 500 and passed at 1000; an 8-item
              // ranking failed at 1500 and passed at 2500. See
              // scripts/audit-json-contract-ceilings.ts.
              maxTokens: 2500,
              temperature: 0.8,
            });
            const cand = out.candidates?.[0];
            subtitle = (cand?.topic ?? "").trim().replace(/^["']|["']$/g, "");
            angle = (cand?.angle ?? "").trim();
            arcSummaryOut = (cand?.arcSummary ?? "").trim();
            newPlotBeatOut = (cand?.newPlotBeat ?? "").trim();
            unresolvedThreadsOut = (cand?.unresolvedThreads ?? []).map((t) => t.trim()).filter(Boolean);
            entitiesOut = (cand?.entities ?? [])
              .map((e) => ({ name: (e.name ?? "").trim(), role: (e.role ?? "").trim() }))
              .filter((e) => e.name);
          } catch (e) {
            ctx.log(`topic_select(series): subtitle gen failed (continuing): ${e instanceof Error ? e.message : e}`);
          }
        }
        const topic = subtitle
          ? `${seriesTitle} — ${label}: ${subtitle}`
          : `${seriesTitle} — ${label}`;
        // Validate before either durable series write. Keep topic-memory and
        // story-state updates under the same dry-run guard: their ordered
        // pairing is the series continuation transaction boundary.
        assertTopicFitsProgramRoute(programRoute, topic, "series");
        if (ctx.params["dryRun"] !== true) {
          await recordTopicMemory(c, ctx, topic);
          // Best-effort write-back: a failed story-state write must never break
          // topic selection — the no-repeat guarantee (topicMemory, above) is
          // the only FATAL write on this path.
          const hasUpdate =
            subtitle || arcSummaryOut || newPlotBeatOut || unresolvedThreadsOut.length > 0 || entitiesOut.length > 0;
          if (hasUpdate) {
            await c
              .mutation(api.seriesStoryState.recordEpisodeBeat, {
                ownerId: ctx.ownerId,
                channelId,
                seriesTitle,
                episode: epNum,
                arcSummary: arcSummaryOut || undefined,
                newPlotBeat:
                  newPlotBeatOut || (subtitle ? `${label}: ${subtitle}${angle ? ` — ${angle}` : ""}` : undefined),
                unresolvedThreads: unresolvedThreadsOut.length ? unresolvedThreadsOut : undefined,
                newEntities: entitiesOut.length ? entitiesOut : undefined,
              })
              .catch((e) => {
                ctx.log(`topic_select(series): story-state write-back failed (non-fatal): ${e instanceof Error ? e.message : e}`);
            });
          }
        }
        ctx.log(`topic_select(series): "${topic}" (episode ${epNum}${seriesCount ? `/${seriesCount}` : ""})`);
        return { topic };
      }
      ctx.log(`topic_select(series): "${seriesTitle}" complete (${doneCount}/${seriesCount}) — falling through to normal topics`);
    }

    // TOPICRAFT — the golden topic-intel engine: metadata-evidenced, judged
    // bets. No silent pool fallback: a missing permitted creative provider
    // fails loud (the recovery loop's job).
    if (!hasAnthropicKey()) {
      throw new Error("topic_select: OPENROUTER_API_KEY missing — refusing silent pool fallback");
    }
    const competitorRows = niche
      ? await c.query(api.competitors.listCompetitors, { ownerId: ctx.ownerId, niche }).catch(() => [])
      : [];
    const competitorTitles = (competitorRows as { topVideos?: { title: string; views: number }[] }[])
      .flatMap((r) => r.topVideos ?? [])
      .sort((a, b) => b.views - a.views)
      .slice(0, 12)
      .map((v) => ({ title: v.title, views: v.views }));
    const outliers = niche
      ? await loadOutlierBank({
          convex: c,
          ownerId: ctx.ownerId,
          niche,
          query: [niche, ...pool.slice(0, 2)].filter(Boolean).join(" "),
          log: (m) => ctx.log(m),
        })
      : [];

    const crafted = await craftTopics({
      channelName,
      niche,
      persona,
      styleGrammar: style,
      topicPool: pool,
      bannedWords,
      targetSeconds: Number(ctx.params["targetSeconds"] ?? 0) || undefined,
      count: 1,
      avoid: [...usedRows.map((r) => r.key), ...plannedTopics],
      perfContext: perfCtx || undefined,
      competitorTitles,
      outliers,
      programDirective,
      log: ctx.log,
    });
    const bet = crafted.bets[0];

    let topic = bet.topic;
    assertTopicFitsProgramRoute(programRoute, topic, "crafted");
    // FINAL hard guarantee (code, not model).
    if (usedNorm.has(normalizeTopic(topic))) {
      if (policy === "no_repeat") {
        throw new Error(
          "topic_select: could not produce a non-repeating topic for a no_repeat channel",
        );
      }
      const fresh = pool.filter((t) => !usedNorm.has(normalizeTopic(t)));
      if (fresh.length) topic = fresh[0];
    }
    // dryRun = preview a topic without committing it to history (UI preview/tests).
    await persistTopicAfterRouteValidation({
      route: programRoute,
      topic,
      source: "crafted",
      dryRun: ctx.params["dryRun"] === true,
      persist: () => recordTopicMemory(c, ctx, topic),
    });
    ctx.log(
      `topic_select: "${topic}" [${bet.betType}] title="${bet.provisionalTitle}" ` +
        `evidence=${bet.evidence.slice(0, 90)}`,
    );
    // The full bet rides the store: provisionalTitle/thumbnailMoment/hookPromise
    // are judged warm starts for metacraft, banana and hookcraft downstream.
    return { topic, topicBet: bet };
  },
};

/* -------------------------- 1b. scene_planner --------------------------- */

/**
 * Creates the immutable episode-level audio/visual brief consumed by both the
 * looping-scene planner and the paid music generation block.  The plan is
 * deterministic from the already-selected topic and frozen channel route; it
 * never calls a provider or grants render/publication authority.
 */
export const musicProgramPlan: Block = {
  id: "music_program_plan",
  consumes: ["topic"],
  produces: ["musicProgramPlan", "musicProgramPlanFingerprint"],
  run: async (ctx) => {
    const topic = str(ctx, "topic");
    const route = routeSeedForTopicSelection(ctx);
    if (!route) {
      throw new Error("music_program_plan: requires a sealed music-loop channel program route");
    }
    const dna = (ctx.store["styleDNA"] as import("@/engine/creative/types").StyleDNA | null) ?? null;
    const visual = getVisualBrief(ctx.store);
    const audio = getMusicBrief(ctx.store);
    const setting = [
      visual?.setting,
      visual?.world,
      visual?.footageQueries?.[0],
      ctx.params["setting"] as string | undefined,
      dna?.setting,
      ctx.store["niche"] as string | undefined,
    ].map((value) => value?.toString().trim()).find(Boolean);
    const audioDirection = [
      `Original instrumental program for “${topic}”.`,
      dna?.audio?.genre ? `Preserve the channel sound: ${dna.audio.genre}.` : "",
      dna?.audio?.instrumentation?.length ? `Instrumentation: ${dna.audio.instrumentation.join(", ")}.` : "",
      dna?.audio?.textures?.length ? `Texture: ${dna.audio.textures.join(", ")}.` : "",
      audio?.musicPrompt ? `Episode mood movement: ${audio.musicPrompt.trim().slice(0, 260)}.` : "",
      "No vocals, no lyrics, and a musically resolved seamless loop.",
    ].filter(Boolean).join(" ");
    const plan = createOriginalMusicProgramPlan({
      route,
      topic,
      setting,
      visualStyle: visualStyle(ctx),
      motionIntent: "one calm, seamless camera movement with no abrupt cuts, flashes, or subject drift",
      audioDirection,
      // The legacy route plan predates MiniMax-Music3 and remains replayable.
      // A MiniMax selection is bound separately by channel-music-program/v1 in
      // the paid block; never smuggle an unsupported provider into this v1.
      providerPreference: ctx.params["provider"] === "mureka" ? "mureka" : "suno",
    });
    ctx.log(`music_program_plan: sealed ${plan.fingerprint.slice(0, 12)} for ${plan.routeKey}`);
    return {
      musicProgramPlan: plan,
      musicProgramPlanFingerprint: plan.fingerprint,
    };
  },
};

export const scenePlanner: Block = {
  id: "scene_planner",
  consumes: ["topic"],
  produces: ["scenes", "sceneMusicPrompt", "musicProgramMotionIntent"],
  run: async (ctx) => {
    const topic = str(ctx, "topic");
    const musicProgram = musicProgramForCurrentRoute(ctx, topic);
    const style = musicProgram?.visual.visualStyle ?? styleGrammar(ctx);
    const vs = musicProgram?.visual.visualStyle ?? visualStyle(ctx);
    // Optional per-channel pre-authored library (locked consistency across a
    // series). Seeded from channel identity into the store by the runner, or
    // passed as a block param.
    const sceneLibrary =
      (ctx.params["sceneLibrary"] as Record<string, SceneLibraryEntry> | undefined) ??
      (ctx.store["sceneLibrary"] as Record<string, SceneLibraryEntry> | undefined);
    const defaultDurationSec = Number(ctx.params["clipDurationSec"] ?? 5);

    // On-brand SETTING for the loop: cinematographer brief > channel param >
    // niche/persona. Drives WHAT is in the frame so the loop matches the channel
    // goal instead of a generic template.
    // The cinematographer brief's first footage query is the most concrete,
    // on-brand WORLD descriptor (e.g. "rain-soaked Tokyo street at night");
    // styleGrammar is the channel's synthesized visual descriptor. Either is a
    // far better scene setting than the bare niche label.
    const vb = getVisualBrief(ctx.store);
    const settingHint = [
      musicProgram?.visual.setting,
      vb?.setting,
      vb?.world,
      vb?.footageQueries?.[0],
      ctx.params["setting"] as string | undefined,
      ctx.store["styleGrammar"] as string | undefined,
      ctx.store["niche"] as string | undefined,
    ].map((s) => (s ?? "").toString().trim()).find((s) => s.length > 0);

    // Phase 2 grounding: the frozen Style DNA renders the channel's LOCKED
    // identity (subject/setting/grade/motifs/allowed-motion) instead of a generic
    // cozy template, so every loop reads as the same channel.
    const styleDNA = (ctx.store["styleDNA"] as import("@/engine/creative/types").StyleDNA | null) ?? null;
    const plan = planScenes({
      topic,
      styleGrammar: style,
      visualStyle: vs,
      settingHint,
      styleDNA,
      sceneLibrary,
      defaultDurationSec,
    });
    const grounded = !!(styleDNA && styleDNA.recurringSubject && styleDNA.setting);
    ctx.log(
      `scene_planner: ${plan.scenes.length} scene(s) (fromLibrary=${plan.fromLibrary}, style=${vs}, ${grounded ? `DNA-grounded: "${styleDNA!.recurringSubject.slice(0, 50)}"` : `setting=${settingHint ? `"${settingHint.slice(0, 50)}"` : "generic"}`})`,
    );
    return {
      scenes: plan.scenes,
      // The route-owned plan is the binding instruction. The derived planner
      // prompt remains a legacy fallback for historical pipelines only.
      sceneMusicPrompt: musicProgram?.audio.direction ?? plan.musicPrompt ?? "",
      // loop_clips reads this before its generic scene prompt.  Passing the
      // sealed intent through is what makes the program’s motion constraint a
      // real renderer input rather than decorative planning metadata.
      ...(musicProgram ? { musicProgramMotionIntent: musicProgram.visual.motionIntent } : {}),
    };
  },
};

/* ---------------------------- 2. keyframes ------------------------------ */

export const keyframes: Block = {
  id: "keyframes",
  consumes: ["scenes"],
  produces: ["f1Url", "f1Key", "motionPrompt"],
  paid: true,
  run: async (ctx) => {
    // CLOUD REBUILD: one attested Novita still replaces the old local/Higgsfield
    // path, retaining a durable receipt and a bounded direct-worker envelope.
    // We make ONE keyframe; the seamless loop is built from one forward i2v clip
    // (crossfade self-loop), so we never need a second "frame B" still.
    const style = styleGrammar(ctx);
    const vs = visualStyle(ctx);
    const scene = scenesFromStore(ctx)[0];
    const aspect = (ctx.params.aspectRatio as string) ?? "16:9";
    if (aspect !== "16:9") {
      throw new Error(`keyframes: ${aspect} is not covered by the pinned Novita production profile`);
    }

    const baseFluxPrompt = composeFluxPrompt({
      sceneDescription: scene.fluxPrompt,
      styleGrammar: style,
      visualStyle: vs,
    });
    const dna = (ctx.store["styleDNA"] as import("@/engine/creative/types").StyleDNA | null) ?? null;
    const tmp = await makeRunTempDir(ctx.runId);
    const productionVisualQa = ctx.params["qaProfile"] !== "draft" && ctx.params["qualityProfile"] !== "draft";
    const hasGroundedIdentity = !!(dna?.recurringSubject?.trim() && dna.setting?.trim());

    // Per-block CREATIVE-DIRECTOR LOOP (Phase 2): generate the still → a vision
    // critic scores it against the channel's DNA identity → regenerate carrying the
    // critique forward. Keep the BEST attempt; NEVER fall back to a generic image.
    // Production loops need a concrete identity lock and an independent,
    // non-Google reviewer before a paid keyframe is admitted. A successful
    // render log cannot prove a loop is on-brand or free of baked-in text.
    if (productionVisualQa && !hasGroundedIdentity) {
      throw new Error("keyframes: production loop requires a grounded Style DNA subject and setting before image generation");
    }
    if (productionVisualQa && !hasNonGoogleVisionKey()) {
      throw new Error("keyframes: production loop requires a configured non-Google OpenRouter vision reviewer (OPENROUTER_API_KEY)");
    }
    const canCritique = hasNonGoogleVisionKey() && hasGroundedIdentity;
    const maximumImageAttempts = canCritique ? 2 : 1;
    // The director loop is deliberately bounded. Admit its complete possible
    // still fanout before the first worker so a retry can never borrow the
    // run-wide budget or leave a partially regenerated visual behind.
    novitaCostEnvelope({
      label: "keyframes",
      imageJobs: maximumImageAttempts,
      maxCostUsd: ctx.stageBudgetUsd,
    });
    let stills = 0;
    let imageCostUsd = 0;
    const loop = await produceAndCritique<{ url: string; local: string; key: string; jobId: string; model: string }>({
      label: "keyframe",
      threshold: 0.8,
      maxIters: maximumImageAttempts,
      log: (m) => ctx.log(m),
      produce: async (priorIssues) => {
        const fix = priorIssues.length
          ? ` Correct these problems from the previous attempt: ${priorIssues.join("; ")}.`
          : "";
        stills++;
        ctx.log(`keyframes: generating still (Novita local Z-Image Turbo), attempt ${stills}…`);
        const rendered = await renderNovitaImage({
          prefix: `${ctx.keyPrefix.replace(/\/$/, "")}/runs/${ctx.runId}/lofi-keyframe`,
          id: `keyframe-${stills}`,
          prompt: baseFluxPrompt + fix,
          profileId: "production",
          maxCostUsd: PRICE.novitaImageMaxUsd,
          lifecycle: {
            ownerId: ctx.ownerId,
            channelId: ctx.channelId,
            runId: ctx.runId,
            blockId: "keyframes",
          },
        });
        imageCostUsd += rendered.costUsd;
        const local = await downloadTo(rendered.url, join(tmp, `f1_${stills}.png`), {
          timeoutMs: DURABLE_RENDER_OUTPUT_DOWNLOAD_TIMEOUT_MS,
        });
        return { url: rendered.url, local, key: rendered.key, jobId: rendered.jobId, model: rendered.model };
      },
      critique: async (cand) => {
        if (!canCritique) return { score: 1, pass: true, issues: [] };
        try {
          const raw = await visionLocal({
            prompt: [
              "You are the channel's art director QA'ing a generated still against its LOCKED visual identity.",
              `RECURRING SUBJECT: ${dna!.recurringSubject}`,
              `SETTING: ${dna!.setting}`,
              dna!.colorGrade ? `COLOR GRADE: ${dna!.colorGrade}` : "",
              dna!.composition ? `COMPOSITION: ${dna!.composition}` : "",
              dna!.motifs?.length ? `MUST FEATURE motifs: ${dna!.motifs.join(", ")}` : "",
              dna!.visualAvoid?.length ? `MUST NOT contain: ${dna!.visualAvoid.slice(0, 6).join(", ")}` : "",
              // Legacy NO_RAIN_INSIDE physics gate, now enforced by the critic too:
              // Flux happily paints rain over interiors and the loop repeats the
              // defect forever, so a wet interior is an automatic fail.
              "HARD PHYSICS CHECK: if the scene is indoor/covered, is any rain, snow, mist or wet surface rendered INSIDE the room (not seen through a window)? If yes → this is an automatic FAIL: score 0 and name it in issues (weather belongs OUTSIDE the glass only).",
              "Score 0..1 how faithfully the image matches this identity (subject, setting, palette/grade, motifs, composition) AND is free of the forbidden elements and of any text/letters baked into the artwork.",
              'Return STRICT JSON {"score":number,"issues":[concrete visual fixes]}.',
            ].filter(Boolean).join("\n"),
            imagePaths: [cand.local],
            json: true,
            maxTokens: VISION_GATE_MAX_TOKENS,
            providers: ["openrouter"], tier: "final",
          });
          const v = parseJsonLoose<{ score?: number; issues?: string[] }>(raw);
          const score = Math.max(0, Math.min(1, Number(v.score) || 0));
          const issues = (v.issues ?? []).filter((s): s is string => typeof s === "string" && s.length > 0).slice(0, 5);
          return { score, pass: score >= 0.8, issues };
        } catch (e) {
          if (productionVisualQa) {
            throw new Error(`keyframes: independent art-direction review failed: ${e instanceof Error ? e.message : e}`);
          }
          ctx.log(`keyframes: critic failed (${e instanceof Error ? e.message : e}) — accepting draft attempt`);
          return { score: 0.8, pass: true, issues: [] };
        }
      },
    });
    const f1Url = loop.value.url;
    const f1Local = loop.value.local;
    ctx.log(`keyframes: best still after ${stills} attempt(s) (score=${loop.critique.score.toFixed(2)}, accepted=${loop.accepted})`);

    const f1Key = loop.value.key;
    await recordAsset(ctx, "keyframe", f1Key, {
      provider: "novita-z-image-turbo-local",
      jobId: loop.value.jobId,
      model: loop.value.model,
      attempts: stills,
      identityScore: loop.critique.score,
    });

    // SCENE DIRECTOR reads the actual accepted still through the same independent
    // reviewer and names animatable elements, so I2V moves real pixels rather
    // than relying on a generic template motion guess.
    let motionPrompt = scene.klingMotionPrompt;
    if (canCritique) {
      try {
        const raw = await visionLocal({
          prompt:
            "This is a still for a seamless lofi/ambient LOOP. Identify the elements that should " +
            "SUBTLY animate (e.g. drifting steam, swaying plants, flickering candle, rain on glass, " +
            "rippling water, twinkling lights, a breathing/blinking character) and where they are. " +
            "The CAMERA stays perfectly STATIC. Return STRICT JSON " +
            '{"motion":"one concise sentence describing only the subtle looping motion of the named elements"}.',
          imagePaths: [f1Local],
          json: true,
          maxTokens: VISION_GATE_MAX_TOKENS,
          providers: ["openrouter"], tier: "final",
        });
        const m = parseJsonLoose<{ motion?: string }>(raw).motion;
        if (m && m.length > 12) { motionPrompt = m; ctx.log(`keyframes: scene-director motion → "${m.slice(0, 90)}"`); }
      } catch (e) {
        if (productionVisualQa) {
          throw new Error(`keyframes: independent motion-direction review failed: ${e instanceof Error ? e.message : e}`);
        }
        ctx.log(`keyframes: scene-director failed (using draft template): ${e instanceof Error ? e.message : e}`);
      }
    }

    ctx.log(`keyframes ok: still=${f1Key}`);
    return {
      f1Url,
      f1Key,
      motionPrompt,
      [COST_PATCH_KEY]: imageCostUsd,
    };
  },
};

/* --------------------------- 3. loop_clips ------------------------------ */

export const loopClips: Block = {
  id: "loop_clips",
  consumes: ["f1Key"],
  produces: [
    "loopRawKey",
    "loopRawUrl",
    "loopSourceDurationSec",
    "loopSourceSegmentCount",
    "loopSourceInternalSeamDiff",
    "loopSourceWrapSeamDiff",
  ],
  paid: true,
  run: async (ctx) => {
    // A music-loop episode owns one nominal 30-second source unit: two distinct
    // 15-second LTX FLF2V segments sharing the same independently reviewed
    // first/end still. The final 1–8 hour master repeats only this unit.
    const scaling = familyTimeScalingContract("music_loop");
    if (scaling.method !== "stream_loop") {
      throw new Error("loop_clips: music-loop family has no stream-loop scaling contract");
    }
    const segmentCount = Number(ctx.params.segmentCount ?? scaling.sourceSegmentCount);
    const segmentSeconds = Number(ctx.params.clipDurationSec ?? scaling.sourceSegmentSeconds);
    const loopMode = String(ctx.params.loopMode ?? scaling.loopMode);
    if (
      segmentCount !== scaling.sourceSegmentCount
      || segmentSeconds !== scaling.sourceSegmentSeconds
      || loopMode !== scaling.loopMode
    ) {
      throw new Error(
        `loop_clips: source contract requires ${scaling.sourceSegmentCount}×${scaling.sourceSegmentSeconds}s ${scaling.loopMode}; ` +
        `received ${segmentCount}×${segmentSeconds}s ${loopMode}`,
      );
    }
    const f1Key = str(ctx, "f1Key");
    // The source track is sealed before visual generation. Distilled I2V does
    // not accept an audio-conditioning input, so do not imply that it does;
    // retaining this verified dependency is what lets the separate LTX 2.5
    // A2V benchmark consume the exact mastered source without re-generation.
    const musicKey = typeof ctx.store["musicKey"] === "string" ? ctx.store["musicKey"].trim() : "";
    const routeBoundMusicProgram = musicProgramForCurrentRoute(ctx, str(ctx, "topic"));
    if (routeBoundMusicProgram && !musicKey) {
      throw new Error("loop_clips: the registered music-loop route requires mastered music before visual generation");
    }
    const style = styleGrammar(ctx);
    const vs = visualStyle(ctx);
    const scene = scenesFromStore(ctx)[0];
    // PARAM SPLIT: flf's safety-net fade used to read the SHARED `crossfadeSec`
    // (pipeline: 2.5s — tuned for the plain-crossfade mode where the blend IS
    // the loop mechanism), double-exposing 2.5s of every loop into a visible
    // ghost over a seam that FLF2V had already closed. flf gets its OWN small
    // param, hard-capped: anything longer than ~0.6s reads as a double exposure.
    const flfCrossfadeSec = Math.min(0.6, Math.max(0, Number(ctx.params.flfCrossfadeSec ?? 0.4)));
    // This optional adapter travels through the same sealed direct-worker path
    // as cinematic I2V: base/revision, benchmark, strength and trigger tokens
    // are validated there before a GPU job starts. Do not flatten it into text.
    const creativeAdapter = LtxCreativeAdapterInputSchema.optional().parse(
      ctx.params["ltxCreativeAdapter"],
    );

    // Prefer the independently reviewed scene-director motion over the template, and
    // push hard for a LOCKED camera + NON-directional ambient motion so the loop
    // (esp. the boomerang's reverse half) reads naturally with no scale/pan pop.
    const motion = (ctx.store["musicProgramMotionIntent"] as string | undefined)
      || (ctx.store["motionPrompt"] as string | undefined)
      || scene.klingMotionPrompt;
    const fwd = composeKlingPrompt({
      sceneDescription: `${motion}. Extremely subtle, slow, NON-directional ambient motion only ` +
        `(gentle shimmer, soft glow flicker, drifting steam, faint sway) — avoid strong directional ` +
        `movement. The camera is COMPLETELY LOCKED: absolutely no zoom, no push-in, no pan, no scale ` +
        `or framing change. Perfectly smooth, seamlessly loopable, no scene change.`,
      styleGrammar: style,
      visualStyle: vs,
      extraNegative: "zoom, push in, dolly, camera move, scale change, framing change, pan, tilt",
    });

    ctx.log(`loop_clips: Novita LTX-2.5 distilled ${segmentCount}×${segmentSeconds}s (loop=${loopMode}${musicKey ? `; sealed music=${musicKey.slice(-32)}` : "; legacy no-audio path"}) — prompt: "${fwd.prompt.slice(0, 80)}…"`);
    const stageBudgetUsd = requireNovitaStageBudget(ctx.stageBudgetUsd, "loop_clips");
    const envelope = novitaCostEnvelope({
      label: "loop_clips",
      videoJobs: scaling.sourceSegmentCount,
      maxCostUsd: stageBudgetUsd,
    });
    const tmp = await makeRunTempDir(ctx.runId);
    const clips: Awaited<ReturnType<typeof renderNovitaI2V>>[] = [];
    const segmentPaths: string[] = [];
    let observedClipCostUsd = 0;
    try {
      for (let index = 0; index < scaling.sourceSegmentCount; index++) {
        const ordinal = index + 1;
        const seed = Number.parseInt(
          sha256Hex(`${ctx.runId}:lofi-loop-segment:${ordinal}`).slice(0, 8),
          16,
        ) % 2_147_483_647;
        const clip = await renderNovitaI2V({
          prefix: `${ctx.keyPrefix.replace(/\/$/, "")}/runs/${ctx.runId}/lofi-loop`,
          id: `loop-segment-${ordinal}`,
          prompt: `${fwd.prompt}\nSource segment ${ordinal} of ${segmentCount}: preserve the exact subject, composition, lighting, and motion language while varying only tiny ambient micro-motion.`,
          negativePrompt: fwd.negativePrompt,
          imageKey: f1Key,
          // Both segments begin and end at the same accepted still. This binds
          // A→B and B→A continuity to real worker inputs, not prompt wording.
          endImageKey: f1Key,
          durationSec: segmentSeconds,
          seed,
          profileId: "production",
          ...(typeof ctx.params["ltxStyleId"] === "string" ? { styleId: ctx.params["ltxStyleId"] } : {}),
          creativeAdapter,
          maxCostUsd: envelope.videoMaxCostUsd / scaling.sourceSegmentCount,
          lifecycle: {
            ownerId: ctx.ownerId,
            channelId: ctx.channelId,
            runId: ctx.runId,
            blockId: "loop_clips",
          },
        });
        if (!clip.url) throw new Error(`loop_clips: Novita segment ${ordinal} produced no URL`);
        clips.push(clip);
        observedClipCostUsd += clip.costUsd;
        const local = await downloadTo(clip.url, join(tmp, `clip-${ordinal}.mp4`), {
          timeoutMs: DURABLE_RENDER_OUTPUT_DOWNLOAD_TIMEOUT_MS,
        });
        // Each FLF2V take already closes on the accepted still. A separately
        // capped 0.4s blend only absorbs encoder/model endpoint noise.
        segmentPaths.push(await seamlessLoopUnit(
          local,
          join(tmp, `segment-${ordinal}.mp4`),
          { crossfadeSec: flfCrossfadeSec },
        ));
      }
    } catch (error) {
      const source = error instanceof Error ? error : new Error(String(error));
      const charged = Object.isExtensible(source) ? source : Object.assign(new Error(source.message), { cause: source });
      const prior = Number((charged as { additionalObservedCostUsd?: unknown }).additionalObservedCostUsd ?? 0);
      throw Object.assign(charged, {
        additionalObservedCostUsd: (Number.isFinite(prior) && prior > 0 ? prior : 0) + observedClipCostUsd,
        retryable: false,
      });
    }

    if (segmentPaths.length !== scaling.sourceSegmentCount) {
      throw new Error("loop_clips: incomplete source segment set after rendering");
    }
    let loopRaw: string;
    let internalSeamDiff: number;
    let wrapSeamDiff: number;
    try {
      loopRaw = await composeLoopSourceUnit({
        segmentPaths: [segmentPaths[0], segmentPaths[1]],
        outPath: join(tmp, "loopraw.mp4"),
        segmentSeconds,
        fps: 25,
      });
      [internalSeamDiff, wrapSeamDiff] = await Promise.all([
        measureVideoBoundaryDiff(loopRaw, tmp, {
          boundarySec: segmentSeconds,
          label: "lofi-internal-seam",
        }),
        measureLoopSeamDiff(loopRaw, tmp),
      ]);
      const worstSeamDiff = Math.max(internalSeamDiff, wrapSeamDiff);
      ctx.log(
        `loop_clips: 30s source continuity internal=${internalSeamDiff.toFixed(4)} wrap=${wrapSeamDiff.toFixed(4)} (max ${scaling.seamMaximumDiff.toFixed(2)})`,
      );
      if (worstSeamDiff > scaling.seamMaximumDiff) {
        throw new Error(
          `loop_clips: source continuity failed (${worstSeamDiff.toFixed(4)} > ${scaling.seamMaximumDiff.toFixed(2)})`,
        );
      }
    } catch (error) {
      const source = error instanceof Error ? error : new Error(String(error));
      const charged = Object.isExtensible(source) ? source : Object.assign(new Error(source.message), { cause: source });
      const prior = Number((charged as { additionalObservedCostUsd?: unknown }).additionalObservedCostUsd ?? 0);
      throw Object.assign(charged, {
        additionalObservedCostUsd: (Number.isFinite(prior) && prior > 0 ? prior : 0) + observedClipCostUsd,
        retryable: false,
      });
    }

    const loopRawKey = `${ctx.keyPrefix}runs/${ctx.runId}/loopraw.mp4`;
    await putObject(loopRawKey, await readBytes(loopRaw), { contentType: "video/mp4" });
    await recordAsset(ctx, "clip", loopRawKey, {
      jobIds: clips.map((clip) => clip.jobId),
      models: clips.map((clip) => clip.model),
      sourceSegmentCount: scaling.sourceSegmentCount,
      sourceSegmentSeconds: scaling.sourceSegmentSeconds,
      sourceUnitSeconds: scaling.sourceUnitSeconds,
      internalSeamDiff,
      wrapSeamDiff,
    });

    return {
      loopRawKey,
      loopRawUrl: loopRaw, // local path; upscale reads it directly
      loopSourceDurationSec: scaling.sourceUnitSeconds,
      loopSourceSegmentCount: scaling.sourceSegmentCount,
      loopSourceInternalSeamDiff: internalSeamDiff,
      loopSourceWrapSeamDiff: wrapSeamDiff,
      [COST_PATCH_KEY]: observedClipCostUsd,
    };
  },
};

/* ----------------------------- 4. upscale ------------------------------- */

export const upscale: Block = {
  id: "upscale",
  consumes: ["loopRawUrl"],
  produces: [
    "loopUnitKey",
    "loopUnitUrl",
    "loopUnitUpscaled",
    "loopUnitResolution",
  ],
  paid: false,
  run: async (ctx) => {
    // The generative pixels already came from the attested Novita LTX-2.5
    // distilled two-stage latent x2 pipeline and its pinned spatial upscaler. This finishing
    // stage performs only deterministic local Lanczos scaling on the short loop
    // unit; no Replicate/Topaz provider or hidden fallback can re-render it.
    const targetResolution = (ctx.params.targetResolution as string) ?? "4k";
    const targetFps = Number(ctx.params.targetFps ?? 30);
    const dimensions: Record<string, [number, number]> = {
      "2k": [2560, 1440],
      "4k": [3840, 2160],
      "1080p": [1920, 1080],
    };
    const target = dimensions[targetResolution];
    if (!target) throw new Error(`upscale: unsupported target resolution ${targetResolution}`);
    if (!Number.isFinite(targetFps) || targetFps < 24 || targetFps > 60) {
      throw new Error(`upscale: target fps ${targetFps} is outside 24..60`);
    }

    const tmp = await makeRunTempDir(ctx.runId);
    // loop_clips stashed the local path in loopRawUrl; re-fetch from R2 on resume.
    const loopRawLocal = ctx.store["loopRawUrl"] as string | undefined;
    let loopUnit: string;
    if (loopRawLocal && (await fileExists(loopRawLocal))) {
      loopUnit = loopRawLocal;
    } else {
      const key = str(ctx, "loopRawKey");
      ctx.log(`upscale: loop-unit temp missing — re-fetching ${key} from R2`);
      loopUnit = await writeBytes(join(tmp, "loopraw.mp4"), await getObjectBytes(key));
    }

    const finalLoopPath = join(tmp, `loopunit_${targetResolution}.mp4`);
    const [width, height] = target;
    ctx.log(`upscale: deterministic local Lanczos finish → ${width}x${height}@${targetFps}fps…`);
    await promisify(execFile)(process.env.FFMPEG_BIN ?? "ffmpeg", [
      "-y", "-i", loopUnit,
      "-vf",
      `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,fps=${Math.round(targetFps)}`,
      "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "17",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart", finalLoopPath,
    ], { maxBuffer: 4 * 1024 * 1024 });
    const resolution = targetResolution;
    const upscaled = true;
    ctx.log(`upscale: local finish complete — ${resolution}`);

    const loopUnitKey = `${ctx.keyPrefix}runs/${ctx.runId}/loopunit_${resolution}.mp4`;
    await putObjectFromFile(loopUnitKey, finalLoopPath, {
      contentType: "video/mp4",
    });
    await recordAsset(ctx, "loop_unit", loopUnitKey, {
      upscaled,
      resolution,
      targetFps,
      sourceRender: "novita-ltx-distilled-two-stage-x2",
      finish: "local-lanczos",
    });

    // Stash the local path so assemble can stream_loop without re-downloading.
    return {
      loopUnitKey,
      loopUnitUrl: finalLoopPath, // local path; assemble reads it directly
      loopUnitUpscaled: upscaled,
      loopUnitResolution: resolution,
      [COST_PATCH_KEY]: 0,
    };
  },
};

/* ------------------------------ 5. music -------------------------------- */

export const music: Block = {
  id: "music",
  consumes: ["topic"],
  produces: [
    "musicKey",
    "musicProvider",
    "musicUrl",
    "channelMusicProgramKey",
    "channelMusicProgramFingerprint",
    "musicRuntimeReceiptKey",
  ],
  paid: true,
  run: async (ctx) => {
    const topic = str(ctx, "topic");
    // Bind before a reuse shortcut as well: otherwise a newly admitted music
    // route could attach a sibling's track without proving it belongs to this
    // episode program.
    const musicProgram = musicProgramForCurrentRoute(ctx, topic);
    // RENDER-GROUP REUSE: a language sibling reuses the base render's music track
    // (identical audio bed; only narration differs) — no Mureka/Suno generation.
    const reuseMusicKey = ctx.store["reuseMusicKey"] as string | undefined;
    if (reuseMusicKey) {
      ctx.log(`music: REUSED base music track ${reuseMusicKey} (no generation)`);
      let reuseUrl = "";
      try { reuseUrl = publicUrl(reuseMusicKey); } catch { reuseUrl = `r2://${reuseMusicKey}`; }
      return {
        musicKey: reuseMusicKey,
        musicProvider: "reuse",
        musicUrl: reuseUrl,
        [COST_PATCH_KEY]: 0,
      };
    }
    const requestedProvider = ["suno", "mureka", "minimax_music3"].includes(String(ctx.params.provider))
      ? ctx.params.provider as MusicProvider
      : undefined;
    const provider: MusicProvider = requestedProvider ?? musicProgram?.audio.providerPreference ?? "mureka";
    // Phase 2 grounding: "Suno generated by the STYLE OF THE CHANNEL" — the frozen
    // Style DNA audio spec (genre/instrumentation/textures/BPM/loop) is the
    // channel's locked SOUND and WINS. Priority: DNA spec > Composer crew brief
    // (per-video nuance, only when there is no DNA) > explicit param > default.
    const composerPrompt = getMusicBrief(ctx.store)?.musicPrompt;
    const studioAudioRecipe = studioPostproductionRecipeProjectionFromUnknown(
      ctx.store["studioAudioRecipeProjection"],
      "audio_recipe",
    );
    const studioAudioDirection = studioAudioRecipe.promptAddenda.length
      ? ` Approved Studio audio direction (must preserve the locked channel sound, instrumental/no-vocal rule, and requested duration): ${studioAudioRecipe.promptAddenda.join(" ")}`
      : "";
    const dna = (ctx.store["styleDNA"] as import("@/engine/creative/types").StyleDNA | null) ?? null;
    const a = dna?.audio;
    const dnaPrompt = a?.genre?.trim()
      ? [
          `${a.genre} instrumental to study and relax to, evoking "${topic}".`,
          a.instrumentation?.length ? `Instrumentation: ${a.instrumentation.join(", ")}.` : "",
          a.textures?.length ? `Texture: ${a.textures.join(", ")}.` : "",
          // Neither Mureka nor Suno exposes a structural/section parameter
          // (verified against both providers' actual request shapes in
          // src/lib/music.ts — `duration` is the only real metadata either
          // returns; BPM only ever appears as OUTBOUND prompt text). Prose is
          // the only lever these providers expose for mood movement across a
          // track, so carry the DNA's full mood-arc sentence (not just its
          // first clause) — an author who wrote "opens tense, resolves
          // warmer" wants that shift reaching the model, not truncated away.
          a.moodArc ? `Emotional arc across the track: ${a.moodArc.trim().slice(0, 240)}.` : "",
          `${a.bpmRange?.[0] ?? 70}-${a.bpmRange?.[1] ?? 88} BPM, ${a.loopable ? "loop-friendly, resolves back to the tonic" : "natural ending"}, purely instrumental, no vocals, no lyrics.`,
        ].filter(Boolean).join(" ")
      : "";
    // BLEND, not override: the DNA is the channel's locked sound (identity
    // floor); the Composer's per-video brief carries THIS video's emotional
    // arc. DNA-only made every video's score near-identical — the staleness
    // the composer crew existed to prevent.
    const arcNote = composerPrompt?.trim()
      ? ` This video's emotional direction: ${composerPrompt.trim().slice(0, 220)}`
      : "";
    const basePrompt =
      (dnaPrompt && dnaPrompt.trim() ? `${dnaPrompt.trim()}${arcNote}` : "") ||
      (composerPrompt && composerPrompt.trim()) ||
      (ctx.params.prompt as string) ||
      `warm cozy lofi hip-hop instrumental to study/relax to, evoking "${topic}". ` +
      `mellow Rhodes piano, soft boom-bap drums, gentle bass, vinyl crackle, tape warmth, ` +
      `calm and nostalgic, ~72 bpm, purely instrumental, no vocals, no lyrics, loop-friendly`;
    const prompt = [
      musicProgram?.audio.direction,
      basePrompt,
      studioAudioDirection,
    ].filter(Boolean).join(" ");
    ctx.log(`music: prompt source = ${dnaPrompt ? (arcNote ? "style DNA + composer arc" : "style DNA") : composerPrompt ? "composer brief" : "default"}${studioAudioDirection ? " + approved Studio audio direction" : ""}`);

    const route = routeSeedForTopicSelection(ctx);
    const channelIdentityFingerprint = sha256Hex(canonicalJson({
      ownerId: ctx.ownerId,
      channelId: ctx.channelId,
      channelName: ctx.store["channelName"] ?? null,
      routeFingerprint: route?.routeFingerprint ?? null,
      styleDNA: dna,
      musicBrief: getMusicBrief(ctx.store) ?? null,
    }));
    const channelMusicProgram: ChannelMusicProgram = createChannelMusicProgram({
      channelId: String(ctx.channelId),
      channelIdentityFingerprint,
      family: route?.family ?? "music_loop",
      contentLaneKey: route?.contentLaneKey ?? "music_loop",
      topic,
      providerPreference: provider,
      durationSec: Number(ctx.params.generationDurationSec ?? 300),
      genre: a?.genre,
      instrumentation: a?.instrumentation,
      textures: a?.textures,
      bpmRange: a?.bpmRange,
      moodArc: a?.moodArc,
      composerDirection: [composerPrompt, studioAudioDirection].filter(Boolean).join(" ") || undefined,
      targetLufs: Number(a?.loudnessLufs ?? -16),
      bodyMusicVol: 1,
    });
    const channelMusicProgramKey =
      `${ctx.keyPrefix}runs/${ctx.runId}/audio/channel-music-program-${channelMusicProgram.fingerprint}.json`;
    await putObject(
      channelMusicProgramKey,
      Buffer.from(JSON.stringify(channelMusicProgram, null, 2)),
      { contentType: "application/json" },
    );
    await recordAsset(ctx, "channel_music_program", channelMusicProgramKey, {
      fingerprint: channelMusicProgram.fingerprint,
      providerPreference: channelMusicProgram.generation.providerPreference,
      role: channelMusicProgram.role,
      spendUsd: 0,
      productionMusicKey: null,
    });
    ctx.log(
      `music: sealed channel sound program ${channelMusicProgram.fingerprint.slice(0, 12)} ` +
      `(${channelMusicProgram.role}, ${channelMusicProgram.generation.sections.length} authored sections) before spend`,
    );
    const providerPrompt = provider === "minimax_music3"
      ? channelMusicProgram.generation.structuredCaption
      : [
          prompt,
          `Arrangement map: ${channelMusicProgram.generation.sections.map((section) =>
            `${section.label} ${Math.round(section.startFraction * 100)}-${Math.round(section.endFraction * 100)}%: ${section.instruction}`,
          ).join(" ")}`,
        ].join(" ");

    // MULTI-TRACK MIX: a single looped 3-min track reads as stale on anything
    // longer than a few minutes. trackCount asks for N distinct clips that get
    // crossfade-concatenated (3s tri — the proven legacy-autostudio recipe)
    // into one continuous mix before looping. A Suno generation returns TWO
    // clips for one credit, so cost = ceil(N/2) generations. Default 2 = double
    // the unique audio at the old single-track price.
    const trackCount = Math.max(1, Math.min(8, Number(ctx.params.trackCount ?? 2)));
    const sunoModel = (ctx.params.model as string | undefined) ?? "V5";
    const mixTitle = (String(ctx.store["channelName"] ?? "") || topic).slice(0, 60);
    const tmp = await makeRunTempDir(ctx.runId);

    let tracks: MusicTrack[] = [];
    let jobIds: string[] = [];
    let generations = 0;
    let billedGenerations = 0;
    let billedAttestedCostUsd = 0;
    let usedProvider: MusicProvider = provider;
    let minimaxLocalPath: string | undefined;
    let minimaxReceipt: MiniMaxMusic3Receipt | undefined;
    let musicRuntimeReceiptKey: string | undefined;

    try {
    const generateWith = async (prov: MusicProvider): Promise<void> => {
      tracks = [];
      jobIds = [];
      generations = 0;
      if (prov === "minimax_music3") {
        ctx.log(
          "music: MiniMax-Music3 — two-GPU spot worker, pinned ComfyUI/model revisions, " +
          "prominent attribution/disclosure, durable WAV integrity, and listened-quality admission required…",
        );
        const result = await generateMiniMaxMusic3({
          program: channelMusicProgram,
          seed: Number(ctx.params.seed ?? 4_242),
          cfgScale: Number(ctx.params.cfgScale ?? 7),
          topK: Number(ctx.params.topK ?? 50),
          maxCostUsd: Number(ctx.params.maxCostUsd ?? 5),
        });
        minimaxReceipt = result.receipt;
        billedAttestedCostUsd = result.receipt.runtime.costUsd;
        minimaxLocalPath = await writeBytes(join(tmp, "minimax-music3.wav"), result.audio);
        musicRuntimeReceiptKey =
          `${ctx.keyPrefix}runs/${ctx.runId}/audio/minimax-music3-runtime-${result.receipt.requestKey}.json`;
        await putObject(
          musicRuntimeReceiptKey,
          Buffer.from(JSON.stringify(result.receipt, null, 2)),
          { contentType: "application/json" },
        );
        await recordAsset(ctx, "minimax_music3_runtime_receipt", musicRuntimeReceiptKey, {
          requestKey: result.receipt.requestKey,
          jobId: result.receipt.jobId,
          programFingerprint: channelMusicProgram.fingerprint,
          modelRevision: result.receipt.modelRevision,
          runtimeRevision: result.receipt.runtimeRevision,
          observedCostUsd: result.receipt.runtime.costUsd,
          uiAttribution: result.receipt.license.uiAttribution,
          generatedContentDisclosureEnabled: result.receipt.license.generatedContentDisclosureEnabled,
          trackHumanAuditionStatus: "pending_private_draft_review",
        });
        generations = 1;
        usedProvider = "minimax_music3";
        jobIds = [result.receipt.jobId];
        tracks = [{
          url: result.receipt.output.url,
          wavUrl: result.receipt.output.url,
          durationSec: result.receipt.durationSec,
        }];
      } else if (prov === "suno") {
        const gens = Math.ceil(trackCount / 2);
        for (let g = 0; g < gens && tracks.length < trackCount; g++) {
          const varied =
            g === 0
              ? providerPrompt
              : `${providerPrompt} Part ${g + 1} of a continuous mix: same instrumentation, key family and mood, a different melodic progression.`;
          ctx.log(`music: suno ${sunoModel} generation ${g + 1}/${gens} (custom mode, WAV upgrade)…`);
          const res = await generateSuno({
            prompt: varied,
            model: sunoModel,
            title: mixTitle,
            // WAV upgrade only when EXPLICITLY requested (lofi sets it): a
            // narrated bed sits ducked -22dB under voice — inaudible benefit,
            // and a failed WAV poll burned up to 3 min/clip of pure waiting.
            wantClips: Math.min(2, trackCount - tracks.length),
            preferWav: ctx.params.preferWav === true,
            timeoutMs: 600_000,
          });
          generations++;
          billedGenerations++;
          jobIds.push(res.jobId);
          tracks.push(...res.tracks.slice(0, trackCount - tracks.length));
        }
      } else {
        ctx.log(`music: generating via ${prov}…`);
        const res = await generateMureka({
          prompt: providerPrompt,
          model: ctx.params.model as string | undefined,
          timeoutMs: 600_000,
        });
        generations = 1;
        billedGenerations++;
        usedProvider = res.provider;
        jobIds = [res.jobId];
        tracks = res.tracks;
      }
    };

    // PROVIDER FAILOVER: a quota/billing-dead provider must not kill the render
    // when the alternate provider's key is present — both produce instrumental
    // beds from the same DNA prompt. (Live case: Mureka 429 "exceeded your
    // current quota" after two renders; Suno had credits.)
    const altProvider: Exclude<MusicProvider, "minimax_music3"> = provider === "suno" ? "mureka" : "suno";
    const hasProviderKey = (p: Exclude<MusicProvider, "minimax_music3">) =>
      p === "suno" ? Boolean(process.env.SUNO_API_KEY) : Boolean(process.env.MUREKA_API_KEY);
    try {
      await generateWith(provider);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const admissionRejected =
        e instanceof MusicError &&
        e.safeToFallback &&
        e.acceptedUnits === 0 &&
        billedGenerations === 0;
      if (provider !== "minimax_music3" && admissionRejected && hasProviderKey(altProvider)) {
        ctx.log(`music: ${provider} is quota/billing-dead (${msg.slice(0, 120)}) — FAILING OVER to ${altProvider}`);
        usedProvider = altProvider;
        await generateWith(altProvider);
      } else {
        throw e;
      }
    }
    if (!tracks.length) throw new Error("music: provider returned no tracks");
    const wavCount = tracks.filter((t) => t.wavUrl).length;
    ctx.log(`music: ${tracks.length} track(s) ready (${wavCount} lossless WAV) from ${generations} generation(s)`);

    // Download all clips, crossfade-concat into one mix, then MASTER to the
    // channel's LUFS target (DNA audio.loudnessLufs, default -14 = YouTube
    // reference) — the "Suno loudness mastering" step that previously existed
    // only as an unenforced DNA field.
    const locals: string[] = minimaxLocalPath ? [minimaxLocalPath] : [];
    if (!minimaxLocalPath) {
      for (let i = 0; i < tracks.length; i++) {
        const ext = tracks[i].wavUrl ? "wav" : "mp3";
        locals.push(await downloadTo(tracks[i].url, join(tmp, `track_${i}.${ext}`), {
          timeoutMs: MUSIC_PROVIDER_OUTPUT_DOWNLOAD_TIMEOUT_MS,
        }));
      }
    }
    const mixPath =
      locals.length > 1 ? await crossfadeConcatAudio(locals, join(tmp, "mix.mp3"), 3) : locals[0];
    const targetLufs = channelMusicProgram.mix.targetLufs;
    let local = await masterAudioTransparentGain(mixPath, join(tmp, "music.mp3"), {
      lufs: targetLufs,
      truePeakMaxDbtp: channelMusicProgram.mix.truePeakMaxDbtp,
    });
    ctx.log(`music: mastered mix → transparent constant gain I=${targetLufs} LUFS, no compressor/limiter, 320k`);
    // SELF-LOOPING FOLD: assemble stream_loops this mix for the whole render,
    // so an unproven bed would create an audible hard splice every loop. This
    // is a release gate, not optional polish: after a paid generation the
    // outer catch retains its observed spend and makes this failure terminal,
    // rather than buying the same music again on a task replay.
    const loopedMusicPath = join(tmp, "music_loop.mp3");
    const loopedMusic = await selfLoopAudio(local, loopedMusicPath, {
      log: (m) => ctx.log(`music: ${m}`),
    });
    // `selfLoopAudio` promises this exact path on success. Keep the check at
    // the release boundary as a future-proof guard against any reintroduced
    // pass-through fallback.
    if (loopedMusic !== loopedMusicPath) {
      throw new MusicError(
        "music: self-loop continuity proof did not produce the sealed loop artifact; refusing a hard-splice fallback",
      );
    }
    local = loopedMusic;

    const musicKey = `${ctx.keyPrefix}runs/${ctx.runId}/music.mp3`;
    await putObject(musicKey, await readBytes(local), { contentType: "audio/mpeg" });
    await recordAsset(ctx, "music", musicKey, {
      provider: usedProvider,
      jobId: jobIds.join(","),
      tracks: tracks.length,
      losslessTracks: wavCount,
      masteredLufs: targetLufs,
      channelMusicProgramFingerprint: channelMusicProgram.fingerprint,
      channelMusicProgramKey,
      runtimeReceiptKey: musicRuntimeReceiptKey,
      generatedContentDisclosure: usedProvider === "minimax_music3",
      uiAttribution: minimaxReceipt?.license.uiAttribution,
      trackHumanAuditionStatus: "pending_private_draft_review",
    });

    // Downstream consumers (assemble/timeline_assemble) PREFER musicKey — the
    // mastered R2 mix. musicUrl is only the legacy fallback; R2_PUBLIC_BASE_URL
    // may be unset on Trigger, so fall back to the first provider clip URL.
    let musicUrl: string;
    try {
      musicUrl = publicUrl(musicKey);
    } catch {
      musicUrl = tracks[0].url;
    }
    return {
      musicKey,
      musicProvider: usedProvider,
      musicUrl,
      channelMusicProgramKey,
      channelMusicProgramFingerprint: channelMusicProgram.fingerprint,
      musicRuntimeReceiptKey,
      // Keep spend from successful generations made before provider failover;
      // resetting the selected provider's tracks must not erase paid work.
      [COST_PATCH_KEY]: PRICE.musicTrackUsd * billedGenerations + billedAttestedCostUsd,
    };
    } catch (error) {
      // Preserve every confirmed accepted generation if a later generation,
      // download, mix, or R2 write fails. This also makes the failure terminal,
      // preventing the runner from buying the completed jobs again.
      if (billedAttestedCostUsd > 0 && error && typeof error === "object") {
        Object.assign(error, { observedCostUsd: billedAttestedCostUsd });
      }
      throw withMusicGenerationCost(error, billedGenerations, PRICE.musicTrackUsd);
    }
  },
};

/* ----------------------------- 7. assemble ------------------------------ */

export const assemble: Block = {
  id: "assemble",
  consumes: ["loopUnitKey", "musicUrl"],
  produces: ["videoKey", "videoLocalPath", "videoDurationSec", "introApplied", "loopSeamDiff"],
  run: async (ctx) => {
    // SHORT for M1; set durationSec=7200 in the channel pipeline for a 2h render.
    // The loop UNIT is already upscaled (Topaz) by the upscale block; assemble
    // PREPENDS the Remotion title card (music-only intro, no narration), then
    // stream_loops that 4K unit under the full music track → the cost of length
    // is just ffmpeg time, not another upscale. Lofi has no narration so the
    // music plays at full volume the whole way (composeWithIntro skips ducking).
    const durationSec = Number(ctx.params.durationSec ?? 90);
    const duration = familyDurationContract("music_loop");
    const scaling = familyTimeScalingContract("music_loop");
    if (scaling.method !== "stream_loop") {
      throw new Error("assemble: music-loop family has no stream-loop scaling contract");
    }
    if (
      !Number.isFinite(durationSec)
      || durationSec < duration.minimumSeconds
      || durationSec > duration.maximumSeconds
      || (durationSec - duration.minimumSeconds) % duration.stepSeconds !== 0
    ) {
      throw new Error(
        `assemble: music-loop duration must be an authored 1–8 hour unit; received ${String(ctx.params.durationSec)}`,
      );
    }
    const internalSeamDiff = Number(ctx.store["loopSourceInternalSeamDiff"]);
    const wrapSeamDiff = Number(ctx.store["loopSourceWrapSeamDiff"]);
    if (
      Number(ctx.store["loopSourceDurationSec"]) !== scaling.sourceUnitSeconds
      || Number(ctx.store["loopSourceSegmentCount"]) !== scaling.sourceSegmentCount
      || !Number.isFinite(internalSeamDiff)
      || !Number.isFinite(wrapSeamDiff)
      || internalSeamDiff > scaling.seamMaximumDiff
      || wrapSeamDiff > scaling.seamMaximumDiff
    ) {
      throw new Error("assemble: the exact 2×15s source unit and both continuity proofs are required");
    }
    const musicUrl = str(ctx, "musicUrl");
    // upscale stashed the loop-unit local path in loopUnitUrl; if absent (e.g.
    // resumed run), fall back to the R2 key via a fresh download.
    const loopUnitLocal = ctx.store["loopUnitUrl"] as string | undefined;

    const tmp = await makeRunTempDir(ctx.runId);
    // Music: prefer the R2 copy (musicKey) — it's the MASTERED multi-track mix
    // (loudnorm'd), and it never expires like a provider CDN link. The provider
    // URL is only the legacy fallback.
    let audio: string;
    const mk = opt(ctx, "musicKey");
    if (mk) {
      audio = await writeBytes(join(tmp, "music.mp3"), await getObjectBytes(mk));
    } else {
      audio = await downloadTo(musicUrl, join(tmp, "music.mp3"));
    }

    let loopUnitPath: string;
    if (loopUnitLocal && (await fileExists(loopUnitLocal))) {
      loopUnitPath = loopUnitLocal;
    } else {
      // Re-fetch the upscaled loop unit from R2 if the local temp is gone
      // (e.g. a resumed run on a fresh worker).
      const key = str(ctx, "loopUnitKey");
      ctx.log(`assemble: loop-unit temp missing — re-fetching ${key} from R2`);
      const bytes = await getObjectBytes(key);
      loopUnitPath = await writeBytes(join(tmp, "loopunit.mp4"), bytes);
    }

    // Cap delivery height (default UHD 2160) so a true-4K Topaz unit stays
    // CPU-encodable; the upscale detail is preserved, the pixel count is sane.
    // The card (rendered 1080p) is scaled up to match this canvas.
    const maxHeight = Number(ctx.params.maxHeight ?? 2160);
    const p = await probe(loopUnitPath);
    const ih = p.height && p.height > 0 ? p.height : 1080;
    const iw = p.width && p.width > 0 ? p.width : 1920;
    let H = Math.min(maxHeight, ih);
    H -= H % 2;
    let W = Math.round(iw * (H / ih));
    W -= W % 2;
    const preset = (ctx.params.encodePreset as string) ?? "veryfast";

    // The seamless unit is the actual repeated visual artifact. Measure its
    // first/last-frame SSIM before it is streamed under the full music bed so
    // a critic that requests a loop-seam assertion gets a real deterministic
    // value rather than an unmeasured, silently skipped assertion.
    let loopSeamDiff: number | undefined;
    try {
      loopSeamDiff = await measureLoopSeamDiff(loopUnitPath, tmp);
      ctx.log(`assemble: loop seam diff=${loopSeamDiff.toFixed(4)} (0=perfect)`);
    } catch (e) {
      // Draft exploration can still surface the render. Production QA will
      // fail closed if its critic requires this metric and it remains absent.
      ctx.log(`assemble: loop seam metric unavailable: ${e instanceof Error ? e.message : e}`);
    }

    const fadeOutSec = Number(ctx.params.fadeOutSec ?? 0);
    const finalPath = join(tmp, "final.mp4");
    // GOLDEN: deblur intro (channel + title over the animated bg, 20-step deblur,
    // no separate card) — the v1 lofi look. Default ON for music loops.
    const deblurIntro = ctx.params["deblurIntro"] !== false;
    let introSec = 0;
    let videoDurationSec = durationSec;
    let introApplied = deblurIntro; // the deblur title IS the intro for lofi
    if (deblurIntro) {
      ctx.log(`assemble: deblur-intro music loop under music to ${durationSec}s @ ${W}x${H} (preset=${preset})…`);
      // On-screen title must be SHORT + legible (NOT the long SEO title). Take the
      // part before the first separator (": " / "|" / "–") and cap length.
      const fullTitle = opt(ctx, "title") || "";
      const shortTitle =
        ((fullTitle.split(/\s*[:|–—\-]\s*/)[0] || fullTitle).trim().slice(0, 34)) ||
        String(ctx.store["channelName"] ?? "");
      await composeMusicLoopDeblur({
        loopUnitPath, musicPath: audio, outPath: finalPath, durationSec,
        title: shortTitle,
        channel: String(ctx.store["channelName"] ?? ""),
        width: W, height: H, preset,
      });
    } else {
      const introCardPath = opt(ctx, "introCardPath"); // "" if the card render failed
      introSec = introCardPath ? Number(ctx.store["introSec"] ?? 5) : 0;
      introApplied = Boolean(introCardPath);
      videoDurationSec = introSec + durationSec;
      ctx.log(`assemble: prepend card (${introSec}s) + stream_loop 4K unit under music to ${durationSec}s @ ${W}x${H}…`);
      await composeWithIntro({
        introCardPath: introCardPath || undefined,
        loopBodyPath: loopUnitPath,
        musicPath: audio,
        outPath: finalPath,
        introSec,
        bodySec: durationSec,
        tailSec: 0,
        fadeOutSec,
        width: W,
        height: H,
        preset,
      });
    }

    const videoKey = `${ctx.keyPrefix}runs/${ctx.runId}/final.mp4`;
    await putObjectFromFile(videoKey, finalPath, { contentType: "video/mp4" });
    await recordAsset(ctx, "video", videoKey, {
      durationSec: videoDurationSec,
      introSec,
      loopUnitResolution: ctx.store["loopUnitResolution"],
      ...(loopSeamDiff === undefined ? {} : { loopSeamDiff }),
    });

    return {
      videoKey,
      videoLocalPath: finalPath,
      videoDurationSec,
      introApplied,
      ...(loopSeamDiff === undefined ? {} : { loopSeamDiff }),
    };
  },
};

/* --------------------------- 10. upload_draft --------------------------- */

/**
 * Reload the release certificate from R2 and bind it to the exact local bytes
 * the connector is about to upload. This is intentionally before connector
 * lookup/dispatch: a stale, deleted, or mismatched QA receipt must never reach
 * the external publishing path.
 */
async function loadDurableFinalMasterReleaseCertificate(ctx: StageContext) {
  const certificateKey = str(ctx, "finalMasterReleaseCertificateKey");
  const durableCertificate = parseFinalMasterReleaseCertificateBytes(
    await getObjectBytes(certificateKey),
  );
  const expectedCertificateKey = finalMasterReleaseCertificateKey(
    ctx.keyPrefix,
    ctx.runId,
    durableCertificate.certificateFingerprint,
  );
  if (certificateKey !== expectedCertificateKey) {
    throw new Error("final-master release certificate key is not content-addressed for this run");
  }
  const stagedCertificateValue = ctx.store["finalMasterReleaseCertificate"];
  if (stagedCertificateValue !== undefined) {
    const stagedCertificate = assertFinalMasterReleaseCertificate(stagedCertificateValue);
    if (durableCertificate.certificateFingerprint !== stagedCertificate.certificateFingerprint) {
      throw new Error("upload_draft: durable final-master release certificate differs from the staged QA certificate");
    }
  }
  return { certificateKey, durableCertificate };
}

/**
 * A successful derivative upload leaves only a compact certificate reference
 * in the run store. Rehydrate its authoritative certificate here so cleanup
 * can retain the Short and its proof bytes without trusting a stale in-memory
 * value. An absent key is legitimate for runs that did not opt into Shorts.
 */
async function loadDurableShortReleaseCertificate(ctx: StageContext) {
  const certificateKey = opt(ctx, "shortReleaseCertificateKey");
  if (!certificateKey) return undefined;
  const shortKey = opt(ctx, "shortKey");
  if (!shortKey) {
    throw new Error("cleanup: a Short release certificate exists without its durable Short object key");
  }
  const durableCertificate = parseFinalMasterReleaseCertificateBytes(
    await getObjectBytes(certificateKey),
  );
  const expectedCertificateKey = finalMasterReleaseCertificateKey(
    ctx.keyPrefix,
    ctx.runId,
    durableCertificate.certificateFingerprint,
  );
  if (certificateKey !== expectedCertificateKey || durableCertificate.finalMaster.r2Key !== shortKey) {
    throw new Error("cleanup: Short release certificate is not bound to this run's durable Short object");
  }
  return { certificateKey, durableCertificate };
}

/**
 * Semantic narration receipts contain a separate, content-addressed full
 * transcript audit. The common visual-proof verifier only needs that object
 * for V2 reference contracts, while a derivative Short uses no inherited
 * reference claim; verify it explicitly wherever we handle the Short.
 */
async function verifyFinalMasterNarrationAuditIfPresent(
  certificate: FinalMasterReleaseCertificate,
  subject: string,
): Promise<void> {
  const narrationEvidence = certificate.audio?.finalMasterNarration;
  if (!narrationEvidence) return;
  const audit = parseFinalMasterNarrationTranscriptAuditBytes(
    await getObjectBytes(narrationEvidence.auditArtifact.r2Key),
  );
  try {
    assertFinalMasterNarrationTranscriptAuditBinding({
      evidence: narrationEvidence,
      audit,
    });
  } catch (error) {
    throw new Error(
      `${subject}: durable final-master narration audit does not bind this release: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function verifyFinalMasterReleaseEvidenceForUpload(
  ctx: StageContext,
  filePath: string,
  videoKey: string,
  source: "remote" | "local-upload" = "remote",
) {
  const { certificateKey, durableCertificate } = await loadDurableFinalMasterReleaseCertificate(ctx);
  // Validate the certificate and every retained evidence key in the same
  // bounded namespace cleanup will later use. This also rejects a receipt key
  // that is not derived from its content fingerprint before any connector work.
  retainedFinalMasterReleaseObjectKeys({
    keyPrefix: ctx.keyPrefix,
    runId: ctx.runId,
    certificateKey,
    certificate: durableCertificate,
  });
  if (durableCertificate.finalMaster.r2Key !== videoKey) {
    throw new Error("upload_draft: final-master release certificate belongs to a different video object");
  }
  if (source === "local-upload") {
    await verifyFinalMasterReleaseEvidenceForLocalUpload({
      certificate: durableCertificate,
      filePath,
      getObjectBytes,
      headObjectMetadata,
    });
  } else {
    await verifyFinalMasterReleaseEvidenceObjects({
      certificate: durableCertificate,
      getObjectBytes,
      getObjectIntegrity,
    });
  }
  await verifyFinalMasterNarrationAuditIfPresent(durableCertificate, "upload_draft");
  if (source === "remote") {
    const localMasterSha256 = await fileSha256(filePath);
    if (localMasterSha256 !== durableCertificate.finalMaster.sha256) {
      throw new Error("upload_draft: local final master no longer matches its durable release certificate");
    }
  }
  return durableCertificate;
}

type ShortReleaseStructuralEvidence = {
  hasVideo: boolean;
  hasAudio: boolean;
  width?: number;
  height?: number;
  durationSec: number;
  expectedDurationSec: number;
  integratedLufs: number | null;
};

/**
 * The parent master is not evidence for a post-transform Short. This narrow,
 * deterministic gate rejects the common transform failures before an external
 * connector can be resolved: missing/cropped streams, a portrait mismatch,
 * an unexpectedly truncated clip, or an unmeasurable/silent final mix.
 */
export function assertShortReleaseStructuralEvidence(
  evidence: ShortReleaseStructuralEvidence,
): void {
  if (!evidence.hasVideo || !evidence.hasAudio) {
    throw new Error(
      `shorts_spinoff: post-transform master is structurally invalid (video=${evidence.hasVideo} audio=${evidence.hasAudio})`,
    );
  }
  if (evidence.width !== 1080 || evidence.height !== 1920) {
    throw new Error(
      `shorts_spinoff: post-transform master must be native 1080x1920 (got ${evidence.width ?? "?"}x${evidence.height ?? "?"})`,
    );
  }
  if (!Number.isFinite(evidence.durationSec) || evidence.durationSec < 8) {
    throw new Error("shorts_spinoff: post-transform master duration is invalid");
  }
  const toleranceSec = Math.max(1.5, evidence.expectedDurationSec * 0.04);
  if (
    !Number.isFinite(evidence.expectedDurationSec) ||
    evidence.expectedDurationSec < 8 ||
    Math.abs(evidence.durationSec - evidence.expectedDurationSec) > toleranceSec
  ) {
    throw new Error(
      `shorts_spinoff: post-transform duration ${evidence.durationSec.toFixed(2)}s does not match the selected source window ${evidence.expectedDurationSec.toFixed(2)}s`,
    );
  }
  if (
    evidence.integratedLufs === null ||
    !Number.isFinite(evidence.integratedLufs) ||
    evidence.integratedLufs < -30 ||
    evidence.integratedLufs > -8
  ) {
    throw new Error(
      "shorts_spinoff: post-transform audio loudness is unavailable or outside the sane release band [-30,-8] LUFS",
    );
  }
}

/**
 * Validate the actual reviewer result before it is sealed. This function is
 * deliberately exported for regression coverage, but is called by the live
 * upload path below; it is not a test-only classifier.
 */
export function assertShortReleaseVisualEvidence(args: {
  review: Pick<
    VisualReviewResult,
    "ran" | "verdict" | "referenceCriteriaComplete" | "evidence" | "reviewFingerprint" |
      "reviewReceiptVersion" | "reviewReceiptFingerprint" | "summary" | "defects" | "focusWindows" |
      "referenceCriteria"
  >;
  expectedMasterSha256: string;
  actualMasterSha256: string;
}): {
  evidenceManifestKey: string;
  evidenceFrameKeys: string[];
  evidenceFrameArtifacts: Array<{
    id: string;
    tSec: number;
    r2Key: string;
    contentSha256: string;
    byteLength: number;
  }>;
} {
  const { review, expectedMasterSha256, actualMasterSha256 } = args;
  if (!review.ran) {
    throw new Error("shorts_spinoff: required post-transform visual reviewer did not run");
  }
  if (review.verdict !== "pass" || !review.referenceCriteriaComplete) {
    throw new Error(
      `shorts_spinoff: post-transform visual review did not pass (verdict=${review.verdict})`,
    );
  }
  if (
    !/^[a-f0-9]{64}$/i.test(expectedMasterSha256) ||
    review.evidence.source.sha256 !== expectedMasterSha256 ||
    actualMasterSha256 !== expectedMasterSha256
  ) {
    throw new Error("shorts_spinoff: post-transform master changed during visual release review");
  }
  const evidenceManifestKey = review.evidence.manifestKey;
  if (!evidenceManifestKey) {
    throw new Error("shorts_spinoff: post-transform visual review lacks a durable evidence manifest");
  }
  const evidenceFrameArtifacts = review.evidence.frames.map((frame) => {
    if (
      typeof frame.id !== "string" ||
      !frame.id.trim() ||
      !Number.isFinite(frame.tSec) ||
      frame.tSec < 0 ||
      !frame.r2Key ||
      !frame.contentSha256 ||
      !/^[a-f0-9]{64}$/i.test(frame.contentSha256) ||
      typeof frame.byteLength !== "number" ||
      !Number.isInteger(frame.byteLength) ||
      frame.byteLength <= 0
    ) {
      throw new Error("shorts_spinoff: post-transform visual review frame lacks a durable byte receipt");
    }
    return {
      id: frame.id,
      tSec: frame.tSec,
      r2Key: frame.r2Key,
      contentSha256: frame.contentSha256,
      byteLength: frame.byteLength,
    };
  });
  if (!evidenceFrameArtifacts.length) {
    throw new Error("shorts_spinoff: post-transform visual review retained no evidence frames");
  }
  const sortedArtifacts = [...evidenceFrameArtifacts].sort((left, right) => left.r2Key.localeCompare(right.r2Key));
  const evidenceFrameKeys = sortedArtifacts.map((frame) => frame.r2Key);
  if (new Set(evidenceFrameKeys).size !== evidenceFrameKeys.length) {
    throw new Error("shorts_spinoff: post-transform visual review has duplicate evidence keys");
  }
  return {
    evidenceManifestKey,
    evidenceFrameKeys,
    evidenceFrameArtifacts: sortedArtifacts,
  };
}

/**
 * Turn the exact captions burned into a 9:16 derivative into independently
 * auditable OCR probes.  Sampling at the center of every cue proves both that
 * the caption is still on screen at its intended time and that it remains
 * readable after portrait reframing.  This deliberately fails closed for
 * malformed or one-token cues: a Short that cannot supply meaningful text
 * evidence must not receive the automatic upload path.
 */
export function buildShortCaptionOnScreenTextCues(
  captions: readonly CaptionCue[],
  durationSec: number,
): TimedOnScreenTextCue[] {
  if (!Number.isFinite(durationSec) || durationSec < 8) {
    throw new Error("shorts_spinoff: post-transform duration is invalid for caption OCR evidence");
  }
  if (!captions.length) {
    throw new Error("shorts_spinoff: no burned captions are available for required OCR evidence");
  }

  return captions.map((caption, index) => {
    const text = typeof caption.text === "string" ? caption.text.trim() : "";
    const startSec = Number(caption.startSec);
    const endSec = Number(caption.endSec);
    const tokenCount = text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?/gu)?.length ?? 0;
    if (!text || text.length < 3 || tokenCount < 2) {
      throw new Error(
        `shorts_spinoff: caption ${index + 1} cannot supply meaningful OCR evidence (need at least two readable tokens)`,
      );
    }
    if (
      !Number.isFinite(startSec) ||
      !Number.isFinite(endSec) ||
      startSec < 0 ||
      endSec > durationSec ||
      endSec - startSec < 0.2
    ) {
      throw new Error(`shorts_spinoff: caption ${index + 1} has invalid final-master timing`);
    }
    return {
      id: `short-caption-${String(index + 1).padStart(3, "0")}`,
      sampleSec: Number(((startSec + endSec) / 2).toFixed(3)),
      expectedText: text,
      minTokenCoverage: 0.8,
    };
  });
}

function shortReviewFrameCount(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(8, Math.min(max, Math.floor(parsed)));
}

function assertParentMasterReadyForShort(ctx: StageContext): void {
  if (ctx.store["qaPassed"] !== true) {
    throw new Error("shorts_spinoff: parent master QA did not pass — refusing to derive a Short");
  }
  const quality = QualityEvidenceSchema.safeParse(ctx.store["qualityEvidence"]);
  if (!quality.success || !quality.data.release.hardGateReady) {
    throw new Error("shorts_spinoff: parent master lacks passing final quality evidence");
  }
  const editorialAcceptance = assessProductionEditorialAcceptance(quality.data);
  if (!editorialAcceptance.ready) {
    throw new Error(
      `shorts_spinoff: parent master did not clear editorial acceptance — ${editorialAcceptance.blockers.join("; ")}`,
    );
  }
}

function narrativeShortStorySpine(store: Readonly<Record<string, unknown>>) {
  return StorySpineSchema.parse({
    version: "1.0.0",
    timedScript: store["timedScript"],
    narrativeBeats: store["narrativeBeats"],
    continuityLedger: store["continuityLedger"],
    shotList: store["shotList"],
    dpVisualSpecs: store["dpVisualSpecs"],
    editorEdl: store["editorEdl"],
    coverage: store["storyCoverage"],
  });
}

type NarrativeShortSelection =
  | Readonly<{ kind: "not_narrative" }>
  | Readonly<{ kind: "not_safe"; reason: string }>
  | Readonly<{
      kind: "selected";
      sourceStartSec: number;
      sourceEndSec: number;
      origin: NarrativeShortOrigin;
    }>;

/**
 * A sealed serialized run never falls back to the first sentence when making
 * a Short. It rehydrates the exact series horizon, binds the actual Episode
 * Graph to its Story Spine, and selects one self-contained beat. The future
 * portrait transform still has to earn its own review/certificate below.
 */
async function selectNarrativeShortSource(input: {
  readonly ctx: StageContext;
  readonly parentCertificate: FinalMasterReleaseCertificate;
  readonly maxCandidateDurationSec: number;
}): Promise<NarrativeShortSelection> {
  const selectorValue = input.ctx.store[NARRATIVE_SERIES_RUN_SELECTOR_SEED_KEY];
  if (selectorValue === undefined) return Object.freeze({ kind: "not_narrative" as const });
  try {
    const selector = parseNarrativeSeriesRunSelector(selectorValue);
    const route = parseChannelProgramRouteRunSeed(input.ctx.store["channelProgramRoute"]);
    const record = await getNarrativeSeriesPlanRecord({
      client: convex(),
      ownerId: input.ctx.ownerId,
      channelId: input.ctx.channelId as Id<"channels">,
      fingerprint: selector.seriesPlanFingerprint,
    });
    if (!record) throw new Error("immutable narrative horizon could not be reloaded");
    const admission = assertNarrativeSeriesRunAdmission({
      selector,
      plan: record.plan,
      ownerId: input.ctx.ownerId,
      channelId: input.ctx.channelId,
      routeSeed: route,
    });
    const episodeGraph = EpisodeGraphSchema.parse(input.ctx.store["episodeGraph"]);
    const episodeBinding = bindNarrativeEpisodeToSeries({
      plan: admission.plan,
      serializedEpisodeContext: input.ctx.store["serializedProgramEpisodeContext"],
      episodeGraph,
      storySpine: narrativeShortStorySpine(input.ctx.store),
    });
    // A third-party-stock sidecar proves acquisition but deliberately cannot
    // prove exact on-screen beat occurrence. Keep those derivatives manual;
    // system-generated / first-party masters can proceed to a private draft.
    const usesThirdPartyStock = input.parentCertificate.thirdPartyStockEvidence !== undefined;
    const expansion = planNarrativeShortsExpansion({
      seriesPlan: admission.plan,
      episodeBinding,
      episodeGraph,
      parentReleaseReadiness: {
        finalMasterReleaseEvidence: "verified",
        finalMasterCertificateFingerprint: input.parentCertificate.certificateFingerprint,
        sourceProvenance: usesThirdPartyStock ? "licensed" : "first_party",
        selectedMomentRights: usesThirdPartyStock ? "unknown" : "cleared",
        // This prospective plan must not claim transform evidence before the
        // actual 9:16 output is created and reviewed.
        portraitAssemblyAndReviewEvidence: "missing",
        automaticDraftCreationAllowed: true,
      },
      maxCandidateDurationSec: input.maxCandidateDurationSec,
    });
    if (expansion.status !== "candidate_briefs_ready" || expansion.automaticAction !== "draft_only_after_post_transform_review") {
      throw new Error(expansion.blockers.join("; ") || "no safe narrative Short candidate is available");
    }
    const candidate = expansion.candidates[0];
    if (!candidate) throw new Error("narrative Short plan has no candidate");
    if (candidate.sourceWindow.t1 > input.parentCertificate.finalMaster.durationSec + 0.05) {
      throw new Error("narrative Short candidate exceeds the certified parent-master duration");
    }
    return Object.freeze({
      kind: "selected" as const,
      sourceStartSec: candidate.sourceWindow.t0,
      sourceEndSec: candidate.sourceWindow.t1,
      origin: createNarrativeShortOrigin({
        version: "narrative-short-origin/v1",
        parentFinalMasterSha256: input.parentCertificate.finalMaster.sha256,
        parentFinalMasterCertificateFingerprint: input.parentCertificate.certificateFingerprint,
        seriesPlanFingerprint: admission.plan.fingerprint,
        episodeGraphFingerprint: episodeBinding.episodeGraphFingerprint,
        episodeBindingFingerprint: episodeBinding.fingerprint,
        shortsExpansionPlanFingerprint: expansion.fingerprint,
        candidateId: candidate.id,
        parentBeatId: candidate.parentBeatId,
        sourceWindow: candidate.sourceWindow,
      }),
    });
  } catch (error) {
    return Object.freeze({
      kind: "not_safe" as const,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

async function persistShortReleaseEvidence(args: {
  ctx: StageContext;
  filePath: string;
  shortKey: string;
  title: string;
  topic: string;
  expectedDurationSec: number;
  captionCues: readonly CaptionCue[];
  transcriptCues: Array<{ text: string; startSec: number; endSec: number }>;
  sourceAudioPath: string;
  expectedNarrationText: string;
  narrativeShortOrigin?: NarrativeShortOrigin;
}): Promise<{
  certificateKey: string;
  certificateReference: ReturnType<typeof createFinalMasterReleaseCertificateReference>;
  certificateFingerprint: string;
  finalMasterSha256: string;
  durationSec: number;
}> {
  const { ctx } = args;
  const structural = await probe(args.filePath);
  const audioMeters = await measureAudio(args.filePath);
  assertShortReleaseStructuralEvidence({
    ...structural,
    expectedDurationSec: args.expectedDurationSec,
    integratedLufs: audioMeters.integratedLufs,
  });
  // Validate the deterministic Short caption clock before invoking the
  // required visual reviewer. The first timed caption is the only existing
  // post-transform semantic-visual authority, so an ambiguous clock must not
  // consume a provider review and then fail at certificate time.
  const captionTextCues = buildShortCaptionOnScreenTextCues(args.captionCues, structural.durationSec);
  const openingCaptionPlan = planShortsOpeningCaptionEvidence(
    args.captionCues,
    structural.durationSec,
  );

  const beforeReviewSha256 = await fileSha256(args.filePath);
  const contentLane = resolveContentLane({
    stored: ctx.params["contentLane"] ?? ctx.store["contentLane"],
    pipeline: [],
  });
  const laneQuality = laneQualityPolicy(contentLane);
  const qualityBar = ctx.store["qualityBar"] as {
    dimensions?: Array<{ id?: unknown; description?: unknown }>;
  } | null;
  const criticDoctrine = opt(ctx, "criticDoctrine");
  const channelProfile = channelVisualReviewProfile({
    contentLaneKey: contentLane.key,
    primaryRenderer: contentLane.primaryRenderer,
    requireSpecificLaneProfile: true,
    channelName: opt(ctx, "channelName"),
    persona: opt(ctx, "persona"),
    styleGrammar: opt(ctx, "styleGrammar"),
    styleDNA: ctx.store["styleDNA"],
    showBible: ctx.store["showBible"],
    ...(criticDoctrine ? { criticDoctrine } : {}),
    laneEmphasis: laneQuality.emphasis,
    qualityDimensions: (qualityBar?.dimensions ?? []).flatMap((dimension) =>
      typeof dimension?.id === "string" ? [dimension.id] : [],
    ),
    qualityCriteria: (qualityBar?.dimensions ?? []).flatMap((dimension) =>
      typeof dimension?.id === "string" && typeof dimension?.description === "string"
        ? [`${dimension.id}: ${dimension.description}`]
        : [],
    ),
  });
  const durationSec = structural.durationSec;
  const review = await reviewRender(
    args.filePath,
    durationSec,
    {
      title: `${args.title} #Shorts`.slice(0, 100),
      topic: args.topic,
      niche: opt(ctx, "niche"),
      expectTitleCard: false,
      expectOutroCard: false,
      expectChapters: false,
      channelWorld: [
        channelProfile.channelWorld,
        "This is a post-transform 9:16 derivative. Judge the actual center crop and burned captions, not the parent landscape master.",
      ].filter(Boolean).join("; "),
      expectedStructure:
        "A self-contained portrait Short with an intact subject, a coherent opening-to-end thought, and readable synchronized captions. " +
        channelProfile.expectedStructure,
      allowedVisualConditions: [
        ...channelProfile.allowedVisualConditions,
        "Portrait reframing is acceptable only when important subjects, factual context, and burned captions remain readable and in-frame.",
      ],
      ...(channelProfile.criticDoctrine ? { criticDoctrine: channelProfile.criticDoctrine } : {}),
      criticEmphasis: [
        ...channelProfile.criticEmphasis,
        "portrait crop subject preservation",
        "burned-caption legibility and synchronization",
        "opening-hook continuity",
      ],
      qualityCriteria: [
        ...channelProfile.qualityCriteria,
        "The 9:16 crop must not cut off the active subject, source evidence, or required on-screen context.",
        "Burned captions must be legible, timed to the spoken words, and must not obscure the primary visual subject.",
        "The Short must begin and end at coherent speech/edit boundaries without a black, frozen, or abruptly truncated finish.",
      ],
      transcriptCues: args.transcriptCues,
      ...(openingCaptionPlan
        ? {
            overlays: [{
              id: openingCaptionPlan.cueId,
              startSec: openingCaptionPlan.startSec,
              endSec: openingCaptionPlan.endSec,
              kind: "caption" as const,
              expected: "Opening hook caption must be readable at its planned timing.",
            }],
          }
        : {}),
      focusWindows: [
        { startSec: 0, endSec: Math.min(durationSec, 6), reason: "reviewer" },
        { startSec: Math.max(0, durationSec - 5), endSec: durationSec, reason: "reviewer" },
      ],
      ...(channelProfile.identityReferenceCriterion
        ? { referenceCriteria: [channelProfile.identityReferenceCriterion] }
        : {}),
    },
    {
      runId: ctx.runId,
      keyPrefix: ctx.keyPrefix,
      sourceSha256: beforeReviewSha256,
      required: true,
      maxFrames: shortReviewFrameCount(ctx.params["shortVisualReviewFrames"], 36, 72),
      maxFocusFrames: shortReviewFrameCount(ctx.params["shortVisualReviewFocusFrames"], 18, 36),
      log: (message) => ctx.log(`shorts_spinoff: ${message}`),
    },
  );
  const afterReviewSha256 = await fileSha256(args.filePath);
  const visualEvidence = assertShortReleaseVisualEvidence({
    review,
    expectedMasterSha256: beforeReviewSha256,
    actualMasterSha256: afterReviewSha256,
  });
  const captionTextSourceSha256 = await sha256OnScreenTextSource(args.filePath);
  if (captionTextSourceSha256 !== afterReviewSha256) {
    throw new Error("shorts_spinoff: post-transform master changed before caption OCR evidence");
  }
  const onScreenText = await proveOnScreenText({
    videoPath: args.filePath,
    sourceSha256: afterReviewSha256,
    cues: captionTextCues,
  });
  if (!onScreenText.passed || onScreenText.cues.some((cue) => !cue.passed)) {
    const failed = onScreenText.cues
      .filter((cue) => !cue.passed)
      .map((cue) => `${cue.id} ${cue.tokenCoverage.toFixed(2)} < ${cue.minTokenCoverage.toFixed(2)}`)
      .join(", ");
    throw new Error(`shorts_spinoff: burned-caption OCR evidence failed${failed ? ` (${failed})` : ""}`);
  }
  ctx.log(
    `shorts_spinoff: burned-caption OCR PASSED (${onScreenText.cues.length} timed cue(s), ` +
      `${onScreenText.engine.name} ${onScreenText.engine.version})`,
  );
  const visualReviewReleaseReceipt = createVisualReviewReleaseReceipt({
    reviewFingerprint: review.reviewFingerprint,
    reviewReceiptVersion: review.reviewReceiptVersion,
    reviewReceiptFingerprint: review.reviewReceiptFingerprint,
    verdict: "pass",
    summary: review.summary,
    defects: review.defects,
    focusWindows: review.focusWindows,
    referenceCriteria: review.referenceCriteria,
    // assertShortReleaseVisualEvidence above has already rejected every
    // non-complete review. Keep the receipt schema's literal pass invariant.
    referenceCriteriaComplete: true,
    evidence: {
      source: { durationSec, sha256: afterReviewSha256 },
      manifestKey: visualEvidence.evidenceManifestKey,
      frameKeys: visualEvidence.evidenceFrameKeys,
      frameArtifacts: visualEvidence.evidenceFrameArtifacts,
    },
  });
  const visualReviewReceiptKey = visualReviewReleaseReceiptKey(
    ctx.keyPrefix,
    ctx.runId,
    visualReviewReleaseReceipt.releaseReceiptFingerprint,
  );
  await putObject(
    visualReviewReceiptKey,
    Buffer.from(JSON.stringify(visualReviewReleaseReceipt, null, 2)),
    { contentType: "application/json" },
  );
  const shortsOpeningEvidence = createShortsOpeningEvidence({
    finalMaster: { sha256: afterReviewSha256, durationSec },
    review,
    visualReviewReleaseReceiptFingerprint: visualReviewReleaseReceipt.releaseReceiptFingerprint,
    ...(openingCaptionPlan ? { caption: openingCaptionPlan } : {}),
    onScreenText,
  });
  const expectedNarrationText = args.expectedNarrationText.trim();
  if (!expectedNarrationText) {
    throw new Error("shorts_spinoff: selected Short window has no approved narration text to audit");
  }
  // makeVerticalClip creates the raw portrait derivative and burnCaptions
  // copies its audio stream. Audit both independently: the first transcript
  // proves the selected window against the approved text, while the second
  // proves that exact spoken text is still audible in the caption-burned
  // release bytes. This is deliberately not an inherited parent receipt.
  const sourceNarrationSha256 = await sha256NarrationTranscriptSource(args.sourceAudioPath);
  const sourceTranscript = proveNarrationTranscript({
    audioPath: args.sourceAudioPath,
    expectedText: expectedNarrationText,
    sourceSha256: sourceNarrationSha256,
  });
  const finalMasterTranscript = proveNarrationTranscript({
    audioPath: args.filePath,
    expectedText: expectedNarrationText,
    sourceSha256: afterReviewSha256,
  });
  const preparedNarrationAudit = prepareFinalMasterNarrationTranscriptAudit({
    version: FINAL_MASTER_NARRATION_TRANSCRIPT_AUDIT_VERSION,
    finalMaster: { sha256: afterReviewSha256, durationSec },
    narration: {
      sourceSha256: sourceNarrationSha256,
      expectedTextSha256: sourceTranscript.expected.textSha256,
      startSec: 0,
      durationSec,
    },
    sourceTranscript,
    finalMasterTranscript,
  });
  const narrationAuditKey = finalMasterNarrationTranscriptAuditObjectKey(
    ctx.keyPrefix,
    ctx.runId,
    preparedNarrationAudit.contentSha256,
  );
  await putObject(narrationAuditKey, preparedNarrationAudit.bytes, {
    contentType: "application/json",
  });
  const finalMasterNarration = sealFinalMasterNarrationSemanticEvidence({
    version: "final-master-narration-semantic-evidence/v1",
    finalMaster: preparedNarrationAudit.audit.finalMaster,
    narration: preparedNarrationAudit.audit.narration,
    sourceTranscript: preparedNarrationAudit.sourceTranscript,
    finalMasterTranscript: preparedNarrationAudit.finalMasterTranscript,
    auditArtifact: {
      version: FINAL_MASTER_NARRATION_TRANSCRIPT_AUDIT_VERSION,
      r2Key: narrationAuditKey,
      contentSha256: preparedNarrationAudit.contentSha256,
      byteLength: preparedNarrationAudit.bytes.byteLength,
    },
  });
  // The certificate deliberately carries no inherited reference-quality V1/V2
  // claim. Its audio proof is only the real, local transcript audit and
  // deterministic final-mix meter measured on these derivative bytes.
  const certificate = createFinalMasterReleaseCertificate({
    version: FINAL_MASTER_RELEASE_CERTIFICATE_VERSION,
    finalMaster: {
      r2Key: args.shortKey,
      sha256: afterReviewSha256,
      byteLength: (await stat(args.filePath)).size,
      durationSec,
    },
    visualReview: {
      evidenceManifestKey: visualEvidence.evidenceManifestKey,
      evidenceFrameKeys: visualEvidence.evidenceFrameKeys,
      evidenceFrameArtifacts: visualEvidence.evidenceFrameArtifacts,
      receiptKey: visualReviewReceiptKey,
      reviewFingerprint: review.reviewFingerprint,
      reviewReceiptVersion: review.reviewReceiptVersion,
      reviewReceiptFingerprint: review.reviewReceiptFingerprint,
      releaseReceiptFingerprint: visualReviewReleaseReceipt.releaseReceiptFingerprint,
    },
    audio: {
      finalMasterNarration,
      finalMasterMeters: {
        integratedLufs: audioMeters.integratedLufs,
        windowMeanDb: audioMeters.windowMeanDb,
      },
    },
    onScreenText,
    shortsOpeningEvidence,
    ...(args.narrativeShortOrigin ? { narrativeShortOrigin: args.narrativeShortOrigin } : {}),
  });
  const certificateKey = finalMasterReleaseCertificateKey(
    ctx.keyPrefix,
    ctx.runId,
    certificate.certificateFingerprint,
  );
  await putObject(certificateKey, Buffer.from(JSON.stringify(certificate, null, 2)), {
    contentType: "application/json",
  });
  const durableCertificate = parseFinalMasterReleaseCertificateBytes(await getObjectBytes(certificateKey));
  if (durableCertificate.certificateFingerprint !== certificate.certificateFingerprint) {
    throw new Error("shorts_spinoff: reloaded post-transform release certificate fingerprint changed after persistence");
  }
  await verifyFinalMasterReleaseEvidenceObjects({
    certificate: durableCertificate,
    getObjectBytes,
    getObjectIntegrity,
  });
  await verifyFinalMasterNarrationAuditIfPresent(durableCertificate, "shorts_spinoff");
  if (await fileSha256(args.filePath) !== afterReviewSha256) {
    throw new Error("shorts_spinoff: post-transform master changed while its durable release evidence was being persisted");
  }
  return {
    certificateKey,
    certificateReference: createFinalMasterReleaseCertificateReference({
      keyPrefix: ctx.keyPrefix,
      runId: ctx.runId,
      certificateKey,
      certificate: durableCertificate,
    }),
    certificateFingerprint: durableCertificate.certificateFingerprint,
    finalMasterSha256: afterReviewSha256,
    durationSec,
  };
}

async function verifyShortReleaseEvidenceForUpload(args: {
  ctx: StageContext;
  filePath: string;
  shortKey: string;
  certificateKey: string;
}): Promise<FinalMasterReleaseCertificate> {
  const certificate = parseFinalMasterReleaseCertificateBytes(await getObjectBytes(args.certificateKey));
  const expectedCertificateKey = finalMasterReleaseCertificateKey(
    args.ctx.keyPrefix,
    args.ctx.runId,
    certificate.certificateFingerprint,
  );
  if (args.certificateKey !== expectedCertificateKey || certificate.finalMaster.r2Key !== args.shortKey) {
    throw new Error("shorts_spinoff: post-transform release certificate is not bound to this Short object");
  }
  if (
    !certificate.onScreenText ||
    !certificate.onScreenText.passed ||
    certificate.onScreenText.cues.some((cue) => !cue.passed)
  ) {
    throw new Error("shorts_spinoff: post-transform release certificate lacks passing burned-caption OCR evidence");
  }
  if (!certificate.shortsOpeningEvidence) {
    throw new Error("shorts_spinoff: post-transform release certificate lacks opening timing evidence");
  }
  retainedFinalMasterReleaseObjectKeys({
    keyPrefix: args.ctx.keyPrefix,
    runId: args.ctx.runId,
    certificateKey: args.certificateKey,
    certificate,
  });
  await verifyFinalMasterReleaseEvidenceForLocalUpload({
    certificate,
    filePath: args.filePath,
    getObjectBytes,
    headObjectMetadata,
  });
  await verifyFinalMasterNarrationAuditIfPresent(certificate, "shorts_spinoff");
  return certificate;
}

/**
 * The destructive half of cleanup is deliberately isolated so the exact
 * fail-closed behavior can be exercised without R2 or a pipeline worker.
 * Any absent, overwritten, or mismatched review-evidence object preserves the
 * entire run namespace instead of deleting the last recoverable proof.
 */
export const uploadDraft: Block = {
  id: "upload_draft",
  consumes: [
    "videoKey", "videoLocalPath", "title", "description", "tags", "qaPassed",
    "qualityEvidence", "thumbnailKey", "thumbnailPublishable",
    "finalMasterReleaseCertificateKey",
  ],
  produces: ["youtubeVideoId", "watchUrl", "youtubePrivacy", "artifactRetentionRelease"],
  run: async (ctx) => {
    // Keep historical seeds inspectable, but never let a route-bearing legacy
    // fictional run cross a new publication boundary as generic nonfiction.
    // This must happen before any connector lookup or upload-adjacent work.
    const thumbnailScenarioVisualTreatment = resolveScenarioVisualTreatmentForNewVisualArtifact({
      treatment: ctx.store["scenarioVisualTreatment"],
      route: ctx.store["channelProgramRoute"],
      scenario: ctx.store["syntheticScenario"],
      disclosure: ctx.store["syntheticScenarioDisclosure"],
      topic: ctx.store["topic"],
      consumer: "upload_draft",
      operation: "publish thumbnail package art",
    });
    if (thumbnailScenarioVisualTreatment && typeof ctx.store["topic"] !== "string") {
      throw new Error("upload_draft: fictional scenario thumbnail provenance requires its exact active topic");
    }
    if (thumbnailScenarioVisualTreatment && ctx.store["syntheticScenarioDisclosure"] === undefined) {
      throw new Error("upload_draft: fictional scenario thumbnail lacks its verified disclosure receipt");
    }
    if (
      thumbnailScenarioVisualTreatment &&
      ctx.store["thumbnailScenarioVisualTreatmentProvenance"] === undefined
    ) {
      throw new Error("upload_draft: fictional scenario thumbnail lacks sealed treatment provenance");
    }
    if (ctx.store["qaPassed"] !== true) {
      throw new Error("upload_draft: qa did not pass — refusing to upload");
    }
    const quality = QualityEvidenceSchema.safeParse(ctx.store["qualityEvidence"]);
    if (!quality.success) {
      throw new Error("upload_draft: final quality evidence is missing or malformed — refusing to upload");
    }
    if (!quality.data.release.hardGateReady) {
      throw new Error(
        `upload_draft: final quality evidence did not clear its hard gates — ${quality.data.release.blockers.join("; ")}`,
      );
    }
    const lane = resolveContentLane({ stored: ctx.store["contentLane"], pipeline: [] });
    if (
      quality.data.episode.lane.key !== lane.key ||
      (quality.data.episode.lane.renderer !== undefined &&
        quality.data.episode.lane.renderer !== lane.primaryRenderer)
    ) {
      throw new Error("upload_draft: final quality evidence belongs to a different content lane — refusing to upload");
    }
    // `hardGateReady` is intentionally a narrow raw-receipt signal. Publishing
    // needs the lane's full editorial contract: a real passing evaluator for
    // every required axis, and a source-backed story receipt where the format
    // exposes one. Unknown/legacy lanes have no such contract and fail closed
    // here until migration supplies one.
    const editorialAcceptance = assessProductionEditorialAcceptance(quality.data);
    if (!editorialAcceptance.ready) {
      throw new Error(
        `upload_draft: final editorial acceptance did not pass — ${editorialAcceptance.blockers.join("; ")}`,
      );
    }
    if (!quality.data.release.calibrationComplete) {
      ctx.log(`upload_draft: quality calibration gaps retained for review: ${quality.data.calibrationGaps.join(" | ")}`);
    }
    if (ctx.store["thumbnailPublishable"] !== true) {
      throw new Error("upload_draft: thumbnail is a nonpublishable draft preview — refusing to upload");
    }
    const thumbKey = str(ctx, "thumbnailKey");
    const thumbnailSha256 = bytesSha256(await getObjectBytes(thumbKey));
    // The final-master certificate intentionally seals video evidence only.
    // Package art has a separate, byte-bound receipt revalidated here before
    // any connector/publish work, so thumbnail swaps cannot inherit a video's
    // treatment evidence.
    let thumbnailScenarioVisualTreatmentProvenance:
      | ScenarioVisualTreatmentThumbnailProvenance
      | undefined;
    if (thumbnailScenarioVisualTreatment) {
      thumbnailScenarioVisualTreatmentProvenance = assertScenarioVisualTreatmentThumbnailProvenance({
        provenance: ctx.store["thumbnailScenarioVisualTreatmentProvenance"],
        treatment: thumbnailScenarioVisualTreatment,
        thumbnailArtifactSha256: thumbnailSha256,
        consumer: "upload_draft",
      });
    } else if (ctx.store["thumbnailScenarioVisualTreatmentProvenance"] !== undefined) {
      throw new Error("upload_draft: non-fictional thumbnail carries scenario visual treatment provenance");
    }
    const filePath = str(ctx, "videoLocalPath");
    const videoKey = str(ctx, "videoKey");
    const title = str(ctx, "title");
    let description = str(ctx, "description");
    // LAST-HOP SANITIZE: performed [audio tags] must never reach a public
    // surface — a resume once shipped a CACHED pre-sanitize description
    // ("[softly]" in the hook quote) straight to a YouTube draft. The upload
    // is the final gate, so it strips regardless of upstream cache state.
    description = description.replace(/\[(?:softly|whispers?|pause|long pause|sighs?|exhales?|inhales? deeply|laughs?|chuckles?|seriously|slowly|thoughtful|curious|emphatic|excited|sarcastic|appalled|surprised)\]/gi, "").replace(/ {2,}/g, " ");
    description = await appendMusicGenerationDisclosure(ctx, description);
    const tags = (ctx.store["tags"] as string[]) ?? [];

    // AUTO-CHAPTERS (metacraft.buildChapters): the chapterPlan knows exactly
    // when each section card lands — write the timestamped list into the
    // description (YouTube key-moments indexing). Skipped when the description
    // already carries timestamps or there are <2 chapters.
    const plan = ctx.store["chapterPlan"] as { kind: string; durSec: number; heading?: string }[] | undefined;
    const chapters = buildChapters(plan);
    if (chapters && !/^\d{1,2}:\d{2}\s/m.test(description)) {
      description = `${description}\n\nChapters:\n${chapters}`;
      ctx.log(`upload_draft: appended ${chapters.split("\n").length} chapters to the description`);
    }

    const client = convex();
    const internalSecret = requireInternalQuerySecret();
    const channelId = ctx.channelId as Id<"channels">;
    const [channel, run] = await Promise.all([
      client.query(api.channels.getChannel, { channelId }),
      client.query(api.runs.getRun, { runId: ctx.runId as Id<"runs"> }),
    ]);
    if (!channel || channel.ownerId !== ctx.ownerId || !run?.startedAt) {
      throw new Error("upload_draft: run/channel tenancy could not be verified");
    }
    const finalMasterReleaseCertificate = await verifyFinalMasterReleaseEvidenceForUpload(
      ctx,
      filePath,
      videoKey,
      "local-upload",
    );
    ctx.log(
      `upload_draft: revalidated final-master release evidence (${finalMasterReleaseCertificate.certificateFingerprint.slice(0, 12)})`,
    );

    // Publish mode (per-channel pipeline param; default "draft" = private, human
    // approves). A scheduled timestamp is reused from the durable upload row so
    // a worker retry cannot change metadata and accidentally create a duplicate.
    const publishMode = (ctx.params["publishMode"] as string | undefined) ?? "draft";
    const uploadProgramRoute = ctx.store["channelProgramRoute"] === undefined
      ? undefined
      : parseChannelProgramRouteRunSeed(ctx.store["channelProgramRoute"]);
    if (uploadProgramRoute?.routeKey === "quizyear/portrait-supervised/v1") {
      assertQuizShortReleaseReceiptForUpload({
        receipt: ctx.store["quizShortRelease"],
        route: uploadProgramRoute,
        certificate: finalMasterReleaseCertificate,
        videoKey,
        publishMode,
      });
    }
    if (uploadProgramRoute && certifiedFamilyAdmission(uploadProgramRoute.family).automatic) {
      requireAutomaticPackageToOpeningReceipt({
        receipt: finalMasterReleaseCertificate.packageToOpening,
        omission: finalMasterReleaseCertificate.packageToOpeningOmission,
      });
    }
    if (finalMasterReleaseCertificate.referenceQuality?.assessment === "unmeasured") {
      // This is an honest evidence state, not a new publication veto. Existing
      // final QA, editorial acceptance, child-safety, and channel-policy gates
      // remain authoritative for private, public, and scheduled releases.
      ctx.log("upload_draft: reference-quality contract is sealed but unmeasured; this certificate makes no reference-quality attestation claim");
    }
    const isSupervisedChildrenLane = lane.key === "children_learning_supervised";
    const childSafety = ctx.store["childContentSafety"] as
      | {
          pass?: unknown;
          madeForKids?: unknown;
          release?: unknown;
          allowedPublishMode?: unknown;
          sceneManifestFingerprint?: unknown;
        }
      | undefined;
    if (isSupervisedChildrenLane) {
      if (
        childSafety?.pass !== true ||
        childSafety.madeForKids !== true ||
        childSafety.release !== "human-editorial-approval-required" ||
        childSafety.allowedPublishMode !== "draft"
      ) {
        throw new Error("upload_draft: children-learning lane lacks its mandatory human-review safety receipt");
      }
      assertChildContentRenderEvidence({
        childSafety,
        sceneCompilerReceipt: ctx.store["sceneCompilerReceipt"],
      });
      if (publishMode !== "draft") {
        throw new Error("upload_draft: children-learning episodes may only create private drafts; public/scheduled release is human-gated");
      }
    }
    const dispatchRequestedAt = Date.now();
    let privacyStatus: "private" | "public" | "unlisted" = "private";
    let publishAt: string | undefined;
    let publishAtMs: number | undefined;
    if (publishMode === "public") {
      privacyStatus = "public";
    } else if (publishMode === "scheduled") {
      publishAtMs = resolveScheduledPublishAtMs({
        publishMode,
        pinnedScheduledAt: typeof ctx.store["scheduledPublishAt"] === "number"
          ? ctx.store["scheduledPublishAt"] as number
          : undefined,
        runStartedAt: run.startedAt,
        runId: ctx.runId,
        publishOffsetHours: Number(ctx.params["publishOffsetHours"] ?? 6),
        publishJitterHours: Number(ctx.params["publishJitterHours"] ?? 4),
      });
      if (publishAtMs === undefined) throw new Error("upload_draft: scheduled publish time is missing");
      assertScheduledPublishIsFuture(publishAtMs, dispatchRequestedAt);
      publishAt = new Date(publishAtMs).toISOString();
    }

    // Every write is bound to this exact app owner/channel connector. Missing,
    // mismatched, legacy-unmigrated, or undecryptable credentials stop the run.
    const connector = await requireYouTubeConnector(client, {
      channelId,
      ownerId: ctx.ownerId,
      requiredScopes: YOUTUBE_UPLOAD_SCOPES,
    });
    ctx.log(
      `upload_draft: using linked YouTube channel "${connector.ytTitle ?? connector.ytChannelId ?? "?"}" (${connector.storage})`,
    );

    if (publishAt && !Number.isFinite(publishAtMs)) {
      throw new Error("upload_draft: invalid scheduled publish timestamp");
    }
    let policyDecision: ChannelPublishDecision | undefined;
    if (publishMode === "public" || publishMode === "scheduled") {
      policyDecision = await evaluateChannelPublishAction({
        ownerId: ctx.ownerId,
        channelId,
        action: publishMode === "public" ? "youtube_public" : "youtube_scheduled",
        channel,
        convex: client,
      });
      if (!policyDecision.authorized) {
        ctx.log(
          `upload_draft: channel policy did not authorize ${publishMode} (${policyDecision.reason}); creating an awaiting-approval intent`,
        );
      }
    }
    const madeForKids =
      typeof ctx.params["madeForKids"] === "boolean"
        ? (ctx.params["madeForKids"] as boolean)
        : (channel.schedule?.madeForKids ?? false);
    if (isSupervisedChildrenLane && !madeForKids) {
      throw new Error("upload_draft: children-learning lane must set madeForKids=true");
    }
    const metadata = {
      title,
      description,
      tags,
      categoryId: String(ctx.params["categoryId"] ?? "10"),
      privacyStatus,
      publishAt: publishAtMs,
      containsSyntheticMedia: true,
      madeForKids,
    } as const;
    const videoSha256 = finalMasterReleaseCertificate.finalMaster.sha256;
    const videoArtifactId = `sha256:${videoSha256}`;
    const intentVersion = Number(ctx.params["intentVersion"] ?? 1);
    const idempotencyKey = buildPublishIdempotencyKey({
      connectorId: String(connector.connectorId),
      videoArtifactId,
      intentVersion,
    });
    const intent = await client.mutation(api.publishIntents.createOrGet, {
      secret: internalSecret,
      ownerId: ctx.ownerId,
      channelId,
      connectorId: connector.connectorId,
      connectorVersion: connector.tokenVersion,
      runId: ctx.runId as Id<"runs">,
      videoArtifactId,
      videoArtifactKey: videoKey,
      videoSha256,
      releaseEvidenceCertificateKey: str(ctx, "finalMasterReleaseCertificateKey"),
      releaseEvidenceCertificateFingerprint:
        finalMasterReleaseCertificate.certificateFingerprint,
      thumbnailArtifactKey: thumbKey,
      thumbnailSha256,
      ...(thumbnailScenarioVisualTreatmentProvenance
        ? {
            thumbnailScenarioVisualTreatmentProvenance,
            thumbnailScenarioVisualTreatmentProvenanceFingerprint:
              thumbnailScenarioVisualTreatmentProvenance.fingerprint,
          }
        : {}),
      intentVersion,
      idempotencyKey,
      metadataSha256: publishMetadataSha256(metadata),
      ...metadata,
      approvedForPublish:
        privacyStatus === "private" && publishAtMs === undefined
          ? true
          : policyDecision?.authorized === true,
      approvedBy: policyDecision?.authorized ? policyDecision.approvedBy : undefined,
      approvalEvidence: policyDecision?.authorized
        ? policyDecision.approvalEvidence
        : undefined,
      approvalPolicyVersion: policyDecision?.authorized
        ? policyDecision.policyVersion
        : undefined,
      approvalPolicyFingerprint: policyDecision?.authorized
        ? policyDecision.pipelineFingerprint
        : undefined,
      hypothesis:
        typeof ctx.params["experimentHypothesis"] === "string"
          ? (ctx.params["experimentHypothesis"] as string)
          : undefined,
      hookVariant:
        typeof ctx.params["hookVariant"] === "string"
          ? (ctx.params["hookVariant"] as string)
          : undefined,
      visualVariant:
        typeof ctx.params["visualVariant"] === "string"
          ? (ctx.params["visualVariant"] as string)
          : undefined,
      dispatchRequestedAt,
      createdAt: run.startedAt,
    });
    if (!intent) throw new Error("upload_draft: publish intent was not persisted");

    ctx.log(
      `upload_draft: dispatching intent ${intent._id} (mode=${publishMode}${publishAt ? `, publishAt=${publishAt}` : ""})…`,
    );
    const dispatched = await dispatchPublishIntent({
      intentId: intent._id,
      workerId: `pipeline:${ctx.runId}`,
      preferredLocalFilePath: filePath,
      executionLease: ctx.executionLease,
      log: ctx.log,
    });
    if (dispatched.kind !== "uploaded") {
      throw new Error(
        `upload_draft: publish intent deferred (${dispatched.reason}, status=${dispatched.status})`,
      );
    }
    ctx.log(
      `upload_draft ok: ${dispatched.watchUrl} (privacy=${dispatched.privacyStatus})`,
    );
    return {
      youtubeVideoId: dispatched.videoId,
      watchUrl: dispatched.watchUrl,
      youtubePrivacy: dispatched.privacyStatus,
      artifactRetentionRelease: {
        releaseMode:
          publishMode === "scheduled"
            ? "scheduled"
            : publishMode === "public"
              ? "public"
              : "private_draft",
        uploadedAt: Date.now(),
        ...(publishAtMs === undefined ? {} : { scheduledPublishAt: publishAtMs }),
      },
    };
  },
};

/* ------------------------------ 11. notify ------------------------------ */

export const notify: Block = {
  id: "notify",
  consumes: ["watchUrl", "title"],
  produces: ["notified"],
  run: async (ctx) => {
    const watchUrl = str(ctx, "watchUrl");
    const title = str(ctx, "title");
    await notifyDraftReady(title, watchUrl, {
      chatId: process.env.TELEGRAM_CHAT_ID ?? process.env.TELEGRAM_ADMIN_CHAT_ID,
    });
    ctx.log(`notify: telegram draft-ready sent for ${watchUrl}`);
    return { notified: true };
  },
};

/* ------------------------------ 12. cleanup ----------------------------- */

/**
 * Release-aware storage lifecycle — runs LAST after a successful upload but
 * never destroys media in the pipeline worker. It seals an immutable cleanup
 * schedule instead: private drafts wait for a real release, scheduled uploads
 * retain through publish time + 14 days, and public uploads retain for 14 days.
 * A separate leased sweeper re-reads every release certificate and retained
 * evidence object immediately before it removes intermediates.
 */
export const cleanup: Block = {
  id: "cleanup",
  consumes: [
    "watchUrl",
    "finalMasterReleaseCertificateKey",
    "artifactRetentionRelease",
  ], // gated on a successful upload — never runs on a failed render
  produces: ["cleaned", "removedObjects", "artifactRetention"],
  run: async (ctx) => {
    const keepNames = (ctx.params["keep"] as string[] | undefined) ?? ["final.mp4", "thumbnail.jpg"];
    const { certificateKey } = await loadDurableFinalMasterReleaseCertificate(ctx);
    const shortRelease = await loadDurableShortReleaseCertificate(ctx);
    if (shortRelease) {
      await verifyFinalMasterNarrationAuditIfPresent(
        shortRelease.durableCertificate,
        "cleanup retention scheduling",
      );
    }
    const release = ctx.store["artifactRetentionRelease"] as {
      releaseMode?: unknown;
      uploadedAt?: unknown;
      scheduledPublishAt?: unknown;
    } | undefined;
    const releaseMode = release?.releaseMode;
    if (
      releaseMode !== "private_draft" &&
      releaseMode !== "scheduled" &&
      releaseMode !== "public"
    ) {
      throw new Error("cleanup: upload did not provide a valid artifact retention release mode");
    }
    const uploadedAt = Number(release?.uploadedAt);
    const scheduledPublishAt = release?.scheduledPublishAt === undefined
      ? undefined
      : Number(release.scheduledPublishAt);
    const retention = scheduleRunArtifactRetention({
      releaseMode,
      uploadedAt,
      ...(scheduledPublishAt === undefined ? {} : { scheduledPublishAt }),
    });
    const durable = await convex().mutation(api.runArtifactRetentions.schedule, {
      ownerId: ctx.ownerId,
      channelId: ctx.channelId as Id<"channels">,
      runId: ctx.runId as Id<"runs">,
      keyPrefix: ctx.keyPrefix,
      certificateKey,
      additionalCertificateKeys: shortRelease ? [shortRelease.certificateKey] : [],
      keepNames,
      releaseMode,
      uploadedAt,
      scheduledPublishAt,
    });
    if (!durable) throw new Error("cleanup: artifact retention schedule was not persisted");
    ctx.log(
      retention.status === "awaiting_release"
        ? "cleanup: retained all run artifacts until this private draft has a real release time"
        : `cleanup: retained all run artifacts until ${new Date(retention.retainUntil as number).toISOString()} (release + 14 days)`,
    );
    return {
      cleaned: false,
      removedObjects: 0,
      artifactRetention: {
        version: retention.version,
        status: retention.status,
        releaseMode: retention.releaseMode,
        releaseAt: retention.releaseAt,
        retainUntil: retention.retainUntil,
      },
    };
  },
};

/**
 * All lofi blocks (registration order; pipeline order is set by LOFI_PIPELINE).
 *
 * NOTE: the legacy `metadata` and `thumbnail` blocks are intentionally OMITTED
 * from registration. The competitor-intelligence engine supersedes them with
 * `metadataOptimized` (same id "metadata", title-optimised + view estimate) and
 * `thumbnailGen` (id "thumbnail_gen", banana engine), both registered via
 * `intelligenceBlocks` in src/engine/blocks.ts. Registering both copies of the
 * "metadata" id would throw a duplicate-id error. The legacy exports remain for
 * reference but are no longer wired into the registry or LOFI_PIPELINE.
 */
/* ------------------------- shorts spinoff ------------------------- */

/**
 * `shorts_spinoff` — turn the finished long-form into a vertical 9:16 Short: take
 * the engineered HOOK window, reframe to 1080x1920, burn word-level captions, store
 * in R2, and upload as a PRIVATE YouTube Short (private-first). Optionally crosspost
 * the Short to TikTok/Reels/etc. via Ayrshare (param-gated — never auto-publishes
 * private brand content). Gated on `watchUrl` so it only runs after a successful
 * main upload. Best-effort: any failure is non-fatal to the run.
 */
export const shortsSpinoff: Block = {
  id: "shorts_spinoff",
  consumes: [
    "videoKey",
    "videoLocalPath",
    "sentenceTimings",
    "title",
    "watchUrl",
    "qaPassed",
    "qualityEvidence",
    "finalMasterReleaseCertificateKey",
  ],
  produces: [
    "shortKey",
    "shortVideoId",
    "shortReleaseCertificateReference",
    "shortReleaseCertificateKey",
  ],
  paid: true,
  run: async (ctx) => {
    const src = str(ctx, "videoLocalPath");
    const videoKey = str(ctx, "videoKey");
    const title = str(ctx, "title");
    const timings = (ctx.store["sentenceTimings"] as { text: string; start: number; end: number }[] | undefined) ?? [];
    if (timings.length === 0) {
      ctx.log("shorts_spinoff: no sentenceTimings — skipping");
      return { [COST_PATCH_KEY]: 0 };
    }
    // Even a private derivative must originate from the exact certified parent
    // master. This revalidation is intentionally repeated here rather than
    // assuming the preceding upload stage's in-memory success is still true.
    assertParentMasterReadyForShort(ctx);
    const parentCertificate = await verifyFinalMasterReleaseEvidenceForUpload(ctx, src, videoKey);
    ctx.log(
      `shorts_spinoff: revalidated certified parent master (${parentCertificate.certificateFingerprint.slice(0, 12)})`,
    );
    const requestedTargetDur = Number(ctx.params["shortDurSec"] ?? 45);
    // The transform gate and transcript audit both require at least eight
    // seconds. Normalize the requested window before choosing sentences so a
    // too-short caller value cannot make the output include un-audited speech.
    const targetDur = Number.isFinite(requestedTargetDur)
      ? Math.max(8, requestedTargetDur)
      : 45;
    const narrativeSelection = await selectNarrativeShortSource({
      ctx,
      parentCertificate,
      maxCandidateDurationSec: Math.max(15, targetDur),
    });
    if (narrativeSelection.kind === "not_safe") {
      ctx.log(`shorts_spinoff: serialized narrative derivative skipped without transform spend — ${narrativeSelection.reason}`);
      return { [COST_PATCH_KEY]: 0 };
    }

    let sourceStartSec: number;
    let endSec: number;
    let windowTimings: { text: string; start: number; end: number }[];
    if (narrativeSelection.kind === "selected") {
      sourceStartSec = narrativeSelection.sourceStartSec;
      endSec = narrativeSelection.sourceEndSec;
      windowTimings = timings
        .filter((timing) => timing.end > sourceStartSec && timing.start < endSec)
        .map((timing) => ({
          ...timing,
          start: Math.max(sourceStartSec, timing.start),
          end: Math.min(endSec, timing.end),
        }))
        .filter((timing) => timing.end > timing.start);
      if (!windowTimings.length) {
        ctx.log("shorts_spinoff: selected narrative beat has no timed narration — skipping without transform spend");
        return { [COST_PATCH_KEY]: 0 };
      }
      ctx.log(
        `shorts_spinoff: selected sealed Episode-Graph beat ${narrativeSelection.origin.parentBeatId} ` +
          `(${sourceStartSec.toFixed(1)}–${endSec.toFixed(1)}s)`,
      );
    } else {
      // Non-serialized channels retain the existing opening-window behavior.
      sourceStartSec = Math.max(0, timings[0].start);
      endSec = sourceStartSec;
      windowTimings = [];
      for (const t of timings) {
        if (t.start < sourceStartSec) continue;
        windowTimings.push(t);
        endSec = t.end;
        if (endSec - sourceStartSec >= targetDur) break;
      }
    }
    const durSec = narrativeSelection.kind === "selected"
      ? endSec - sourceStartSec
      : Math.max(8, Math.min(endSec - sourceStartSec, targetDur + 12));

    const tmp = await makeRunTempDir(ctx.runId);
    const raw = join(tmp, "short_raw.mp4");
    const final = join(tmp, "short.mp4");
    await makeVerticalClip(src, raw, { startSec: sourceStartSec, durSec });
    const cues = captionCuesFromTimings(windowTimings, -sourceStartSec);
    await burnCaptions(raw, cues, final, { tmpDir: tmp, width: 1080, height: 1920 });

    const shortKey = `${ctx.keyPrefix}runs/${ctx.runId}/short.mp4`;
    await putObjectFromFile(shortKey, final, { contentType: "video/mp4" });
    ctx.log(`shorts_spinoff: built 9:16 short (${durSec.toFixed(0)}s) → ${shortKey}`);

    // Crop + caption burning creates a new master. Its own required visual
    // review, audio meter, receipt, and certificate are all persisted and
    // re-read before any YouTube connector is touched. Parent evidence is
    // therefore a prerequisite, never a substitute for this actual output.
    const shortRelease = await persistShortReleaseEvidence({
      ctx,
      filePath: final,
      shortKey,
      title,
      topic: opt(ctx, "topic") ?? title,
      expectedDurationSec: durSec,
      captionCues: cues,
      sourceAudioPath: raw,
      ...(narrativeSelection.kind === "selected" ? { narrativeShortOrigin: narrativeSelection.origin } : {}),
      expectedNarrationText: windowTimings
        .map((timing) => typeof timing.text === "string" ? timing.text.trim() : "")
        .filter(Boolean)
        .join(" "),
      transcriptCues: windowTimings.flatMap((timing) => {
        const text = typeof timing.text === "string" ? timing.text.trim() : "";
        const cueStartSec = Number(timing.start) - sourceStartSec;
        const cueEndSec = Number(timing.end) - sourceStartSec;
        return text && Number.isFinite(cueStartSec) && Number.isFinite(cueEndSec) && cueEndSec >= cueStartSec
          ? [{ text, startSec: Math.max(0, cueStartSec), endSec: Math.min(durSec, cueEndSec) }]
          : [];
      }),
    });
    await verifyShortReleaseEvidenceForUpload({
      ctx,
      filePath: final,
      shortKey,
      certificateKey: shortRelease.certificateKey,
    });
    ctx.log(
      `shorts_spinoff: durable post-transform release evidence persisted (${shortRelease.certificateFingerprint.slice(0, 12)})`,
    );

    // Upload as a YouTube Short (PRIVATE unless the param opts into public).
    let shortVideoId = "";
    const client = convex();
    const channelId = ctx.channelId as Id<"channels">;
    const connector = await requireYouTubeConnector(client, {
      channelId,
      ownerId: ctx.ownerId,
      requiredScopes: YOUTUBE_UPLOAD_SCOPES,
    });
    const desc = await appendMusicGenerationDisclosure(
      ctx,
      (ctx.store["description"] as string | undefined) ?? "",
    );
    const publishShort = narrativeSelection.kind === "selected"
      ? false
      : ctx.params["publishShort"] === "public";
    if (narrativeSelection.kind === "selected" && ctx.params["publishShort"] === "public") {
      ctx.log("shorts_spinoff: sealed narrative Short is forced private; publication remains a later explicit action");
    }
    if (publishShort) {
      await requireChannelPublishAction({
        ownerId: ctx.ownerId,
        channelId,
        action: "youtube_short_public",
        convex: client,
      });
    }
    const res = await uploadDurableVideo({
      convex: client,
      ownerId: ctx.ownerId,
      channelId,
      uploadKey: `${ctx.runId}:short-video:${connector.connectorId}:v${connector.tokenVersion}`,
      upload: {
        filePath: final,
        title: `${title} #Shorts`.slice(0, 100),
        description: `#Shorts\n\n${desc}`.slice(0, 4900),
        tags: ((ctx.store["tags"] as string[]) ?? []).slice(0, 15),
        privacyStatus: publishShort ? "public" : "private",
        refreshToken: connector.refreshToken,
        containsSyntheticMedia: true,
      },
      log: ctx.log,
    });
    shortVideoId = res.videoId;
    ctx.log(`shorts_spinoff: uploaded Short ${res.watchUrl} (privacy=${res.privacyStatus})`);
    await recordAsset(ctx, "derived_short", shortKey, {
      kind: "post_transform_short",
      durationSec: shortRelease.durationSec,
      sha256: shortRelease.finalMasterSha256,
      youtubeVideoId: shortVideoId,
      parentMasterCertificateFingerprint: parentCertificate.certificateFingerprint,
      releaseCertificateFingerprint: shortRelease.certificateFingerprint,
      releaseCertificateKey: shortRelease.certificateKey,
      ...(narrativeSelection.kind === "selected"
        ? {
            narrativeShortOriginFingerprint: narrativeSelection.origin.fingerprint,
            narrativeSeriesPlanFingerprint: narrativeSelection.origin.seriesPlanFingerprint,
            narrativeEpisodeGraphFingerprint: narrativeSelection.origin.episodeGraphFingerprint,
            narrativeParentBeatId: narrativeSelection.origin.parentBeatId,
            narrativeSourceWindow: narrativeSelection.origin.sourceWindow,
          }
        : {}),
      referenceQualityAssessment: "not_attested_for_derivative",
    });

    // Optional multi-platform crosspost of the SHORT via Ayrshare — explicit opt-in
    // only (so private brand content is never auto-published off-platform).
    if (narrativeSelection.kind !== "selected" && ctx.params["crosspostShort"] === true && hasAyrshareKey()) {
      await requireChannelPublishAction({
        ownerId: ctx.ownerId,
        channelId,
        action: "crosspost",
        convex: client,
      });
      try {
        const platforms = (ctx.params["platforms"] as string[] | undefined) ?? ["tiktok", "instagram"];
        const r = await ayrCrosspost({ mediaUrl: publicUrl(shortKey), caption: title.slice(0, 2000), platforms });
        ctx.log(`shorts_spinoff: crosspost ${r.ok ? "ok" : "failed"} → ${r.ids.join(", ") || "(none)"}`);
      } catch (e) {
        ctx.log(`shorts_spinoff: crosspost failed (non-fatal): ${e instanceof Error ? e.message : e}`);
      }
    }
    return {
      shortKey,
      shortVideoId,
      shortReleaseCertificateReference: shortRelease.certificateReference,
      shortReleaseCertificateKey: shortRelease.certificateKey,
      [COST_PATCH_KEY]: shortsSpinoffReleaseEvidenceCost(ctx.params),
    };
  },
};

export const lofiBlocks: Block[] = [
  topicSelect,
  musicProgramPlan,
  scenePlanner,
  keyframes,
  loopClips,
  upscale,
  music,
  assemble,
  uploadDraft,
  notify,
  cleanup,
  shortsSpinoff,
];

/**
 * Canonical lofi pipeline (ordered block entries) for a channel.
 *
 * Order (faithful to legacy lofi sequence + competitor-intelligence engine):
 *   competitor_research → music plan/music → scene_planner → keyframes
 *   → loop_clips(2×15s) → upscale(short source unit) → metadata
 *   → assemble(packet-looped 1–8h master) → qa_visual
 *   → thumbnail_gen(Nano Banana edit of exact 15s 4K frame) → upload_draft → notify
 *
 * `competitor_research` runs first (consumes []) so nicheIntelligence /
 * seoDatabank / competitors are in the store before `metadata` optimises the
 * title and `thumbnail_gen` uses the exact rendered frame at 15 seconds as a
 * Nano Banana reference edit. The normal thumbnail playbook is read-only and
 * non-Lo-Fi families keep the usual picture-only generation route.
 *
 * We upscale the exact 30s loop UNIT (not the full render), then stream_loop the
 * 4K unit to length — so length is just a duration param, never extra GPU cost.
 */
export const LOFI_PIPELINE = [
  { block: "competitor_research" },
  { block: "topic_select" },
  { block: "music_program_plan" },
  { block: "scene_planner", params: { visualStyle: "lofi", clipDurationSec: 15 } },
  { block: "music", params: { provider: "suno" } },
  { block: "keyframes", params: { aspectRatio: "16:9", visualStyle: "lofi" } },
  { block: "loop_clips", params: { segmentCount: 2, clipDurationSec: 15, visualStyle: "lofi", loopMode: "flf2v", flfCrossfadeSec: 0.4 } },
  { block: "upscale", params: { targetResolution: "4k", targetFps: 30 } },
  { block: "metadata" },
  { block: "assemble", params: { durationSec: 7_200, deblurIntro: true } },
  { block: "thumbnail_gen" },
  { block: "qa_visual" },
  { block: "upload_draft" },
  { block: "notify" },
  { block: "cleanup" },
];
