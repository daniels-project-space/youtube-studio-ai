import { v } from "convex/values";
import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";
import { assertRouteReleaseQualifiedReceiptWire } from "../src/engine/productionRouteQualificationReceiptWire";
import { normalizePipelineInvocationSnapshot } from "../src/lib/pipelineInvocationSnapshot";
import { pipelineInvocationSha256 } from "../src/lib/pipelineInvocationHash";
import { canonicalJson } from "../src/lib/canonicalJson";
import { sha256Hex } from "../src/lib/sha256";
import { assertCandidateBenchmarkExecutionBinding } from "../src/lib/candidateBenchmarkExecutionBinding";
import { assertRouteQualificationBenchmarkDispatchEnvelope, ROUTE_QUALIFICATION_BENCHMARK_INPUT_V3 } from "../src/lib/routeQualificationBenchmark";
import { assertRouteQualificationBenchmarkInvocationBinding } from "../src/lib/routeQualificationBenchmarkInvocationBinding";
import { assertCandidateBenchmarkMaterialization } from "../src/lib/candidateBenchmarkMaterialization";

/** Retains evidence only. This operation never changes a channel or dispatches work. */
export const retain = mutation({
  args: { ownerId: v.string(), channelId: v.id("channels"), runId: v.id("runs"), receiptId: v.id("productionRouteQualificationReceipts") },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "retained pipeline candidate");
    const run = await ctx.db.get(args.runId);
    const row = await ctx.db.get(args.receiptId);
    if (!run || run.ownerId !== args.ownerId || run.channelId !== args.channelId || !row || row.ownerId !== args.ownerId || row.channelId !== args.channelId) {
      throw new Error("candidate evidence ownership or channel mismatch");
    }
    if (!run.pipelineInvocationSnapshot || !run.pipelineInvocationSha256) throw new Error("candidate requires a frozen compiled invocation");
    const snapshot = normalizePipelineInvocationSnapshot(run.pipelineInvocationSnapshot);
    if (snapshot.ownerId !== args.ownerId || snapshot.channelId !== String(args.channelId) || snapshot.runId !== String(args.runId) || pipelineInvocationSha256(snapshot) !== run.pipelineInvocationSha256) {
      throw new Error("candidate invocation identity or hash mismatch");
    }
    if (!snapshot.workerDeployment) throw new Error("candidate requires exact worker deployment identity");
    const receipt = assertRouteReleaseQualifiedReceiptWire(row.receipt);
    if (receipt.ownerId !== args.ownerId || receipt.channelId !== String(args.channelId) || row.receiptFingerprint !== receipt.receiptFingerprint || row.level !== receipt.level || row.pipelineFingerprint !== receipt.binding.pipelineFingerprint || snapshot.showProfileFingerprint !== receipt.binding.showProfileFingerprint || snapshot.programRouteFingerprint !== receipt.binding.routeFingerprint) {
      throw new Error("candidate qualification does not match the frozen invocation");
    }
    const admission = snapshot.budgetAdmission;
    if (
      run.status !== "ok" ||
      admission?.kind !== "route-qualification-benchmark" ||
      admission.productionPipelineFingerprint !== receipt.binding.pipelineFingerprint ||
      admission.preflightReceiptFingerprint !== receipt.preflightReceiptFingerprint ||
      admission.dispatchEnvelopeFingerprint !== run.routeQualificationBenchmarkDispatchEnvelopeFingerprint ||
      run.releaseEvidenceStatus !== "release_evidence_recorded" ||
      run.releaseEvidenceCertificateFingerprint !== receipt.provenance.releaseCertificateFingerprint ||
      typeof run.releaseEvidenceCertificateKey !== "string" || !run.releaseEvidenceCertificateKey.trim()
    ) {
      throw new Error("candidate requires its completed benchmark and matching final-master certificate provenance");
    }
    const modules = snapshot.compilationModules as Array<{ id?: unknown; version?: unknown }>;
    if (modules.length !== snapshot.entries.length || modules.some((module, index) => !module || module.id !== snapshot.entries[index].block || typeof module.version !== "string" || !module.version.trim() || (snapshot.entries[index].version !== undefined && snapshot.entries[index].version !== module.version))) {
      throw new Error("candidate requires exact compiled module versions");
    }
    let sourceCandidate;
    let moduleConfigOverride;
    let productionEntries = snapshot.entries;
    if (run.routeQualificationBenchmarkCandidate) {
      const target = { ...run.routeQualificationBenchmarkCandidate, candidateId: String(run.routeQualificationBenchmarkCandidate.candidateId) };
      const envelope = run.routeQualificationBenchmarkDispatchEnvelope;
      assertRouteQualificationBenchmarkDispatchEnvelope(envelope);
      if (snapshot.source !== "override" || envelope.ownerId !== args.ownerId || envelope.channelId !== String(args.channelId) || envelope.runId !== String(args.runId) || envelope.dispatchEnvelopeFingerprint !== run.routeQualificationBenchmarkDispatchEnvelopeFingerprint || envelope.input.version !== ROUTE_QUALIFICATION_BENCHMARK_INPUT_V3 || envelope.input.productionPipelineFingerprint !== receipt.binding.pipelineFingerprint) throw new Error("candidate benchmark dispatch provenance mismatch");
      if (Object.keys(envelope.input.moduleConfigOverride).length === 0) {
        if (canonicalJson(snapshot.entries) !== canonicalJson(envelope.input.benchmarkPipeline)) throw new Error("candidate benchmark materialization cannot be proven from its private pipeline");
      } else {
        assertCandidateBenchmarkMaterialization(envelope.input.benchmarkPipeline, envelope.input.moduleConfigOverride, snapshot.entries);
        moduleConfigOverride = envelope.input.moduleConfigOverride;
      }
      assertRouteQualificationBenchmarkInvocationBinding({ ownerId: args.ownerId, channelId: String(args.channelId), runId: String(args.runId), envelope, storedEnvelopeFingerprint: run.routeQualificationBenchmarkDispatchEnvelopeFingerprint, snapshot, candidateInvocationInput: run.routeQualificationBenchmarkCandidateInvocationInput, candidateTarget: target });
      assertCandidateBenchmarkExecutionBinding({ benchmark: envelope.input, frozenInput: run.routeQualificationBenchmarkCandidateInvocationInput, candidateTarget: target, snapshot });
      productionEntries = envelope.input.productionPipeline;
      sourceCandidate = { ...target, invocationInputFingerprint: envelope.input.candidateExecutionBinding!.invocationInputFingerprint, executionFingerprint: envelope.input.candidateExecutionBinding!.executionFingerprint };
    } else if (run.routeQualificationBenchmarkDispatchEnvelope?.input?.version === ROUTE_QUALIFICATION_BENCHMARK_INPUT_V3) {
      throw new Error("candidate benchmark target is missing");
    } else if (sha256Hex(canonicalJson(snapshot.entries)) !== receipt.binding.pipelineFingerprint) {
      throw new Error("candidate qualification does not match the frozen invocation");
    }
    const candidate = {
      version: moduleConfigOverride ? "retained-pipeline-candidate/v3" : sourceCandidate ? "retained-pipeline-candidate/v2" : "retained-pipeline-candidate/v1", ownerId: args.ownerId, channelId: String(args.channelId),
      sourceRunId: String(args.runId), invocationSha256: run.pipelineInvocationSha256,
      entries: productionEntries, ...(sourceCandidate ? { benchmarkEntries: snapshot.entries } : {}), compilation: { fingerprint: snapshot.compilationFingerprint, policyId: snapshot.compilationPolicyId, policyVersion: snapshot.compilationPolicyVersion, modules: snapshot.compilationModules, capabilities: snapshot.compilationCapabilities, reservedMaxCostUsd: snapshot.reservedMaxCostUsd },
      ...(moduleConfigOverride ? { moduleConfigOverride } : {}),
      workerDeployment: snapshot.workerDeployment,
      qualification: { receiptId: String(args.receiptId), receipt },
      ...(sourceCandidate ? { sourceCandidate } : {}),
    };
    const encoded = canonicalJson(candidate);
    if (new TextEncoder().encode(encoded).byteLength > 750_000) throw new Error("candidate exceeds size limit");
    const fingerprint = sha256Hex(encoded);
    const existing = await ctx.db.query("retainedPipelineCandidates").withIndex("by_channel_fingerprint", q => q.eq("channelId", args.channelId).eq("fingerprint", fingerprint)).unique();
    if (existing) {
      if (existing.ownerId !== args.ownerId || canonicalJson(existing.candidate) !== encoded) throw new Error("candidate immutable conflict");
      return { id: existing._id, fingerprint, reused: true };
    }
    const id = await ctx.db.insert("retainedPipelineCandidates", { ownerId: args.ownerId, channelId: args.channelId, fingerprint, candidate, createdAt: Date.now() });
    return { id, fingerprint, reused: false };
  },
});

export const list = query({
  args: { ownerId: v.string(), channelId: v.id("channels") },
  handler: async (ctx, args) => ctx.db.query("retainedPipelineCandidates").withIndex("by_channel_created", q => q.eq("channelId", args.channelId)).order("desc").take(100),
});
