import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import type { MusicProvider } from "@/lib/music";

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function provider(value: unknown): MusicProvider | undefined {
  return value === "mureka" || value === "suno" || value === "minimax_music3" ? value : undefined;
}

/** Hash only explicit channel sound identity; missing DNA is never treated as a match. */
export function groupMusicSoundProfileFingerprint(input: {
  family: unknown;
  contentLaneKey: unknown;
  provider: unknown;
  styleDNA: unknown;
}): string | undefined {
  const family = typeof input.family === "string" ? input.family.trim() : "";
  const contentLaneKey = typeof input.contentLaneKey === "string" ? input.contentLaneKey.trim() : "";
  const selectedProvider = provider(input.provider);
  const audio = record(record(input.styleDNA)?.audio);
  if (!family || !contentLaneKey || !selectedProvider || !audio ||
      typeof audio.genre !== "string" || !audio.genre.trim() ||
      !Array.isArray(audio.bpmRange) || audio.bpmRange.length !== 2 ||
      !audio.bpmRange.every((value) => typeof value === "number" && Number.isFinite(value)) ||
      !Array.isArray(audio.instrumentation) || !audio.instrumentation.length ||
      !audio.instrumentation.every((value) => typeof value === "string" && value.trim()) ||
      !Array.isArray(audio.textures) || !audio.textures.length ||
      !audio.textures.every((value) => typeof value === "string" && value.trim()) ||
      typeof audio.moodArc !== "string" || !audio.moodArc.trim() ||
      typeof audio.loudnessLufs !== "number" || !Number.isFinite(audio.loudnessLufs) ||
      typeof audio.loopable !== "boolean" ||
      (audio.bodyMusicVol !== undefined &&
        (typeof audio.bodyMusicVol !== "number" || !Number.isFinite(audio.bodyMusicVol)))) {
    return undefined;
  }
  return sha256Hex(canonicalJson({
    family,
    contentLaneKey,
    provider: selectedProvider,
    audio: {
      genre: audio.genre.trim(),
      bpmRange: audio.bpmRange,
      instrumentation: audio.instrumentation,
      textures: audio.textures,
      moodArc: audio.moodArc.trim(),
      loudnessLufs: audio.loudnessLufs,
      ...(audio.bodyMusicVol !== undefined ? { bodyMusicVol: audio.bodyMusicVol } : {}),
      loopable: audio.loopable,
    },
  }));
}

/** Resolve only an unversioned sibling route whose provider is deterministic. */
export function storedChannelMusicProvider(channelValue: unknown): MusicProvider | undefined {
  const channel = record(channelValue);
  const pipeline = Array.isArray(channel?.pipeline) ? channel.pipeline : undefined;
  if (!channel || !pipeline) return undefined;
  const musicEntry = pipeline.map(record).find((entry) => entry?.block === "music");
  if (!musicEntry || typeof musicEntry.version === "string" ||
      pipeline.some((entry) => record(entry)?.block === "music_program_plan")) return undefined;
  const configMusic = record(record(channel.moduleConfig)?.music);
  const entryParams = record(musicEntry.params);
  const configProvider = provider(configMusic?.provider);
  const entryProvider = provider(entryParams?.provider);
  if ((configMusic?.provider !== undefined && !configProvider) ||
      (entryParams?.provider !== undefined && !entryProvider) ||
      (configProvider && entryProvider && configProvider !== entryProvider)) return undefined;
  return configProvider ?? entryProvider ?? "mureka";
}
