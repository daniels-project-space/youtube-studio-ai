import { channelInceptionContentSha256 } from "@/engine/channelInceptionPlan";

export interface VoiceCastingAuditionReceipt {
  version: "voice-casting-audition/v1";
  ownerId: string;
  channelId: string;
  voiceId: string;
  score: number;
  judgedAt: number;
  auditionedCount: number;
  shortlistFingerprint: string;
  verdictFingerprint: string;
}

export interface VoiceColdOpenReceipt {
  version: "voice-cold-open/v1";
  ownerId: string;
  channelId: string;
  voiceId: string;
  judgedAt: number;
  seed: number;
  textFingerprint: string;
  physicsFingerprint: string;
  verdictFingerprint: string;
  scores: {
    register: number;
    pace: number;
    performance: number;
    clean: number;
  };
}

/** A transparent provider-metadata pre-cast; it is not an audio audition. */
export interface VoiceProviderSelectionReceipt {
  version: "voice-provider-selection/v1";
  ownerId: string;
  channelId: string;
  provider: VoiceCastingProvider;
  voiceId: string;
  score: number;
  selectedAt: number;
  shortlistedCount: number;
  shortlistFingerprint: string;
  selectionFingerprint: string;
}

/**
 * Health evidence from a real provider-rendered cold open. It establishes a
 * usable take without pretending that FFmpeg can judge acting or timbre.
 */
export interface VoiceLocalColdOpenReceipt {
  version: "voice-local-cold-open/v1";
  ownerId: string;
  channelId: string;
  provider: VoiceCastingProvider;
  voiceId: string;
  measuredAt: number;
  textFingerprint: string;
  physicsFingerprint: string;
  audioFingerprint: string;
  durationSec: number;
  wordsPerSec: number;
  integratedLufs: number;
}

export type VoiceCastingProvider = "elevenlabs" | "qwen3";

export interface PersistedVoiceCasting {
  voiceId: string;
  score: number;
  at: number;
  auditionReceipt?: VoiceCastingAuditionReceipt;
  coldOpenReceipt?: VoiceColdOpenReceipt;
  providerSelectionReceipt?: VoiceProviderSelectionReceipt;
  localColdOpenReceipt?: VoiceLocalColdOpenReceipt;
}

function sha256(value: unknown): boolean {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function score(value: unknown): boolean {
  return Number.isFinite(value) && Number(value) >= 7 && Number(value) <= 10;
}

function current(value: unknown, now: number): boolean {
  return Number.isFinite(value) && Number(value) > 0 && Number(value) <= now + 5 * 60 * 1_000;
}

export function makeVoiceColdOpenReceipt(args: {
  ownerId: string;
  channelId: string;
  voiceId: string;
  judgedAt: number;
  seed: number;
  text: string;
  physics: unknown;
  verdict: {
    pass: boolean;
    register: number;
    pace: number;
    performance: number;
    clean: number;
    why: string;
  };
}): VoiceColdOpenReceipt {
  if (!args.verdict.pass) throw new Error("voice cold-open receipt requires a passing verdict");
  const receipt: VoiceColdOpenReceipt = {
    version: "voice-cold-open/v1",
    ownerId: args.ownerId,
    channelId: args.channelId,
    voiceId: args.voiceId,
    judgedAt: args.judgedAt,
    seed: args.seed,
    textFingerprint: channelInceptionContentSha256(args.text),
    physicsFingerprint: channelInceptionContentSha256(args.physics),
    verdictFingerprint: channelInceptionContentSha256(args.verdict),
    scores: {
      register: args.verdict.register,
      pace: args.verdict.pace,
      performance: args.verdict.performance,
      clean: args.verdict.clean,
    },
  };
  if (!validateVoiceColdOpenReceipt({
    receipt,
    ownerId: args.ownerId,
    channelId: args.channelId,
    voiceId: args.voiceId,
  })) {
    throw new Error("generated voice cold-open receipt is invalid");
  }
  return receipt;
}

export function makeVoiceCastingAuditionReceipt(args: {
  ownerId: string;
  channelId: string;
  voiceId: string;
  score: number;
  judgedAt: number;
  auditioned: Array<{ name: string; score: number; note: string }>;
  verdict: unknown;
}): VoiceCastingAuditionReceipt {
  if (args.auditioned.length < 1) {
    throw new Error("voice casting receipt requires at least one heard audition");
  }
  const receipt: VoiceCastingAuditionReceipt = {
    version: "voice-casting-audition/v1",
    ownerId: args.ownerId,
    channelId: args.channelId,
    voiceId: args.voiceId,
    score: args.score,
    judgedAt: args.judgedAt,
    auditionedCount: args.auditioned.length,
    shortlistFingerprint: channelInceptionContentSha256(args.auditioned),
    verdictFingerprint: channelInceptionContentSha256(args.verdict),
  };
  if (!validateVoiceCastingAuditionReceipt({
    cast: { voiceId: args.voiceId, score: args.score, at: args.judgedAt, auditionReceipt: receipt },
    ownerId: args.ownerId,
    channelId: args.channelId,
  })) {
    throw new Error("generated voice casting audition receipt is invalid");
  }
  return receipt;
}

export function makeVoiceProviderSelectionReceipt(args: {
  ownerId: string;
  channelId: string;
  voiceId: string;
  score: number;
  selectedAt: number;
  provider?: VoiceCastingProvider;
  shortlisted: unknown[];
  selection: unknown;
}): VoiceProviderSelectionReceipt {
  if (!args.shortlisted.length) throw new Error("voice provider selection requires at least one declared candidate");
  const receipt: VoiceProviderSelectionReceipt = {
    version: "voice-provider-selection/v1",
    ownerId: args.ownerId,
    channelId: args.channelId,
    provider: args.provider ?? "elevenlabs",
    voiceId: args.voiceId,
    score: args.score,
    selectedAt: args.selectedAt,
    shortlistedCount: args.shortlisted.length,
    shortlistFingerprint: channelInceptionContentSha256(args.shortlisted),
    selectionFingerprint: channelInceptionContentSha256(args.selection),
  };
  if (!validateVoiceProviderSelectionReceipt({
    cast: { voiceId: args.voiceId, score: args.score, at: args.selectedAt, providerSelectionReceipt: receipt },
    ownerId: args.ownerId,
    channelId: args.channelId,
  })) throw new Error("generated voice provider selection receipt is invalid");
  return receipt;
}

export function makeVoiceLocalColdOpenReceipt(args: {
  ownerId: string;
  channelId: string;
  voiceId: string;
  measuredAt: number;
  provider?: VoiceCastingProvider;
  text: string;
  physics: unknown;
  audioFingerprint: string;
  durationSec: number;
  wordsPerSec: number;
  integratedLufs: number;
}): VoiceLocalColdOpenReceipt {
  const receipt: VoiceLocalColdOpenReceipt = {
    version: "voice-local-cold-open/v1",
    ownerId: args.ownerId,
    channelId: args.channelId,
    provider: args.provider ?? "elevenlabs",
    voiceId: args.voiceId,
    measuredAt: args.measuredAt,
    textFingerprint: channelInceptionContentSha256(args.text),
    physicsFingerprint: channelInceptionContentSha256(args.physics),
    audioFingerprint: args.audioFingerprint,
    durationSec: args.durationSec,
    wordsPerSec: args.wordsPerSec,
    integratedLufs: args.integratedLufs,
  };
  if (!validateVoiceLocalColdOpenReceipt({
    receipt,
    ownerId: args.ownerId,
    channelId: args.channelId,
    voiceId: args.voiceId,
  })) throw new Error("generated local cold-open receipt is invalid");
  return receipt;
}

export function validateVoiceCastingAuditionReceipt(args: {
  cast: PersistedVoiceCasting | null | undefined;
  ownerId: string;
  channelId: string;
  now?: number;
}): args is { cast: PersistedVoiceCasting & { auditionReceipt: VoiceCastingAuditionReceipt }; ownerId: string; channelId: string; now?: number } {
  const cast = args.cast;
  const receipt = cast?.auditionReceipt;
  const now = args.now ?? Date.now();
  return Boolean(
    cast &&
    receipt &&
    receipt.version === "voice-casting-audition/v1" &&
    receipt.ownerId === args.ownerId &&
    receipt.channelId === args.channelId &&
    receipt.voiceId === cast.voiceId &&
    receipt.score === cast.score &&
    receipt.judgedAt === cast.at &&
    Number.isFinite(receipt.score) &&
    receipt.score >= 7 &&
    receipt.score <= 10 &&
    Number.isFinite(receipt.judgedAt) &&
    receipt.judgedAt > 0 &&
    receipt.judgedAt <= now + 5 * 60 * 1_000 &&
    Number.isInteger(receipt.auditionedCount) &&
    receipt.auditionedCount >= 1 &&
    /^[a-f0-9]{64}$/.test(receipt.shortlistFingerprint) &&
    /^[a-f0-9]{64}$/.test(receipt.verdictFingerprint)
  );
}

export function validateVoiceProviderSelectionReceipt(args: {
  cast: PersistedVoiceCasting | null | undefined;
  ownerId: string;
  channelId: string;
  now?: number;
}): args is { cast: PersistedVoiceCasting & { providerSelectionReceipt: VoiceProviderSelectionReceipt }; ownerId: string; channelId: string; now?: number } {
  const cast = args.cast;
  const receipt = cast?.providerSelectionReceipt;
  const now = args.now ?? Date.now();
  return Boolean(
    cast && receipt && receipt.version === "voice-provider-selection/v1" &&
    receipt.ownerId === args.ownerId && receipt.channelId === args.channelId &&
    (receipt.provider === "elevenlabs" || receipt.provider === "qwen3") && receipt.voiceId === cast.voiceId &&
    receipt.score === cast.score && receipt.selectedAt === cast.at &&
    score(receipt.score) && current(receipt.selectedAt, now) &&
    Number.isInteger(receipt.shortlistedCount) && receipt.shortlistedCount >= 1 &&
    sha256(receipt.shortlistFingerprint) && sha256(receipt.selectionFingerprint),
  );
}

export function validateVoiceColdOpenReceipt(args: {
  receipt: VoiceColdOpenReceipt | null | undefined;
  ownerId: string;
  channelId: string;
  voiceId: string;
  now?: number;
}): args is {
  receipt: VoiceColdOpenReceipt;
  ownerId: string;
  channelId: string;
  voiceId: string;
  now?: number;
} {
  const receipt = args.receipt;
  const now = args.now ?? Date.now();
  const scores = receipt?.scores;
  return Boolean(
    receipt &&
    receipt.version === "voice-cold-open/v1" &&
    receipt.ownerId === args.ownerId &&
    receipt.channelId === args.channelId &&
    receipt.voiceId === args.voiceId &&
    Number.isFinite(receipt.judgedAt) &&
    receipt.judgedAt > 0 &&
    receipt.judgedAt <= now + 5 * 60 * 1_000 &&
    Number.isInteger(receipt.seed) &&
    receipt.seed >= 0 &&
    /^[a-f0-9]{64}$/.test(receipt.textFingerprint) &&
    /^[a-f0-9]{64}$/.test(receipt.physicsFingerprint) &&
    /^[a-f0-9]{64}$/.test(receipt.verdictFingerprint) &&
    scores &&
    [scores.register, scores.pace, scores.performance, scores.clean].every(
      (score) => Number.isFinite(score) && score >= 7 && score <= 10,
    )
  );
}

export function validateVoiceLocalColdOpenReceipt(args: {
  receipt: VoiceLocalColdOpenReceipt | null | undefined;
  ownerId: string;
  channelId: string;
  voiceId: string;
  provider?: VoiceCastingProvider;
  now?: number;
}): args is { receipt: VoiceLocalColdOpenReceipt; ownerId: string; channelId: string; voiceId: string; now?: number } {
  const receipt = args.receipt;
  const now = args.now ?? Date.now();
  return Boolean(
    receipt && receipt.version === "voice-local-cold-open/v1" &&
    receipt.ownerId === args.ownerId && receipt.channelId === args.channelId &&
    (receipt.provider === "elevenlabs" || receipt.provider === "qwen3") &&
    (!args.provider || receipt.provider === args.provider) && receipt.voiceId === args.voiceId &&
    current(receipt.measuredAt, now) && sha256(receipt.textFingerprint) &&
    sha256(receipt.physicsFingerprint) && sha256(receipt.audioFingerprint) &&
    Number.isFinite(receipt.durationSec) && receipt.durationSec >= 2 && receipt.durationSec <= 60 &&
    Number.isFinite(receipt.wordsPerSec) && receipt.wordsPerSec >= 0.7 && receipt.wordsPerSec <= 4 &&
    Number.isFinite(receipt.integratedLufs) && receipt.integratedLufs >= -36 && receipt.integratedLufs <= -5,
  );
}

export function validateVoiceCastingReadinessReceipt(args: {
  cast: PersistedVoiceCasting | null | undefined;
  ownerId: string;
  channelId: string;
  now?: number;
}): args is {
  cast: PersistedVoiceCasting;
  ownerId: string;
  channelId: string;
  now?: number;
} {
  const legacy = validateVoiceCastingAuditionReceipt(args) && validateVoiceColdOpenReceipt({
    receipt: args.cast.coldOpenReceipt,
    ownerId: args.ownerId, channelId: args.channelId, voiceId: args.cast.voiceId, now: args.now,
  });
  const providerMetadata = validateVoiceProviderSelectionReceipt(args) && validateVoiceLocalColdOpenReceipt({
    receipt: args.cast.localColdOpenReceipt,
    ownerId: args.ownerId,
    channelId: args.channelId,
    voiceId: args.cast.voiceId,
    provider: args.cast.providerSelectionReceipt.provider,
    now: args.now,
  });
  return legacy || providerMetadata;
}

export function voiceCastingOutputFingerprint(cast: PersistedVoiceCasting): string {
  return channelInceptionContentSha256(cast);
}
