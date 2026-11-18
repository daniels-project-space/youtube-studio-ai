import { v } from "convex/values";
import { query } from "./studioFunctions";
import { parseWorkshopDesignTransport } from "../src/lib/workshopDesignTransport";
import { channelPipelineWriteFence } from "../src/lib/channelPipelineWriteFence";
import { assertRouteReleaseQualifiedReceiptWire } from "../src/engine/productionRouteQualificationReceiptWire";
import { canonicalJson } from "../src/lib/canonicalJson";
import { sha256Hex } from "../src/lib/sha256";
import { comparePipelineCandidates } from "../src/lib/comparePipelineCandidates";
import { buildRouteQualificationBenchmarkPipeline } from "../src/lib/routeQualificationBenchmark";
import { assertCandidateBenchmarkMaterialization } from "../src/lib/candidateBenchmarkMaterialization";

const hash = (value: unknown) => sha256Hex(canonicalJson(value));

/** Read-only comparison inputs. A matching benchmark never qualifies a review. */
export const list = query({
  args: { ownerId: v.string(), channelId: v.id("channels"), designFingerprint: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity?.role !== "owner" || identity.subject !== args.ownerId || identity.owner_id !== args.ownerId) throw new Error("Owner verification required");
    const channel = await ctx.db.get(args.channelId);
    if (!channel || channel.ownerId !== args.ownerId) throw new Error("Channel not found");
    if (!/^[a-f0-9]{64}$/.test(args.designFingerprint)) throw new Error("Invalid design fingerprint");
    const reviews = await ctx.db.query("workshopReviewCandidates").withIndex("by_owner_channel_design_created", q => q.eq("ownerId", args.ownerId).eq("channelId", args.channelId).eq("designFingerprint", args.designFingerprint)).order("desc").take(11);
    const benchmarks = await ctx.db.query("retainedPipelineCandidates").withIndex("by_channel_created", q => q.eq("channelId", args.channelId)).order("desc").take(11);
    const verifiedReviews = reviews.slice(0, 10).map(row => {
        const candidate = row.candidate;
        const design = parseWorkshopDesignTransport(candidate?.design);
        if (candidate?.version !== "workshop-review-candidate/v1" || candidate.status !== "unqualified" || candidate.ownerId !== args.ownerId || candidate.channelId !== String(args.channelId) || candidate.baselineFingerprint !== row.baselineFingerprint || channelPipelineWriteFence(candidate.baseline) !== row.baselineFingerprint || design.fingerprint !== row.designFingerprint || hash(candidate) !== row.fingerprint) throw new Error("Saved review integrity check failed");
        return { fingerprint: row.fingerprint, createdAt: row.createdAt, name: design.name, entries: design.entries };
      });
    const verifiedBenchmarks = benchmarks.slice(0, 10).map(row => {
        const candidate = row.candidate;
        if (row.ownerId !== args.ownerId || !["retained-pipeline-candidate/v1", "retained-pipeline-candidate/v2", "retained-pipeline-candidate/v3"].includes(candidate?.version) || candidate.ownerId !== args.ownerId || candidate.channelId !== String(args.channelId) || hash(candidate) !== row.fingerprint || !Array.isArray(candidate.entries)) throw new Error("Benchmark integrity check failed");
        if (candidate.version === "retained-pipeline-candidate/v2" || candidate.version === "retained-pipeline-candidate/v3") {
          if (!Array.isArray(candidate.benchmarkEntries) || typeof candidate.sourceCandidate?.candidateId !== "string" || !candidate.sourceCandidate.candidateId || ![candidate.sourceCandidate.fingerprint, candidate.sourceCandidate.baselineFingerprint, candidate.sourceCandidate.invocationInputFingerprint, candidate.sourceCandidate.executionFingerprint].every(value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value))) throw new Error("Benchmark derivation mismatch");
          const privateEntries = buildRouteQualificationBenchmarkPipeline(candidate.entries);
          if (candidate.version === "retained-pipeline-candidate/v2") {
            if (canonicalJson(privateEntries) !== canonicalJson(candidate.benchmarkEntries)) throw new Error("Benchmark derivation mismatch");
          } else {
            if (!candidate.moduleConfigOverride || typeof candidate.moduleConfigOverride !== "object" || Array.isArray(candidate.moduleConfigOverride) || Object.keys(candidate.moduleConfigOverride).length === 0) throw new Error("Benchmark derivation mismatch");
            assertCandidateBenchmarkMaterialization(privateEntries, candidate.moduleConfigOverride, candidate.benchmarkEntries);
          }
        }
        const receipt = assertRouteReleaseQualifiedReceiptWire(candidate.qualification?.receipt);
        if (receipt.ownerId !== args.ownerId || receipt.channelId !== String(args.channelId) || receipt.binding.pipelineFingerprint !== hash(candidate.entries)) throw new Error("Benchmark receipt binding mismatch");
        return { fingerprint: row.fingerprint, createdAt: row.createdAt, entries: candidate.entries, runId: candidate.sourceRunId, workerVersion: candidate.workerDeployment?.version, receiptFingerprint: receipt.receiptFingerprint };
      });
    return {
      reviewsTruncated: reviews.length > 10, benchmarksTruncated: benchmarks.length > 10,
      reviews: verifiedReviews,
      benchmarks: verifiedBenchmarks,
      comparisons: verifiedReviews.flatMap(review => verifiedBenchmarks.map(benchmark => ({
        reviewFingerprint: review.fingerprint, benchmarkFingerprint: benchmark.fingerprint,
        differences: comparePipelineCandidates(review.entries, benchmark.entries),
      }))),
    };
  },
});
