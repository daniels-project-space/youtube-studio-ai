import { buildRouteQualificationBenchmarkPipeline } from "@/lib/routeQualificationBenchmark";
import { verifiedDurationCandidate } from "@/lib/durationCandidateEvidenceReview";
import { channelPipelineWriteFence } from "@/lib/channelPipelineWriteFence";
import { firstLockedModulePipelineChange, moduleConfigFingerprint } from "@/lib/channelModuleLock";
import { durationCandidateFamily } from "@/lib/durationCandidateFamily";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import type { PipelineEntry } from "@/engine/types";

/** Frozen input to a future invocation, not compiled entries, a receipt, or admission. */
export function candidateBenchmarkInvocation(input: {
  ownerId: string; channelId: string; runId: string;
  target: { candidateId: string; fingerprint: string; baselineFingerprint: string };
  channel: { ownerId: string; name?: unknown; slug?: unknown; schedule?: { madeForKids?: unknown }; pipeline: PipelineEntry[]; moduleConfig?: Record<string, unknown>; moduleLocks?: Record<string, unknown>; locked?: boolean; family?: unknown; contentLane?: unknown; identity?: unknown };
  candidate: unknown; maximumCostUsd: number;
  version?: "candidate-benchmark-invocation-input/v1" | "candidate-benchmark-invocation-input/v2";
}) {
  const candidate = input.candidate as Record<string, unknown> | null;
  const verified = verifiedDurationCandidate(candidate, input.ownerId, input.channelId);
  if (!candidate || !verified || String(candidate._id) !== input.target.candidateId || candidate.fingerprint !== input.target.fingerprint || candidate.baselineFingerprint !== input.target.baselineFingerprint || input.channel.ownerId !== input.ownerId || input.channel.locked || channelPipelineWriteFence(input.channel) !== input.target.baselineFingerprint || durationCandidateFamily(input.channel) !== candidate.family) throw new Error("candidate benchmark baseline or draft changed");
  if (!Number.isFinite(input.maximumCostUsd) || input.maximumCostUsd <= 0) throw new Error("candidate benchmark budget is invalid");
  if (firstLockedModulePipelineChange({ moduleLocks: input.channel.moduleLocks, currentPipeline: input.channel.pipeline, nextPipeline: verified.pipeline })) throw new Error("candidate benchmark pipeline is locked");
  for (const block of Object.keys(input.channel.moduleLocks ?? {})) if (moduleConfigFingerprint(input.channel.moduleConfig ?? {}, block) !== moduleConfigFingerprint(verified.moduleConfig, block)) throw new Error("candidate benchmark module settings are locked");
  const version = input.version ?? "candidate-benchmark-invocation-input/v2";
  if (version === "candidate-benchmark-invocation-input/v2" && (typeof input.channel.name !== "string" || !input.channel.name.trim() || typeof input.channel.slug !== "string" || !input.channel.slug.trim() || (input.channel.schedule?.madeForKids !== undefined && typeof input.channel.schedule.madeForKids !== "boolean"))) throw new Error("candidate benchmark channel seed identity is invalid");
  const body = {
    version,
    ownerId: input.ownerId, channelId: input.channelId, runId: input.runId,
    candidate: input.target, maximumCostUsd: input.maximumCostUsd,
    productionPipeline: structuredClone(verified.pipeline),
    benchmarkPipeline: buildRouteQualificationBenchmarkPipeline(verified.pipeline),
    moduleConfigOverride: structuredClone(verified.moduleConfig),
    ...(version === "candidate-benchmark-invocation-input/v2" ? { channelSeedIdentity: { name: input.channel.name, slug: input.channel.slug, madeForKids: input.channel.schedule?.madeForKids ?? false } } : {}),
  };
  return { body, fingerprint: sha256Hex(canonicalJson(body)) };
}

/** Reproduce the retained input at the transactional first-claim boundary. */
export function assertCurrentCandidateBenchmarkInvocation(input: {
  ownerId: string; channelId: string; runId: string;
  target: { candidateId: string; fingerprint: string; baselineFingerprint: string };
  channel: Parameters<typeof candidateBenchmarkInvocation>[0]["channel"];
  candidate: unknown; maximumCostUsd: number; frozenInput: unknown;
}): void {
  const frozen = input.frozenInput as { body?: { version?: unknown } } | null;
  const version = frozen?.body?.version;
  if (version !== "candidate-benchmark-invocation-input/v1" && version !== "candidate-benchmark-invocation-input/v2") throw new Error("candidate benchmark invocation input version is invalid");
  const current = candidateBenchmarkInvocation({ ...input, version });
  if (canonicalJson(current) !== canonicalJson(input.frozenInput)) throw new Error("candidate benchmark invocation input is unavailable or changed");
}
