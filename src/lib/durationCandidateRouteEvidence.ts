import { assertCanonicalChannelProgramBrief } from "@/engine/channelProgramBrief";
import { assertChannelProgramRouteBinding } from "@/engine/channelProgramRoute";
import { assertChannelShowProfilePipelineCompatibility, createChannelShowProfile } from "@/engine/channelShowProfile";
import { readProductionRouteQualificationBinding } from "@/engine/productionRouteQualificationBinding";
import { readProductionRouteVisualMatterEvidence } from "@/engine/productionRouteVisualMatterEvidence";
import type { PipelineEntry } from "@/engine/types";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

/** Rebuild only from recoverable frozen inputs; this does not create an inception plan or receipt. */
export function durationCandidateRouteEvidence(input: { identity?: { programBrief?: unknown; programRoute?: unknown; showProfile?: unknown }; expectedFamily?: unknown; baselinePipeline: PipelineEntry[]; pipeline: PipelineEntry[]; requestedSeconds: number }) {
  const brief = assertCanonicalChannelProgramBrief(input.identity?.programBrief);
  if (input.expectedFamily !== undefined && input.expectedFamily !== brief.family) throw new Error("Saved channel family does not match its program brief.");
  const route = assertChannelProgramRouteBinding({ programBrief: brief, route: input.identity?.programRoute, expectedFamily: brief.family });
  const original = assertChannelShowProfilePipelineCompatibility({ profile: input.identity?.showProfile, programBrief: brief, pipeline: input.baselinePipeline });
  if (original.designedPipelineFingerprint !== sha256Hex(canonicalJson(input.baselinePipeline))) throw new Error("Saved Show Profile does not bind the baseline pipeline.");
  if (!original.programRoute || original.programRoute.fingerprint !== route.fingerprint) throw new Error("Saved Show Profile does not bind the current route.");
  if (original.selectedCapabilityKeys.length) throw new Error("Original creative capability selections are not available for candidate reconstruction.");
  const profile = createChannelShowProfile({ programBrief: brief, programRoute: route, pipeline: input.pipeline });
  const stable = ({ fingerprint: _fingerprint, designedPipelineFingerprint: _pipeline, ...rest }: typeof profile) => rest;
  if (canonicalJson(stable(original)) !== canonicalJson(stable(profile))) throw new Error("Current route or composition differs from the saved Show Profile.");
  const binding = readProductionRouteQualificationBinding({ programBrief: brief, programRoute: route, showProfile: profile, pipeline: input.pipeline });
  const visualMatter = readProductionRouteVisualMatterEvidence({ binding });
  const evidence = { version: "duration-candidate-route-evidence/v1", profile, binding, visualMatter, requestedSeconds: input.requestedSeconds };
  return { ...evidence, evidenceFingerprint: sha256Hex(canonicalJson(evidence)) };
}
