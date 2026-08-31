import type { PipelineEntry } from "@/engine/types";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import type { StudioActionApprovalReceipt } from "@/lib/studioActionApprovalContract";

/**
 * This is deliberately not a shortened inception probe. A qualification
 * benchmark executes the exact production creative/QA chain and removes only
 * post-master delivery/fan-out work, so it can prove a final master without
 * creating a YouTube draft or a public side effect.
 */
export const ROUTE_QUALIFICATION_BENCHMARK_VERSION =
  "route-qualification-benchmark/v1" as const;

/**
 * A signed owner approval may narrow this; it may never exceed this hard rail.
 * Studio action approvals have the same $100 signing ceiling, so a benchmark
 * can never be prepared but impossible to issue.
 */
export const MAX_ROUTE_QUALIFICATION_BENCHMARK_COST_USD = 100;

const DELIVERY_ONLY_BLOCKS = new Set([
  "upload_draft",
  "notify",
  "cleanup",
  "shorts_spinoff",
  "crosspost",
  "emit_bundle",
]);

export interface RouteQualificationBenchmarkInvocationContext {
  keyPrefix: string;
  seedStore: Record<string, unknown>;
  madeForKids: boolean;
}

export interface RouteQualificationBenchmarkInput {
  version: typeof ROUTE_QUALIFICATION_BENCHMARK_VERSION;
  /** The exact current channel pipeline that the preflight receipt binds. */
  productionPipeline: PipelineEntry[];
  /** Exact production pipeline minus delivery-only terminal work. */
  benchmarkPipeline: PipelineEntry[];
  moduleConfigOverride: Record<string, Record<string, unknown>>;
  invocationContext: RouteQualificationBenchmarkInvocationContext;
  productionPipelineFingerprint: string;
  benchmarkPipelineFingerprint: string;
  preflightReceiptFingerprint: string;
}

/**
 * Write-once handoff from the owner-only Studio control to the dedicated
 * Trigger dispatcher. It contains a complete sealed invocation but no
 * provider credential, media bytes, or publishing authority.
 */
export interface RouteQualificationBenchmarkDispatchEnvelope {
  readonly version: typeof ROUTE_QUALIFICATION_BENCHMARK_VERSION;
  readonly ownerId: string;
  readonly channelId: string;
  readonly runId: string;
  readonly dispatchKey: string;
  readonly input: RouteQualificationBenchmarkInput;
  readonly maximumCostUsd: number;
  readonly approval: StudioActionApprovalReceipt;
  readonly approvalFingerprint: string;
  readonly dispatchEnvelopeFingerprint: string;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function canonicalPipelineFingerprint(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

function clonedPipeline(value: readonly PipelineEntry[]): PipelineEntry[] {
  return structuredClone(value as PipelineEntry[]);
}

/**
 * Produces the only permitted private form of a production route. It preserves
 * every creative, render, final-master and QA parameter byte-for-byte.
 */
export function buildRouteQualificationBenchmarkPipeline(
  productionPipeline: readonly PipelineEntry[],
): PipelineEntry[] {
  if (!Array.isArray(productionPipeline) || productionPipeline.length === 0) {
    throw new Error("route qualification benchmark requires a non-empty production pipeline");
  }
  const qaIndexes = productionPipeline
    .map((entry, index) => entry.block === "qa_visual" ? index : -1)
    .filter((index) => index >= 0);
  const uploadIndexes = productionPipeline
    .map((entry, index) => entry.block === "upload_draft" ? index : -1)
    .filter((index) => index >= 0);
  if (qaIndexes.length !== 1 || uploadIndexes.length !== 1 || qaIndexes[0]! >= uploadIndexes[0]!) {
    throw new Error(
      "route qualification benchmark requires exactly one production qa_visual followed by upload_draft",
    );
  }
  const benchmark = productionPipeline
    .filter((entry) => !DELIVERY_ONLY_BLOCKS.has(entry.block))
    .map((entry) => ({
      block: entry.block,
      ...(entry.params === undefined ? {} : { params: structuredClone(entry.params) }),
    }));
  if (benchmark.some((entry) => DELIVERY_ONLY_BLOCKS.has(entry.block))) {
    throw new Error("route qualification benchmark retained a delivery-only block");
  }
  if (benchmark.filter((entry) => entry.block === "qa_visual").length !== 1) {
    throw new Error("route qualification benchmark lost its production qa_visual gate");
  }
  return benchmark;
}

export function routeQualificationBenchmarkInputFingerprint(
  value: Omit<RouteQualificationBenchmarkInput, "productionPipelineFingerprint" | "benchmarkPipelineFingerprint">,
): string {
  return canonicalPipelineFingerprint({
    version: value.version,
    productionPipeline: value.productionPipeline,
    benchmarkPipeline: value.benchmarkPipeline,
    moduleConfigOverride: value.moduleConfigOverride,
    invocationContext: value.invocationContext,
    preflightReceiptFingerprint: value.preflightReceiptFingerprint,
  });
}

/** Builds and seals a future Trigger input from server-derived channel state. */
export function createRouteQualificationBenchmarkInput(args: {
  productionPipeline: readonly PipelineEntry[];
  moduleConfigOverride: Record<string, Record<string, unknown>>;
  invocationContext: RouteQualificationBenchmarkInvocationContext;
  preflightReceiptFingerprint: string;
}): RouteQualificationBenchmarkInput {
  const productionPipeline = clonedPipeline(args.productionPipeline);
  const benchmarkPipeline = buildRouteQualificationBenchmarkPipeline(productionPipeline);
  const input: RouteQualificationBenchmarkInput = {
    version: ROUTE_QUALIFICATION_BENCHMARK_VERSION,
    productionPipeline,
    benchmarkPipeline,
    moduleConfigOverride: structuredClone(args.moduleConfigOverride),
    invocationContext: structuredClone(args.invocationContext),
    productionPipelineFingerprint: canonicalPipelineFingerprint(productionPipeline),
    benchmarkPipelineFingerprint: canonicalPipelineFingerprint(benchmarkPipeline),
    preflightReceiptFingerprint: args.preflightReceiptFingerprint,
  };
  assertRouteQualificationBenchmarkInput(input);
  return input;
}

/** Runtime-safe structural gate shared by the Trigger receiver and tests. */
export function assertRouteQualificationBenchmarkInput(
  value: unknown,
): asserts value is RouteQualificationBenchmarkInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("route qualification benchmark input is invalid");
  }
  const input = value as RouteQualificationBenchmarkInput;
  if (
    input.version !== ROUTE_QUALIFICATION_BENCHMARK_VERSION ||
    !Array.isArray(input.productionPipeline) ||
    !Array.isArray(input.benchmarkPipeline) ||
    !input.moduleConfigOverride || typeof input.moduleConfigOverride !== "object" ||
    Array.isArray(input.moduleConfigOverride) ||
    !input.invocationContext || typeof input.invocationContext !== "object" ||
    Array.isArray(input.invocationContext) ||
    typeof input.invocationContext.keyPrefix !== "string" || !input.invocationContext.keyPrefix.trim() ||
    !input.invocationContext.seedStore || typeof input.invocationContext.seedStore !== "object" ||
    Array.isArray(input.invocationContext.seedStore) ||
    typeof input.invocationContext.madeForKids !== "boolean" ||
    !isSha256(input.productionPipelineFingerprint) ||
    !isSha256(input.benchmarkPipelineFingerprint) ||
    !isSha256(input.preflightReceiptFingerprint)
  ) {
    throw new Error("route qualification benchmark input is structurally invalid");
  }
  const expectedBenchmark = buildRouteQualificationBenchmarkPipeline(input.productionPipeline);
  if (
    canonicalJson(expectedBenchmark) !== canonicalJson(input.benchmarkPipeline) ||
    canonicalPipelineFingerprint(input.productionPipeline) !== input.productionPipelineFingerprint ||
    canonicalPipelineFingerprint(input.benchmarkPipeline) !== input.benchmarkPipelineFingerprint
  ) {
    throw new Error("route qualification benchmark does not match its exact production pipeline");
  }
}

export function routeQualificationBenchmarkApprovalSubject(args: {
  ownerId: string;
  channelId: string;
  runId: string;
  benchmarkInput: RouteQualificationBenchmarkInput;
  maximumCostUsd: number;
}): string {
  return `route-qualification-benchmark:${sha256Hex(canonicalJson({
    ownerId: args.ownerId,
    channelId: args.channelId,
    runId: args.runId,
    productionPipelineFingerprint: args.benchmarkInput.productionPipelineFingerprint,
    benchmarkPipelineFingerprint: args.benchmarkInput.benchmarkPipelineFingerprint,
    preflightReceiptFingerprint: args.benchmarkInput.preflightReceiptFingerprint,
    maximumCostUsd: args.maximumCostUsd,
  }))}`;
}

/**
 * Browser-confirmed intent deliberately precedes the heavy route derivation.
 * It authorizes only a bounded private request key; the dispatcher later
 * signs the exact pipeline input after reloading all current sealed evidence.
 */
export function routeQualificationBenchmarkRequestApprovalSubject(args: {
  ownerId: string;
  channelId: string;
  runId: string;
  dispatchKey: string;
  maximumCostUsd: number;
}): string {
  return `route-qualification-benchmark-request:${sha256Hex(canonicalJson({
    ownerId: requiredId(args.ownerId, "route qualification benchmark request owner id"),
    channelId: requiredId(args.channelId, "route qualification benchmark request channel id"),
    runId: requiredId(args.runId, "route qualification benchmark request run id"),
    dispatchKey: requiredId(args.dispatchKey, "route qualification benchmark request dispatch key"),
    maximumCostUsd: args.maximumCostUsd,
  }))}`;
}

export function assertRouteQualificationBenchmarkRequestApproval(input: {
  maximumCostUsd: unknown;
  approval: StudioActionApprovalReceipt | unknown;
}): asserts input is {
  maximumCostUsd: number;
  approval: StudioActionApprovalReceipt;
} {
  if (
    typeof input.maximumCostUsd !== "number" ||
    !Number.isFinite(input.maximumCostUsd) ||
    input.maximumCostUsd <= 0 ||
    input.maximumCostUsd > MAX_ROUTE_QUALIFICATION_BENCHMARK_COST_USD ||
    !input.approval || typeof input.approval !== "object" ||
    (input.approval as StudioActionApprovalReceipt).action !== "route-qualification-benchmark-request" ||
    (input.approval as StudioActionApprovalReceipt).maxCostUsd !== input.maximumCostUsd
  ) {
    throw new Error("route qualification benchmark request approval is invalid");
  }
}

/** Binds the exact approved input to a single Trigger dispatch/retry envelope. */
export function routeQualificationBenchmarkDispatchEnvelopeFingerprint(args: {
  ownerId: string;
  channelId: string;
  runId: string;
  dispatchKey: string;
  benchmarkInput: RouteQualificationBenchmarkInput;
  maximumCostUsd: number;
  approval: StudioActionApprovalReceipt;
}): string {
  return sha256Hex(canonicalJson({
    version: ROUTE_QUALIFICATION_BENCHMARK_VERSION,
    ownerId: args.ownerId,
    channelId: args.channelId,
    runId: args.runId,
    dispatchKey: args.dispatchKey,
    benchmarkInput: args.benchmarkInput,
    maximumCostUsd: args.maximumCostUsd,
    approval: args.approval,
  }));
}

export function assertRouteQualificationBenchmarkAdmission(input: {
  benchmark: unknown;
  maximumCostUsd: unknown;
  approval: StudioActionApprovalReceipt | unknown;
}): asserts input is {
  benchmark: RouteQualificationBenchmarkInput;
  maximumCostUsd: number;
  approval: StudioActionApprovalReceipt;
} {
  assertRouteQualificationBenchmarkInput(input.benchmark);
  if (
    typeof input.maximumCostUsd !== "number" ||
    !Number.isFinite(input.maximumCostUsd) ||
    input.maximumCostUsd <= 0 ||
    input.maximumCostUsd > MAX_ROUTE_QUALIFICATION_BENCHMARK_COST_USD ||
    !input.approval || typeof input.approval !== "object" ||
    (input.approval as StudioActionApprovalReceipt).action !== "route-qualification-benchmark"
  ) {
    throw new Error("route qualification benchmark admission is invalid");
  }
}

function requiredId(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 500 ||
    /[\u0000-\u001f]/.test(value)
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

/**
 * Seals the exact private run after Convex allocates its durable id. A retry
 * can only reuse this byte-equivalent envelope.
 */
export function prepareRouteQualificationBenchmarkDispatchEnvelope(args: {
  ownerId: string;
  channelId: string;
  runId: string;
  dispatchKey: string;
  input: RouteQualificationBenchmarkInput;
  maximumCostUsd: number;
  approval: StudioActionApprovalReceipt;
}): RouteQualificationBenchmarkDispatchEnvelope {
  assertRouteQualificationBenchmarkAdmission({
    benchmark: args.input,
    maximumCostUsd: args.maximumCostUsd,
    approval: args.approval,
  });
  const ownerId = requiredId(args.ownerId, "route qualification benchmark owner id");
  const channelId = requiredId(args.channelId, "route qualification benchmark channel id");
  const runId = requiredId(args.runId, "route qualification benchmark run id");
  const dispatchKey = requiredId(args.dispatchKey, "route qualification benchmark dispatch key");
  const approvalFingerprint = sha256Hex(canonicalJson(args.approval));
  const dispatchEnvelopeFingerprint = routeQualificationBenchmarkDispatchEnvelopeFingerprint({
    ownerId,
    channelId,
    runId,
    dispatchKey,
    benchmarkInput: args.input,
    maximumCostUsd: args.maximumCostUsd,
    approval: args.approval,
  });
  return {
    version: ROUTE_QUALIFICATION_BENCHMARK_VERSION,
    ownerId,
    channelId,
    runId,
    dispatchKey,
    input: structuredClone(args.input),
    maximumCostUsd: args.maximumCostUsd,
    approval: structuredClone(args.approval),
    approvalFingerprint,
    dispatchEnvelopeFingerprint,
  };
}

/** Runtime-safe structural guard shared by Convex persistence and Trigger. */
export function assertRouteQualificationBenchmarkDispatchEnvelope(
  value: unknown,
): asserts value is RouteQualificationBenchmarkDispatchEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("route qualification benchmark dispatch envelope is invalid");
  }
  const envelope = value as RouteQualificationBenchmarkDispatchEnvelope;
  if (envelope.version !== ROUTE_QUALIFICATION_BENCHMARK_VERSION) {
    throw new Error("route qualification benchmark dispatch envelope version is invalid");
  }
  const ownerId = requiredId(envelope.ownerId, "route qualification benchmark envelope owner id");
  const channelId = requiredId(envelope.channelId, "route qualification benchmark envelope channel id");
  const runId = requiredId(envelope.runId, "route qualification benchmark envelope run id");
  const dispatchKey = requiredId(envelope.dispatchKey, "route qualification benchmark envelope dispatch key");
  assertRouteQualificationBenchmarkAdmission({
    benchmark: envelope.input,
    maximumCostUsd: envelope.maximumCostUsd,
    approval: envelope.approval,
  });
  const approvalFingerprint = sha256Hex(canonicalJson(envelope.approval));
  const dispatchEnvelopeFingerprint = routeQualificationBenchmarkDispatchEnvelopeFingerprint({
    ownerId,
    channelId,
    runId,
    dispatchKey,
    benchmarkInput: envelope.input,
    maximumCostUsd: envelope.maximumCostUsd,
    approval: envelope.approval,
  });
  if (
    envelope.approvalFingerprint !== approvalFingerprint ||
    envelope.dispatchEnvelopeFingerprint !== dispatchEnvelopeFingerprint
  ) {
    throw new Error("route qualification benchmark dispatch envelope fingerprint is invalid");
  }
}
