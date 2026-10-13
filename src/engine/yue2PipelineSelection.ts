import { z } from "zod";
import { MusicArrangementIntentSchema, type MusicArrangementIntent } from "./acceptedMusicArrangement";
import { getManifest } from "./registry";
import { canonicalJson } from "@/lib/canonicalJson";
import type { PipelineEntry } from "./types";
import { YuE2SourceConfigSchema } from "./yue2SourceConfig";
import { YuE2EngineSourceConfigSchema } from "./studioYuE2EngineSource";

export interface YuE2PipelineSelection {
  musicIntent: MusicArrangementIntent & Required<Pick<MusicArrangementIntent, "playback" | "role" | "requestedDurationSec">>;
  /** Exact bounded source-module params, supplied by the supervised operator. */
  sourceParams: Record<string, unknown>;
}

export const YUE2_ENGINE_MUSIC_MODULE_VERSION = "4.0.0-yue2-engine-candidate" as const;

export function hasEngineOwnedMusicModule(entries: readonly unknown[]): boolean {
  return entries.some(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const entry = value as { block?: unknown; version?: unknown; params?: unknown };
    return entry.block === "music" && entry.version === YUE2_ENGINE_MUSIC_MODULE_VERSION &&
      Boolean(entry.params && typeof entry.params === "object" && !Array.isArray(entry.params) &&
        (entry.params as Record<string, unknown>).renderer === "render-engine");
  });
}

export function isYuE2MusicCandidateVersion(version: string | undefined): boolean {
  return version !== undefined && /(?:^|-)yue2-(?:engine-)?candidate$/u.test(version);
}

export function defaultFreshChannelYuE2Selection(input: {
  family: string;
  routeFingerprint: string;
  episodeLengthSeconds: number;
}): YuE2PipelineSelection {
  if (!/^[a-f0-9]{64}$/u.test(input.routeFingerprint) || !Number.isFinite(input.episodeLengthSeconds) || input.episodeLengthSeconds <= 0) {
    throw new Error("Fresh-channel YuE2 selection requires a sealed route and measured episode target");
  }
  const role = input.family === "music_loop" ? "primary_music"
    : input.family === "sleep" ? "meditation_bed"
      : input.family === "shorts" ? "short_form_bed" : "narration_bed";
  const requestedDurationSec = input.family === "music_loop"
    ? 30
    : Math.min(300, Math.max(30, Math.ceil(input.episodeLengthSeconds)));
  return {
    musicIntent: { role, requestedDurationSec, playback: "repeat" },
    sourceParams: {
      renderer: "render-engine",
      seed: Number.parseInt(input.routeFingerprint.slice(0, 8), 16),
      personalCreatorAcknowledged: true,
      maxCostUsd: 1,
      maxExecutionSeconds: 1200,
    },
  };
}

export const YuE2PipelineSelectionSchema = z.object({
  musicIntent: MusicArrangementIntentSchema.and(z.object({
    playback: z.enum(["repeat", "once"]), role: z.enum(["primary_music", "narration_bed", "meditation_bed", "short_form_bed"]),
    requestedDurationSec: z.number().int().min(10).max(300),
  })),
  sourceParams: z.union([YuE2SourceConfigSchema, YuE2EngineSourceConfigSchema]),
}).strict();

/** Exact read-only graph projection; executable manifest validation remains mandatory at runtime. */
export function projectYuE2Pipeline(source: readonly PipelineEntry[], input: YuE2PipelineSelection): PipelineEntry[] {
  const selected = YuE2PipelineSelectionSchema.parse(input);
  const musicVersion = "renderer" in selected.sourceParams ? YUE2_ENGINE_MUSIC_MODULE_VERSION : "3.0.0-yue2-candidate", composerVersion = "3.0.0-yue2-score";
  const assemblyVersion = selected.musicIntent.playback === "once"
    ? "3.1.0-yue2-reviewed-once" : "3.0.0-yue2-reviewed-loop";
  const sourceParams = selected.sourceParams;
  const base = [...source];
  const indexOfOne = (ids: readonly string[]) => {
    const indexes = base.flatMap((entry, index) => ids.includes(entry.block) ? [index] : []);
    if (indexes.length !== 1) throw new Error(`YuE2 selection requires exactly one ${ids.join(" or ")} owner`);
    return indexes[0];
  };
  const quizYearIndexes = base.flatMap((entry, index) => entry.block === "quiz_year" ? [index] : []);
  if (quizYearIndexes.length > 1) throw new Error("YuE2 selection requires at most one QuizYear mux owner");
  const quizYearIndex = quizYearIndexes[0] ?? -1;
  const hasGenericAssembly = base.some(entry => ["assemble", "timeline_assemble"].includes(entry.block));
  if (quizYearIndex >= 0 && hasGenericAssembly) throw new Error("QuizYear cannot share music ownership with a generic assembler");
  const usesQuizYearMux = quizYearIndex >= 0;
  const composerIndexes = base.flatMap((entry, index) => entry.block === "composer_brief" ? [index] : []);
  if (composerIndexes.length > 1) throw new Error("YuE2 selection requires at most one composer brief owner");
  if (usesQuizYearMux && composerIndexes.length) throw new Error("QuizYear's no-Gemini route cannot use a model-backed composer");
  if (!usesQuizYearMux && composerIndexes.length === 0) base.splice(indexOfOne(["music"]), 0, { block: "composer_brief" });
  const composerIndex = usesQuizYearMux ? -1 : indexOfOne(["composer_brief"]);
  const musicIndex = indexOfOne(["music"]);
  const assemblyIndex = usesQuizYearMux ? quizYearIndex : indexOfOne(["assemble", "timeline_assemble"]);
  const priorIntent = composerIndex >= 0 ? base[composerIndex].params?.musicIntent : undefined;
  if (priorIntent !== undefined && canonicalJson(priorIntent) !== canonicalJson(selected.musicIntent)) {
    throw new Error("YuE2 selection conflicts with the composer's explicit music intent");
  }
  if (usesQuizYearMux) {
    const direction = base[musicIndex]?.params?.prompt;
    if (selected.musicIntent.playback !== "repeat" || typeof direction !== "string" || direction.trim().length < 8) {
      throw new Error("QuizYear Engine music requires repeat intent and its family-owned instrumental direction");
    }
    if (!(musicIndex < assemblyIndex)) throw new Error("QuizYear music source must precede its final mux consumer");
  } else if (!(composerIndex < musicIndex && musicIndex < assemblyIndex)) {
    throw new Error("YuE2 owners must be ordered composer, music, assembly");
  }
  if (selected.musicIntent.playback === "once" && source[assemblyIndex].block !== "timeline_assemble") {
    throw new Error("Play-once music requires the narrated timeline consumer, not loop assembly");
  }
  const versions = new Map<number, string>([[musicIndex, musicVersion]]);
  if (composerIndex >= 0) versions.set(composerIndex, composerVersion);
  if (!usesQuizYearMux) versions.set(assemblyIndex, assemblyVersion);
  if (base.some(entry => ["scene_planner", "keyframes", "loop_clips"].includes(entry.block))) {
    if (selected.musicIntent.playback !== "repeat" || selected.musicIntent.role !== "primary_music") {
      throw new Error("YuE2 loop visuals require repeat primary-music intent");
    }
    const programIndex = indexOfOne(["music_program_plan"]), sceneIndex = indexOfOne(["scene_planner"]);
    const keyframeIndex = indexOfOne(["keyframes"]), clipsIndex = indexOfOne(["loop_clips"]);
    if (!(programIndex < sceneIndex && sceneIndex < musicIndex && musicIndex < keyframeIndex && keyframeIndex < clipsIndex && clipsIndex < assemblyIndex)) {
      throw new Error("YuE2 loop ownership requires program, scene, source audition, keyframe, clips, assembly ordering");
    }
    const provider = base[programIndex].params?.provider;
    if (provider !== undefined && provider !== "yue2") throw new Error("YuE2 selection conflicts with the program's explicit provider");
    versions.set(programIndex, "2.1.0-yue2-frozen-identity");
    versions.set(sceneIndex, "3.0.0-bound-visual-plan");
    versions.set(keyframeIndex, "3.1.0-yue2-reviewed-motion");
    versions.set(clipsIndex, "2.1.0-yue2-reviewed-motion");
  }
  for (const [index, version] of versions) {
    const entry = base[index];
    if (entry.version !== undefined && entry.version !== version) {
      throw new Error(`YuE2 selection cannot replace explicitly pinned ${entry.block}@${entry.version}`);
    }
  }
  const plans = base.flatMap((entry, index) => ["music_arrangement_plan", "music_intent_arrangement"].includes(entry.block) ? [index] : []);
  if (plans.length > 1) throw new Error("YuE2 arrangement acceptance must appear exactly once");
  if (plans.length === 1) {
    const plan = base[plans[0]]!;
    const isQuizIntentPlan = usesQuizYearMux && plan.block === "music_intent_arrangement" &&
      canonicalJson(plan.params?.musicIntent) === canonicalJson(selected.musicIntent) &&
      plan.params?.direction === base[musicIndex]?.params?.prompt && plans[0] < musicIndex;
    const isComposerPlan = !usesQuizYearMux && plan.block === "music_arrangement_plan" && composerIndex < plans[0] && plans[0] < musicIndex;
    if (!isQuizIntentPlan && !isComposerPlan) {
      throw new Error("YuE2 arrangement acceptance must appear once between its declared owner and music");
    }
  }
  const pipeline = base.map((entry, index): PipelineEntry => {
    if (composerIndex >= 0 && index === composerIndex) return { ...entry, version: composerVersion,
      params: { ...entry.params, musicIntent: selected.musicIntent } };
    if (index === musicIndex) return { block: "music", version: musicVersion, params: sourceParams };
    if (index === assemblyIndex && !usesQuizYearMux) {
      if (entry.params?.useAssemblyEdl === true ||
        (selected.musicIntent.playback === "once" && entry.params?.sourceCrossfadeSec !== undefined && entry.params.sourceCrossfadeSec !== 0)) {
        throw new Error("YuE2 selection conflicts with assembly EDL or play-once crossfade settings");
      }
      return { ...entry, version: assemblyVersion, params: { ...entry.params,
        ...(selected.musicIntent.playback === "once" ? { sourceCrossfadeSec: 0 } : {}) } };
    }
    return { ...entry, ...(versions.has(index) ? { version: versions.get(index)! } : {}),
      ...(entry.params ? { params: { ...entry.params } } : {}) };
  });
  if (plans.length === 1 && usesQuizYearMux) {
    pipeline[plans[0]!] = { ...pipeline[plans[0]!]!, version: "1.0.0-yue2-intent" };
  } else if (!plans.length) {
    if (usesQuizYearMux) {
      const direction = base[musicIndex]!.params!.prompt as string;
      pipeline.splice(musicIndex, 0, { block: "music_intent_arrangement", version: "1.0.0-yue2-intent",
        params: { musicIntent: selected.musicIntent, direction } });
    } else {
      pipeline.splice(composerIndex + 1, 0, { block: "music_arrangement_plan" });
    }
  }
  return pipeline;
}

/** Resolve the projection against real executable contracts before freezing or spending. */
export function selectYuE2Pipeline(source: readonly PipelineEntry[], input: YuE2PipelineSelection): PipelineEntry[] {
  const selected = YuE2PipelineSelectionSchema.parse(input);
  const pipeline = projectYuE2Pipeline(source, selected);
  for (const entry of pipeline) {
    const manifest = getManifest(entry.block, entry.version);
    if (!manifest) throw new Error(`YuE2 executable unavailable: ${entry.block}@${entry.version ?? "default"}`);
    manifest.configSchema.parse(entry.params ?? {});
    if (manifest.consumes.musicUrl || manifest.consumes.musicKey) {
      throw new Error(`YuE2 private candidate has no compatible music handoff for ${entry.block}`);
    }
  }
  return pipeline;
}
