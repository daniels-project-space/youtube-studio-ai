import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import type { ModuleCritiqueReceipt } from "@/lib/moduleCritiqueEvidence";

/** Versioned, append-only measurement emitted for every executed module stage. */
export const MODULE_SCORECARD_VERSION = "module-scorecard/v8" as const;

export type ModuleScorecardStatus = "passed" | "failed";

export type ModuleScorecardArtifact = {
  key: string;
  artifactId: string;
  type: string;
  schemaVersion: string;
  producerVersion: string;
  payloadSha256: string;
};

export type ModuleScorecard = {
  version: typeof MODULE_SCORECARD_VERSION;
  runId: string;
  moduleId: string;
  status: ModuleScorecardStatus;
  outputValid: boolean;
  moduleVersion: string;
  inputFingerprint: string;
  configurationFingerprint: string;
  /** Exact durable outputs measured by this stage; hashes only, never payloads. */
  outputArtifacts: ModuleScorecardArtifact[];
  /** The independent oracle may run later; null never means a passing score. */
  oracleFingerprint: string | null;
  oracleScore: number | null;
  falsePasses: number | null;
  falseRejects: number | null;
  wallTimeMs: number;
  providerCalls: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Module-internal critic observations; these are not independently calibrated oracle scores. */
  critiqueEvidence: ModuleCritiqueReceipt[] | null;
  /** These are deliberately nullable until an outer orchestration layer observes them. */
  triggerRuns: number | null;
  triggerWaits: number | null;
  convexReads: number | null;
  convexWrites: number | null;
  convexActions: number | null;
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

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const allowed = new Set(keys);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length) {
    throw new Error(`module scorecard ${label} has unexpected field(s): ${unexpected.sort().join(", ")}`);
  }
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

function outputArtifacts(value: unknown, runId: string, moduleId: string): ModuleScorecardArtifact[] {
  if (!Array.isArray(value) || value.length > 128) {
    throw new Error("module scorecard output artifacts are invalid");
  }
  const artifacts = value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("module scorecard output artifact is invalid");
    }
    const artifact = item as Partial<ModuleScorecardArtifact>;
    exactKeys(item as Record<string, unknown>, ["key", "artifactId", "type", "schemaVersion", "producerVersion", "payloadSha256"], "output artifact");
    const key = requiredId(artifact.key, "artifact key");
    const artifactId = requiredId(artifact.artifactId, "artifact id");
    const type = requiredId(artifact.type, "artifact type");
    const schemaVersion = requiredId(artifact.schemaVersion, "artifact schema version");
    const producerVersion = requiredId(artifact.producerVersion, "artifact producer version");
    const payloadSha256 = requiredId(artifact.payloadSha256, "artifact payload hash");
    const artifactPrefix = `${runId}:${moduleId}:${key}:`;
    if (artifactId.length > 1024 || type.length > 120 || schemaVersion.length > 120 ||
      producerVersion.length > 120 || !/^[a-f0-9]{64}$/u.test(payloadSha256) ||
      !artifactId.startsWith(artifactPrefix) || !/^[a-f0-9]{16}$/u.test(artifactId.slice(artifactPrefix.length))) {
      throw new Error("module scorecard output artifact identity is invalid");
    }
    return { key, artifactId, type, schemaVersion, producerVersion, payloadSha256 };
  }).sort((a, b) => a.key.localeCompare(b.key));
  if (new Set(artifacts.map((artifact) => artifact.key)).size !== artifacts.length ||
    new Set(artifacts.map((artifact) => artifact.artifactId)).size !== artifacts.length) {
    throw new Error("module scorecard output artifact identities must be unique");
  }
  return artifacts;
}

function critiqueEvidence(value: unknown): ModuleCritiqueReceipt[] | null {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length > 64) {
    throw new Error("module scorecard critique evidence is invalid");
  }
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("module scorecard critique receipt is invalid");
    }
    const receipt = item as Partial<ModuleCritiqueReceipt>;
    exactKeys(item as Record<string, unknown>, ["label", "scores", "passes", "fatalIterations", "issueCounts", "accepted", "fatal", "completed"], "critique receipt");
    const label = requiredId(receipt.label, "critique label");
    if (label.length > 120 || !Array.isArray(receipt.scores) || receipt.scores.length > 64 ||
      !Array.isArray(receipt.passes) || !Array.isArray(receipt.fatalIterations) || !Array.isArray(receipt.issueCounts) ||
      receipt.scores.length !== receipt.passes.length || receipt.scores.length !== receipt.fatalIterations.length ||
      receipt.scores.length !== receipt.issueCounts.length || (receipt.completed && receipt.scores.length === 0)) {
      throw new Error("module scorecard critique receipt arrays are invalid");
    }
    const scores = receipt.scores.map((score) => {
      if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1) {
        throw new Error("module scorecard critique score is invalid");
      }
      return score;
    });
    const passes = receipt.passes.map((pass) => {
      if (typeof pass !== "boolean") throw new Error("module scorecard critique pass is invalid");
      return pass;
    });
    const fatalIterations = receipt.fatalIterations.map((fatal) => {
      if (typeof fatal !== "boolean") throw new Error("module scorecard critique fatal flag is invalid");
      return fatal;
    });
    const issueCounts = receipt.issueCounts.map((count) => {
      if (typeof count !== "number" || !Number.isInteger(count) || count < 0 || count > 32) {
        throw new Error("module scorecard critique issue count is invalid");
      }
      return count;
    });
    if (typeof receipt.accepted !== "boolean" || typeof receipt.fatal !== "boolean" ||
      typeof receipt.completed !== "boolean" || (receipt.accepted && (!receipt.completed || receipt.fatal || !passes.at(-1))) ||
      (receipt.fatal && !receipt.completed)) {
      throw new Error("module scorecard critique outcome is invalid");
    }
    return { label, scores, passes, fatalIterations, issueCounts, accepted: receipt.accepted, fatal: receipt.fatal, completed: receipt.completed };
  });
}

/** Create a canonical scorecard; no unavailable metric is silently coerced to zero. */
export function createModuleScorecard(input: ModuleScorecardInput): ModuleScorecard {
  const runId = requiredId(input.runId, "run id");
  const moduleId = requiredId(input.moduleId, "module id");
  const body = {
    version: MODULE_SCORECARD_VERSION,
    runId,
    moduleId,
    status: input.status,
    outputValid: input.outputValid,
    moduleVersion: requiredId(input.moduleVersion, "module version"),
    inputFingerprint: requiredId(input.inputFingerprint, "input fingerprint"),
    configurationFingerprint: requiredId(input.configurationFingerprint, "configuration fingerprint"),
    outputArtifacts: outputArtifacts(input.outputArtifacts, runId, moduleId),
    oracleFingerprint: input.oracleFingerprint,
    oracleScore: nullableScore(input.oracleScore),
    falsePasses: nullableNonNegative(input.falsePasses, "false passes"),
    falseRejects: nullableNonNegative(input.falseRejects, "false rejects"),
    wallTimeMs: nonNegative(input.wallTimeMs, "wall time"),
    providerCalls: nullableNonNegative(input.providerCalls, "provider calls"),
    inputTokens: nullableNonNegative(input.inputTokens, "input tokens"),
    outputTokens: nullableNonNegative(input.outputTokens, "output tokens"),
    critiqueEvidence: critiqueEvidence(input.critiqueEvidence),
    triggerRuns: nullableNonNegative(input.triggerRuns, "Trigger runs"),
    triggerWaits: nullableNonNegative(input.triggerWaits, "Trigger waits"),
    convexReads: nullableNonNegative(input.convexReads, "Convex reads"),
    convexWrites: nullableNonNegative(input.convexWrites, "Convex writes"),
    convexActions: nullableNonNegative(input.convexActions, "Convex actions"),
    estimatedCostUsd: nonNegative(input.estimatedCostUsd, "estimated cost"),
    capturedAt: nonNegative(input.capturedAt, "capture timestamp"),
  } satisfies Omit<ModuleScorecard, "fingerprint">;
  if (body.status !== "passed" && body.status !== "failed") {
    throw new Error("module scorecard status is invalid");
  }
  if (typeof body.outputValid !== "boolean") {
    throw new Error("module scorecard output validity is invalid");
  }
  if (!/^[a-f0-9]{64}$/u.test(body.inputFingerprint) || !/^[a-f0-9]{64}$/u.test(body.configurationFingerprint)) {
    throw new Error("module scorecard measurement fingerprint is invalid");
  }
  if (body.oracleFingerprint !== null &&
    (typeof body.oracleFingerprint !== "string" || !/^[a-f0-9]{64}$/u.test(body.oracleFingerprint))) {
    throw new Error("module scorecard oracle fingerprint is invalid");
  }
  if (body.oracleFingerprint === null &&
    [body.oracleScore, body.falsePasses, body.falseRejects].some((value) => value !== null)) {
    throw new Error("module scorecard quality measurements require an oracle fingerprint");
  }
  if (body.status === "passed" && !body.outputValid) {
    throw new Error("a passed module scorecard cannot claim invalid output");
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
  exactKeys(candidate as Record<string, unknown>, [
    "version", "runId", "moduleId", "status", "outputValid", "moduleVersion", "inputFingerprint",
    "configurationFingerprint", "outputArtifacts", "oracleFingerprint", "oracleScore", "falsePasses",
    "falseRejects", "wallTimeMs", "providerCalls", "inputTokens", "outputTokens", "critiqueEvidence",
    "triggerRuns", "triggerWaits", "convexReads", "convexWrites", "convexActions", "estimatedCostUsd",
    "capturedAt", "fingerprint",
  ], "record");
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
  oracleScoreDelta: number | null;
  falsePassesDelta: number | null;
  falseRejectsDelta: number | null;
  oracleFingerprintChanged: boolean;
  wallTimeMs: number;
  providerCalls: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  critiqueEvidenceChanged: boolean | null;
  triggerRuns: number | null;
  triggerWaits: number | null;
  convexReads: number | null;
  convexWrites: number | null;
  convexActions: number | null;
  estimatedCostUsd: number;
  moduleVersionChanged: boolean;
  inputFingerprintChanged: boolean;
  configurationFingerprintChanged: boolean;
  outputValidityChanged: boolean;
  outputArtifactsChanged: boolean;
};

function nullableDelta(baseline: number | null, current: number | null): number | null {
  return baseline === null || current === null ? null : current - baseline;
}

function nullableScoreDelta(baseline: number | null, current: number | null): number | null {
  const delta = nullableDelta(baseline, current);
  return delta === null ? null : Number(delta.toFixed(6));
}

function outputArtifactMeasurements(artifacts: readonly ModuleScorecardArtifact[]): string {
  return canonicalJson(artifacts.map(({ key, type, schemaVersion, producerVersion, payloadSha256 }) =>
    ({ key, type, schemaVersion, producerVersion, payloadSha256 }),
  ));
}

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
  const sameInputs = baseline.inputFingerprint === current.inputFingerprint;
  const sameOracle = baseline.oracleFingerprint !== null && baseline.oracleFingerprint === current.oracleFingerprint;
  const qualityComparable = sameInputs && sameOracle;
  return {
    moduleId: current.moduleId,
    // Quality deltas need the same frozen input and oracle. Keep operational
    // deltas visible, but never present a changed test or judge as a gain.
    oracleScoreDelta: qualityComparable ? nullableScoreDelta(baseline.oracleScore, current.oracleScore) : null,
    falsePassesDelta: qualityComparable ? nullableDelta(baseline.falsePasses, current.falsePasses) : null,
    falseRejectsDelta: qualityComparable ? nullableDelta(baseline.falseRejects, current.falseRejects) : null,
    oracleFingerprintChanged: baseline.oracleFingerprint !== current.oracleFingerprint,
    wallTimeMs: current.wallTimeMs - baseline.wallTimeMs,
    providerCalls: nullableDelta(baseline.providerCalls, current.providerCalls),
    inputTokens: nullableDelta(baseline.inputTokens, current.inputTokens),
    outputTokens: nullableDelta(baseline.outputTokens, current.outputTokens),
    critiqueEvidenceChanged: baseline.critiqueEvidence === null || current.critiqueEvidence === null
      ? null
      : canonicalJson(baseline.critiqueEvidence) !== canonicalJson(current.critiqueEvidence),
    triggerRuns: nullableDelta(baseline.triggerRuns, current.triggerRuns),
    triggerWaits: nullableDelta(baseline.triggerWaits, current.triggerWaits),
    convexReads: nullableDelta(baseline.convexReads, current.convexReads),
    convexWrites: nullableDelta(baseline.convexWrites, current.convexWrites),
    convexActions: nullableDelta(baseline.convexActions, current.convexActions),
    estimatedCostUsd: Number((current.estimatedCostUsd - baseline.estimatedCostUsd).toFixed(6)),
    moduleVersionChanged: current.moduleVersion !== baseline.moduleVersion,
    inputFingerprintChanged: current.inputFingerprint !== baseline.inputFingerprint,
    configurationFingerprintChanged: current.configurationFingerprint !== baseline.configurationFingerprint,
    outputValidityChanged: current.outputValid !== baseline.outputValid,
    outputArtifactsChanged: outputArtifactMeasurements(baseline.outputArtifacts) !== outputArtifactMeasurements(current.outputArtifacts),
  };
}
