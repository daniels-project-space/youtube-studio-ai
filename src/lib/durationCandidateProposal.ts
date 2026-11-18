import { familyDurationContract, familyEpisodeLengthError, familyTimeScalingContract } from "@/engine/families";
import { DELIVERY_METADATA_VERSION } from "@/lib/metadataDelivery";
import type { PipelineEntry } from "@/engine/types";
import { moduleSurface } from "@/engine/moduleRegistry";
import { resolveKnobs } from "@/engine/customization";
import { durationCandidateFamily } from "@/lib/durationCandidateFamily";

export const durationCandidateRouteOwned: Record<string, string[]> = {
  topic_select: ["targetSeconds", "seriesTitle", "seriesCount"], director_brief: ["targetSeconds"], dp_brief: ["targetSeconds"], editor_brief: ["targetSeconds"], composer_brief: ["targetSeconds"], critic_spec: ["targetSeconds"], script_gen: ["maxSeconds"], length_check: ["minSeconds", "maxSeconds"], assemble: ["durationSec"], whiteboard_scribe: ["targetSeconds"], lore_short: ["targetSeconds"], motion_comic: ["targetSeconds", "panels"], quiz_year: ["targetSeconds"], short_strategy: ["targetSeconds"], documotion_short: ["targetSeconds"],
};
const durationKeys: Record<string, string[]> = {
  topic_select: ["targetSeconds"], director_brief: ["targetSeconds"], dp_brief: ["targetSeconds"], editor_brief: ["targetSeconds"], composer_brief: ["targetSeconds"], critic_spec: ["targetSeconds"], script_gen: ["maxSeconds"], length_check: ["minSeconds", "maxSeconds"], assemble: ["durationSec", "exactFinalDuration"], studio_reusable_media_resolve: ["targetTimelineSeconds"], metadata: ["targetDurationSec"], loop_clips: ["segmentCount", "clipDurationSec", "loopMode"], music: ["trackCount"], whiteboard_scribe: ["targetSeconds"], lore_short: ["targetSeconds"], motion_comic: ["targetSeconds", "panels"], quiz_year: ["targetSeconds"],
};
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

function reconcileOverrides(config: unknown, baseline: PipelineEntry[], pipeline: PipelineEntry[], transform: (entry: PipelineEntry) => PipelineEntry, changed: string[]) {
  if (config === undefined) return {};
  if (!isRecord(config)) throw new Error("Saved module overrides must be an object.");
  const candidate = { ...config };
  for (const [block, raw] of Object.entries(config)) {
    const entries = pipeline.filter(entry => entry.block === block);
    if (!entries.length && block !== "show-bible") continue;
    if (entries.length > 1) throw new Error(`Module overrides for repeated ${block} require manual review.`);
    if (!isRecord(raw)) throw new Error(`Module overrides for ${block} are invalid.`);
    if ((durationCandidateRouteOwned[block] ?? []).some(key => key in raw)) throw new Error(`Module overrides for ${block} contain route-owned settings.`);
    const { preset: rawPreset, ...overrides } = raw;
    if (rawPreset !== undefined && (typeof rawPreset !== "string" || !rawPreset.trim())) throw new Error(`Module overrides for ${block} have an invalid preset.`);
    const preset = typeof rawPreset === "string" ? rawPreset : undefined;
    const surface = moduleSurface(block);
    if (!surface) throw new Error(`Module overrides for ${block} have no supported configuration surface.`);
    const resolved = resolveKnobs(surface, preset, overrides as Parameters<typeof resolveKnobs>[2]);
    if (!resolved.ok) throw new Error(`Module overrides for ${block} are invalid: ${resolved.errors.join("; ")}`);
    const chosen = new Set([...(preset ? Object.keys(surface.presets[preset] ?? {}) : []), ...Object.keys(overrides)]);
    const index = baseline.findIndex(entry => entry.block === block);
    const effective = index < 0 ? undefined : transform({ ...baseline[index]!, params: { ...baseline[index]!.params, ...Object.fromEntries(Object.entries(resolved.values).filter(([key]) => chosen.has(key))) } });
    const nextConfig = { ...raw };
    for (const key of durationKeys[block] ?? []) {
      if (!chosen.has(key) || !effective || index < 0) continue;
      const target = effective.params?.[key];
      if (target === undefined) throw new Error(`Duration override for ${block}.${key} cannot be reconciled.`);
      if (pipeline[index]!.params?.[key] !== target) {
        pipeline[index] = { ...pipeline[index]!, params: { ...pipeline[index]!.params, [key]: target } };
        changed.push(`${block}.${key}: reconciled with effective module settings`);
      }
      if (resolved.values[key] !== target) {
        nextConfig[key] = target;
        changed.push(`${block}.${key}: module override ${String(resolved.values[key])}→${String(target)}`);
      }
    }
    const { preset: _preset, ...nextOverrides } = nextConfig;
    const checked = resolveKnobs(surface, preset, nextOverrides as Parameters<typeof resolveKnobs>[2]);
    if (!checked.ok) throw new Error(`Reconciled module overrides for ${block} are invalid: ${checked.errors.join("; ")}`);
    candidate[block] = nextConfig;
  }
  return candidate;
}

/** Authoritative proposal used by both preview and transactional candidate creation. */
export function durationCandidateProposal(channel: {
  family?: unknown; contentLane?: unknown; pipeline?: PipelineEntry[]; moduleConfig?: unknown;
}, requestedSeconds: number) {
  const family = durationCandidateFamily(channel);
  if (family !== "music_loop" && family !== "narrated_stock") throw new Error("Duration candidates are not yet supported for this format.");
  if (!Number.isSafeInteger(requestedSeconds) || requestedSeconds <= 0) throw new Error("Provide a positive whole number of seconds.");
  const durationError = familyEpisodeLengthError(family, requestedSeconds / 60);
  if (durationError) throw new Error(durationError);
  if (!Array.isArray(channel.pipeline) || !channel.pipeline.some(entry => entry.block === (family === "music_loop" ? "assemble" : "script_gen"))) throw new Error("The saved pipeline has no supported duration module.");
  const changed: string[] = [];
  const contract = familyDurationContract(family);
  const transform = (entry: PipelineEntry, changes: string[]): PipelineEntry => {
    const params: Record<string, unknown> = { ...(entry.params ?? {}) };
    const pin = (key: string, value: unknown) => {
      if (params[key] !== value) {
        changes.push(`${entry.block}.${key}: ${String(params[key] ?? "unset")}→${String(value)}`);
        params[key] = value;
      }
    };
    if (["topic_select", "director_brief", "dp_brief", "editor_brief", "composer_brief", "critic_spec", "whiteboard_scribe", "lore_short", "quiz_year"].includes(entry.block)) pin("targetSeconds", requestedSeconds);
    if (entry.block === "script_gen") pin("maxSeconds", requestedSeconds);
    if (entry.block === "length_check") {
      pin("minSeconds", contract.inputUnit === "fixed" ? contract.defaultSeconds : Math.max(contract.minimumSeconds, Math.round(requestedSeconds * 0.6)));
      pin("maxSeconds", contract.inputUnit === "fixed" ? contract.defaultSeconds : Math.min(contract.maximumSeconds, Math.round(requestedSeconds * 1.8)));
    }
    if (entry.block === "assemble" && family === "music_loop") { pin("durationSec", requestedSeconds); pin("exactFinalDuration", true); }
    if (entry.block === "studio_reusable_media_resolve") pin("targetTimelineSeconds", requestedSeconds);
    if (entry.block === "metadata" && entry.version === DELIVERY_METADATA_VERSION) pin("targetDurationSec", requestedSeconds);
    if (entry.block === "loop_clips" && family === "music_loop") {
      const scaling = familyTimeScalingContract("music_loop");
      if (scaling.method !== "stream_loop") throw new Error("music-loop family has no sealed stream-loop scaling contract");
      pin("segmentCount", scaling.sourceSegmentCount); pin("clipDurationSec", scaling.sourceSegmentSeconds); pin("loopMode", scaling.loopMode);
    }
    if (entry.block === "music" && family === "music_loop") {
      const want = Math.max(2, Math.min(8, Math.ceil(requestedSeconds / 420)));
      if (Number(params.trackCount ?? 0) > want) pin("trackCount", want);
    }
    if (entry.block === "motion_comic") { pin("targetSeconds", requestedSeconds); pin("panels", Math.max(4, Math.min(12, Math.round(requestedSeconds / 22)))); }
    return { ...entry, params: Object.keys(params).length ? params : undefined };
  };
  const pipeline = channel.pipeline.map(entry => transform(entry, changed));
  const moduleConfig = reconcileOverrides(channel.moduleConfig, channel.pipeline, pipeline, entry => transform(entry, []), changed);
  const proposal = { pipeline, moduleConfig, changed };
  if (!proposal.changed.length) throw new Error("The requested duration produces no pipeline change.");
  return proposal;
}
