import { buildChannelInceptionPlan, type ChannelInceptionRequest } from "@/engine/channelInceptionPlan";
import { readProductionRouteInceptionEvidence } from "@/engine/productionRouteInceptionEvidence";
import type { ProductionRouteQualificationBinding } from "@/engine/productionRouteQualificationBinding";
import type { ChannelShowProfile } from "@/engine/channelShowProfile";
import type { PipelineEntry } from "@/engine/types";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const hash = (value: unknown) => sha256Hex(canonicalJson(value));

/** Rebuild a plan-only candidate proposal from the exact retained source request, without approvals. */
export function durationCandidateInceptionEvidence(input: { source: unknown; ownerId: string; channelId: string; candidateFingerprint: string; baselinePipeline: PipelineEntry[]; baselineModuleConfig: unknown; baselineShowProfile: unknown; candidateModuleConfig: unknown; candidateProfile: ChannelShowProfile; binding: ProductionRouteQualificationBinding }) {
  if (!record(input.source) || !record(input.source.requestSnapshot) || !/^[a-f0-9]{64}$/.test(input.candidateFingerprint)) throw new Error("No retained source inception request is available.");
  const source = buildChannelInceptionPlan(input.source.requestSnapshot as unknown as ChannelInceptionRequest);
  if (source.schemaVersion !== input.source.schemaVersion || source.inceptionKey !== input.source.planKey || source.requestFingerprint !== input.source.requestFingerprint || canonicalJson(source.requestSnapshot) !== canonicalJson(input.source.requestSnapshot)) throw new Error("The retained source inception plan does not match its fingerprint.");
  const snapshot = source.requestSnapshot;
  if (snapshot.ownerId !== input.ownerId || snapshot.channelRef !== input.channelId || snapshot.pipelineSourceFingerprint !== hash(input.baselinePipeline) || snapshot.moduleConfigFingerprint !== hash(input.baselineModuleConfig ?? {}) || canonicalJson(snapshot.showProfile) !== canonicalJson(input.baselineShowProfile)) throw new Error("The retained source inception plan does not match this channel baseline.");
  const plan = buildChannelInceptionPlan({ ...snapshot, sourceRevision: `duration-candidate:${input.candidateFingerprint}`, pipelineSourceFingerprint: input.binding.pipelineFingerprint, moduleConfigFingerprint: hash(input.candidateModuleConfig), showProfile: input.candidateProfile, includeProbe: false });
  if (plan.providerCallsAuthorized !== false || plan.mode !== "plan-only" || plan.requestSnapshot.includeProbe !== false) throw new Error("Candidate inception plan must remain provider-free.");
  const evidence = readProductionRouteInceptionEvidence({ binding: input.binding, plan });
  return { sourceRequestFingerprint: source.requestFingerprint, plan, evidence };
}
