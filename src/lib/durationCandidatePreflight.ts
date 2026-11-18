import { assertChannelProgramRoutePipelineCompatibility } from "@/engine/channelProgramRoute";
import { assertRouteReleaseQualifiedReceiptWire } from "@/engine/productionRouteQualificationReceiptWire";
import type { PipelineEntry } from "@/engine/types";
import { canonicalJson } from "@/lib/canonicalJson";
import { firstLockedModulePipelineChange, moduleConfigFingerprint } from "@/lib/channelModuleLock";
import { channelPipelineWriteFence } from "@/lib/channelPipelineWriteFence";
import { verifiedRetainedEvidence } from "@/lib/durationCandidateEvidenceReview";
import { durationCandidateRouteEvidence } from "@/lib/durationCandidateRouteEvidence";
import { durationCandidateInceptionEvidence } from "@/lib/durationCandidateInceptionEvidence";
import { durationCandidatePlannerEvidence } from "@/lib/durationCandidatePlannerEvidence";
import { durationCandidateFamily } from "@/lib/durationCandidateFamily";
import { normalizePipelineWorkerDeployment } from "@/lib/pipelineWorkerDeployment";
import { privatePipelineConfigurationPreflight } from "@/lib/privateBenchmarkPreflight";
import { sha256Hex } from "@/lib/sha256";

type Channel = { pipeline: PipelineEntry[]; moduleConfig?: Record<string, unknown>; moduleLocks?: Record<string, unknown>; locked?: boolean; budget?: number; family?: unknown; contentLane?: unknown; identity?: { voiceId?: string; programBrief?: unknown; programRoute?: unknown; showProfile?: unknown } };
type Candidate = { fingerprint: string; baselineFingerprint: string; requestedSeconds: number; pipeline: PipelineEntry[]; moduleConfig: Record<string, unknown>; sourceInception?: unknown; family?: unknown };
type HistoricalWorker = { evidenceFingerprint: string; receiptFingerprint: string; sourceRunId: string; deployment: { version: string; projectId: string; environmentId: string } };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** This proves only a historical retained benchmark binding, never the currently released worker. */
export function historicalWorkerEvidence(row: unknown, ownerId: string, channelId: string): HistoricalWorker | null {
  const retained = verifiedRetainedEvidence(row, ownerId, channelId);
  if (!retained || !record(row) || !record(row.candidate) || !record(row.candidate.qualification)) return null;
  try {
    const receipt = assertRouteReleaseQualifiedReceiptWire(row.candidate.qualification.receipt);
    if (receipt.ownerId !== ownerId || receipt.channelId !== channelId || receipt.binding.pipelineFingerprint !== sha256Hex(canonicalJson(retained.entries))) return null;
    return { evidenceFingerprint: retained.fingerprint, receiptFingerprint: receipt.receiptFingerprint, sourceRunId: retained.sourceRunId, deployment: normalizePipelineWorkerDeployment(row.candidate.workerDeployment) };
  } catch { return null; }
}

/** A fingerprinted read-only assessment, not a route preflight receipt or run admission. */
export function durationCandidatePreflight(input: { ownerId: string; channelId: string; channel: Channel; candidate: Candidate; maximumCostUsd: number; worker: HistoricalWorker | null; plannerOptions?: unknown }) {
  const { channel, candidate } = input;
  if (!Number.isFinite(input.maximumCostUsd) || input.maximumCostUsd <= 0 || input.maximumCostUsd > 10000) throw new Error("A positive bounded benchmark ceiling is required.");
  const blockers: string[] = [];
  let resolvedFamily: string | null = null;
  try {
    resolvedFamily = durationCandidateFamily(channel);
    if (candidate.family !== undefined && candidate.family !== resolvedFamily) { blockers.push("The candidate format conflicts with the saved channel identity."); resolvedFamily = null; }
  } catch { blockers.push("The saved channel format and content lane could not be verified."); }
  const observedChannelFingerprint = channelPipelineWriteFence(channel);
  if (observedChannelFingerprint !== candidate.baselineFingerprint) blockers.push("The saved channel baseline has changed; create a new candidate.");
  if (channel.locked) blockers.push("The channel is locked.");
  const lock = firstLockedModulePipelineChange({ moduleLocks: channel.moduleLocks, currentPipeline: channel.pipeline, nextPipeline: candidate.pipeline });
  if (lock) blockers.push(`Module ${lock} is locked.`);
  let lockedSettings = false;
  for (const block of Object.keys(channel.moduleLocks ?? {})) {
    if (moduleConfigFingerprint(channel.moduleConfig ?? {}, block) !== moduleConfigFingerprint(candidate.moduleConfig, block)) { lockedSettings = true; blockers.push(`Module ${block} settings are locked.`); }
  }
  if (typeof channel.budget !== "number" || !Number.isFinite(channel.budget) || channel.budget <= 0) blockers.push("A valid saved channel budget is required.");
  const shadow = { ...channel, ...(resolvedFamily ? { family: resolvedFamily } : {}), pipeline: candidate.pipeline, moduleConfig: candidate.moduleConfig };
  const structural = privatePipelineConfigurationPreflight(shadow, input.maximumCostUsd, "qualification-benchmark");
  blockers.push(...structural.blockers);
  let preparedEvidence: null | { body: { version: string; ownerId: string; channelId: string; candidateFingerprint: string; baselineFingerprint: string; candidatePipelineFingerprint: string; moduleConfigFingerprint: string; entries: PipelineEntry[]; inserted: string[]; retired: string[]; removedDeliveryBlocks: string[]; skippedModuleConfig: string[]; repeatedBlocks: string[] }; evidenceFingerprint: string } = null;
  if (structural.prepared && resolvedFamily && observedChannelFingerprint === candidate.baselineFingerprint && !channel.locked && !lock && !lockedSettings) {
    const seen = new Set<string>(), repeated = new Set<string>();
    for (const entry of structural.prepared.entries) {
      if (seen.has(entry.block)) repeated.add(entry.block);
      seen.add(entry.block);
    }
    const repeatedBlocks = [...repeated].sort();
    if (repeatedBlocks.length) blockers.push(`Repeated modules use a shared parameter map during preparation (${repeatedBlocks.join(", ")}); occurrence-specific runtime settings require review.`);
    const body = { version: "duration-candidate-prepared-benchmark/v1", ownerId: input.ownerId, channelId: input.channelId, candidateFingerprint: candidate.fingerprint, baselineFingerprint: candidate.baselineFingerprint, candidatePipelineFingerprint: sha256Hex(canonicalJson(candidate.pipeline)), moduleConfigFingerprint: sha256Hex(canonicalJson(candidate.moduleConfig)), entries: structural.prepared.entries, inserted: structural.prepared.inserted, retired: structural.prepared.retired, removedDeliveryBlocks: structural.removedDeliveryBlocks, skippedModuleConfig: structural.prepared.skippedModuleConfig, repeatedBlocks };
    preparedEvidence = { body, evidenceFingerprint: sha256Hex(canonicalJson(body)) };
  }
  try {
    assertChannelProgramRoutePipelineCompatibility({ route: channel.identity?.programRoute, programBrief: channel.identity?.programBrief, pipeline: candidate.pipeline });
  } catch { blockers.push("The proposed pipeline has no verified compatible sealed channel route."); }
  let routeEvidence: ReturnType<typeof durationCandidateRouteEvidence> | null = null;
  if (resolvedFamily && observedChannelFingerprint === candidate.baselineFingerprint && !channel.locked && !lock && !lockedSettings) {
    try { routeEvidence = durationCandidateRouteEvidence({ identity: channel.identity, expectedFamily: resolvedFamily, baselinePipeline: channel.pipeline, pipeline: candidate.pipeline, requestedSeconds: candidate.requestedSeconds }); }
    catch { blockers.push("A candidate-specific route and Show Profile binding could not be rebuilt from the saved identity and pipeline."); }
  } else blockers.push("Candidate-specific route evidence requires a current, unlocked baseline.");
  if (routeEvidence && Object.keys(candidate.moduleConfig).length) blockers.push("The Show Profile binds the proposed pipeline, not the separately fingerprinted module overrides; a compiled invocation must bind both.");
  let inceptionEvidence: ReturnType<typeof durationCandidateInceptionEvidence> | null = null;
  if (routeEvidence && candidate.sourceInception) {
    try {
      inceptionEvidence = durationCandidateInceptionEvidence({ source: candidate.sourceInception, ownerId: input.ownerId, channelId: input.channelId, candidateFingerprint: candidate.fingerprint, baselinePipeline: channel.pipeline, baselineModuleConfig: channel.moduleConfig ?? {}, baselineShowProfile: channel.identity?.showProfile, candidateModuleConfig: candidate.moduleConfig, candidateProfile: routeEvidence.profile, binding: routeEvidence.binding });
    } catch { blockers.push("The retained inception request could not be verified against the saved baseline."); }
  } else if (routeEvidence) blockers.push("No source inception request was retained for this candidate.");
  let plannerEvidence: ReturnType<typeof durationCandidatePlannerEvidence> | null = null;
  if (routeEvidence && input.plannerOptions !== undefined) {
    try { plannerEvidence = durationCandidatePlannerEvidence({ options: input.plannerOptions, baselinePipeline: channel.pipeline, requestedSeconds: candidate.requestedSeconds, binding: routeEvidence.binding }); }
    catch { blockers.push("The supplied designer options did not reproduce both the saved baseline and candidate pipeline."); }
  } else if (routeEvidence) blockers.push("Original designer options were not retained; planner evidence requires complete owner-supplied options.");
  if (plannerEvidence) blockers.push("Designer options were supplied by the owner; their historical provenance is not attested. Executable planner and runtime registry validation remain outstanding.");
  blockers.push("Candidate-specific runtime evidence has not been derived; no preflight receipt was issued.");
  blockers.push("Full compiled pipeline cost reservation, provider readiness and final budget admission have not been checked.");
  blockers.push(input.worker ? "The selected worker is historical; its current release and candidate compatibility have not been attested." : "No verified historical worker evidence was selected; the current worker release has not been attested.");
  blockers.push("This assessment is not a benchmark admission; baseline, locks and evidence must be rechecked atomically before any future run.");
  const binding = { version: "duration-candidate-preflight/v1", ownerId: input.ownerId, channelId: input.channelId, candidateFingerprint: candidate.fingerprint, baselineFingerprint: candidate.baselineFingerprint, observedChannelFingerprint, resolvedFamily, pipelineFingerprint: sha256Hex(canonicalJson(candidate.pipeline)), moduleConfigFingerprint: sha256Hex(canonicalJson(candidate.moduleConfig)), preparedEvidenceFingerprint: preparedEvidence?.evidenceFingerprint ?? null, routeEvidenceFingerprint: routeEvidence?.evidenceFingerprint ?? null, inceptionEvidenceFingerprint: inceptionEvidence ? sha256Hex(canonicalJson(inceptionEvidence)) : null, plannerEvidenceFingerprint: plannerEvidence ? sha256Hex(canonicalJson(plannerEvidence)) : null, channelBudgetUsd: typeof channel.budget === "number" && Number.isFinite(channel.budget) ? channel.budget : null, maximumCostUsd: input.maximumCostUsd, historicalWorker: input.worker };
  return { binding, bindingFingerprint: sha256Hex(canonicalJson(binding)), preparedEvidence, routeEvidence, inceptionEvidence, plannerEvidence, blockers, removedDeliveryBlocks: structural.removedDeliveryBlocks, ready: false as const, dispatchAuthorized: false as const, receiptIssued: false as const };
}
