import { isQuietListeningNarration, quietListeningRestBudgetSec } from "@/lib/narrationPerformance";
import type { PipelineEntry } from "@/engine/types";
import { resolvePipelineModuleConfig } from "@/engine/runtimeModuleConfig";

export type ScriptNarrationTiming = {
  version: "script-narration-timing/v1";
  targetSeconds: number;
  style: string | null;
  genre: string | null;
};

const sentenceSegmenter = new Intl.Segmenter("und", { granularity: "sentence" });

export function splitNarrationSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  return Array.from(sentenceSegmenter.segment(normalized), item => item.segment.trim()).filter(Boolean);
}

export function scriptNarrationTiming(params: Readonly<Record<string, unknown>>): ScriptNarrationTiming {
  const targetSeconds = params.maxSeconds ?? 240;
  if (typeof targetSeconds !== "number" || !Number.isFinite(targetSeconds) || targetSeconds <= 0) {
    throw new Error("script timing requires a finite positive target duration");
  }
  const hint = (key: "style" | "genre") => {
    const value = params[key];
    if (value === undefined || value === null) return null;
    if (typeof value !== "string") throw new Error(`script timing ${key} must be text`);
    return value;
  };
  return { version: "script-narration-timing/v1", targetSeconds, style: hint("style"), genre: hint("genre") };
}

export function bindScriptNarrationTiming(entries: readonly PipelineEntry[]): PipelineEntry[] {
  const scripts = entries.filter(entry => entry.block === "script_gen");
  if (scripts.length > 1) throw new Error("script timing requires a unique script_gen module");
  if (!scripts.length) return [...entries];
  const timing = scriptNarrationTiming(scripts[0].params ?? {});
  return entries.map(entry => entry.block === "narration_tts"
    ? { ...entry, params: { ...entry.params, scriptNarrationTiming: timing } }
    : entry);
}

export function narrationParamsFromFrozenPipeline(args: {
  params: Record<string, unknown>;
  entries: readonly PipelineEntry[];
  paramsByBlock?: Readonly<Record<string, Record<string, unknown>>>;
  preparedScriptPresent: boolean;
}): Record<string, unknown> {
  const scripts = args.entries.filter(entry => entry.block === "script_gen");
  if (scripts.length > 1) throw new Error("script timing requires a unique script_gen module");
  if (!scripts.length) return args.params;
  const timing = scriptNarrationTiming(args.paramsByBlock?.script_gen ?? scripts[0].params ?? {});
  if (args.params.scriptNarrationTiming !== undefined) {
    const actual = resolveScriptNarrationTiming(args.params.scriptNarrationTiming, undefined, undefined).timing;
    if (actual.targetSeconds !== timing.targetSeconds || actual.style !== timing.style || actual.genre !== timing.genre) {
      throw new Error("narration timing differs from the frozen script parameters");
    }
  }
  return { ...args.params, scriptNarrationTiming: timing,
    ...(args.preparedScriptPresent ? { preparedScriptRequiresTimingProof: true } : {}) };
}

export function weeklyTimingPipeline(execution: { pipeline: unknown[]; moduleConfig: Record<string, Record<string, unknown>> }): readonly PipelineEntry[] {
  if (!execution.pipeline.every(entry => entry && typeof entry === "object" && !Array.isArray(entry) && typeof (entry as { block?: unknown }).block === "string")) {
    throw new Error("weekly script timing pipeline is invalid");
  }
  return resolvePipelineModuleConfig({ entries: execution.pipeline as PipelineEntry[], moduleConfig: execution.moduleConfig }).effectivePipeline;
}

export function weeklyScriptParams(execution: { pipeline: unknown[]; moduleConfig: Record<string, Record<string, unknown>> }): Record<string, unknown> {
  const entries = weeklyTimingPipeline(execution);
  const scripts = entries.filter(entry => entry.block === "script_gen");
  if (scripts.length !== 1) throw new Error("weekly script timing requires a unique script_gen module");
  return scripts[0].params ?? {};
}

export function weeklyScriptNarrationTiming(execution: { pipeline: unknown[]; moduleConfig: Record<string, Record<string, unknown>> }): ScriptNarrationTiming {
  return scriptNarrationTiming(weeklyScriptParams(execution));
}

export function resolveScriptNarrationTiming(value: unknown, niche: unknown, narrative: {
  scriptStyle?: unknown; hookStyle?: unknown; pacing?: unknown; delivery?: unknown;
} | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("script narration timing is missing");
  const raw = value as Record<string, unknown>;
  if (raw.version !== "script-narration-timing/v1" || typeof raw.targetSeconds !== "number" ||
      !("style" in raw) || !("genre" in raw)) throw new Error("script narration timing is invalid");
  const timing = scriptNarrationTiming({ maxSeconds: raw.targetSeconds, style: raw.style, genre: raw.genre });
  const quiet = isQuietListeningNarration(niche, timing.genre, timing.style,
    narrative?.scriptStyle, narrative?.hookStyle, narrative?.pacing, narrative?.delivery);
  return { timing, profile: quiet ? "quiet_listening" as const : "standard" as const,
    restBudgetSec: quiet ? quietListeningRestBudgetSec(timing.targetSeconds) : 0 };
}
