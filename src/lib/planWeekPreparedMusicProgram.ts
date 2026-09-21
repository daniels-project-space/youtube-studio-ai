import type { PlanWeekPreparationManifest } from "@/lib/planWeekPreparation";
import { ChannelMusicProgramSchema, createChannelMusicProgram, type ChannelMusicProgram, type ChannelMusicProvider as MusicProvider } from "@/engine/channelMusicProgram";
import { parseChannelProgramRouteRunSeed, type ChannelProgramRouteRunSeed } from "@/engine/channelProgramRoute";
import { getMusicBrief } from "@/engine/creative/brief";
import { assertOriginalMusicProgramPlanBinding } from "@/engine/originalMusicProgram";
import { studioPostproductionRecipeProjectionFromUnknown } from "@/engine/studioAssetLibrary";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

function finiteNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const result = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(minimum, Math.min(maximum, result));
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
  const value = manifest.execution.moduleConfig.music ?? manifest.execution.moduleConfig.lofi ?? {};
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function styleAudio(manifest: PlanWeekPreparationManifest): Record<string, unknown> {
  const style = seedRecord(manifest).styleDNA;
  if (!style || typeof style !== "object" || Array.isArray(style)) return {};
  const audio = (style as Record<string, unknown>).audio;
  return audio && typeof audio === "object" && !Array.isArray(audio) ? audio as Record<string, unknown> : {};
}

/** Re-derive the exact frozen preparation recipe before trusting a saved result. */
export function planWeekPreparedMusicProgram(manifest: PlanWeekPreparationManifest, provider: MusicProvider): ChannelMusicProgram {
  const seed = seedRecord(manifest);
  const route = routeSeed(manifest);
  const audio = styleAudio(manifest);
  const config = planWeekMusicConfig(manifest);
  const styleDNA = seed.styleDNA ?? null;
  const composerDirection = getMusicBrief(seed)?.musicPrompt?.trim() ||
    (typeof config.composerDirection === "string" ? config.composerDirection.trim() : "") ||
    (typeof config.musicPrompt === "string" ? config.musicPrompt.trim() : "");
  const explicitDirection = typeof config.prompt === "string" ? config.prompt.trim() : "";
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
  const channelIdentityFingerprint = sha256Hex(canonicalJson({
    ownerId: manifest.ownerId,
    channelId: manifest.channelId,
    channelName,
    routeFingerprint,
    styleDNA,
    musicBrief: getMusicBrief(seed) ?? null,
  }));
  const family = route?.family ?? (typeof seed.family === "string" ? seed.family : "narrated_stock");
  const contentLaneKey = route?.contentLaneKey ?? (typeof seed.contentLane === "object" && seed.contentLane && !Array.isArray(seed.contentLane)
    ? String((seed.contentLane as Record<string, unknown>).key ?? "narrated_stock")
    : "narrated_stock");
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
      studioDirection,
    ].filter(Boolean).join(" ") || undefined,
    targetLufs: finiteNumber(audio.loudnessLufs, -16, -23, -12),
    bodyMusicVol: 1,
  }));
}
