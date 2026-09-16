import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

/** Versioned, append-only measurement emitted for every executed module stage. */
export const MODULE_SCORECARD_VERSION = "module-scorecard/v1" as const;

export type ModuleScorecardStatus = "passed" | "failed";

export type ModuleScorecard = {
  version: typeof MODULE_SCORECARD_VERSION;
  runId: string;
  moduleId: string;
  status: ModuleScorecardStatus;
  outputValid: boolean;
  /** The independent oracle may run later; null never means a passing score. */
  oracleScore: number | null;
  falsePasses: number | null;
  falseRejects: number | null;
  wallTimeMs: number;
  providerCalls: number;
  inputTokens: number;
  outputTokens: number;
  /** These are deliberately nullable until an outer orchestration layer observes them. */
  triggerRuns: number | null;
  triggerWaits: number | null;
  convexReads: number | null;
  convexWrites: number | null;
  estimatedCostUsd: number;
  capturedAt: number;
  fingerprint: string;
};

export type ModuleScorecardInput = Omit<ModuleScorecard, "version" | "fingerprint">;

function requiredId(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 240) {
    throw new Error(`module scorecard ${label} is invalid`);
  }
  return value.trim();
}

function nonNegative(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`module scorecard ${label} is invalid`);
  }
  return value;
}

function nullableNonNegative(value: unknown, label: string): number | null {
  return value === null ? null : nonNegative(value, label);
}

function nullableScore(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10) {
    throw new Error("module scorecard oracle score is invalid");
  }
  return value;
}

/** Create a canonical scorecard; no unavailable metric is silently coerced to zero. */
export function createModuleScorecard(input: ModuleScorecardInput): ModuleScorecard {
  const body = {
    version: MODULE_SCORECARD_VERSION,
    runId: requiredId(input.runId, "run id"),
    moduleId: requiredId(input.moduleId, "module id"),
    status: input.status,
    outputValid: input.outputValid,
    oracleScore: nullableScore(input.oracleScore),
    falsePasses: nullableNonNegative(input.falsePasses, "false passes"),
    falseRejects: nullableNonNegative(input.falseRejects, "false rejects"),
    wallTimeMs: nonNegative(input.wallTimeMs, "wall time"),
    providerCalls: nonNegative(input.providerCalls, "provider calls"),
    inputTokens: nonNegative(input.inputTokens, "input tokens"),
    outputTokens: nonNegative(input.outputTokens, "output tokens"),
    triggerRuns: nullableNonNegative(input.triggerRuns, "Trigger runs"),
    triggerWaits: nullableNonNegative(input.triggerWaits, "Trigger waits"),
    convexReads: nullableNonNegative(input.convexReads, "Convex reads"),
    convexWrites: nullableNonNegative(input.convexWrites, "Convex writes"),
    estimatedCostUsd: nonNegative(input.estimatedCostUsd, "estimated cost"),
    capturedAt: nonNegative(input.capturedAt, "capture timestamp"),
  } satisfies Omit<ModuleScorecard, "fingerprint">;
  if (body.status !== "passed" && body.status !== "failed") {
    throw new Error("module scorecard status is invalid");
  }
  if (typeof body.outputValid !== "boolean") {
    throw new Error("module scorecard output validity is invalid");
  }
  if (body.status === "failed" && body.outputValid) {
    throw new Error("a failed module scorecard cannot claim valid output");
  }
  return { ...body, fingerprint: sha256Hex(canonicalJson(body)) };
}

/** Verify a persisted scorecard without trusting its stored fingerprint. */
export function assertModuleScorecard(value: unknown): ModuleScorecard {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("module scorecard is invalid");
  }
  const candidate = value as Partial<ModuleScorecard>;
  const { fingerprint: _fingerprint, ...input } = candidate;
  void _fingerprint;
  const rebuilt = createModuleScorecard(input as ModuleScorecardInput);
  if (candidate.fingerprint !== rebuilt.fingerprint) {
    throw new Error("module scorecard fingerprint mismatch");
  }
  return rebuilt;
}

export type ModuleScorecardDelta = {
  moduleId: string;
  wallTimeMs: number;
  providerCalls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  outputValidityChanged: boolean;
};

/** Compare a current run to an exact same-module baseline without comparing unrelated modules. */
export function compareModuleScorecards(
  baseline: ModuleScorecard,
  current: ModuleScorecard,
): ModuleScorecardDelta {
  assertModuleScorecard(baseline);
  assertModuleScorecard(current);
  if (baseline.moduleId !== current.moduleId) {
    throw new Error("module scorecard comparison requires the same module");
  }
  return {
    moduleId: current.moduleId,
    wallTimeMs: current.wallTimeMs - baseline.wallTimeMs,
    providerCalls: current.providerCalls - baseline.providerCalls,
    inputTokens: current.inputTokens - baseline.inputTokens,
    outputTokens: current.outputTokens - baseline.outputTokens,
    estimatedCostUsd: Number((current.estimatedCostUsd - baseline.estimatedCostUsd).toFixed(6)),
    outputValidityChanged: current.outputValid !== baseline.outputValid,
  };
}
