import { task } from "@trigger.dev/sdk";
import { makeFunctionReference } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { issueDurationCandidatePreflightReceipt } from "@/lib/durationCandidatePreflightReceipt";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { currentPipelineWorkerDeployment } from "@/trigger/pipelineWorkerRuntime";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

type Input = { ownerId: string; channelId: Id<"channels">; candidateId: Id<"durationDraftCandidates">; candidateFingerprint: string; baselineFingerprint: string; options: unknown; requestId?: Id<"durationCandidatePreflightRequests"> };
const getCandidate = makeFunctionReference<"query", Pick<Input, "ownerId" | "channelId" | "candidateId">, Record<string, unknown> | null>("durationDraftCandidates:get");
const retain = makeFunctionReference<"mutation", { ownerId: string; channelId: Id<"channels">; candidateId: Id<"durationDraftCandidates">; receipt: unknown; taskRunId: string; workerDeployment: unknown; requestId?: Id<"durationCandidatePreflightRequests"> }, { id: string; fingerprint: string; reused: boolean }>("durationCandidateLocalReports:retainWorkerReceipt");
const transition = makeFunctionReference<"mutation">("durationCandidatePreflightRequests:transition");

/** Local code and owner options are not an attestation of the deployed worker. */
export const durationCandidatePreflightTask = task({
  id: "duration-candidate-local-preflight",
  maxDuration: 120,
  retry: { maxAttempts: 1 },
  run: async (input: Input, { ctx }) => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) throw new Error("Database not configured");
    if (!input || !input.ownerId || !input.channelId || !input.candidateId || !/^[a-f0-9]{64}$/.test(input.candidateFingerprint) || !/^[a-f0-9]{64}$/.test(input.baselineFingerprint) || !input.options || typeof input.options !== "object" || Array.isArray(input.options) || JSON.stringify(input.options).length > 100_000) throw new Error("Invalid candidate preflight request");
    const client = new StudioConvexHttpClient(url);
    const state = { ownerId: input.ownerId, channelId: input.channelId, candidateId: input.candidateId, requestId: input.requestId, taskRunId: ctx.run.id, candidateFingerprint: input.candidateFingerprint, baselineFingerprint: input.baselineFingerprint, optionsFingerprint: sha256Hex(canonicalJson(input.options)) };
    if (input.requestId) {
      const started = await client.mutation(transition, { ...state, action: "start" }) as { state: string };
      if (started.state !== "running") throw new Error("Candidate preflight request is already finished");
    }
    try {
    const workerDeployment = currentPipelineWorkerDeployment(ctx);
    const [channel, candidate] = await Promise.all([
      client.query(api.channels.getChannel, { channelId: input.channelId }),
      client.query(getCandidate, { ownerId: input.ownerId, channelId: input.channelId, candidateId: input.candidateId }),
    ]);
    if (!channel || channel.ownerId !== input.ownerId || !candidate || candidate.fingerprint !== input.candidateFingerprint || candidate.baselineFingerprint !== input.baselineFingerprint) throw new Error("Candidate or channel changed");
    const receipt = issueDurationCandidatePreflightReceipt({ ownerId: input.ownerId, channelId: String(input.channelId), channel: { ...channel, pipeline: channel.pipeline ?? [] }, candidate, options: input.options });
    const retained = await client.mutation(retain, { ownerId: input.ownerId, channelId: input.channelId, candidateId: input.candidateId, receipt, taskRunId: ctx.run.id, workerDeployment, ...(input.requestId ? { requestId: input.requestId } : {}) });
    if (input.requestId) await client.mutation(transition, { ...state, action: "complete", reportFingerprint: retained.fingerprint });
    return { ...retained, workerAttestation: false as const, dispatchAuthorized: false as const };
    } catch (error) {
      if (input.requestId) {
        try { await client.mutation(transition, { ...state, action: "fail" }); } catch { /* Preserve the original worker failure. */ }
      }
      throw error;
    }
  },
});
