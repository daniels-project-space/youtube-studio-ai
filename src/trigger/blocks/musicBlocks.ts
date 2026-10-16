/**
 * Shared music generation and prepared-track reuse for every channel family.
 * Provider admission, receipt verification, mastering and spend stay together.
 */
import { boundedInteger } from "@/engine/boundedNumber";
import { COST_PATCH_KEY, type Block, type StageContext } from "@/engine/types";
import { getMusicBrief, getVisualBrief } from "@/engine/creative/brief";
import { acceptedMusicArrangementForRun } from "@/engine/acceptedMusicArrangement";
import { createOriginalMusicProgramPlan, selectOriginalMusicProvider } from "@/engine/originalMusicProgram";
import { studioPostproductionRecipeProjectionFromUnknown } from "@/engine/studioAssetLibrary";
import { PRICE } from "@/engine/pricing";
import {
  assertMusicProgramQualityReceipt,
  createChannelMusicProgram,
  music3StructuredCaptionWordCount,
  musicFallbackProfileForRole,
  musicProviderPromptForProgram,
  ChannelMusicProgramSchema,
  ChannelMusicProviderSchema,
  musicRoleForRoute,
  resolveMusicModuleBodyMusicVol,
  type ChannelMusicRole,
  type ChannelMusicProgram,
} from "@/engine/channelMusicProgram";
import {
  CHANNEL_IDENTITY_SHORT_FORM_MUSIC_POLICY,
  MUSIC_REQUIRED_STUDIO_DIRECTION_POLICY,
} from "@/engine/musicModuleVersions";
import type { PlanWeekPreparedMusic } from "@/lib/planWeekPreparation";
import {
  assertMusicAuditionNativeBytes,
  createMusicProviderAuditionSource,
  musicRunAudioPrefix,
} from "@/engine/musicAuditionCheckpoint";
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
  hasQualifiedMiniMaxMusic3,
  type MiniMaxMusic3Receipt,
} from "@/lib/minimaxMusic3";
import {
  hasKnownMiniMaxMusic3OpeningDegradation,
  measureNativeMusicQuality,
  type NativeMusicQualityAnalysis,
} from "@/lib/nativeMusicQuality";
import { decodeMusicAuditionPcmWav, probe, crossfadeConcatAudio, masterAudioTransparentGain } from "@/lib/ffmpeg";
import { makeRunTempDir, downloadTo, readBytes, writeBytes } from "@/lib/files";
import { putObject, getObjectBytes, publicUrl } from "@/lib/storage";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256BytesHex, sha256Hex } from "@/lib/sha256";
import { assertMusicReuseReceipt } from "@/lib/musicReuseReceipt";
import { join } from "node:path";
import {
  str,
  recordAsset,
  channelProgramRouteFromContext,
  musicProgramForCurrentRoute,
  routeSeedForTopicSelection,
} from "./blockContext";

// Accepted Mureka/Suno jobs do not expose a durable replay receipt yet. Keep
// their output transfer bounded so a stalled provider body reaches this block's
// existing cost-carrying terminal catch instead of the whole-task timeout.
const MUSIC_PROVIDER_OUTPUT_DOWNLOAD_TIMEOUT_MS = 300_000;
const PREPARED_MUSIC_EVIDENCE_MAX_BYTES = 2 * 1024 * 1024;

export function musicTrackVariationDirection(role: ChannelMusicRole): string {
  switch (role) {
    case "sleep_sound_bed":
      return "preserve the continuous beatless texture and stable level; vary only a barely perceptible timbral or spatial detail, with no pulse, melody, chord change, transient, swell, or climax";
    case "meditation_bed":
      return "preserve the same gentle energy and sealed pulse-or-no-pulse direction; use subtle timbral variation without a startling event or climax";
    case "narration_bed":
      return "preserve the stable harmonic floor and restrained dynamics; vary only accompaniment beneath speech, with no lead melody or attention-grabbing event";
    case "short_form_bed":
      return "preserve the channel instrumentation and identity; use a distinct concise progression with one clear reveal and no added climax";
    case "primary_music":
      return "preserve the channel instrumentation and identity, with a distinct compatible melodic progression";
  }
}

export function musicDnaTempoDirection(input: {
  role: ChannelMusicRole;
  tempoMode?: "metered" | "unmetered";
  bpmRange?: readonly [number, number];
}): string {
  if (input.role === "sleep_sound_bed" || input.tempoMode === "unmetered" || !input.bpmRange) return "";
  return `${input.bpmRange[0]}-${input.bpmRange[1]} BPM`;
}

export async function generateMusicTrackSet(input: {
  prompt: string;
  trackCount: number;
  variationDirection: string;
  generate: (request: {
    prompt: string;
    remainingTrackCount: number;
    generationIndex: number;
  }) => Promise<{ jobId: string; tracks: MusicTrack[] }>;
  onCompletedGeneration?: () => void;
}): Promise<{ tracks: MusicTrack[]; jobIds: string[]; generationCount: number }> {
  if (!Number.isSafeInteger(input.trackCount) || input.trackCount < 1 || input.trackCount > 8) {
    throw new Error("music: track count must be an integer between 1 and 8");
  }
  const tracks: MusicTrack[] = [];
  const jobIds: string[] = [];
  while (tracks.length < input.trackCount) {
    const generationIndex = jobIds.length;
    const prompt = generationIndex === 0
      ? input.prompt
      : `${input.prompt}\nPart ${generationIndex + 1}: ${input.variationDirection}.`;
    const result = await input.generate({
      prompt,
      remainingTrackCount: input.trackCount - tracks.length,
      generationIndex,
    });
    input.onCompletedGeneration?.();
    if (!result.tracks.length) throw new Error("music: provider generation returned no tracks");
    jobIds.push(result.jobId);
    tracks.push(...result.tracks.slice(0, input.trackCount - tracks.length));
  }
  return { tracks, jobIds, generationCount: jobIds.length };
}

async function retainProviderMusicAuditionSource(input: {
  ctx: StageContext;
  provider: "mureka" | "suno";
  program: ChannelMusicProgram;
  musicKey: string;
  sourcePath: string;
  sourceBytes: Uint8Array;
  durationSec: number;
}): Promise<{ musicAuditionSourceKey: string; musicAuditionWavKey: string }> {
  const directory = await makeRunTempDir(input.ctx.runId);
  const wavPath = join(directory, "provider-music-audition.wav");
  await decodeMusicAuditionPcmWav(input.sourcePath, wavPath, input.durationSec);
  const auditionWavBytes = await readBytes(wavPath);
  const auditionWavSha256 = sha256BytesHex(auditionWavBytes);
  const audioPrefix = musicRunAudioPrefix(input.ctx.ownerId, input.ctx.runId);
  const musicAuditionWavKey = `${audioPrefix}music-audition-${auditionWavSha256}.wav`;
  const source = createMusicProviderAuditionSource({
    ownerId: input.ctx.ownerId,
    channelId: String(input.ctx.channelId),
    runId: input.ctx.runId,
    provider: input.provider,
    program: input.program,
    sourceMusicKey: input.musicKey,
    sourceBytes: input.sourceBytes,
    durationSec: input.durationSec,
    auditionWavKey: musicAuditionWavKey,
    auditionWavBytes,
  });
  const musicAuditionSourceKey = `${audioPrefix}music-provider-audition-${source.fingerprint}.json`;
  await Promise.all([
    putObject(musicAuditionWavKey, auditionWavBytes, { contentType: "audio/wav" }),
    putObject(musicAuditionSourceKey, Buffer.from(JSON.stringify(source)), { contentType: "application/json" }),
  ]);
  await recordAsset(input.ctx, "music_provider_audition_source", musicAuditionSourceKey, {
    provider: input.provider,
    sourceMusicKey: input.musicKey,
    sourceContentSha256: source.sourceOutput.contentSha256,
    auditionWavKey: musicAuditionWavKey,
    auditionContentSha256: source.auditionOutput.contentSha256,
    programFingerprint: input.program.fingerprint,
    spendUsd: 0,
  });
  return { musicAuditionSourceKey, musicAuditionWavKey };
}

/** Seals one episode's audio identity and the visual intent used by loop consumers. */
function boundedMusicDirection(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  const contentLimit = Math.max(0, maximum - 3);
  const boundary = value.lastIndexOf(" ", contentLimit);
  return `${value.slice(0, boundary > 0 ? boundary : contentLimit).trimEnd()}...`;
}

export function createMusicProgramPlanBlock(sourceProvider?: "yue2", readIdentity?: (ctx: StageContext) => {
  dna: import("@/engine/creative/types").StyleDNA | null;
  niche?: string;
}): Block {
  return {
    id: "music_program_plan",
    consumes: ["topic"],
    produces: ["musicProgramPlan"],
    run: async ctx => {
      const topic = str(ctx, "topic");
      const route = routeSeedForTopicSelection(ctx);
      if (!route) throw new Error("music_program_plan: requires a sealed music-loop channel program route");
      const requestedProvider = ctx.params["provider"];
      if (sourceProvider && requestedProvider !== undefined && requestedProvider !== sourceProvider) {
        throw new Error("music_program_plan: explicit provider conflicts with YuE2 source ownership");
      }
      if (requestedProvider !== undefined && requestedProvider !== "minimax_music3" && requestedProvider !== "suno" &&
        requestedProvider !== "mureka" && !(sourceProvider === "yue2" && requestedProvider === "yue2")) {
        throw new Error("music_program_plan: provider must be minimax_music3, suno, or mureka");
      }
      const identity = readIdentity?.(ctx);
      const dna = identity ? identity.dna
        : (ctx.store["styleDNA"] as import("@/engine/creative/types").StyleDNA | null) ?? null;
      const visual = getVisualBrief(ctx.store);
      const audio = getMusicBrief(ctx.store);
      const setting = [visual?.setting, visual?.world, visual?.footageQueries?.[0], ctx.params["setting"] as string | undefined,
        dna?.setting, identity ? identity.niche : ctx.store["niche"] as string | undefined]
        .map(value => value?.toString().trim()).find(Boolean);
      const channelAudioDirection = [
        `Original instrumental program for “${topic}”.`,
        dna?.audio?.genre ? `Preserve the channel sound: ${boundedMusicDirection(dna.audio.genre, 120)}.` : "",
        dna?.audio?.bpmRange?.length === 2
          ? `Keep the channel tempo within ${dna.audio.bpmRange[0]}-${dna.audio.bpmRange[1]} BPM.`
          : "",
        dna?.audio?.instrumentation?.length
          ? `Instrumentation: ${boundedMusicDirection(dna.audio.instrumentation.join(", "), 180)}.`
          : "",
        dna?.audio?.textures?.length
          ? `Texture: ${boundedMusicDirection(dna.audio.textures.join(", "), 120)}.`
          : "",
        dna?.audio?.moodArc
          ? `Preserve the channel's emotional arc: ${boundedMusicDirection(dna.audio.moodArc, 160)}.`
          : "",
      ].filter(Boolean).join(" ");
      const episodePrefix = "Episode mood movement: ";
      const audioRequirements = "No vocals, no lyrics, and a musically resolved seamless loop.";
      const boundedChannelDirection = boundedMusicDirection(
        channelAudioDirection,
        900 - audioRequirements.length - 2,
      );
      const episodeDirectionBudget = Math.max(
        0,
        900 - boundedChannelDirection.length - episodePrefix.length - audioRequirements.length - 3,
      );
      const episodeDirection = audio?.musicPrompt?.trim().slice(0, Math.min(520, episodeDirectionBudget));
      const audioDirection = [
        boundedChannelDirection,
        episodeDirection ? `${episodePrefix}${episodeDirection}.` : "",
        audioRequirements,
      ].filter(Boolean).join(" ");
      const visualStyle = (ctx.params["visualStyle"] as string | undefined) ??
        (ctx.store["visualStyle"] as string | undefined) ?? visual?.promptStyle ?? dna?.colorGrade ??
        "channel-native ambient";
      const plan = createOriginalMusicProgramPlan({
        route,
        topic,
        setting,
        visualStyle,
        motionIntent: sourceProvider === "yue2"
          ? `Camera completely static. ${(dna?.motionVocabulary ?? []).join("; ") || "Only subtle ambient motion"}. No abrupt cuts, flashes, or subject drift.`
          : "one calm, seamless camera movement with no abrupt cuts, flashes, or subject drift",
        audioDirection,
        providerPreference: sourceProvider ?? selectOriginalMusicProvider({
          requestedProvider: requestedProvider === "yue2" ? undefined : requestedProvider,
          minimaxQualified: hasQualifiedMiniMaxMusic3(),
        }),
      });
      ctx.log(`music_program_plan: sealed ${plan.fingerprint.slice(0, 12)} for ${plan.routeKey}`);
      return { musicProgramPlan: plan };
    },
  };
}

export const musicProgramPlan = createMusicProgramPlanBlock();

export function musicFallbackPromptForRoute(input: {
  family?: string;
  contentLaneKey?: string;
  role?: ChannelMusicRole;
  topic: string;
  channelIdentitySeed: string;
  profileVersion?: "legacy" | "channel-identity-short-form/v1";
}): string {
  const family = input.family?.toLowerCase() ?? "";
  const contentLaneKey = input.contentLaneKey?.toLowerCase() ?? "";
  const role = input.role ?? musicRoleForRoute(family, contentLaneKey);
  const profile = musicFallbackProfileForRole({
    role,
    family,
    contentLaneKey,
    channelIdentitySeed: input.channelIdentitySeed,
    profileVersion: input.profileVersion,
  });
  const lyricRule = role === "sleep_sound_bed" ? "no vocals or lyrics" : "no vocals, no lyrics";
  return `${profile.prompt}, evoking "${input.topic}"; ${lyricRule}`;
}

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
    "musicNativeWavKey",
    "musicAuditionSourceKey",
    "musicAuditionWavKey",
    "musicQualityReviewStatus",
  ],
  paid: true,
  run: async (ctx) => {
    const topic = str(ctx, "topic");
    const preparedMusic = ctx.store["preparedMusic"] as PlanWeekPreparedMusic | undefined;
    // Bind before a reuse shortcut as well: otherwise a newly admitted music
    // route could attach a sibling's track without proving it belongs to this
    // episode program.
    const musicProgram = musicProgramForCurrentRoute(ctx, topic);
    const musicRoute = channelProgramRouteFromContext(ctx);
    if (musicProgram?.audio.providerPreference === "yue2") {
      throw new Error("music: sealed YuE2 program requires the YuE2 candidate module; legacy generation and reuse cannot substitute for it");
    }
    const selection = ctx.params.provider === undefined ? undefined : ChannelMusicProviderSchema.safeParse(ctx.params.provider);
    if (selection && !selection.success) {
      throw new Error("music: unsupported explicit provider; refusing substitution with a default provider");
    }
    const requestedProvider = selection?.success ? selection.data : undefined;
    let preparedProgram: ChannelMusicProgram | undefined;
    if (preparedMusic !== undefined) {
      if (!preparedMusic || typeof preparedMusic !== "object" ||
        preparedMusic.ownerId !== ctx.ownerId || preparedMusic.channelId !== String(ctx.channelId) || preparedMusic.topic !== topic) {
        throw new Error("music: prepared weekly music does not match the current owner, channel and topic");
      }
      preparedProgram = ChannelMusicProgramSchema.parse(preparedMusic.musicProgram);
      if (preparedProgram.channelId !== String(ctx.channelId) || preparedProgram.topic !== topic) {
        throw new Error("music: prepared weekly sound program does not match the current channel and topic");
      }
      if (preparedMusic.provider !== preparedProgram.generation.providerPreference ||
        (requestedProvider !== undefined && requestedProvider !== preparedMusic.provider) ||
        (musicProgram && musicProgram.audio.providerPreference !== preparedMusic.provider)) {
        throw new Error("music: prepared weekly provider does not match its program or the selected route");
      }
      if (!Number.isSafeInteger(preparedMusic.audioByteLength) || preparedMusic.audioByteLength < 1_000 ||
        preparedMusic.audioByteLength > 250_000_000 || typeof preparedMusic.audioSha256 !== "string" || !/^[a-f0-9]{64}$/.test(preparedMusic.audioSha256) ||
        !Number.isFinite(preparedMusic.musicDurationSec) || preparedMusic.musicDurationSec < 1.5 || preparedMusic.musicDurationSec > 86_400) {
        throw new Error("music: prepared weekly audio bounds are invalid");
      }
    }
    if (
      musicProgram &&
      requestedProvider !== undefined &&
      requestedProvider !== musicProgram.audio.providerPreference
    ) {
      throw new Error(
        `music: requested provider ${requestedProvider} does not match sealed music program provider ${musicProgram.audio.providerPreference}`,
      );
    }
    const provider: MusicProvider = musicProgram?.audio.providerPreference ?? requestedProvider ?? "mureka";
    // RENDER-GROUP REUSE: a language sibling reuses the base render's music track
    // (identical audio bed; only narration differs) — no Mureka/Suno generation.
    const reuseMusicKey = ctx.store["reuseMusicKey"] as string | undefined;
    if (reuseMusicKey) {
      try {
        assertMusicReuseReceipt({
          receipt: ctx.store["reuseMusicReceipt"],
          ownerId: ctx.ownerId,
          siblingChannelId: String(ctx.channelId),
          musicKey: reuseMusicKey,
          currentFamily: musicRoute?.family,
          currentContentLaneKey: musicRoute?.contentLaneKey,
          currentProvider: provider,
          currentStyleDNA: ctx.store["styleDNA"],
        });
        ctx.log(`music: REUSED profile-matched base track ${reuseMusicKey} (no generation)`);
        let reuseUrl = "";
        try { reuseUrl = publicUrl(reuseMusicKey); } catch { reuseUrl = `r2://${reuseMusicKey}`; }
        return {
          musicKey: reuseMusicKey,
          musicProvider: "reuse",
          musicUrl: reuseUrl,
          musicQualityReviewStatus: "not-required-reused-master",
          [COST_PATCH_KEY]: 0,
        };
      } catch (error) {
        ctx.log(`music: ignored incompatible render-group master and will generate for this channel: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    // Phase 2 grounding: "Suno generated by the STYLE OF THE CHANNEL" — the frozen
    // Style DNA audio spec (genre/instrumentation/textures/BPM/loop) is the
    // channel's locked SOUND. Composer and module directions add episode nuance;
    // neither may replace that identity or a specialized sleep-bed contract.
    const composerBrief = getMusicBrief(ctx.store);
    const acceptedArrangement = acceptedMusicArrangementForRun(ctx.store["acceptedMusicArrangement"], {
      ownerId: ctx.ownerId,
      channelId: String(ctx.channelId),
      runId: ctx.runId,
      topic,
      sourceBrief: ctx.store["musicBrief"],
    });
    const acceptedTempoMode = acceptedArrangement?.arrangement.tempoMode;
    const composerPrompt = composerBrief?.musicPrompt;
    const configuredPrompt = typeof ctx.params.prompt === "string"
      ? ctx.params.prompt.trim().replace(/\s+/gu, " ").slice(0, 300)
      : "";
    const dna = (ctx.store["styleDNA"] as import("@/engine/creative/types").StyleDNA | null) ?? null;
    const channelRole = dna?.audio.role;
    const composerRole = composerBrief?.musicIntent?.role;
    if (channelRole && composerRole && channelRole !== composerRole) {
      throw new Error(`music: Composer role ${composerRole} conflicts with locked channel audio role ${channelRole}`);
    }
    const selectedRole = channelRole ?? composerRole ?? musicRoleForRoute(
      musicRoute?.family ?? "",
      musicRoute?.contentLaneKey ?? "",
    );
    const sleepBed = selectedRole === "sleep_sound_bed";
    const studioAudioRecipe = studioPostproductionRecipeProjectionFromUnknown(
      ctx.store["studioAudioRecipeProjection"],
      "audio_recipe",
    );
    const studioAudioDirection = studioAudioRecipe.promptAddenda.length
      ? ` Approved Studio audio direction (must preserve the locked channel sound, instrumental/no-vocal rule, and requested duration): ${studioAudioRecipe.promptAddenda.join(" ")}`
      : "";
    const a = dna?.audio;
    const dnaTempoDirection = musicDnaTempoDirection({
      role: selectedRole,
      tempoMode: acceptedTempoMode ?? composerBrief?.musicIntent?.tempoMode,
      bpmRange: a?.bpmRange,
    });
    const dnaPrompt = a?.genre?.trim()
      ? [
          `${a.genre} instrumental, evoking "${topic}".`,
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
          a.moodArc ? `Emotional arc across the track: ${a.moodArc.trim()}.` : "",
          `${dnaTempoDirection ? `${dnaTempoDirection}, ` : ""}${a.loopable ? "loop-friendly, resolves back to the tonic" : "natural ending"}, purely instrumental, no vocals, no lyrics.`,
        ].filter(Boolean).join(" ")
      : "";
    // BLEND, not override: the DNA is the channel's locked sound (identity
    // floor); the Composer's per-video brief carries THIS video's emotional
    // arc. DNA-only made every video's score near-identical — the staleness
    // the composer crew existed to prevent.
    const arcNote = composerPrompt?.trim()
      ? ` This video's emotional direction: ${composerPrompt.trim()}`
      : "";
    // LAST RESORT, AND IT USED TO BE ONE GENRE.
    //
    // This chain ended in a lofi hip-hop brief — Rhodes piano, boom-bap drums,
    // vinyl crackle — from when this block served only the lofi family. It now
    // serves twelve channels, most of them not lofi, so a finance or philosophy
    // channel with no styleDNA audio and no composer brief was one missing
    // param away from being scored as lofi. Nothing caught it because a wrong
    // score renders and uploads perfectly.
    //
    // The lofi family still gets its own brief; everything else draws from a
    // range by stable channel identity, so two narrated channels that both
    // declare nothing no longer sound identical.
    const route = musicRoute;
    const musicProfileVersion = (ctx.params as Record<PropertyKey, unknown>)[CHANNEL_IDENTITY_SHORT_FORM_MUSIC_POLICY] === true
      ? "channel-identity-short-form/v1" as const
      : "legacy" as const;
    const channelIdentityFingerprint = sha256Hex(canonicalJson({
      ownerId: ctx.ownerId,
      channelId: ctx.channelId,
      channelName: ctx.store["channelName"] ?? null,
      routeFingerprint: route?.routeFingerprint ?? null,
      styleDNA: dna,
    }));
    const lastResort = musicFallbackPromptForRoute({
      family: musicRoute?.family,
      contentLaneKey: musicRoute?.contentLaneKey,
      role: selectedRole,
      topic,
      channelIdentitySeed: channelIdentityFingerprint,
      profileVersion: musicProfileVersion,
    });
    const basePrompt =
      (dnaPrompt && dnaPrompt.trim() ? `${dnaPrompt.trim()}${arcNote}` : "") ||
      (composerPrompt && composerPrompt.trim()) ||
      configuredPrompt ||
      lastResort;
    const moduleDirectionPrefix = "Additional module direction, subordinate to the locked channel sound and route contract:";
    let modulePromptDirection = configuredPrompt && !sleepBed && (dnaPrompt || composerPrompt?.trim())
      ? `${moduleDirectionPrefix} ${configuredPrompt}`
      : "";
    const stableComposerDirection = [
      musicProgram?.audio.direction,
      dnaPrompt ? (a?.loopable ? "Loop-friendly, resolves back to the tonic." : "Natural ending.") : "",
      dnaPrompt ? arcNote : basePrompt,
      studioAudioDirection,
    ].filter(Boolean).join(" ");
    const makeChannelMusicProgram = (moduleDirection: string): ChannelMusicProgram => createChannelMusicProgram({
      channelId: String(ctx.channelId),
      channelIdentityFingerprint,
      family: route?.family,
      contentLaneKey: route?.contentLaneKey,
      topic,
      role: selectedRole,
      musicProfileVersion,
      providerPreference: provider,
      durationSec: Number(ctx.params.generationDurationSec ?? 300),
      tempoMode: acceptedTempoMode ?? composerBrief?.musicIntent?.tempoMode,
      genre: a?.genre,
      instrumentation: a?.instrumentation,
      textures: a?.textures,
      bpmRange: a?.bpmRange,
      moodArc: a?.moodArc,
      // DNA is already represented by the structured identity fields. Carry
      // its episode nuance, or the selected non-DNA prompt, without duplicating it.
      composerDirection: [stableComposerDirection, moduleDirection].filter(Boolean).join(" ") || undefined,
      targetLufs: a?.loudnessLufs,
      bodyMusicVol: resolveMusicModuleBodyMusicVol(ctx.params.bodyMusicVol, dna?.audio?.bodyMusicVol),
    });
    let channelMusicProgram: ChannelMusicProgram = preparedProgram ?? makeChannelMusicProgram(
      provider === "minimax_music3" ? "" : modulePromptDirection,
    );
    if (!preparedProgram && provider === "minimax_music3" && modulePromptDirection) {
      const words = configuredPrompt.split(/\s+/u);
      let low = 1;
      let high = words.length;
      let bestCount = 0;
      let bestProgram = channelMusicProgram;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const retained = words.slice(0, middle).join(" ");
        const direction = retained ? `${moduleDirectionPrefix} ${retained}` : "";
        let candidate: ChannelMusicProgram;
        try {
          candidate = makeChannelMusicProgram(direction);
        } catch (error) {
          if (!String(error).includes("structured caption must contain 250–450 words")) throw error;
          high = middle - 1;
          continue;
        }
        if (music3StructuredCaptionWordCount(candidate.generation.structuredCaption) <= 450) {
          bestCount = middle;
          bestProgram = candidate;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }
      const retained = words.slice(0, bestCount).join(" ");
      modulePromptDirection = retained ? `${moduleDirectionPrefix} ${retained}` : "";
      channelMusicProgram = bestProgram;
      if (bestCount < words.length) ctx.log(
        `music: MiniMax caption budget kept ${bestCount}/${words.length} words of supplemental module direction; locked identity and role requirements were preserved`,
      );
    }
    ctx.log(`music: prompt source = ${dnaPrompt ? (arcNote ? "style DNA + composer arc" : "style DNA") : composerPrompt ? "composer brief" : "route-aware default"}` +
      `${modulePromptDirection ? " + supplemental module direction" : ""}` +
      `${sleepBed && configuredPrompt ? " + sleep contract suppresses free-form module direction" : ""}` +
      `${studioAudioDirection ? " + approved Studio audio direction" : ""}`);
    const channelMusicProgramKey =
      `${musicRunAudioPrefix(ctx.ownerId, ctx.runId)}channel-music-program-${channelMusicProgram.fingerprint}.json`;
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
    // Week-ahead preparation is a distinct, receipt-backed reuse route. Do
    // not feed it through reuseMusicKey: that shortcut only proves a language
    // sibling named an object. This verifies the master and the exact sealed
    // program admitted against the frozen manifest by assertPlanWeekPreparedMusicBinding.
    // A stale program, altered byte, or absent MiniMax audit record is
    // terminal rather than permission to replace the planned track.
    if (preparedMusic !== undefined) {
      if (!preparedMusic || typeof preparedMusic !== "object") {
        throw new Error("music: prepared weekly music is invalid");
      }
      const masterBytes = await getObjectBytes(preparedMusic.musicKey, undefined, {
        maxBytes: preparedMusic.audioByteLength, timeoutMs: MUSIC_PROVIDER_OUTPUT_DOWNLOAD_TIMEOUT_MS,
      });
      if (
        masterBytes.byteLength !== preparedMusic.audioByteLength ||
        sha256BytesHex(masterBytes) !== preparedMusic.audioSha256
      ) {
        throw new Error("music: prepared weekly master bytes do not match their immutable receipt");
      }
      const preparedMasterPath = await writeBytes(
        join(await makeRunTempDir(ctx.runId), "prepared_weekly_music.mp3"),
        masterBytes,
      );
      const measuredDurationSec = (await probe(preparedMasterPath)).durationSec;
      if (
        !Number.isFinite(measuredDurationSec) ||
        measuredDurationSec <= 0 ||
        Math.abs(measuredDurationSec - preparedMusic.musicDurationSec) > 0.05
      ) {
        throw new Error("music: prepared weekly master duration does not match its immutable receipt");
      }

      let musicRuntimeReceiptKey: string | undefined;
      let musicNativeWavKey: string | undefined;
      let musicAuditionSourceKey: string | undefined;
      let musicAuditionWavKey: string | undefined;
      if (preparedMusic.provider === "minimax_music3") {
        const minimax = preparedMusic.minimax;
        if (!minimax) {
          throw new Error("music: prepared MiniMax weekly music is missing its release evidence");
        }
        if (ctx.store["musicQualityReceiptKey"] !== minimax.qualityReceiptKey) {
          throw new Error("music: prepared MiniMax quality receipt is not bound to the scheduled invocation");
        }
        const [runtimeReceiptBytes, qualityReceiptBytes] = await Promise.all([
          getObjectBytes(minimax.runtimeReceiptKey, undefined, { maxBytes: PREPARED_MUSIC_EVIDENCE_MAX_BYTES, timeoutMs: 30_000 }),
          getObjectBytes(minimax.qualityReceiptKey, undefined, { maxBytes: PREPARED_MUSIC_EVIDENCE_MAX_BYTES, timeoutMs: 30_000 }),
        ]);
        let runtimeReceipt: unknown;
        let qualityReceipt: unknown;
        try {
          runtimeReceipt = JSON.parse(Buffer.from(runtimeReceiptBytes).toString("utf8"));
          qualityReceipt = JSON.parse(Buffer.from(qualityReceiptBytes).toString("utf8"));
        } catch (error) {
          throw new Error(
            `music: prepared MiniMax evidence is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        const runtime = assertPinnedMiniMaxMusic3Receipt(runtimeReceipt, channelMusicProgram);
        const quality = assertMusicProgramQualityReceipt({ program: channelMusicProgram, receipt: qualityReceipt });
        if (
          quality.output.contentSha256 !== runtime.output.contentSha256 ||
          quality.output.byteLength !== runtime.output.byteLength ||
          Math.abs(quality.output.durationSec - runtime.durationSec) > Math.max(0.1, runtime.durationSec * 0.001) ||
          quality.output.sampleRate !== runtime.output.sampleRateHz ||
          quality.output.channels !== runtime.output.channels ||
          quality.output.codec !== runtime.output.codec
        ) {
          throw new Error("music: prepared MiniMax quality receipt is not bound to the exact native worker WAV");
        }
        // Validate the small receipts before transferring another full native WAV.
        const nativeWavBytes = await getObjectBytes(minimax.nativeWavKey, undefined, {
          maxBytes: runtime.output.byteLength, timeoutMs: MUSIC_PROVIDER_OUTPUT_DOWNLOAD_TIMEOUT_MS,
        });
        assertMusicAuditionNativeBytes({ expected: runtime.output, bytes: nativeWavBytes });
        musicNativeWavKey =
          `${musicRunAudioPrefix(ctx.ownerId, ctx.runId)}minimax-music3-native-${runtime.output.contentSha256}.wav`;
        await putObject(musicNativeWavKey, nativeWavBytes, { contentType: "audio/wav" });
        await recordAsset(ctx, "minimax_music3_native_wav", musicNativeWavKey, {
          source: "prepared-weekly-music",
          sourceKey: minimax.nativeWavKey,
          requestKey: runtime.requestKey,
          contentSha256: runtime.output.contentSha256,
          byteLength: runtime.output.byteLength,
          durationSec: runtime.durationSec,
          programFingerprint: channelMusicProgram.fingerprint,
          qualityReceiptKey: minimax.qualityReceiptKey,
          reviewBinding: "native-worker-wav",
        });
        musicRuntimeReceiptKey = minimax.runtimeReceiptKey;
      } else {
        const retained = await retainProviderMusicAuditionSource({
          ctx,
          provider: preparedMusic.provider,
          program: channelMusicProgram,
          musicKey: preparedMusic.musicKey,
          sourcePath: preparedMasterPath,
          sourceBytes: masterBytes,
          durationSec: measuredDurationSec,
        });
        musicAuditionSourceKey = retained.musicAuditionSourceKey;
        musicAuditionWavKey = retained.musicAuditionWavKey;
      }
      let musicUrl: string;
      try {
        musicUrl = publicUrl(preparedMusic.musicKey);
      } catch {
        musicUrl = `r2://${preparedMusic.musicKey}`;
      }
      await recordAsset(ctx, "music", preparedMusic.musicKey, {
        provider: preparedMusic.provider,
        source: "prepared-weekly-music",
        byteLength: masterBytes.byteLength,
        durationSec: preparedMusic.musicDurationSec,
        channelMusicProgramFingerprint: channelMusicProgram.fingerprint,
        channelMusicProgramKey,
        runtimeReceiptKey: musicRuntimeReceiptKey,
        trackHumanAuditionStatus: preparedMusic.provider === "minimax_music3"
          ? "passed-prepared-weekly-review"
          : "pending_private_draft_review",
      });
      ctx.log(
        `music: consumed prepared weekly ${preparedMusic.provider} master ` +
        `(${preparedMusic.musicDurationSec.toFixed(1)}s; no music-generation spend)`,
      );
      return {
        musicKey: preparedMusic.musicKey,
        musicProvider: preparedMusic.provider,
        musicUrl,
        channelMusicProgramKey,
        channelMusicProgramFingerprint: channelMusicProgram.fingerprint,
        musicRuntimeReceiptKey,
        musicNativeWavKey,
        musicAuditionSourceKey,
        musicAuditionWavKey,
        musicQualityReviewStatus: preparedMusic.provider === "minimax_music3"
          ? "passed-prepared-weekly-audition"
          : "awaiting-human-audition",
        [COST_PATCH_KEY]: 0,
      };
    }
    const providerPrompt = provider === "minimax_music3" || channelMusicProgram.role === "sleep_sound_bed"
      ? channelMusicProgram.generation.structuredCaption
      : musicProviderPromptForProgram(channelMusicProgram, basePrompt, [
          studioAudioDirection,
          modulePromptDirection,
          dnaPrompt ? (a?.loopable ? "Loop-friendly, resolves back to the tonic." : "Natural ending.") : "",
          composerPrompt,
          musicProgram?.audio.direction,
        ].filter(Boolean).join(" "), 900,
        (ctx.params as Record<PropertyKey, unknown>)[MUSIC_REQUIRED_STUDIO_DIRECTION_POLICY] === true);

    // MULTI-TRACK MIX: a single looped track reads as stale on long videos.
    // trackCount asks for N distinct clips, crossfade-concatenated before the
    // final mix is looped. Suno returns up to two clips per generation; Mureka
    // is called again until its accepted choices fill the requested count.
    // NaN here produced NaN, so the track loop ran zero times and the video
    // shipped with no music at all — the quietest possible failure.
    const trackCount = boundedInteger(ctx.params.trackCount, 2, 1, 8);
    const modelOverride = typeof ctx.params.model === "string" ? ctx.params.model.trim() : "";
    if (modelOverride.length > 12) throw new Error("music: provider model ID must be at most 12 characters");
    const sunoModel = provider === "suno" && modelOverride ? modelOverride : "V5";
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
    // The worker receipt is bound to the native WAV, not the subsequently
    // mastered/loop-folded MP3. Retain those exact verified bytes before any
    // transformation so an owner audition and its later quality receipt can
    // never silently approve the derivative in place of the worker output.
    let musicNativeWavKey: string | undefined;

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
        const configuredBudgetUsd = Number(ctx.params.maxCostUsd ?? 5);
        if (!Number.isFinite(configuredBudgetUsd) || configuredBudgetUsd <= 0) {
          throw new Error("music: MiniMax-Music3 requires a positive total generation budget");
        }
        const configuredSeed = Number(ctx.params.seed ?? 4_242);
        const baseSeed = Number.isSafeInteger(configuredSeed) && configuredSeed >= 0 ? configuredSeed : 4_242;
        let result: Awaited<ReturnType<typeof generateMiniMaxMusic3>> | undefined;
        let nativeTechnicalQuality: NativeMusicQualityAnalysis | undefined;
        // The upstream stock-graph defect can produce a healthy opening then
        // collapse spectrally around the first few seconds. Retry exactly once
        // with a deterministic different seed, only while the original stage
        // reservation still covers the observed first attempt. This is a
        // mechanical repair, not a substitute for the later human audition.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const remainingBudgetUsd = configuredBudgetUsd - billedAttestedCostUsd;
          if (remainingBudgetUsd <= 0) {
            throw new Error("music: MiniMax-Music3 known-defect retry would exceed the sealed stage budget");
          }
          const attemptSeed = attempt === 0
            ? baseSeed
            : (baseSeed + 104_729) % 2_147_483_647;
          const candidate = await generateMiniMaxMusic3({
            program: channelMusicProgram,
            seed: attemptSeed,
            // The worker accepts only the benchmarked full-precision profile.
            // Preserve an explicit override as an intentional, fail-closed
            // benchmark request instead of silently clamping it into a release.
            cfgScale: ctx.params.cfgScale === undefined ? undefined : Number(ctx.params.cfgScale),
            topK: ctx.params.topK === undefined ? undefined : Number(ctx.params.topK),
            maxCostUsd: Math.min(10, remainingBudgetUsd),
          });
          billedAttestedCostUsd += candidate.receipt.runtime.costUsd;
          const technicalQuality = await measureNativeMusicQuality({
            audio: candidate.audio,
            durationSec: candidate.receipt.durationSec,
          });
          if (!hasKnownMiniMaxMusic3OpeningDegradation(technicalQuality)) {
            result = candidate;
            nativeTechnicalQuality = technicalQuality;
            break;
          }
          const rejectedKey =
            `${musicRunAudioPrefix(ctx.ownerId, ctx.runId)}rejected/minimax-music3-native-${candidate.receipt.output.contentSha256}.wav`;
          await putObject(rejectedKey, candidate.audio, { contentType: "audio/wav" });
          await recordAsset(ctx, "minimax_music3_rejected_native_wav", rejectedKey, {
            requestKey: candidate.receipt.requestKey,
            jobId: candidate.receipt.jobId,
            contentSha256: candidate.receipt.output.contentSha256,
            durationSec: candidate.receipt.durationSec,
            openingHighBandDropDb: technicalQuality.measurements.openingHighBandDropDb,
            mechanicalArtifactScore: technicalQuality.measurements.mechanicalArtifactScore,
            rejection: "known-music3-opening-degradation",
          });
          ctx.log(
            `music: rejected MiniMax-Music3 attempt ${attempt + 1}/2 for known opening degradation ` +
            `(high-band drop ${technicalQuality.measurements.openingHighBandDropDb} dB); retained evidence before bounded retry`,
          );
        }
        if (!result || !nativeTechnicalQuality) {
          throw new Error("music: MiniMax-Music3 exhausted its bounded retry after known opening degradation");
        }
        minimaxReceipt = result.receipt;
        minimaxLocalPath = await writeBytes(join(tmp, "minimax-music3.wav"), result.audio);
        musicNativeWavKey =
          `${musicRunAudioPrefix(ctx.ownerId, ctx.runId)}minimax-music3-native-${result.receipt.output.contentSha256}.wav`;
        await putObject(musicNativeWavKey, result.audio, { contentType: "audio/wav" });
        await recordAsset(ctx, "minimax_music3_native_wav", musicNativeWavKey, {
          requestKey: result.receipt.requestKey,
          jobId: result.receipt.jobId,
          contentSha256: result.receipt.output.contentSha256,
          byteLength: result.receipt.output.byteLength,
          durationSec: result.receipt.durationSec,
          sampleRateHz: result.receipt.output.sampleRateHz,
          channels: result.receipt.output.channels,
          codec: result.receipt.output.codec,
          programFingerprint: channelMusicProgram.fingerprint,
          openingHighBandDropDb: nativeTechnicalQuality.measurements.openingHighBandDropDb,
          mechanicalArtifactScore: nativeTechnicalQuality.measurements.mechanicalArtifactScore,
          // This is a retained review artifact. It is deliberately distinct
          // from the mastered MP3, which has its own asset row below.
          reviewBinding: "native-worker-wav",
        });
        musicRuntimeReceiptKey =
          `${musicRunAudioPrefix(ctx.ownerId, ctx.runId)}minimax-music3-runtime-${result.receipt.requestKey}.json`;
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
        const result = await generateMusicTrackSet({
          prompt: providerPrompt,
          trackCount,
          variationDirection: musicTrackVariationDirection(channelMusicProgram.role),
          generate: ({ prompt, remainingTrackCount, generationIndex }) => {
            ctx.log(`music: suno ${sunoModel} generation ${generationIndex + 1} (custom mode, WAV upgrade)…`);
            return generateSuno({
              prompt,
              model: prov === provider ? sunoModel : "V5",
              title: mixTitle,
              // WAV upgrade only when EXPLICITLY requested (lofi sets it): a
              // narrated bed sits ducked -22dB under voice — inaudible benefit,
              // and a failed WAV poll burned up to 3 min/clip of pure waiting.
              wantClips: Math.min(2, remainingTrackCount),
              preferWav: ctx.params.preferWav === true,
              timeoutMs: 600_000,
            });
          },
          onCompletedGeneration: () => {
            generations += 1;
            billedGenerations += 1;
          },
        });
        jobIds = result.jobIds;
        tracks = result.tracks;
        usedProvider = "suno";
      } else {
        ctx.log(`music: generating ${trackCount} requested Mureka tracks…`);
        const result = await generateMusicTrackSet({
          prompt: providerPrompt,
          trackCount,
          variationDirection: musicTrackVariationDirection(channelMusicProgram.role),
          generate: ({ prompt }) => generateMureka({
            prompt,
            model: prov === "mureka" && provider === "mureka" ? modelOverride || undefined : undefined,
            timeoutMs: 600_000,
          }),
          onCompletedGeneration: () => {
            generations += 1;
            billedGenerations += 1;
          },
        });
        jobIds = result.jobIds;
        tracks = result.tracks;
        usedProvider = "mureka";
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

    const musicKey = `${musicRunAudioPrefix(ctx.ownerId, ctx.runId)}music.mp3`;
    const musicBytes = await readBytes(local);
    await putObject(musicKey, musicBytes, { contentType: "audio/mpeg" });
    let musicAuditionSourceKey: string | undefined;
    let musicAuditionWavKey: string | undefined;
    if (usedProvider !== "minimax_music3") {
      const sourceProbe = await probe(local);
      if (!sourceProbe.hasAudio || sourceProbe.hasVideo || sourceProbe.durationSec < 6 || sourceProbe.durationSec > 300) {
        throw new Error("music: mastered provider output is not an auditionable 6–300 second audio-only source");
      }
      const retained = await retainProviderMusicAuditionSource({
        ctx,
        provider: usedProvider,
        program: channelMusicProgram,
        musicKey,
        sourcePath: local,
        sourceBytes: musicBytes,
        durationSec: sourceProbe.durationSec,
      });
      musicAuditionSourceKey = retained.musicAuditionSourceKey;
      musicAuditionWavKey = retained.musicAuditionWavKey;
    }
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
      musicNativeWavKey,
      musicAuditionSourceKey,
      musicAuditionWavKey,
      // An operational worker qualification is not an audition of this track.
      // The owner/review flow adds musicQualityReceiptKey after section review;
      // upload_draft rejects a MiniMax release until that proof is present.
      musicQualityReviewStatus: "awaiting-human-audition",
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
