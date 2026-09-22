import { z } from "zod";
import { MusicArrangementIntentSchema, type MusicArrangementIntent } from "./acceptedMusicArrangement";
import { getManifest } from "./registry";
import { canonicalJson } from "@/lib/canonicalJson";
import type { PipelineEntry } from "./types";

export interface YuE2PipelineSelection {
  musicIntent: MusicArrangementIntent & Required<Pick<MusicArrangementIntent, "playback" | "role" | "requestedDurationSec">>;
  /** Exact bounded source-module params, supplied by the supervised operator. */
  sourceParams: Record<string, unknown>;
}

const selectionSchema = z.object({
  musicIntent: MusicArrangementIntentSchema.and(z.object({
    playback: z.enum(["repeat", "once"]), role: z.enum(["primary_music", "narration_bed", "meditation_bed", "short_form_bed"]),
    requestedDurationSec: z.number().int().min(10).max(300),
  })),
  sourceParams: z.record(z.unknown()),
}).strict();

/** Resolve one explicit source choice into compatible owners before freezing or spending. */
export function selectYuE2Pipeline(source: readonly PipelineEntry[], input: YuE2PipelineSelection): PipelineEntry[] {
  const selected = selectionSchema.parse(input);
  const musicVersion = "3.0.0-yue2-candidate", composerVersion = "3.0.0-yue2-score";
  const assemblyVersion = selected.musicIntent.playback === "once"
    ? "3.1.0-yue2-reviewed-once" : "3.0.0-yue2-reviewed-loop";
  const music = getManifest("music", musicVersion);
  if (!music) throw new Error("YuE2 selection requires registered runtime manifests");
  const sourceParams = music.configSchema.parse(selected.sourceParams) as Record<string, unknown>;
  const indexOfOne = (ids: readonly string[]) => {
    const indexes = source.flatMap((entry, index) => ids.includes(entry.block) ? [index] : []);
    if (indexes.length !== 1) throw new Error(`YuE2 selection requires exactly one ${ids.join(" or ")} owner`);
    return indexes[0];
  };
  const musicIndex = indexOfOne(["music"]), composerIndex = indexOfOne(["composer_brief"]);
  const assemblyIndex = indexOfOne(["assemble", "timeline_assemble"]);
  const priorIntent = source[composerIndex].params?.musicIntent;
  if (priorIntent !== undefined && canonicalJson(priorIntent) !== canonicalJson(selected.musicIntent)) {
    throw new Error("YuE2 selection conflicts with the composer's explicit music intent");
  }
  if (!(composerIndex < musicIndex && musicIndex < assemblyIndex)) throw new Error("YuE2 owners must be ordered composer, music, assembly");
  if (selected.musicIntent.playback === "once" && source[assemblyIndex].block !== "timeline_assemble") {
    throw new Error("Play-once music requires the narrated timeline consumer, not loop assembly");
  }
  const versions = new Map([[composerIndex, composerVersion], [musicIndex, musicVersion], [assemblyIndex, assemblyVersion]]);
  for (const [index, version] of versions) {
    const entry = source[index];
    if (entry.version !== undefined && entry.version !== version) {
      throw new Error(`YuE2 selection cannot replace explicitly pinned ${entry.block}@${entry.version}`);
    }
    if (!getManifest(entry.block, version)) throw new Error(`YuE2 executable unavailable: ${entry.block}@${version}`);
  }
  const plans = source.flatMap((entry, index) => entry.block === "music_arrangement_plan" ? [index] : []);
  if (plans.length > 1 || (plans.length === 1 && !(composerIndex < plans[0] && plans[0] < musicIndex))) {
    throw new Error("YuE2 arrangement acceptance must appear once between composer and music");
  }
  const pipeline = source.map((entry, index): PipelineEntry => {
    if (index === composerIndex) return { ...entry, version: composerVersion,
      params: { ...entry.params, musicIntent: selected.musicIntent } };
    if (index === musicIndex) return { block: "music", version: musicVersion, params: sourceParams };
    if (index === assemblyIndex) {
      if (entry.params?.useAssemblyEdl === true ||
        (selected.musicIntent.playback === "once" && entry.params?.sourceCrossfadeSec !== undefined && entry.params.sourceCrossfadeSec !== 0)) {
        throw new Error("YuE2 selection conflicts with assembly EDL or play-once crossfade settings");
      }
      return { ...entry, version: assemblyVersion, params: { ...entry.params,
        ...(selected.musicIntent.playback === "once" ? { sourceCrossfadeSec: 0 } : {}) } };
    }
    return { ...entry, ...(entry.params ? { params: { ...entry.params } } : {}) };
  });
  if (!plans.length) pipeline.splice(composerIndex + 1, 0, { block: "music_arrangement_plan" });
  for (const entry of pipeline) {
    const manifest = getManifest(entry.block, entry.version);
    if (manifest && (manifest.consumes.musicUrl || manifest.consumes.musicKey)) {
      throw new Error(`YuE2 private candidate has no compatible music handoff for ${entry.block}`);
    }
  }
  return pipeline;
}
