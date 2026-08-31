import type { PipelineEntry } from "@/engine/types";
import {
  channelInceptionProbeCostCeilingUsd,
} from "@/engine/channelInceptionContracts";
import type { FamilyKey } from "@/engine/families";
import { assertCanonicalChannelProgramBrief } from "@/engine/channelProgramBrief";
import {
  assertChannelProgramRouteBinding,
  channelProgramRouteRunSeed,
} from "@/engine/channelProgramRoute";
import {
  assessProductionEditorialAcceptance,
  QualityEvidenceSchema,
} from "@/engine/qualityEvidence";
import {
  pipelineOverrideFingerprint,
  pipelineProbeApprovalSubject,
  studioActionApprovalFingerprint,
  verifyStudioActionApproval,
  type StudioActionApprovalReceipt,
} from "@/lib/studioActionApproval";
import { channelPrefix } from "@/lib/storage";
import {
  MAX_CHANNEL_INCEPTION_PROBE_ATTEMPTS,
  MAX_CHANNEL_INCEPTION_PROBE_COST_USD,
  assertChannelInceptionProbeEnvelopeStructure,
  type ChannelInceptionProbeAttemptCheckpoint,
  type ChannelInceptionProbeAttemptReference,
  type ChannelInceptionProbeInput,
  type ChannelInceptionProbeInvocationContext,
  type ChannelInceptionProbeSpendSummary,
} from "@/lib/channelInceptionProbeContract";

export {
  CHANNEL_INCEPTION_PROBE_CHECKPOINT_VERSION,
  MAX_CHANNEL_INCEPTION_PROBE_ATTEMPTS,
  MAX_CHANNEL_INCEPTION_PROBE_COST_USD,
  type ChannelInceptionProbeAttemptCheckpoint,
  type ChannelInceptionProbeAttemptReference,
  type ChannelInceptionProbeInput,
  type ChannelInceptionProbeInvocationContext,
  type ChannelInceptionProbeSpendSummary,
} from "@/lib/channelInceptionProbeContract";

interface ProbeChannelIdentity {
  programBrief?: unknown;
  programRoute?: unknown;
  topicPool?: unknown[];
  styleGrammar?: string;
  palette?: string[];
  persona?: string;
  niche?: string;
  voiceId?: string;
  bannedWords?: string[];
  imageKey?: string;
}

interface ProbeChannelSnapshot {
  slug: string;
  name: string;
  budget?: number;
  thumbnailer?: string;
  identity?: ProbeChannelIdentity;
  schedule?: { madeForKids?: boolean };
  scriptPlaybook?: unknown;
  styleDNA?: unknown;
  qaRubric?: unknown;
  contentLane?: unknown;
}

function finiteUsd(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be finite and non-negative`);
  return Math.round(value * 1_000_000) / 1_000_000;
}

function validSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export const CHANNEL_INCEPTION_PROBE_QUALITY_VERSION =
  "channel-inception-probe-quality/v2" as const;

export interface ChannelInceptionProbeQualityEvidence {
  version: typeof CHANNEL_INCEPTION_PROBE_QUALITY_VERSION;
  status: "accepted" | "rejected";
  /** Fingerprint of the exact paid `qa_visual` output used for this decision. */
  qaEvidenceFingerprint: string;
  reasons: string[];
  videoScore?: number;
  thumbnailScore?: number;
  /**
   * Holistic reviewer verdict. Current `qa_visual` receipts store it at
   * `qaReport.visualReview`; `qaReport.watch` remains a legacy input only.
   */
  watchVerdict?: string;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function finiteScore(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Current `qa_visual` writes its authoritative chronological review under
 * `qaReport.visualReview`. Keep `watch` only for historical probe receipts,
 * and never let a malformed current receipt silently fall back to the old one.
 */
export function resolveChannelInceptionProbeHolisticReview(
  qaReport: unknown,
): Record<string, unknown> | undefined {
  const report = objectRecord(qaReport);
  if (!report) return undefined;
  if (Object.prototype.hasOwnProperty.call(report, "visualReview")) {
    return objectRecord(report.visualReview);
  }
  return objectRecord(report.watch);
}

/**
 * Turn the already-paid production `qa_visual` result into a fail-closed,
 * content-addressed readiness receipt. This deliberately does not call another
 * model: the child run's QA is inside the admitted probe budget and is the
 * authoritative golden-module review.
 */
export function assessChannelInceptionProbeQuality(
  qaOutputs: unknown,
): ChannelInceptionProbeQualityEvidence {
  const outputs = objectRecord(qaOutputs);
  const report = objectRecord(outputs?.qaReport);
  const structural = objectRecord(report?.structural);
  const lengthMatch = objectRecord(report?.lengthMatch);
  const video = objectRecord(report?.video);
  const thumbnail = objectRecord(report?.thumbnail);
  const holisticReview = resolveChannelInceptionProbeHolisticReview(report);
  const qualityEvidence = QualityEvidenceSchema.safeParse(outputs?.qualityEvidence);
  const videoScore = finiteScore(video?.score);
  const thumbnailScore = finiteScore(thumbnail?.score);
  const watchVerdict = typeof holisticReview?.verdict === "string"
    ? holisticReview.verdict
    : undefined;
  const reasons: string[] = [];

  if (outputs?.qaPassed !== true) reasons.push("qa_visual did not issue a passing receipt");
  if (!report) reasons.push("qa_visual report is missing");
  if (!qualityEvidence.success) {
    reasons.push("typed final quality evidence is missing or malformed");
  } else if (!qualityEvidence.data.release.hardGateReady) {
    reasons.push(
      `typed final quality evidence did not clear hard gates: ${qualityEvidence.data.release.blockers.join("; ")}`,
    );
  } else {
    // A held-out probe is the promotion proof for a new channel, so the
    // narrower raw hard-gate flag is not enough. Use the exact same lane-aware
    // editorial acceptance decision that protects draft upload.
    const editorialAcceptance = assessProductionEditorialAcceptance(qualityEvidence.data);
    if (!editorialAcceptance.ready) {
      reasons.push(
        `typed final quality evidence did not meet production editorial acceptance: ${editorialAcceptance.blockers.join("; ")}`,
      );
    }
  }
  if (structural?.ok !== true) reasons.push("structural render QA did not pass");
  if (lengthMatch?.ok !== true) reasons.push("render length QA did not pass");
  if (video?.skipped === true || videoScore === undefined) {
    reasons.push("required video grader evidence is missing");
  } else if (videoScore < 6) {
    reasons.push(`video quality score ${videoScore} is below the production minimum 6`);
  }
  if (thumbnail?.skipped === true || thumbnailScore === undefined) {
    reasons.push("required thumbnail grader evidence is missing");
  } else if (thumbnailScore < 5) {
    reasons.push(`thumbnail quality score ${thumbnailScore} is below the production minimum 5`);
  }
  if (holisticReview?.ran !== true || watchVerdict !== "pass") {
    reasons.push("holistic render review did not explicitly pass");
  }

  const defects = holisticReview?.defects;
  if (!Array.isArray(defects)) {
    reasons.push("holistic render defect evidence is missing");
  } else if (defects.some((candidate) => {
    const defect = objectRecord(candidate);
    return defect?.severity === "critical" || defect?.severity === "major";
  })) {
    reasons.push("holistic render review contains a major or critical defect");
  }

  if (report?.validation !== undefined) {
    if (!Array.isArray(report.validation)) {
      reasons.push("validation-spec evidence is malformed");
    } else if (report.validation.some((candidate) => {
      const result = objectRecord(candidate);
      return result?.severity === "block" && result?.skipped !== true && result?.passed !== true;
    })) {
      reasons.push("a blocking golden validation assertion failed");
    }
  }

  const qaEvidenceFingerprint = pipelineOverrideFingerprint({
    version: CHANNEL_INCEPTION_PROBE_QUALITY_VERSION,
    qaPassed: outputs?.qaPassed,
    qaReport: outputs?.qaReport,
    // The complete receipt is now promotion-critical. Bind it directly so a
    // changed editorial verdict cannot reuse an otherwise identical QA report.
    qualityEvidence: outputs?.qualityEvidence,
  });
  return {
    version: CHANNEL_INCEPTION_PROBE_QUALITY_VERSION,
    status: reasons.length ? "rejected" : "accepted",
    qaEvidenceFingerprint,
    reasons,
    ...(videoScore === undefined ? {} : { videoScore }),
    ...(thumbnailScore === undefined ? {} : { thumbnailScore }),
    ...(watchVerdict === undefined ? {} : { watchVerdict }),
  };
}

export function freezeChannelInceptionProbeContext(args: {
  ownerId: string;
  family: FamilyKey;
  channel: ProbeChannelSnapshot;
}): ChannelInceptionProbeInvocationContext {
  const identity = args.channel.identity ?? {};
  const programBrief = identity.programBrief === undefined
    ? undefined
    : assertCanonicalChannelProgramBrief(identity.programBrief);
  if (programBrief === undefined && identity.programRoute !== undefined) {
    throw new Error("channel inception probe route is present without a canonical program brief");
  }
  const programRoute = programBrief === undefined
    ? undefined
    : (() => {
        if (identity.programRoute === undefined) {
          throw new Error(
            "channel inception probe requires a sealed program route; historical route-less channels may only resume their existing frozen invocation",
          );
        }
        return assertChannelProgramRouteBinding({ route: identity.programRoute, programBrief });
      })();
  const seedStore: Record<string, unknown> = {
    ...(args.channel.thumbnailer ? { thumbnailer: args.channel.thumbnailer } : {}),
    topicPool: structuredClone(identity.topicPool ?? []),
    styleGrammar: identity.styleGrammar ?? "",
    channelName: args.channel.name,
    palette: structuredClone(identity.palette ?? []),
    persona: identity.persona ?? "",
    niche: identity.niche ?? "",
    ...(identity.voiceId ? { voiceId: identity.voiceId } : {}),
    bannedWords: structuredClone(identity.bannedWords ?? []),
    ...(identity.imageKey ? { channelAvatarKey: identity.imageKey } : {}),
    ...(args.channel.scriptPlaybook !== undefined
      ? { scriptPlaybook: structuredClone(args.channel.scriptPlaybook) }
      : {}),
    styleDNA: structuredClone(args.channel.styleDNA ?? null),
    qualityBar: structuredClone(args.channel.qaRubric ?? null),
    contentLane: structuredClone(args.channel.contentLane ?? null),
    ...(programRoute && programBrief
      ? { channelProgramRoute: channelProgramRouteRunSeed({ route: programRoute, programBrief }) }
      : {}),
  };
  return {
    channelBudgetUsd: finiteUsd(args.channel.budget ?? 0, "probe channel budget"),
    probeMaximumCostUsd: channelInceptionProbeCostCeilingUsd(args.family),
    keyPrefix: channelPrefix(args.ownerId, args.channel.slug),
    seedStore,
    madeForKids: args.channel.schedule?.madeForKids ?? false,
  };
}

export function freezeChannelInceptionProbeInput(args: {
  pipelineOverride: PipelineEntry[];
  moduleConfigOverride: Record<string, Record<string, unknown>>;
  invocationContext: ChannelInceptionProbeInvocationContext;
  productionFingerprint: string;
}): ChannelInceptionProbeInput {
  const frozen = {
    pipelineOverride: structuredClone(args.pipelineOverride),
    moduleConfigOverride: structuredClone(args.moduleConfigOverride),
    invocationContext: structuredClone(args.invocationContext),
    productionFingerprint: args.productionFingerprint,
  };
  return {
    ...frozen,
    overrideFingerprint: pipelineOverrideFingerprint(frozen),
  };
}

export function channelInceptionProbeEffectiveBudgetUsd(
  context: ChannelInceptionProbeInvocationContext,
  admittedCapUsd: number,
): number {
  const channelBudgetUsd = finiteUsd(context.channelBudgetUsd, "probe channel budget");
  const cap = finiteUsd(admittedCapUsd, "probe admitted cap");
  const familyCeiling = finiteUsd(
    context.probeMaximumCostUsd ?? MAX_CHANNEL_INCEPTION_PROBE_COST_USD,
    "probe family ceiling",
  );
  if (
    familyCeiling <= 0 ||
    familyCeiling > MAX_CHANNEL_INCEPTION_PROBE_COST_USD ||
    cap <= 0 ||
    cap > familyCeiling
  ) {
    throw new Error("probe admitted cap is outside its bounded contract");
  }
  if (channelBudgetUsd <= 0) {
    throw new Error("probe channel budget must be greater than zero");
  }
  return Math.min(channelBudgetUsd, cap);
}

export function channelInceptionProbeObservedSpend(args: {
  maximumCostUsd: number;
  runCostTotal: unknown;
  runStatus: "ok" | "failed" | "canceled";
  runError?: unknown;
  stages: readonly { status?: unknown; cost?: unknown; error?: unknown }[];
}): number {
  const maximumCostUsd = finiteUsd(args.maximumCostUsd, "probe attempt authority");
  const runCost = typeof args.runCostTotal === "number" &&
      Number.isFinite(args.runCostTotal) && args.runCostTotal >= 0
    ? args.runCostTotal
    : undefined;
  let stageCost = 0;
  let ambiguous = args.runStatus === "canceled" || runCost === undefined;
  for (const stage of args.stages) {
    if (stage.status === "running") ambiguous = true;
    if (
      typeof stage.error === "string" &&
      /PAID_STAGE_RECONCILIATION_REQUIRED|ambiguous provider spend/i.test(stage.error)
    ) {
      ambiguous = true;
    }
    if (typeof stage.cost === "number" && Number.isFinite(stage.cost) && stage.cost >= 0) {
      stageCost += stage.cost;
    } else if (stage.cost !== undefined) {
      ambiguous = true;
    }
  }
  if (
    typeof args.runError === "string" &&
    /PAID_STAGE_RECONCILIATION_REQUIRED|ambiguous provider spend/i.test(args.runError)
  ) {
    ambiguous = true;
  }
  const observed = Math.max(runCost ?? 0, stageCost);
  if (observed > maximumCostUsd + Number.EPSILON) {
    throw new Error("probe child reported spend above its admitted authority");
  }
  // Unknown spend consumes the remaining child authority. This can reduce
  // future availability, never enlarge it or permit a duplicate paid attempt.
  return ambiguous ? maximumCostUsd : finiteUsd(observed, "probe observed spend");
}

export function channelInceptionProbeDispatchEnvelopeFingerprint(args: {
  attempt: number;
  ownerId: string;
  channelId: string;
  runId: string;
  input: ChannelInceptionProbeInput;
  maximumCostUsd: number;
  approval: StudioActionApprovalReceipt;
}): string {
  return pipelineOverrideFingerprint({
    version: "channel-inception-probe-dispatch/v1",
    ...args,
  });
}

export function prepareChannelInceptionProbeAttempt(args: {
  attempt: number;
  ownerId: string;
  channelId: string;
  runId: string;
  input: ChannelInceptionProbeInput;
  maximumCostUsd: number;
  approval: StudioActionApprovalReceipt;
}): ChannelInceptionProbeAttemptCheckpoint {
  const maximumCostUsd = finiteUsd(args.maximumCostUsd, "probe attempt authority");
  const familyCeiling = finiteUsd(
    args.input.invocationContext.probeMaximumCostUsd ?? MAX_CHANNEL_INCEPTION_PROBE_COST_USD,
    "probe family ceiling",
  );
  if (
    !Number.isInteger(args.attempt) ||
    args.attempt < 1 ||
    args.attempt > MAX_CHANNEL_INCEPTION_PROBE_ATTEMPTS ||
    maximumCostUsd <= 0 ||
    maximumCostUsd > MAX_CHANNEL_INCEPTION_PROBE_COST_USD ||
    familyCeiling <= 0 ||
    familyCeiling > MAX_CHANNEL_INCEPTION_PROBE_COST_USD ||
    maximumCostUsd > familyCeiling
  ) {
    throw new Error("probe attempt or authority is outside its bounded contract");
  }
  const approvalFingerprint = studioActionApprovalFingerprint(args.approval);
  const checkpoint: ChannelInceptionProbeAttemptCheckpoint = {
    ...args,
    input: structuredClone(args.input),
    maximumCostUsd,
    approval: structuredClone(args.approval),
    approvalFingerprint,
    dispatchEnvelopeFingerprint: "",
  };
  checkpoint.dispatchEnvelopeFingerprint =
    channelInceptionProbeDispatchEnvelopeFingerprint({
      attempt: checkpoint.attempt,
      ownerId: checkpoint.ownerId,
      channelId: checkpoint.channelId,
      runId: checkpoint.runId,
      input: checkpoint.input,
      maximumCostUsd: checkpoint.maximumCostUsd,
      approval: checkpoint.approval,
    });
  assertChannelInceptionProbeAttempt(checkpoint);
  return checkpoint;
}

export function assertChannelInceptionProbeAttempt(
  attempt: ChannelInceptionProbeAttemptCheckpoint,
): void {
  assertChannelInceptionProbeEnvelopeStructure(attempt);
  if (
    !Number.isInteger(attempt.attempt) ||
    attempt.attempt < 1 ||
    attempt.attempt > MAX_CHANNEL_INCEPTION_PROBE_ATTEMPTS ||
    !attempt.ownerId.trim() ||
    !attempt.channelId.trim() ||
    !attempt.runId.trim()
  ) {
    throw new Error("probe attempt checkpoint identity is invalid");
  }
  const maximumCostUsd = finiteUsd(attempt.maximumCostUsd, "probe attempt authority");
  const familyCeiling = finiteUsd(
    attempt.input.invocationContext.probeMaximumCostUsd ?? MAX_CHANNEL_INCEPTION_PROBE_COST_USD,
    "probe family ceiling",
  );
  if (
    maximumCostUsd <= 0 ||
    maximumCostUsd > MAX_CHANNEL_INCEPTION_PROBE_COST_USD ||
    familyCeiling <= 0 ||
    familyCeiling > MAX_CHANNEL_INCEPTION_PROBE_COST_USD ||
    maximumCostUsd > familyCeiling
  ) {
    throw new Error("probe attempt authority exceeds the stage ceiling");
  }
  const expectedInputFingerprint = pipelineOverrideFingerprint({
    pipelineOverride: attempt.input.pipelineOverride,
    moduleConfigOverride: attempt.input.moduleConfigOverride,
    invocationContext: attempt.input.invocationContext,
    productionFingerprint: attempt.input.productionFingerprint,
  });
  if (attempt.input.overrideFingerprint !== expectedInputFingerprint) {
    throw new Error("probe frozen input fingerprint changed after checkpoint");
  }
  const approvalFingerprint = studioActionApprovalFingerprint(attempt.approval);
  if (attempt.approvalFingerprint !== approvalFingerprint) {
    throw new Error("probe child approval changed after checkpoint");
  }
  const subject = pipelineProbeApprovalSubject({
    ownerId: attempt.ownerId,
    channelId: attempt.channelId,
    runId: attempt.runId,
    pipelineOverrideFingerprint: attempt.input.overrideFingerprint,
    maximumCostUsd,
  });
  if (
    attempt.approval.maxCostUsd !== maximumCostUsd ||
    !verifyStudioActionApproval(attempt.approval, {
      action: "channel-inception-probe",
      ownerId: attempt.ownerId,
      subject,
      maximumCostUsd,
      persistedReceiptFingerprint: approvalFingerprint,
    })
  ) {
    throw new Error("probe child approval is not bound to its frozen input and authority");
  }
  const envelopeFingerprint = channelInceptionProbeDispatchEnvelopeFingerprint({
    attempt: attempt.attempt,
    ownerId: attempt.ownerId,
    channelId: attempt.channelId,
    runId: attempt.runId,
    input: attempt.input,
    maximumCostUsd,
    approval: attempt.approval,
  });
  if (attempt.dispatchEnvelopeFingerprint !== envelopeFingerprint) {
    throw new Error("probe dispatch envelope changed after checkpoint");
  }
  if (attempt.actualSpendUsd !== undefined) {
    const actual = finiteUsd(attempt.actualSpendUsd, "probe actual spend");
    if (!attempt.terminalStatus || actual > maximumCostUsd + Number.EPSILON) {
      throw new Error("probe actual spend is not terminal or exceeds its authority");
    }
  } else if (attempt.terminalStatus) {
    throw new Error("terminal probe attempt is missing durable actual spend");
  }
  if (attempt.invocationSha256 !== undefined && !validSha256(attempt.invocationSha256)) {
    throw new Error("probe invocation snapshot fingerprint is invalid");
  }
  if (attempt.terminalStatus === "ok" && !attempt.invocationSha256) {
    throw new Error("successful probe is missing its durable invocation snapshot fingerprint");
  }
}

export function summarizeChannelInceptionProbeSpend(
  attempts: readonly ChannelInceptionProbeAttemptReference[],
  stageCapUsd: number,
): ChannelInceptionProbeSpendSummary {
  const cap = finiteUsd(stageCapUsd, "probe stage cap");
  if (cap <= 0 || cap > MAX_CHANNEL_INCEPTION_PROBE_COST_USD) {
    throw new Error("probe stage cap is outside its bounded contract");
  }
  if (attempts.length > MAX_CHANNEL_INCEPTION_PROBE_ATTEMPTS) {
    throw new Error("probe checkpoint contains too many child attempts");
  }
  const seenRuns = new Set<string>();
  let actualSpendUsd = 0;
  let outstandingAuthorityUsd = 0;
  let activeAttempt: number | undefined;
  for (const attempt of attempts) {
    if (
      !Number.isInteger(attempt.attempt) ||
      attempt.attempt < 1 ||
      attempt.attempt > MAX_CHANNEL_INCEPTION_PROBE_ATTEMPTS ||
      !attempt.runId.trim() ||
      !validSha256(attempt.productionFingerprint) ||
      !validSha256(attempt.approvalFingerprint) ||
      !validSha256(attempt.dispatchEnvelopeFingerprint) ||
      (attempt.invocationSha256 !== undefined && !validSha256(attempt.invocationSha256))
    ) {
      throw new Error("probe attempt reference is invalid");
    }
    const maximumCostUsd = finiteUsd(attempt.maximumCostUsd, "probe attempt authority");
    if (maximumCostUsd <= 0 || maximumCostUsd > cap) {
      throw new Error("probe attempt reference exceeds its stage authority");
    }
    if (seenRuns.has(attempt.runId)) throw new Error("probe checkpoint reuses a run id");
    seenRuns.add(attempt.runId);
    if (attempt.terminalStatus) {
      if (attempt.actualSpendUsd === undefined) {
        throw new Error("terminal probe attempt reference has no actual spend");
      }
      const actual = finiteUsd(attempt.actualSpendUsd, "probe actual spend");
      if (actual > maximumCostUsd + Number.EPSILON) {
        throw new Error("probe actual spend exceeds its attempt authority");
      }
      if (attempt.terminalStatus === "ok" && !attempt.invocationSha256) {
        throw new Error("successful probe reference has no invocation fingerprint");
      }
      actualSpendUsd += actual;
    } else {
      if (activeAttempt !== undefined) throw new Error("probe checkpoint has concurrent spend authority");
      activeAttempt = attempt.attempt;
      outstandingAuthorityUsd = maximumCostUsd;
    }
  }
  actualSpendUsd = finiteUsd(actualSpendUsd, "probe cumulative actual spend");
  const committedSpendUsd = finiteUsd(
    actualSpendUsd + outstandingAuthorityUsd,
    "probe cumulative committed spend",
  );
  if (actualSpendUsd > cap + Number.EPSILON || committedSpendUsd > cap + Number.EPSILON) {
    throw new Error("probe cumulative spend exceeds its stage authority");
  }
  return {
    actualSpendUsd,
    committedSpendUsd,
    remainingAuthorityUsd: finiteUsd(cap - actualSpendUsd, "probe remaining authority"),
    ...(activeAttempt === undefined ? {} : { activeAttempt }),
  };
}

export function referenceChannelInceptionProbeAttempt(
  attempt: ChannelInceptionProbeAttemptCheckpoint,
): ChannelInceptionProbeAttemptReference {
  assertChannelInceptionProbeAttempt(attempt);
  return {
    attempt: attempt.attempt,
    runId: attempt.runId,
    maximumCostUsd: attempt.maximumCostUsd,
    productionFingerprint: attempt.input.productionFingerprint,
    approvalFingerprint: attempt.approvalFingerprint,
    dispatchEnvelopeFingerprint: attempt.dispatchEnvelopeFingerprint,
    ...(attempt.terminalStatus ? { terminalStatus: attempt.terminalStatus } : {}),
    ...(attempt.actualSpendUsd === undefined ? {} : { actualSpendUsd: attempt.actualSpendUsd }),
    ...(attempt.invocationSha256 ? { invocationSha256: attempt.invocationSha256 } : {}),
  };
}

export function reconcileChannelInceptionProbeAttempt(args: {
  attempt: ChannelInceptionProbeAttemptCheckpoint;
  status: "ok" | "failed" | "canceled";
  actualSpendUsd: number;
  invocationSha256?: string;
}): ChannelInceptionProbeAttemptCheckpoint {
  assertChannelInceptionProbeAttempt(args.attempt);
  const actualSpendUsd = finiteUsd(args.actualSpendUsd, "probe actual spend");
  if (actualSpendUsd > args.attempt.maximumCostUsd + Number.EPSILON) {
    throw new Error("probe child reported spend above its admitted authority");
  }
  if (args.status === "ok" && !validSha256(args.invocationSha256)) {
    throw new Error("successful probe child has no exact durable invocation snapshot fingerprint");
  }
  if (args.invocationSha256 !== undefined && !validSha256(args.invocationSha256)) {
    throw new Error("probe child invocation snapshot fingerprint is invalid");
  }
  const reconciled: ChannelInceptionProbeAttemptCheckpoint = {
    ...args.attempt,
    terminalStatus: args.status,
    actualSpendUsd,
    ...(args.invocationSha256 ? { invocationSha256: args.invocationSha256 } : {}),
  };
  assertChannelInceptionProbeAttempt(reconciled);
  return reconciled;
}
