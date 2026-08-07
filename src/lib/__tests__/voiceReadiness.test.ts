import assert from "node:assert/strict";
import {
  deriveHistoricalVoiceEvidence,
  LEGACY_CAST_TO_RUN_MAX_MS,
  makeVoicecraftAuditionEvidence,
  patchNarrationVoiceReadiness,
  validateVoiceQualityEvidence,
  type HistoricalVoiceLog,
  type HistoricalVoiceRun,
  type HistoricalVoiceStage,
} from "@/lib/voiceReadiness";

const channelId = "channel_real_1";
const runId = "run_real_1";
const voiceId = "voice_exact_1";
const castJudgedAt = 1_780_000_000_000;

const run: HistoricalVoiceRun = {
  id: runId,
  channelId,
  status: "ok",
  startedAt: castJudgedAt + 60_000,
  finishedAt: castJudgedAt + 180_000,
};
const stage: HistoricalVoiceStage = {
  block: "narration_tts",
  status: "ok",
  startedAt: castJudgedAt + 70_000,
  finishedAt: castJudgedAt + 150_000,
  outputs: {
    narrationKey: `owner/test/channel/test/runs/${runId}/narration.mp3`,
    narrationDurationSec: 226.3,
  },
};
const logs: HistoricalVoiceLog[] = [
  {
    at: castJudgedAt + 80_000,
    message: "voicecraft: take judged — register 8 · pace 8 · performance 8 · clean 9",
  },
  {
    at: castJudgedAt + 80_001,
    message: "narration_tts: cold-open gate PASSED (register 8 | pace 8 | performance 8 | clean 9, seed 4242)",
  },
  {
    at: castJudgedAt + 100_000,
    message: "narration_tts ok: 226.3s, 27 sentences",
  },
];

function derive(overrides: Partial<Parameters<typeof deriveHistoricalVoiceEvidence>[0]> = {}) {
  return deriveHistoricalVoiceEvidence({
    channelId,
    provider: "elevenlabs",
    selectedVoiceId: voiceId,
    cast: { voiceId, score: 9, at: castJudgedAt },
    run,
    stage,
    logs,
    ...overrides,
  });
}

function main(): void {
  const qualified = derive();
  if (!qualified.ok) throw new Error(`expected qualifying fixture: ${qualified.reason}`);
  assert.equal(qualified.ok, true, "exact persisted cast + real-audio proof should qualify");
  assert.equal(qualified.evidence.source, "historical-real-audio");
  assert.equal(qualified.evidence.voiceId, voiceId);
  assert.equal(qualified.evidence.castScore, 9);
  if (qualified.evidence.source !== "historical-real-audio") throw new Error("unexpected evidence source");
  assert.deepEqual(qualified.evidence.audioScores, {
    register: 8,
    pace: 8,
    performance: 8,
    clean: 9,
  });

  assert.equal(derive({ selectedVoiceId: "other" }).ok, false, "voice mismatch must fail closed");
  assert.equal(derive({ provider: "fish" }).ok, false, "legacy Fish runs have no Voicecraft binding");
  assert.equal(
    derive({ run: { ...run, startedAt: castJudgedAt + LEGACY_CAST_TO_RUN_MAX_MS + 1 } }).ok,
    false,
    "an unversioned legacy channel cannot bind a much later run to its cast",
  );
  assert.equal(
    derive({ stage: { ...stage, error: "stale provider failure" } }).ok,
    false,
    "an ok row carrying an error is not clean evidence",
  );
  assert.equal(
    derive({ logs: logs.filter((log) => !log.message?.includes("take judged")) }).ok,
    false,
    "a PASS log without its real-audio judge log is insufficient",
  );
  assert.equal(
    derive({
      logs: logs.map((log) => ({
        ...log,
        message: log.message?.replace("performance 8", "performance 6"),
      })),
    }).ok,
    false,
    "every judged dimension must clear 7",
  );
  assert.equal(
    derive({ logs: logs.map((log) => ({ ...log, at: Number(stage.finishedAt) + 1 })) }).ok,
    false,
    "logs outside the persisted stage window cannot qualify",
  );

  const exactValidation = validateVoiceQualityEvidence({
    evidence: qualified.evidence,
    channelId,
    provider: "elevenlabs",
    voiceId,
    castScore: 9,
  });
  assert.equal(exactValidation.ok, true);
  assert.equal(validateVoiceQualityEvidence({
    evidence: { ...qualified.evidence, voiceId: "tampered" },
    channelId,
    provider: "elevenlabs",
    voiceId,
    castScore: 9,
  }).ok, false);
  assert.equal(validateVoiceQualityEvidence({
    evidence: { ...qualified.evidence, narrationKey: "unbound.mp3" },
    channelId,
    provider: "elevenlabs",
    voiceId,
    castScore: 9,
  }).ok, false);
  assert.equal(validateVoiceQualityEvidence({
    evidence: qualified.evidence,
    channelId: "different-channel",
    provider: "elevenlabs",
    voiceId,
    castScore: 9,
  }).ok, false, "evidence cannot be copied between channels");

  const audition = makeVoicecraftAuditionEvidence({
    channelId,
    provider: "elevenlabs",
    voiceId,
    castScore: 7,
    castJudgedAt,
  });
  assert.equal(validateVoiceQualityEvidence({
    evidence: audition,
    channelId,
    provider: "elevenlabs",
    voiceId,
    castScore: 7,
  }).ok, true);

  const pipeline = [{
    block: "narration_tts",
    params: { voiceCastScore: 10, voiceCastEvidence: "legacy-string", qualityProfile: "production" },
  }];
  const marked = patchNarrationVoiceReadiness({ pipeline, reason: "audition required" });
  assert.equal(marked[0].params?.["voiceReadinessStatus"], "recast_required");
  assert.equal(marked[0].params?.["voiceCastScore"], undefined, "invalid stale score must be removed");
  assert.equal(marked[0].params?.["voiceCastEvidence"], undefined, "invalid stale proof must be removed");
  const migrated = patchNarrationVoiceReadiness({ pipeline, evidence: qualified.evidence });
  assert.equal(migrated[0].params?.["voiceReadinessStatus"], "qualified");
  assert.equal(migrated[0].params?.["voiceCastScore"], 9);

  console.log("VOICE READINESS TESTS PASS");
}

main();
