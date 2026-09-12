/**
 * One-shot, globally idempotent replay of an owner-approved Music3 audition.
 * The payload transports only immutable identifiers; the server reloads and
 * verifies the native audio, quality receipt, and music-stage binding itself.
 */
export const MUSIC_AUDITION_RESUME_SCHEDULE_VERSION = "music-audition-resume-schedule/v1" as const;

export interface MusicAuditionResumePayload {
  readonly channelId: string;
  readonly runId: string;
  readonly invocationSha256: string;
  readonly musicAuditionResume: {
    readonly checkpointId: string;
    readonly checkpointFingerprint: string;
    readonly qualityReceiptFingerprint: string;
    readonly approvalFingerprint: string;
    readonly invocationSha256: string;
  };
}

function required(value: unknown, label: string, max = 500): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) {
    throw new Error(`music audition resume ${label} is invalid`);
  }
  return value;
}

function fingerprint(value: unknown, label: string): string {
  const output = required(value, label, 80);
  if (!/^[a-f0-9]{64}$/.test(output)) throw new Error(`music audition resume ${label} must be sha256`);
  return output;
}

export function musicAuditionResumeSchedule(
  input: MusicAuditionResumePayload,
  options?: { readonly deliveryAttempt?: number },
): { readonly concurrencyKey: string; readonly idempotencySeed: string; readonly payload: MusicAuditionResumePayload } {
  const channelId = required(input.channelId, "channel id");
  const runId = required(input.runId, "run id");
  const invocationSha256 = fingerprint(input.invocationSha256, "invocation fingerprint");
  const checkpointId = required(input.musicAuditionResume.checkpointId, "checkpoint id");
  const checkpointFingerprint = fingerprint(input.musicAuditionResume.checkpointFingerprint, "checkpoint fingerprint");
  const qualityReceiptFingerprint = fingerprint(input.musicAuditionResume.qualityReceiptFingerprint, "quality receipt fingerprint");
  const approvalFingerprint = fingerprint(input.musicAuditionResume.approvalFingerprint, "approval fingerprint");
  if (fingerprint(input.musicAuditionResume.invocationSha256, "nested invocation fingerprint") !== invocationSha256) {
    throw new Error("music audition resume invocation fingerprints do not match");
  }
  const deliveryAttempt = options?.deliveryAttempt ?? 1;
  if (!Number.isSafeInteger(deliveryAttempt) || deliveryAttempt < 1 || deliveryAttempt > 100) {
    throw new Error("music audition resume delivery attempt is invalid");
  }
  const receiptSeed = [
    MUSIC_AUDITION_RESUME_SCHEDULE_VERSION, runId, checkpointId, checkpointFingerprint,
    qualityReceiptFingerprint, approvalFingerprint, invocationSha256,
  ].join(":");
  return {
    concurrencyKey: channelId,
    idempotencySeed: deliveryAttempt === 1 ? receiptSeed : `${receiptSeed}:delivery:${deliveryAttempt}`,
    payload: input,
  };
}
