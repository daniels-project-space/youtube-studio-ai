import { parseChannelProgramRouteRunSeed } from "@/engine/channelProgramRoute";
import { canonicalJson } from "@/lib/canonicalJson";
import { assertPlanWeekPreparedScriptArgs } from "@/lib/planWeekPreparedScriptArgs";
import { assertPlanWeekPreparedScriptBinding, planWeekPreparationKey, planWeekPreparationManifestSha256,
  planWeekPreparedScriptKey, type PlanWeekPreparationManifest } from "@/lib/planWeekPreparation";
import { resolveScriptNarrationTiming, scriptNarrationTiming, weeklyScriptNarrationTiming } from "@/lib/narrationTimingPlan";
import { sha256Hex } from "@/lib/sha256";
import type { ScriptRequest } from "@/lib/scriptGen";

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`legacy script timing: invalid ${label}`);
  return value as Record<string, unknown>;
}

/** Reconstruct the legacy worker's exact request, then verify both durable witnesses. */
export function reconcileLegacyPreparedScriptTiming(args: { manifest: PlanWeekPreparationManifest; prepared: unknown; run: unknown; claim: unknown; runId: string }) {
  const { manifest } = args;
  const prepared = assertPlanWeekPreparedScriptBinding({ prepared: args.prepared, manifest });
  if (prepared.narrationTiming) return prepared.narrationTiming;
  const run = record(args.run, "task run");
  const output = record(run.output, "task output");
  if (run.id !== args.runId || run.taskIdentifier !== "plan-week-prepared-script" || run.status !== "COMPLETED" || run.isTest !== false ||
      output.ok !== true || output.reused !== false || output.scriptSha256 !== prepared.scriptSha256 ||
      output.sidecarKey !== planWeekPreparedScriptKey(manifest)) {
    throw new Error("legacy script timing: task run does not bind the original generated script");
  }
  const rawPayload = record(run.payload, "task payload");
  const payload = assertPlanWeekPreparedScriptArgs({ ...rawPayload, maxSeconds: rawPayload.maxSeconds ?? 240 });
  if (payload.ownerId !== manifest.ownerId || payload.channelId !== manifest.channelId || payload.channelSlug !== manifest.channelSlug ||
      payload.batchId !== manifest.batchId || payload.itemId !== manifest.itemId || payload.manifestKey !== planWeekPreparationKey(manifest) ||
      payload.manifestSha256 !== planWeekPreparationManifestSha256(manifest)) {
    throw new Error("legacy script timing: task payload does not match the frozen manifest");
  }
  const seed = manifest.execution.seedStore;
  const config = manifest.execution.moduleConfig.script_gen ?? {};
  const narrative = seed.styleDNA && typeof seed.styleDNA === "object" && !Array.isArray(seed.styleDNA)
    ? (seed.styleDNA as Record<string, unknown>).narrative : undefined;
  const request: ScriptRequest = {
    topic: manifest.plan.topic,
    channelName: typeof seed.channelName === "string" ? seed.channelName : undefined,
    persona: typeof seed.persona === "string" ? seed.persona : undefined,
    niche: typeof seed.niche === "string" ? seed.niche : undefined,
    style: payload.style ?? (typeof config.style === "string" ? config.style : undefined),
    qualityProfile: "production",
    language: payload.language ?? (typeof config.language === "string" ? config.language : undefined),
    maxSeconds: payload.maxSeconds,
    endWithSummary: config.endWithSummary === false ? false : true,
    sentenceGapSec: typeof config.sentenceGapSec === "number" ? config.sentenceGapSec : undefined,
    ttsSpeed: typeof config.ttsSpeed === "number" ? config.ttsSpeed : undefined,
    voiceTags: config.voiceTags === true, dataRich: config.dataRich === true,
    sourceAttributionRequired: config.sourceAttributionRequired === true,
    weeklyPreparationBrief: manifest.prompts.script,
    programRoute: seed.channelProgramRoute === undefined ? undefined : parseChannelProgramRouteRunSeed(seed.channelProgramRoute),
    narrative: narrative && typeof narrative === "object" && !Array.isArray(narrative) ? narrative as ScriptRequest["narrative"] : undefined,
    playbook: seed.scriptPlaybook as ScriptRequest["playbook"],
    openingDeviceIdx: [...manifest.requestKey].reduce((sum, char) => sum + char.charCodeAt(0), 0),
  };
  const claim = record(args.claim, "dispatch claim");
  if (claim.version !== "prepared-generation-dispatch/v1" || claim.stage !== "script" || claim.costUsd !== null ||
      claim.ownerId !== manifest.ownerId || claim.channelId !== manifest.channelId || claim.batchId !== manifest.batchId ||
      claim.itemId !== manifest.itemId || claim.manifestSha256 !== planWeekPreparationManifestSha256(manifest) ||
      claim.requestSha256 !== sha256Hex(canonicalJson({ payload, request }))) {
    throw new Error("legacy script timing: dispatch claim does not bind the original request");
  }
  const original = scriptNarrationTiming({ maxSeconds: request.maxSeconds, style: request.style });
  const frozen = weeklyScriptNarrationTiming(manifest.execution);
  const context = narrative && typeof narrative === "object" && !Array.isArray(narrative)
    ? narrative as { scriptStyle?: unknown; hookStyle?: unknown; pacing?: unknown; delivery?: unknown } : undefined;
  if (original.targetSeconds !== frozen.targetSeconds ||
      resolveScriptNarrationTiming(original, seed.niche, context).profile !== resolveScriptNarrationTiming(frozen, seed.niche, context).profile) {
    throw new Error("legacy script timing: original request conflicts with the frozen duration or quiet-listening profile");
  }
  return frozen;
}
