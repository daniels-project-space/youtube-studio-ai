/**
 * Audit every stored narration pipeline and, when explicitly requested, persist
 * a fail-closed readiness marker. No TTS/model/provider calls are made.
 *
 * Default is read-only:
 *   npx tsx scripts/migrate-voice-readiness.ts
 *
 * Apply only the evidence-backed migration/markers. Active channels that need
 * recasting are paused so the scheduler cannot repeatedly spend on runs that
 * the production gate will reject:
 *   npx tsx scripts/migrate-voice-readiness.ts --apply
 */
import { loadEnvConfig } from "@next/env";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { registerAllBlocks } from "@/engine/blocks";
import type { PipelineEntry } from "@/engine/types";
import { validatePipeline } from "@/engine/validate";
import {
  deriveHistoricalVoiceEvidence,
  patchNarrationVoiceReadiness,
  validateVoiceQualityEvidence,
  type HistoricalVoiceLog,
  type HistoricalVoiceRun,
  type HistoricalVoiceStage,
  type VoiceCastingRecord,
  type VoiceQualityEvidence,
} from "@/lib/voiceReadiness";

loadEnvConfig(process.cwd());

const APPLY = process.argv.includes("--apply");
const OWNER = process.env.NEXT_PUBLIC_OWNER_ID ?? "owner_daniel";

interface AuditChannel {
  _id: Id<"channels">;
  name: string;
  status: string;
  identity?: {
    voiceId?: string;
    voiceCasting?: VoiceCastingRecord;
  };
  pipeline?: PipelineEntry[];
}

interface AuditResult {
  channel: AuditChannel;
  status: "already_qualified" | "migration_ready" | "recast_required";
  reason: string;
  evidence?: VoiceQualityEvidence;
}

function narrationConfig(channel: AuditChannel): {
  entry: PipelineEntry;
  provider: string;
  selectedVoiceId?: string;
} | null {
  const entry = channel.pipeline?.find((item) => item.block === "narration_tts");
  if (!entry) return null;
  const params = entry.params ?? {};
  const provider = typeof params["ttsProvider"] === "string" ? params["ttsProvider"] : "fish";
  const paramVoice = typeof params["voiceId"] === "string" ? params["voiceId"] : undefined;
  const elevenVoice = typeof params["elevenVoiceId"] === "string" ? params["elevenVoiceId"] : undefined;
  return {
    entry,
    provider,
    selectedVoiceId: provider === "elevenlabs"
      ? (elevenVoice ?? paramVoice ?? channel.identity?.voiceId)
      : (paramVoice ?? channel.identity?.voiceId),
  };
}

function recastPrecondition(channel: AuditChannel, provider: string, selectedVoiceId?: string): string | null {
  if (provider !== "elevenlabs") return "Fish/default voice has no persisted Voicecraft audition proof";
  if (!selectedVoiceId) return "no explicit selected voice";
  const cast = channel.identity?.voiceCasting;
  if (!cast?.voiceId || cast.voiceId !== selectedVoiceId) {
    return "selected voice does not match a persisted Voicecraft cast";
  }
  if (!Number.isFinite(cast.score) || Number(cast.score) < 7 || !Number.isFinite(cast.at) || Number(cast.at) <= 0) {
    return "persisted Voicecraft cast score/timestamp is missing or below 7";
  }
  return null;
}

async function auditChannel(convex: ConvexHttpClient, channel: AuditChannel): Promise<AuditResult | null> {
  const config = narrationConfig(channel);
  if (!config) return null;
  const params = config.entry.params ?? {};
  const castScore = Number(params["voiceCastScore"]);
  if (config.selectedVoiceId && Number.isFinite(castScore)) {
    const existing = validateVoiceQualityEvidence({
      evidence: params["voiceCastEvidence"],
      channelId: String(channel._id),
      provider: config.provider,
      voiceId: config.selectedVoiceId,
      castScore,
    });
    if (existing.ok) {
      return {
        channel,
        status: "already_qualified",
        reason: `${existing.evidence.source} evidence is valid`,
        evidence: existing.evidence,
      };
    }
  }

  const preconditionFailure = recastPrecondition(channel, config.provider, config.selectedVoiceId);
  if (preconditionFailure) {
    return { channel, status: "recast_required", reason: preconditionFailure };
  }

  const runs = (await convex.query(api.runs.listRunsByChannel, {
    channelId: channel._id,
    limit: 500,
  })) as Array<{
    _id: Id<"runs">;
    channelId: Id<"channels">;
    status: string;
    startedAt?: number;
    finishedAt?: number;
    error?: string;
  }>;
  const candidates = runs
    .filter((run) => run.status === "ok" && !run.error)
    .sort((left, right) => Number(right.startedAt ?? 0) - Number(left.startedAt ?? 0))
    .slice(0, 25);

  let lastReason = "no clean completed run exists after the persisted cast";
  for (const run of candidates) {
    const [stages, logs] = await Promise.all([
      convex.query(api.runStages.listRunStages, { runId: run._id }),
      convex.query(api.runLogs.listRunLogs, { runId: run._id, limit: 5_000 }),
    ]);
    const stage = (stages as HistoricalVoiceStage[]).find((item) => item.block === "narration_tts");
    const derived = deriveHistoricalVoiceEvidence({
      channelId: String(channel._id),
      provider: config.provider,
      selectedVoiceId: config.selectedVoiceId,
      cast: channel.identity?.voiceCasting,
      run: {
        id: String(run._id),
        channelId: String(run.channelId),
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        error: run.error,
      } satisfies HistoricalVoiceRun,
      stage,
      logs: logs as HistoricalVoiceLog[],
    });
    if (derived.ok) {
      return {
        channel,
        status: "migration_ready",
        reason: `qualified by judged real audio from run ${run._id}`,
        evidence: derived.evidence,
      };
    }
    lastReason = derived.reason;
  }
  return { channel, status: "recast_required", reason: lastReason };
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is required");
  registerAllBlocks();
  const convex = new ConvexHttpClient(url);
  const channels = (await convex.query(api.channels.listChannels, {
    ownerId: OWNER,
  })) as AuditChannel[];

  const results: AuditResult[] = [];
  for (const channel of channels) {
    const result = await auditChannel(convex, channel);
    if (result) results.push(result);
  }

  for (const result of results) {
    const symbol = result.status === "recast_required" ? "!" : result.status === "migration_ready" ? "~" : "=";
    const pause = result.status === "recast_required" && result.channel.status === "active"
      ? `; ${APPLY ? "paused" : "would pause"}`
      : "";
    console.log(`${symbol} ${result.channel.name} [${result.channel.status}] — ${result.status}: ${result.reason}${pause}`);
  }

  if (APPLY) {
    for (const result of results) {
      const pipeline = patchNarrationVoiceReadiness({
        pipeline: result.channel.pipeline ?? [],
        evidence: result.evidence,
        reason: result.status === "recast_required" ? result.reason : undefined,
      });
      validatePipeline(pipeline);
      await convex.mutation(api.channels.updateChannel, {
        channelId: result.channel._id,
        pipeline,
        ...(result.status === "recast_required" && result.channel.status === "active"
          ? { status: "paused" }
          : {}),
      });
    }
    const after = (await convex.query(api.channels.listChannels, { ownerId: OWNER })) as AuditChannel[];
    for (const result of results) {
      const updated = after.find((channel) => channel._id === result.channel._id);
      const status = narrationConfig(updated ?? result.channel)?.entry.params?.["voiceReadinessStatus"];
      const expected = result.evidence ? "qualified" : "recast_required";
      if (status !== expected) throw new Error(`verification failed for ${result.channel.name}`);
      if (
        result.status === "recast_required" &&
        result.channel.status === "active" &&
        updated?.status !== "paused"
      ) {
        throw new Error(`pause verification failed for ${result.channel.name}`);
      }
    }
  }

  const qualified = results.filter((result) => result.status !== "recast_required").length;
  const recast = results.length - qualified;
  console.log(`\n${APPLY ? "APPLIED + VERIFIED" : "READ-ONLY"}: ${qualified} qualified, ${recast} recast required, ${channels.length - results.length} non-narrated.`);
}

main().catch((error) => {
  console.error("VOICE READINESS MIGRATION FAILED:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
