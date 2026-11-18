import { designPipeline, type DesignOptions } from "@/engine/designer";
import { readProductionRoutePlannerEvidence } from "@/engine/productionRouteQualification";
import type { PipelineEntry } from "@/engine/types";
import { canonicalJson } from "@/lib/canonicalJson";
import { channelPipelineWriteFence } from "@/lib/channelPipelineWriteFence";
import { firstLockedModulePipelineChange, moduleConfigFingerprint } from "@/lib/channelModuleLock";
import { verifiedDurationCandidate } from "@/lib/durationCandidateEvidenceReview";
import { durationCandidateFamily } from "@/lib/durationCandidateFamily";
import { durationCandidateProposal } from "@/lib/durationCandidateProposal";
import { durationCandidateRouteEvidence } from "@/lib/durationCandidateRouteEvidence";
import { sha256Hex } from "@/lib/sha256";
import { assertCanonicalChannelProgramBrief } from "@/engine/channelProgramBrief";
import { assertChannelProgramRouteBinding } from "@/engine/channelProgramRoute";
import { resolveContentLane, assertPipelineMatchesContentLane, injectContentLaneIntoPipeline } from "@/engine/contentLane";
import { completePipelineForPolicy } from "@/engine/pipelineCompiler";
import { prepareWorkerModuleConfig, materializeWorkerPipelineParams, compileWorkerPipeline } from "@/engine/workerPipelineMaterialization";
import { buildRouteQualificationBenchmarkPipeline } from "@/lib/routeQualificationBenchmark";
import { freezeChannelInceptionProbeContext } from "@/lib/channelInceptionProbe";
import { PRIVATE_PROBE_THUMBNAIL_MODE_STORE_KEY } from "@/lib/channelInceptionProbeContract";

const hash = (value: unknown) => sha256Hex(canonicalJson(value));
type Channel = { ownerId: string; name: string; slug: string; budget: number; pipeline: PipelineEntry[]; moduleConfig?: Record<string, unknown>; moduleLocks?: Record<string, unknown>; locked?: boolean; family?: unknown; contentLane?: unknown; identity?: { voiceId?: string; programBrief?: unknown; programRoute?: unknown; showProfile?: unknown } };

/** Local executable-planner replay; never a deployed-worker attestation or admission. */
export function durationCandidateExecutablePlanner(input: { ownerId: string; channelId: string; channel: Channel; candidate: Record<string, unknown>; options: unknown }) {
  const { channel, candidate, ownerId, channelId } = input;
  const verified = verifiedDurationCandidate(candidate, ownerId, channelId);
  if (!verified || channel.ownerId !== ownerId || typeof candidate.fingerprint !== "string" || typeof candidate.baselineFingerprint !== "string" || typeof candidate.requestedSeconds !== "number" || !Number.isSafeInteger(candidate.requestedSeconds)) throw new Error("Candidate or owner could not be verified.");
  const baselineFingerprint = channelPipelineWriteFence(channel);
  if (baselineFingerprint !== candidate.baselineFingerprint) throw new Error("The channel baseline has changed.");
  const family = durationCandidateFamily(channel);
  if (family !== candidate.family || channel.locked || firstLockedModulePipelineChange({ moduleLocks: channel.moduleLocks, currentPipeline: channel.pipeline, nextPipeline: verified.pipeline })) throw new Error("Channel identity or locks prevent this check.");
  for (const block of Object.keys(channel.moduleLocks ?? {})) if (moduleConfigFingerprint(channel.moduleConfig ?? {}, block) !== moduleConfigFingerprint(verified.moduleConfig, block)) throw new Error("Module settings are locked.");
  const proposal = durationCandidateProposal(channel, candidate.requestedSeconds);
  if (canonicalJson(proposal.pipeline) !== canonicalJson(verified.pipeline) || canonicalJson(proposal.moduleConfig) !== canonicalJson(verified.moduleConfig)) throw new Error("The candidate does not match the current duration transformation.");
  if (!input.options || typeof input.options !== "object" || Array.isArray(input.options)) throw new Error("Complete original designer options are required.");
  const options = input.options as DesignOptions;
  if (options.family !== family || typeof options.lengthMinutes !== "number" || !Number.isFinite(options.lengthMinutes) || options.lengthMinutes <= 0 || !options.programBrief || !options.programRoute) throw new Error("Complete original designer options are required.");
  if (canonicalJson(designPipeline(options).pipeline) !== canonicalJson(channel.pipeline)) throw new Error("The supplied designer options do not reproduce the saved baseline.");
  const route = durationCandidateRouteEvidence({ identity: channel.identity, expectedFamily: family, baselinePipeline: channel.pipeline, pipeline: verified.pipeline, requestedSeconds: candidate.requestedSeconds });
  const proposedOptions = { ...options, lengthMinutes: candidate.requestedSeconds / 60 };
  const planner = readProductionRoutePlannerEvidence({ binding: route.binding, options: proposedOptions });
  const privatePipeline = buildRouteQualificationBenchmarkPipeline(verified.pipeline);
  const completed = completePipelineForPolicy(privatePipeline);
  const seen = new Set<string>();
  for (const entry of completed.entries) { if (seen.has(entry.block)) throw new Error("Repeated modules require occurrence-specific invocation review."); seen.add(entry.block); }
  const prepared = prepareWorkerModuleConfig(completed.entries, verified.moduleConfig as Record<string, Record<string, unknown>>);
  const merged = prepared.merged;
  let entries = materializeWorkerPipelineParams(completed.entries, prepared.paramsByBlock, false);
  const brief = assertCanonicalChannelProgramBrief(channel.identity?.programBrief);
  assertChannelProgramRouteBinding({ programBrief: brief, route: channel.identity?.programRoute, expectedFamily: family });
  const lane = resolveContentLane({ stored: channel.contentLane, family: channel.family, pipeline: channel.pipeline });
  assertPipelineMatchesContentLane(lane, entries);
  entries = injectContentLaneIntoPipeline(entries, lane);
  const context = freezeChannelInceptionProbeContext({ ownerId, family, channel: channel as never });
  const seedStore: Record<string, unknown> = { ...structuredClone(context.seedStore), channelModuleConfig: merged.frozenModuleConfig };
  delete seedStore[PRIVATE_PROBE_THUMBNAIL_MODE_STORE_KEY];
  const { seedKeys, compilation } = compileWorkerPipeline({ entries, contentLane: lane, seedStore, privateAdmission: true, env: { YOUTUBE_AUTOMATION_PRIVATE: "1" } });
  const localCompilation = { entries, seedKeys, baseSeedFingerprint: hash(seedStore), policyId: compilation.policyId, policyVersion: compilation.policyVersion, compilationFingerprint: compilation.fingerprint, modules: compilation.modules, capabilities: compilation.capabilities, reservedMaxCostUsd: compilation.reservedMaxCostUsd, inserted: completed.inserted, retired: completed.retired, skippedModuleConfig: merged.skippedBlockIds };
  const blockers = ["Designer options are owner-supplied; historical provenance is not attested.", "Local registry results do not attest the deployed worker or its release.", "Compiled module settings are not yet bound to production-route qualification.", "The base seed is hashed, but evidence-enriched final seed values and an admitted immutable invocation do not exist yet.", "Provider readiness, budget admission and benchmark evidence remain unchecked.", "This read-only check is not an atomic admission or an approval."];
  const body = { version: "duration-candidate-local-executable-planner/v2", ownerId, channelId, candidateFingerprint: candidate.fingerprint, baselineFingerprint, sourceOptionsFingerprint: hash(options), candidateOptionsFingerprint: hash(proposedOptions), bindingFingerprint: route.binding.bindingFingerprint, planner, localCompilation, blockers };
  return { body, evidenceFingerprint: hash(body), provenance: "owner-supplied-options-unattested" as const, localCodeOnly: true as const, receiptIssued: false as const, dispatchAuthorized: false as const };
}
