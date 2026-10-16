import { v } from "convex/values";

const artifactValidator = v.object({
  key: v.string(),
  artifactId: v.string(),
  type: v.string(),
  schemaVersion: v.string(),
  producerVersion: v.string(),
  payloadSha256: v.string(),
});

const critiqueReceiptValidator = v.object({
  label: v.string(),
  scores: v.array(v.number()),
  passes: v.array(v.boolean()),
  fatalIterations: v.array(v.boolean()),
  issueCounts: v.array(v.number()),
  accepted: v.boolean(),
  fatal: v.boolean(),
  completed: v.boolean(),
});

export const moduleScorecardValidator = v.object({
  version: v.literal("module-scorecard/v8"),
  runId: v.string(),
  moduleId: v.string(),
  status: v.union(v.literal("passed"), v.literal("failed")),
  outputValid: v.boolean(),
  moduleVersion: v.string(),
  inputFingerprint: v.string(),
  configurationFingerprint: v.string(),
  outputArtifacts: v.array(artifactValidator),
  oracleFingerprint: v.union(v.string(), v.null()),
  oracleScore: v.union(v.number(), v.null()),
  falsePasses: v.union(v.number(), v.null()),
  falseRejects: v.union(v.number(), v.null()),
  wallTimeMs: v.number(),
  providerCalls: v.union(v.number(), v.null()),
  inputTokens: v.union(v.number(), v.null()),
  outputTokens: v.union(v.number(), v.null()),
  critiqueEvidence: v.union(v.array(critiqueReceiptValidator), v.null()),
  triggerRuns: v.union(v.number(), v.null()),
  triggerWaits: v.union(v.number(), v.null()),
  convexReads: v.union(v.number(), v.null()),
  convexWrites: v.union(v.number(), v.null()),
  convexActions: v.union(v.number(), v.null()),
  estimatedCostUsd: v.number(),
  capturedAt: v.number(),
  fingerprint: v.string(),
});
