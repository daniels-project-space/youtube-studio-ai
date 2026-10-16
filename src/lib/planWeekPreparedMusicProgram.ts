import type { PlanWeekPreparationManifest } from "@/lib/planWeekPreparation";
import { ChannelMusicProgramSchema, createChannelMusicProgram, musicRoleForRoute, resolveMusicModuleBodyMusicVol, type ChannelMusicProgram, type ChannelMusicProvider as MusicProvider, type ChannelMusicRole } from "@/engine/channelMusicProgram";
import { parseChannelProgramRouteRunSeed, type ChannelProgramRouteRunSeed } from "@/engine/channelProgramRoute";
import { getMusicBrief } from "@/engine/creative/brief";
import { assertOriginalMusicProgramPlanBinding } from "@/engine/originalMusicProgram";
import { studioPostproductionRecipeProjectionFromUnknown } from "@/engine/studioAssetLibrary";
import { CHANNEL_IDENTITY_SHORT_FORM_MUSIC_VERSION } from "@/engine/musicModuleVersions";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

function finiteNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const result = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(minimum, Math.min(maximum, result));
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function seedRecord(manifest: PlanWeekPreparationManifest): Record<string, unknown> {
  const value = manifest.execution.seedStore;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("weekly prepared music seed store is invalid");
  return value;
}

function routeSeed(manifest: PlanWeekPreparationManifest): ChannelProgramRouteRunSeed | undefined {
  const raw = seedRecord(manifest).channelProgramRoute;
  return raw === undefined ? undefined : parseChannelProgramRouteRunSeed(raw);
}

export function planWeekMusicConfig(manifest: PlanWeekPreparationManifest): Record<string, unknown> {
  const legacyValue = manifest.execution.moduleConfig.lofi;
  const musicValue = manifest.execution.moduleConfig.music;
  const legacyConfig = legacyValue && typeof legacyValue === "object" && !Array.isArray(legacyValue)
    ? legacyValue as Record<string, unknown>
    : {};
  const musicConfig = musicValue && typeof musicValue === "object" && !Array.isArray(musicValue)
    ? musicValue as Record<string, unknown>
    : {};
  const musicEntry = manifest.execution.pipeline.find((entry): entry is Record<string, unknown> =>
    Boolean(entry) && typeof entry === "object" && !Array.isArray(entry) &&
    (entry as Record<string, unknown>).block === "music");
  const rawMusicParams = musicEntry?.params;
  const musicParams = rawMusicParams && typeof rawMusicParams === "object" && !Array.isArray(rawMusicParams)
    ? rawMusicParams as Record<string, unknown>
    : {};
  return { ...musicParams, ...legacyConfig, ...musicConfig };
}

function styleAudio(manifest: PlanWeekPreparationManifest): Record<string, unknown> {
  const style = seedRecord(manifest).styleDNA;
  if (!style || typeof style !== "object" || Array.isArray(style)) return {};
  const audio = (style as Record<string, unknown>).audio;
  return audio && typeof audio === "object" && !Array.isArray(audio) ? audio as Record<string, unknown> : {};
}

export function planWeekMusicRole(manifest: PlanWeekPreparationManifest): ChannelMusicRole {
  const seed = seedRecord(manifest);
  const route = routeSeed(manifest);
  const family = route?.family ?? (typeof seed.family === "string" ? seed.family : "narrated_stock");
  const contentLaneKey = route?.contentLaneKey ?? (typeof seed.contentLane === "object" && seed.contentLane && !Array.isArray(seed.contentLane)
    ? String((seed.contentLane as Record<string, unknown>).key ?? "narrated_stock")
    : "narrated_stock");
  return getMusicBrief(seed)?.musicIntent?.role ?? musicRoleForRoute(family, contentLaneKey);
}

/** Re-derive the exact frozen preparation recipe before trusting a saved result. */
export function planWeekPreparedMusicProgram(manifest: PlanWeekPreparationManifest, provider: MusicProvider): ChannelMusicProgram {
  const seed = seedRecord(manifest);
  const route = routeSeed(manifest);
  const musicEntries = manifest.execution.pipeline.filter((entry): entry is Record<string, unknown> =>
    Boolean(entry) && typeof entry === "object" && !Array.isArray(entry) &&
    (entry as Record<string, unknown>).block === "music");
  if (musicEntries.length > 1) throw new Error("weekly prepared music requires exactly one music module");
  const musicVersion = musicEntries[0]?.version;
  if (musicVersion !== undefined && musicVersion !== CHANNEL_IDENTITY_SHORT_FORM_MUSIC_VERSION) {
    throw new Error(`weekly prepared music implementation version ${JSON.stringify(musicVersion)} is unsupported`);
  }
  const usesShortFormIdentityProfile = musicVersion === CHANNEL_IDENTITY_SHORT_FORM_MUSIC_VERSION;
  const audio = styleAudio(manifest);
  const config = planWeekMusicConfig(manifest);
  const styleDNA = seed.styleDNA ?? null;
  const musicBrief = getMusicBrief(seed);
  const composerDirection = musicBrief?.musicPrompt?.trim() ||
    (typeof config.composerDirection === "string" ? config.composerDirection.trim() : "") ||
    (typeof config.musicPrompt === "string" ? config.musicPrompt.trim() : "");
  const explicitDirection = typeof config.prompt === "string"
    ? config.prompt.trim().replace(/\s+/gu, " ")
    : "";
  const hasDna = typeof audio.genre === "string" && Boolean(audio.genre.trim());
  const sealedProgram = seed.musicProgramPlan !== undefined && route?.requiredBlocks.includes("music_program_plan")
    ? assertOriginalMusicProgramPlanBinding({ plan: seed.musicProgramPlan, route, topic: manifest.plan.topic })
    : undefined;
  const configuredProvider = config.provider ?? config.musicProvider;
  if ((configuredProvider !== undefined && configuredProvider !== provider) ||
    (sealedProgram && sealedProgram.audio.providerPreference !== provider)) {
    throw new Error("weekly prepared music provider does not match the frozen route");
  }
  const studioAudioRecipe = studioPostproductionRecipeProjectionFromUnknown(seed.studioAudioRecipeProjection, "audio_recipe");
  const studioDirection = studioAudioRecipe.promptAddenda.length
    ? `Approved Studio audio direction (must preserve the locked channel sound, instrumental/no-vocal rule, and requested duration): ${studioAudioRecipe.promptAddenda.join(" ")}`
    : "";
  const channelName = seed.channelName ?? null;
  const routeFingerprint = route?.routeFingerprint ?? null;
  const family = route?.family ?? (typeof seed.family === "string" ? seed.family : "narrated_stock");
  const contentLaneKey = route?.contentLaneKey ?? (typeof seed.contentLane === "object" && seed.contentLane && !Array.isArray(seed.contentLane)
    ? String((seed.contentLane as Record<string, unknown>).key ?? "narrated_stock")
    : "narrated_stock");
  const role = planWeekMusicRole(manifest);
  if (usesShortFormIdentityProfile && role !== "short_form_bed") {
    throw new Error("weekly prepared short-form music version requires the short_form_bed role");
  }
  const channelIdentityFingerprint = sha256Hex(canonicalJson({
    ownerId: manifest.ownerId,
    channelId: manifest.channelId,
    channelName,
    routeFingerprint,
    styleDNA,
  }));
  const supplementalDirection = explicitDirection && role !== "sleep_sound_bed" && (hasDna || composerDirection)
    ? `Additional module direction, subordinate to the locked channel sound and route contract: ${explicitDirection}`
    : "";
  const rawBpm = audio.bpmRange;
  const bpmRange = Array.isArray(rawBpm) && rawBpm.length === 2
    ? [Number(rawBpm[0]), Number(rawBpm[1])] as [number, number]
    : undefined;
  return ChannelMusicProgramSchema.parse(createChannelMusicProgram({
    channelId: manifest.channelId,
    channelIdentityFingerprint,
    family,
    contentLaneKey,
    topic: manifest.plan.topic,
    role,
    musicProfileVersion: usesShortFormIdentityProfile ? "channel-identity-short-form/v1" : undefined,
    providerPreference: provider,
    durationSec: finiteNumber(config.generationDurationSec ?? config.durationSec, 300, 10, 300),
    genre: typeof audio.genre === "string" ? audio.genre : undefined,
    instrumentation: Array.isArray(audio.instrumentation) ? audio.instrumentation.filter((value): value is string => typeof value === "string") : undefined,
    textures: Array.isArray(audio.textures) ? audio.textures.filter((value): value is string => typeof value === "string") : undefined,
    bpmRange,
    moodArc: typeof audio.moodArc === "string" ? audio.moodArc : undefined,
    composerDirection: [
      sealedProgram?.audio.direction,
      hasDna ? (audio.loopable ? "Loop-friendly, resolves back to the tonic." : "Natural ending.") : "",
      composerDirection || (!hasDna ? explicitDirection : ""),
      supplementalDirection,
      studioDirection,
    ].filter(Boolean).join(" ") || undefined,
    targetLufs: optionalFiniteNumber(audio.loudnessLufs),
    bodyMusicVol: resolveMusicModuleBodyMusicVol(config.bodyMusicVol, optionalFiniteNumber(audio.bodyMusicVol)),
  }));
}
