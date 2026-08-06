import type { PipelineEntry } from "@/engine/types";

export const VOICE_QUALITY_EVIDENCE_SCHEMA = "voice-quality-evidence/v1" as const;
export const LEGACY_CAST_TO_RUN_MAX_MS = 24 * 60 * 60 * 1000;

export type VoiceProvider = "elevenlabs" | "fish";

export interface VoiceQualityScores {
  register: number;
  pace: number;
  performance: number;
  clean: number;
}

interface VoiceEvidenceBase {
  schema: typeof VOICE_QUALITY_EVIDENCE_SCHEMA;
  channelId: string;
  provider: VoiceProvider;
  voiceId: string;
  castScore: number;
  castJudgedAt: number;
}

export interface VoicecraftAuditionEvidence extends VoiceEvidenceBase {
  source: "voicecraft-audition";
}

export interface HistoricalRealAudioEvidence extends VoiceEvidenceBase {
  source: "historical-real-audio";
  runId: string;
  narrationKey: string;
  narrationDurationSec: number;
  stageFinishedAt: number;
  gateLogAt: number;
  audioScores: VoiceQualityScores;
}

export type VoiceQualityEvidence =
  | VoicecraftAuditionEvidence
  | HistoricalRealAudioEvidence;

export interface VoiceCastingRecord {
  voiceId?: string;
  score?: number;
  at?: number;
}

export interface HistoricalVoiceRun {
  id: string;
  channelId: string;
  status: string;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

export interface HistoricalVoiceStage {
  block: string;
  status: string;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  outputs?: unknown;
}

export interface HistoricalVoiceLog {
  at?: number;
  message?: string;
}

export type VoiceEvidenceValidation =
  | { ok: true; evidence: VoiceQualityEvidence }
  | { ok: false; reason: string };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteScore(value: unknown): number | null {
  const score = Number(value);
  return Number.isFinite(score) && score >= 7 && score <= 10 ? score : null;
}

function finiteTimestamp(value: unknown): number | null {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

function scoresFrom(value: unknown): VoiceQualityScores | null {
  const source = record(value);
  if (!source) return null;
  const scores = {
    register: finiteScore(source["register"]),
    pace: finiteScore(source["pace"]),
    performance: finiteScore(source["performance"]),
    clean: finiteScore(source["clean"]),
  };
  if (Object.values(scores).some((score) => score === null)) return null;
  return scores as VoiceQualityScores;
}

/**
 * Validate the persisted proof before a production narration spends money.
 * The proof is bound to the selected provider, voice and exact audition score;
 * a legacy string such as "voicecraft-audition" is deliberately insufficient.
 */
export function validateVoiceQualityEvidence(args: {
  evidence: unknown;
  channelId: string;
  provider: string;
  voiceId: string;
  castScore: number;
}): VoiceEvidenceValidation {
  const value = record(args.evidence);
  if (!value || value["schema"] !== VOICE_QUALITY_EVIDENCE_SCHEMA) {
    return { ok: false, reason: "structured voice-quality evidence v1 is missing" };
  }
  if (value["source"] !== "voicecraft-audition" && value["source"] !== "historical-real-audio") {
    return { ok: false, reason: "voice-quality evidence source is not recognized" };
  }
  if (typeof value["channelId"] !== "string" || value["channelId"] !== args.channelId) {
    return { ok: false, reason: "voice-quality evidence does not match the current channel" };
  }
  if (value["provider"] !== "elevenlabs" && value["provider"] !== "fish") {
    return { ok: false, reason: "voice-quality evidence provider is invalid" };
  }
  if (value["provider"] !== args.provider) {
    return { ok: false, reason: "voice-quality evidence does not match the selected provider" };
  }
  if (typeof value["voiceId"] !== "string" || value["voiceId"] !== args.voiceId) {
    return { ok: false, reason: "voice-quality evidence does not match the selected voice" };
  }
  const evidenceScore = finiteScore(value["castScore"]);
  if (evidenceScore === null || evidenceScore !== args.castScore) {
    return { ok: false, reason: "voice-quality evidence does not match the persisted audition score" };
  }
  const castJudgedAt = finiteTimestamp(value["castJudgedAt"]);
  if (castJudgedAt === null) {
    return { ok: false, reason: "voice-quality evidence has no valid audition timestamp" };
  }

  if (value["source"] === "historical-real-audio") {
    const runId = typeof value["runId"] === "string" ? value["runId"] : "";
    const channelId = typeof value["channelId"] === "string" ? value["channelId"] : "";
    const narrationKey = typeof value["narrationKey"] === "string" ? value["narrationKey"] : "";
    const narrationDurationSec = Number(value["narrationDurationSec"]);
    const stageFinishedAt = finiteTimestamp(value["stageFinishedAt"]);
    const gateLogAt = finiteTimestamp(value["gateLogAt"]);
    const audioScores = scoresFrom(value["audioScores"]);
    if (!runId || !channelId || !narrationKey.includes(`/runs/${runId}/`)) {
      return { ok: false, reason: "historical voice evidence is not bound to an exact run asset" };
    }
    if (!Number.isFinite(narrationDurationSec) || narrationDurationSec < 10) {
      return { ok: false, reason: "historical voice evidence has no credible narration duration" };
    }
    if (!stageFinishedAt || !gateLogAt || gateLogAt > stageFinishedAt || castJudgedAt > gateLogAt) {
      return { ok: false, reason: "historical voice evidence timestamps are inconsistent" };
    }
    if (!audioScores) {
      return { ok: false, reason: "historical real-audio scores must all be >= 7" };
    }
  }

  return { ok: true, evidence: value as unknown as VoiceQualityEvidence };
}

export function makeVoicecraftAuditionEvidence(args: {
  channelId: string;
  provider: VoiceProvider;
  voiceId: string;
  castScore: number;
  castJudgedAt: number;
}): VoicecraftAuditionEvidence {
  const evidence: VoicecraftAuditionEvidence = {
    schema: VOICE_QUALITY_EVIDENCE_SCHEMA,
    source: "voicecraft-audition",
    channelId: args.channelId,
    provider: args.provider,
    voiceId: args.voiceId,
    castScore: args.castScore,
    castJudgedAt: args.castJudgedAt,
  };
  const validation = validateVoiceQualityEvidence({
    evidence,
    channelId: args.channelId,
    provider: args.provider,
    voiceId: args.voiceId,
    castScore: args.castScore,
  });
  if (!validation.ok) throw new Error(`invalid voicecraft audition evidence: ${validation.reason}`);
  return evidence;
}

const TAKE_SCORES = /voicecraft:\s*take judged\s*[—-]\s*register\s+([\d.]+)\s*[·|]\s*pace\s+([\d.]+)\s*[·|]\s*performance\s+([\d.]+)\s*[·|]\s*clean\s+([\d.]+)/i;
const PASS_SCORES = /narration_tts:\s*cold-open gate PASSED\s*\(register\s+([\d.]+)\s*\|\s*pace\s+([\d.]+)\s*\|\s*performance\s+([\d.]+)\s*\|\s*clean\s+([\d.]+)/i;

function scoresFromMatch(match: RegExpMatchArray | null): VoiceQualityScores | null {
  if (!match) return null;
  return scoresFrom({
    register: match[1],
    pace: match[2],
    performance: match[3],
    clean: match[4],
  });
}

function sameScores(left: VoiceQualityScores, right: VoiceQualityScores): boolean {
  return left.register === right.register &&
    left.pace === right.pace &&
    left.performance === right.performance &&
    left.clean === right.clean;
}

function qualifyingGateFromLogs(
  logs: HistoricalVoiceLog[],
  startedAt: number,
  finishedAt: number,
): { at: number; scores: VoiceQualityScores } | null {
  const window = logs
    .filter((log) => {
      const at = finiteTimestamp(log.at);
      return at !== null && at >= startedAt && at <= finishedAt;
    })
    .sort((a, b) => Number(a.at) - Number(b.at));

  let latest: { at: number; scores: VoiceQualityScores } | null = null;
  for (let i = 0; i < window.length; i += 1) {
    const passScores = scoresFromMatch((window[i].message ?? "").match(PASS_SCORES));
    if (!passScores) continue;
    const passAt = Number(window[i].at);
    const matchingJudge = window
      .slice(0, i)
      .reverse()
      .find((log) => {
        const judged = scoresFromMatch((log.message ?? "").match(TAKE_SCORES));
        return judged !== null && sameScores(judged, passScores) && passAt - Number(log.at) <= 5_000;
      });
    const completedAfter = window
      .slice(i + 1)
      .some((log) => /^narration_tts ok(?::|\s|\()/i.test(log.message ?? ""));
    if (matchingJudge && completedAfter) latest = { at: passAt, scores: passScores };
  }
  return latest;
}

/**
 * One-time legacy migration. It intentionally accepts only the narrow proof
 * chain the old deployment persisted: a >=7 Voicecraft cast, an exact matching
 * ElevenLabs voice, and an in-window judged real-audio PASS on a successful run.
 */
export function deriveHistoricalVoiceEvidence(args: {
  channelId: string;
  provider: string;
  selectedVoiceId?: string;
  cast?: VoiceCastingRecord;
  run: HistoricalVoiceRun;
  stage?: HistoricalVoiceStage;
  logs: HistoricalVoiceLog[];
}): VoiceEvidenceValidation {
  if (args.provider !== "elevenlabs") {
    return { ok: false, reason: "legacy migration supports only Voicecraft-cast ElevenLabs voices" };
  }
  const voiceId = args.selectedVoiceId?.trim();
  if (!voiceId || !args.cast?.voiceId || voiceId !== args.cast.voiceId) {
    return { ok: false, reason: "selected voice is not bound to the persisted Voicecraft cast" };
  }
  const castScore = finiteScore(args.cast.score);
  const castJudgedAt = finiteTimestamp(args.cast.at);
  if (castScore === null || castJudgedAt === null) {
    return { ok: false, reason: "persisted Voicecraft cast score/timestamp is missing or below 7" };
  }
  const runStartedAt = finiteTimestamp(args.run.startedAt);
  const runFinishedAt = finiteTimestamp(args.run.finishedAt);
  if (
    args.run.channelId !== args.channelId ||
    args.run.status !== "ok" ||
    Boolean(args.run.error) ||
    runStartedAt === null ||
    runFinishedAt === null
  ) {
    return { ok: false, reason: "historical run is not a clean completed run for this channel" };
  }
  if (runStartedAt < castJudgedAt || runStartedAt - castJudgedAt > LEGACY_CAST_TO_RUN_MAX_MS) {
    return { ok: false, reason: "historical run is not within 24 hours after the persisted cast" };
  }

  const stage = args.stage;
  const stageStartedAt = finiteTimestamp(stage?.startedAt);
  const stageFinishedAt = finiteTimestamp(stage?.finishedAt);
  const outputs = record(stage?.outputs);
  const narrationKey = typeof outputs?.["narrationKey"] === "string" ? outputs["narrationKey"] : "";
  const narrationDurationSec = Number(outputs?.["narrationDurationSec"]);
  if (
    stage?.block !== "narration_tts" ||
    stage.status !== "ok" ||
    Boolean(stage.error) ||
    stageStartedAt === null ||
    stageFinishedAt === null ||
    stageStartedAt < runStartedAt ||
    stageFinishedAt > runFinishedAt ||
    !narrationKey.includes(`/runs/${args.run.id}/`) ||
    !Number.isFinite(narrationDurationSec) ||
    narrationDurationSec < 10
  ) {
    return { ok: false, reason: "historical narration stage has no clean, exact real-audio artifact" };
  }
  const gate = qualifyingGateFromLogs(args.logs, stageStartedAt, stageFinishedAt);
  if (!gate) {
    return { ok: false, reason: "historical narration has no paired in-window real-audio judge and gate PASS" };
  }

  const evidence: HistoricalRealAudioEvidence = {
    schema: VOICE_QUALITY_EVIDENCE_SCHEMA,
    source: "historical-real-audio",
    provider: "elevenlabs",
    voiceId,
    castScore,
    castJudgedAt,
    channelId: args.channelId,
    runId: args.run.id,
    narrationKey,
    narrationDurationSec,
    stageFinishedAt,
    gateLogAt: gate.at,
    audioScores: gate.scores,
  };
  return validateVoiceQualityEvidence({
    evidence,
    channelId: args.channelId,
    provider: args.provider,
    voiceId,
    castScore,
  });
}

export function patchNarrationVoiceReadiness(args: {
  pipeline: PipelineEntry[];
  evidence?: VoiceQualityEvidence;
  reason?: string;
}): PipelineEntry[] {
  return args.pipeline.map((entry) => {
    if (entry.block !== "narration_tts") return entry;
    const params: Record<string, unknown> = { ...(entry.params ?? {}) };
    delete params["voiceCastScore"];
    delete params["voiceCastEvidence"];
    delete params["voiceReadinessReason"];
    if (args.evidence) {
      params["voiceCastScore"] = args.evidence.castScore;
      params["voiceCastEvidence"] = args.evidence;
      params["voiceReadinessStatus"] = "qualified";
    } else {
      params["voiceReadinessStatus"] = "recast_required";
      params["voiceReadinessReason"] = (args.reason ?? "no qualifying persisted voice evidence").slice(0, 300);
    }
    return { ...entry, params };
  });
}
