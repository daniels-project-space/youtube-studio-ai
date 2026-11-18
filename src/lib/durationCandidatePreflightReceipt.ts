import { createRoutePreflightReadyReceipt } from "@/engine/productionRouteQualificationReceipt";
import { readProductionRouteRuntimeEvidence } from "@/engine/productionRouteQualification";
import { canonicalJson } from "@/lib/canonicalJson";
import { durationCandidateExecutablePlanner } from "@/lib/durationCandidateExecutablePlanner";
import { durationCandidateInceptionEvidence } from "@/lib/durationCandidateInceptionEvidence";
import { durationCandidateRouteEvidence } from "@/lib/durationCandidateRouteEvidence";
import { verifiedDurationCandidate } from "@/lib/durationCandidateEvidenceReview";
import { durationCandidateFamily } from "@/lib/durationCandidateFamily";
import { sha256Hex } from "@/lib/sha256";

type PlannerInput = Parameters<typeof durationCandidateExecutablePlanner>[0];

/** Local candidate evidence only. It is not a channel receipt or dispatch authorization. */
export function issueDurationCandidatePreflightReceipt(input: PlannerInput) {
  const { ownerId, channelId, channel, candidate } = input;
  const verified = verifiedDurationCandidate(candidate, ownerId, channelId);
  if (!verified || typeof candidate.fingerprint !== "string" || typeof candidate.baselineFingerprint !== "string" || typeof candidate.requestedSeconds !== "number") throw new Error("Candidate could not be verified.");
  const local = durationCandidateExecutablePlanner(input);
  const route = durationCandidateRouteEvidence({ identity: channel.identity, expectedFamily: durationCandidateFamily(channel), baselinePipeline: channel.pipeline, pipeline: verified.pipeline, requestedSeconds: candidate.requestedSeconds });
  const inception = durationCandidateInceptionEvidence({ source: verified.sourceInception, ownerId, channelId, candidateFingerprint: candidate.fingerprint, baselinePipeline: channel.pipeline, baselineModuleConfig: channel.moduleConfig ?? {}, baselineShowProfile: channel.identity?.showProfile, candidateModuleConfig: verified.moduleConfig, candidateProfile: route.profile, binding: route.binding });
  const runtime = readProductionRouteRuntimeEvidence({ binding: route.binding, planner: local.body.planner, pipeline: verified.pipeline });
  const receipt = createRoutePreflightReadyReceipt({ ownerId, channelId, binding: route.binding, planner: local.body.planner, inception: inception.evidence, runtime, visualMatter: route.visualMatter });
  const body = {
    version: "duration-candidate-local-preflight-receipt/v1" as const,
    ownerId, channelId, candidateFingerprint: candidate.fingerprint, baselineFingerprint: candidate.baselineFingerprint,
    moduleConfigFingerprint: sha256Hex(canonicalJson(verified.moduleConfig)),
    sourceOptionsFingerprint: local.body.sourceOptionsFingerprint,
    sourceInceptionRequestFingerprint: inception.sourceRequestFingerprint,
    localCompilationFingerprint: local.body.localCompilation.compilationFingerprint,
    routeReceiptFingerprint: receipt.receiptFingerprint,
    routeBindingFingerprint: receipt.binding.bindingFingerprint,
    pipelineFingerprint: receipt.binding.pipelineFingerprint,
    provenance: "owner-supplied-options-unattested" as const,
    workerAttestation: null,
    dispatchAuthorized: false as const,
    channelQualification: false as const,
  };
  return { body, fingerprint: sha256Hex(canonicalJson(body)) };
}
