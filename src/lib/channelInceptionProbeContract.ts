import type { PipelineEntry } from "@/engine/types";
import type { StudioActionApprovalReceipt } from "@/lib/studioActionApprovalContract";

export const CHANNEL_INCEPTION_PROBE_CHECKPOINT_VERSION =
  "channel-inception-probe-checkpoint/v1" as const;
export const MAX_CHANNEL_INCEPTION_PROBE_ATTEMPTS = 2;
/** Absolute ceiling; each frozen context further narrows this by family. */
export const MAX_CHANNEL_INCEPTION_PROBE_COST_USD = 55;

export interface ChannelInceptionProbeInvocationContext {
  channelBudgetUsd: number;
  /**
   * Family-specific signed ceiling, fingerprinted with new child invocations.
   * Undefined is a legacy v1 envelope and remains bounded by the global cap.
   */
  probeMaximumCostUsd?: number;
  keyPrefix: string;
  seedStore: Record<string, unknown>;
  madeForKids: boolean;
}

export interface ChannelInceptionProbeInput {
  pipelineOverride: PipelineEntry[];
  moduleConfigOverride: Record<string, Record<string, unknown>>;
  invocationContext: ChannelInceptionProbeInvocationContext;
  productionFingerprint: string;
  overrideFingerprint: string;
}

export interface ChannelInceptionProbeAttemptCheckpoint {
  attempt: number;
  ownerId: string;
  channelId: string;
  runId: string;
  input: ChannelInceptionProbeInput;
  maximumCostUsd: number;
  approval: StudioActionApprovalReceipt;
  approvalFingerprint: string;
  dispatchEnvelopeFingerprint: string;
  terminalStatus?: "ok" | "failed" | "canceled";
  actualSpendUsd?: number;
  invocationSha256?: string;
}

export interface ChannelInceptionProbeAttemptReference {
  attempt: number;
  runId: string;
  maximumCostUsd: number;
  productionFingerprint: string;
  approvalFingerprint: string;
  dispatchEnvelopeFingerprint: string;
  terminalStatus?: "ok" | "failed" | "canceled";
  actualSpendUsd?: number;
  invocationSha256?: string;
}

export interface ChannelInceptionProbeSpendSummary {
  actualSpendUsd: number;
  committedSpendUsd: number;
  remainingAuthorityUsd: number;
  activeAttempt?: number;
}

function sha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

/** Crypto-free wire-shape guard safe to import from Convex mutations. */
export function assertChannelInceptionProbeEnvelopeStructure(
  envelope: ChannelInceptionProbeAttemptCheckpoint,
): void {
  if (
    !Number.isInteger(envelope.attempt) ||
    envelope.attempt < 1 ||
    envelope.attempt > MAX_CHANNEL_INCEPTION_PROBE_ATTEMPTS ||
    !envelope.ownerId?.trim() ||
    !envelope.channelId?.trim() ||
    !envelope.runId?.trim() ||
    !Number.isFinite(envelope.maximumCostUsd) ||
    envelope.maximumCostUsd <= 0 ||
    envelope.maximumCostUsd > MAX_CHANNEL_INCEPTION_PROBE_COST_USD ||
    !Array.isArray(envelope.input?.pipelineOverride) ||
    !envelope.input?.moduleConfigOverride ||
    !envelope.input?.invocationContext ||
    (envelope.input.invocationContext.probeMaximumCostUsd !== undefined &&
      (!Number.isFinite(envelope.input.invocationContext.probeMaximumCostUsd) ||
        envelope.input.invocationContext.probeMaximumCostUsd <= 0 ||
        envelope.input.invocationContext.probeMaximumCostUsd > MAX_CHANNEL_INCEPTION_PROBE_COST_USD ||
        envelope.maximumCostUsd > envelope.input.invocationContext.probeMaximumCostUsd)) ||
    !sha256(envelope.input.productionFingerprint) ||
    !sha256(envelope.input.overrideFingerprint) ||
    !sha256(envelope.approvalFingerprint) ||
    !sha256(envelope.dispatchEnvelopeFingerprint) ||
    envelope.approval?.action !== "channel-inception-probe"
  ) {
    throw new Error("probe dispatch envelope structure is invalid");
  }
}
