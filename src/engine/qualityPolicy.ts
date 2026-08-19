import { validateVoiceQualityEvidence } from "@/lib/voiceReadiness";

export type QualityProfile = "draft" | "production";

export interface ThumbnailGateVerdict {
  textOk: boolean;
  faceClear: boolean;
  punch: number;
  styleMatch: number;
  storyMatch: number;
  uiClean: boolean;
  reason: string;
}

export function qualityProfile(value: unknown): QualityProfile {
  return value === "draft" ? "draft" : "production";
}

export function thumbnailGatePassed(verdict: ThumbnailGateVerdict): boolean {
  return verdict.textOk &&
    verdict.faceClear &&
    verdict.punch >= 7 &&
    verdict.styleMatch >= 7 &&
    verdict.storyMatch >= 7 &&
    verdict.uiClean;
}

export function assertThumbnailGate(
  profile: QualityProfile,
  verdict: ThumbnailGateVerdict | null,
  source: string,
): void {
  if (profile === "draft") return;
  if (!verdict) {
    throw new Error(`thumbnail_gen: ${source} has no required production QA verdict`);
  }
  if (!thumbnailGatePassed(verdict)) {
    throw new Error(`thumbnail_gen: ${source} failed the production gate (${verdict.reason})`);
  }
}

export function assertThumbnailStrategy(profile: QualityProfile, strategy: string): void {
  if (
    profile === "production" &&
    (
      strategy === "playbook_belowbar" ||
      strategy === "title_card_fallback" ||
      strategy === "draft_preview_placeholder"
    )
  ) {
    throw new Error(`thumbnail_gen: strategy ${strategy} is draft-only`);
  }
}

export function assertVoiceGatePreconditions(args: {
  profile: QualityProfile;
  gateEnabled: boolean;
  judgeAvailable: boolean;
  /** A provider-free FFmpeg evidence gate may substitute for an unavailable remote audio judge. */
  localEvidenceGateAvailable?: boolean;
  channelId?: string;
  provider?: string;
  voiceId?: string;
  castScore?: number;
  castEvidence?: unknown;
  readinessStatus?: unknown;
  readinessReason?: unknown;
}): void {
  if (args.profile === "draft") return;
  if (!args.gateEnabled) {
    throw new Error("narration_tts: voiceGate cannot be disabled in production");
  }
  if (!args.judgeAvailable && !args.localEvidenceGateAvailable) {
    throw new Error("narration_tts: production voice QA requires the audio judge or the local narration-evidence gate");
  }
  if (!args.voiceId?.trim()) {
    throw new Error("narration_tts: production narration requires an explicitly cast voice");
  }
  if (args.readinessStatus === "recast_required") {
    const reason = typeof args.readinessReason === "string" && args.readinessReason.trim()
      ? ` (${args.readinessReason.slice(0, 180)})`
      : "";
    throw new Error(`narration_tts: voice recasting is required${reason}`);
  }
  if (!Number.isFinite(args.castScore) || (args.castScore ?? 0) < 7) {
    throw new Error("narration_tts: production narration requires a persisted audition score >= 7");
  }
  const evidence = validateVoiceQualityEvidence({
    evidence: args.castEvidence,
    channelId: args.channelId ?? "",
    provider: args.provider ?? "fish",
    voiceId: args.voiceId,
    castScore: args.castScore!,
  });
  if (!evidence.ok) {
    throw new Error(`narration_tts: production voice evidence rejected (${evidence.reason})`);
  }
}
