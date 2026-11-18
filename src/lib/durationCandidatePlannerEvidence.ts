import { designPipelineCore, type DesignOptions } from "@/engine/designerCore";
import { assertCanonicalChannelProgramBrief, channelProgramBriefFingerprint } from "@/engine/channelProgramBrief";
import { assertChannelProgramRouteBinding } from "@/engine/channelProgramRoute";
import type { FamilyKey } from "@/engine/families";
import type { ProductionRouteQualificationBinding } from "@/engine/productionRouteQualificationBinding";
import type { PipelineEntry } from "@/engine/types";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

/** Caller-supplied options are a reproducibility claim, not historical provenance. */
export function durationCandidatePlannerEvidence(input: { options: unknown; baselinePipeline: PipelineEntry[]; requestedSeconds: number; binding: ProductionRouteQualificationBinding }) {
  if (!input.options || typeof input.options !== "object" || Array.isArray(input.options)) throw new Error("Designer options must be an object.");
  const options = input.options as DesignOptions;
  if (typeof options.lengthMinutes !== "number" || !Number.isFinite(options.lengthMinutes) || options.lengthMinutes <= 0 || !options.programBrief || !options.programRoute) throw new Error("Complete original designer options, including duration, brief and route, are required.");
  if (options.family !== input.binding.family) throw new Error("Designer options do not match the candidate family.");
  const brief = assertCanonicalChannelProgramBrief(options.programBrief);
  const route = assertChannelProgramRouteBinding({ route: options.programRoute, programBrief: brief, expectedFamily: input.binding.family as FamilyKey });
  if (channelProgramBriefFingerprint(brief) !== input.binding.programBrief.fingerprint || route.fingerprint !== input.binding.route.fingerprint) throw new Error("Designer options do not match the candidate route.");
  const design = (value: DesignOptions) => designPipelineCore(value, { validateRuntimeRegistry: false });
  if (canonicalJson(design(options).pipeline) !== canonicalJson(input.baselinePipeline)) throw new Error("The supplied designer options do not reproduce the saved baseline.");
  const proposedOptions = { ...options, lengthMinutes: input.requestedSeconds / 60 };
  const result = design(proposedOptions);
  const pipelineFingerprint = sha256Hex(canonicalJson(result.pipeline));
  if (pipelineFingerprint !== input.binding.pipelineFingerprint || result.contentLane.key !== input.binding.contentLaneKey) throw new Error("Designer output does not match the candidate pipeline and lane.");
  const runtimeBlockers = [...new Set(result.runtimeBlockers.map(value => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const planFingerprint = sha256Hex(canonicalJson({ pipeline: result.pipeline, contentLane: result.contentLane, episodeLengthSeconds: result.episodeLengthSeconds, available: result.available, productionReady: result.productionReady, runtimeBlockers }));
  const body = { version: "candidate-structural-planner-evidence/v1", bindingFingerprint: input.binding.bindingFingerprint, pipelineFingerprint, planFingerprint };
  const evidence = { ...body, evidenceFingerprint: sha256Hex(canonicalJson(body)) };
  return { provenance: "owner-supplied-unattested" as const, sourceOptionsFingerprint: sha256Hex(canonicalJson(options)), candidateOptionsFingerprint: sha256Hex(canonicalJson(proposedOptions)), evidence };
}
