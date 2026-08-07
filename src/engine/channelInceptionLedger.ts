import type {
  AnyChannelInceptionStagePlan,
  ChannelInceptionPlan,
  ChannelInceptionRequest,
} from "./channelInceptionPlan";
import type { ChannelInceptionModuleKey } from "./channelInceptionContracts";

const MAX_CHANNEL_INCEPTION_LEASE_MS = 2 * 60 * 60 * 1_000;

export type ChannelInceptionStageStatus =
  | "pending"
  | "running"
  | "accepted"
  | "complete"
  | "failed"
  | "blocked";

export interface ChannelInceptionLedgerStage {
  moduleKey: ChannelInceptionModuleKey;
  dependsOn: ChannelInceptionModuleKey[];
  stageKey: string;
  idempotencyKey: string;
  inputFingerprint: string;
  contractVersion: string;
  maximumCostUsd: number;
  status: ChannelInceptionStageStatus;
  attempts: number;
  leaseOwner?: string;
  /** Monotonic fencing token; every lease acquisition invalidates older workers. */
  leaseVersion?: number;
  leaseExpiresAt?: number;
  startedAt?: number;
  finishedAt?: number;
  outputs?: unknown;
  outputFingerprint?: string;
  dependencyOutputFingerprints?: Partial<Record<ChannelInceptionModuleKey, string>>;
  executionPhase?: "claimed" | "provider-started";
  error?: string;
}

export interface ChannelInceptionLedgerState {
  schemaVersion: string;
  planKey: string;
  requestFingerprint: string;
  requestSnapshot: ChannelInceptionRequest;
  admission: ChannelInceptionExecutionAdmission;
  costReservations: ChannelInceptionCostReservation[];
  /** `planned` is a truthful, non-executing state awaiting a fresh signed admission. */
  status: "planned" | "running" | "complete" | "blocked";
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  stages: Record<string, ChannelInceptionLedgerStage>;
}

export interface ChannelInceptionStageDescriptor {
  moduleKey: ChannelInceptionModuleKey;
  dependsOn: ChannelInceptionModuleKey[];
  stageKey: string;
  idempotencyKey: string;
  inputFingerprint: string;
  contractVersion: string;
  maximumCostUsd: number;
}

export interface ChannelInceptionExecutionAdmission {
  executionAuthorized: boolean;
  executionCapUsd: number;
  executionReceiptFingerprint?: string;
  probeAuthorized: boolean;
  probeCapUsd: number;
  probeReceiptFingerprint?: string;
  boundRequestFingerprint: string;
}

export interface ChannelInceptionCostReservation {
  lane: "execution" | "probe";
  requestFingerprint: string;
  receiptFingerprint: string;
  stageKey: string;
  attempt: number;
  maximumCostUsd: number;
  reservedAt: number;
}

export interface SubmittedChannelInceptionAdmission {
  executionFresh: boolean;
  executionCapUsd: number;
  executionReceiptFingerprint?: string;
  probeFresh: boolean;
  probeCapUsd: number;
  probeReceiptFingerprint?: string;
}

/** Freshness is checked on first admission; exact persisted receipts may resume after expiry. */
export function resolveChannelInceptionExecutionAdmission(args: {
  requestFingerprint: string;
  submitted: SubmittedChannelInceptionAdmission;
  persisted?: ChannelInceptionExecutionAdmission;
}): ChannelInceptionExecutionAdmission {
  const persistedBound = args.persisted?.boundRequestFingerprint === args.requestFingerprint;
  const executionResumed = Boolean(
    persistedBound &&
    args.persisted?.executionAuthorized &&
    args.persisted.executionReceiptFingerprint &&
    args.persisted.executionReceiptFingerprint === args.submitted.executionReceiptFingerprint &&
    args.persisted.executionCapUsd === args.submitted.executionCapUsd,
  );
  const probeResumed = Boolean(
    persistedBound &&
    args.persisted?.probeAuthorized &&
    args.persisted.probeReceiptFingerprint &&
    args.persisted.probeReceiptFingerprint === args.submitted.probeReceiptFingerprint &&
    args.persisted.probeCapUsd === args.submitted.probeCapUsd,
  );
  return {
    executionAuthorized: args.submitted.executionFresh || executionResumed,
    executionCapUsd: args.submitted.executionCapUsd,
    executionReceiptFingerprint: args.submitted.executionReceiptFingerprint,
    probeAuthorized: args.submitted.probeFresh || probeResumed,
    probeCapUsd: args.submitted.probeCapUsd,
    probeReceiptFingerprint: args.submitted.probeReceiptFingerprint,
    boundRequestFingerprint: args.requestFingerprint,
  };
}

export type ChannelInceptionClaimDisposition =
  | "execute"
  | "recover"
  | "reuse"
  | "busy"
  | "blocked";

export interface ChannelInceptionStageClaim {
  disposition: ChannelInceptionClaimDisposition;
  stage: ChannelInceptionLedgerStage;
  ledger: ChannelInceptionLedgerState;
}

function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim().slice(0, 1_000) || "unknown channel inception failure";
}

function nextLeaseVersion(stage: ChannelInceptionLedgerStage): number {
  const current = stage.leaseVersion ?? 0;
  if (!Number.isSafeInteger(current) || current < 0 || current >= Number.MAX_SAFE_INTEGER) {
    throw new Error(`Channel inception stage lease version is invalid: ${stage.moduleKey}`);
  }
  return current + 1;
}

function assertStageLease(args: {
  stage: ChannelInceptionLedgerStage;
  claimant: string;
  leaseVersion: number;
  operation: string;
}): void {
  if (
    !Number.isSafeInteger(args.leaseVersion) ||
    args.leaseVersion <= 0 ||
    args.stage.status !== "running" ||
    args.stage.leaseOwner !== args.claimant ||
    args.stage.leaseVersion !== args.leaseVersion
  ) {
    throw new Error(
      `Channel inception stage ${args.operation} lost its fenced lease: ${args.stage.moduleKey}`,
    );
  }
}

function descriptor(stage: ChannelInceptionStageDescriptor): ChannelInceptionStageDescriptor {
  return {
    moduleKey: stage.moduleKey,
    dependsOn: [...stage.dependsOn],
    stageKey: stage.stageKey,
    idempotencyKey: stage.idempotencyKey,
    inputFingerprint: stage.inputFingerprint,
    contractVersion: stage.contractVersion,
    maximumCostUsd: stage.maximumCostUsd,
  };
}

function stageRecord(
  stage: ChannelInceptionStageDescriptor,
  previous?: ChannelInceptionLedgerStage,
): ChannelInceptionLedgerStage {
  const previousDependencies = previous?.dependsOn ?? [];
  if (
    previous?.stageKey === stage.stageKey &&
    previousDependencies.length === stage.dependsOn.length &&
    previousDependencies.every((dependency, index) => dependency === stage.dependsOn[index]) &&
    previous.idempotencyKey === stage.idempotencyKey &&
    previous.inputFingerprint === stage.inputFingerprint &&
    previous.contractVersion === stage.contractVersion &&
    previous.maximumCostUsd === stage.maximumCostUsd
  ) {
    return { ...previous };
  }
  return { ...stage, status: "pending", attempts: 0 };
}

function cloneLedger(ledger: ChannelInceptionLedgerState): ChannelInceptionLedgerState {
  return {
    ...ledger,
    admission: { ...ledger.admission },
    costReservations: [...(ledger.costReservations ?? [])],
    stages: Object.fromEntries(
      Object.entries(ledger.stages).map(([key, stage]) => [key, { ...stage }]),
    ),
  };
}

function requireStage(
  ledger: ChannelInceptionLedgerState,
  stage: ChannelInceptionStageDescriptor,
): ChannelInceptionLedgerStage {
  const persisted = ledger.stages[stage.moduleKey];
  if (!persisted) throw new Error(`Channel inception stage is not planned: ${stage.moduleKey}`);
  if (
    (persisted.dependsOn ?? []).length !== stage.dependsOn.length ||
    !(persisted.dependsOn ?? []).every(
      (dependency, index) => dependency === stage.dependsOn[index],
    ) ||
    persisted.stageKey !== stage.stageKey ||
    persisted.idempotencyKey !== stage.idempotencyKey ||
    persisted.inputFingerprint !== stage.inputFingerprint ||
    persisted.contractVersion !== stage.contractVersion ||
    persisted.maximumCostUsd !== stage.maximumCostUsd
  ) {
    throw new Error(`Channel inception stage identity mismatch: ${stage.moduleKey}`);
  }
  return persisted;
}

/**
 * Materialize a plan into a compact per-channel ledger. Matching content keys
 * retain their completed receipts across plan revisions; changed inputs reset
 * only the affected module and its content-addressed dependants.
 */
export function beginChannelInceptionLedger(
  previous: ChannelInceptionLedgerState | undefined,
  plan: {
    schemaVersion: string;
    inceptionKey: string;
    requestFingerprint: string;
    requestSnapshot: ChannelInceptionRequest;
    admission: ChannelInceptionExecutionAdmission;
    stages: readonly ChannelInceptionStageDescriptor[];
  },
  now: number,
): ChannelInceptionLedgerState {
  const ordered = new Set<ChannelInceptionModuleKey>();
  for (const stage of plan.stages) {
    if (ordered.has(stage.moduleKey)) {
      throw new Error(`Channel inception plan contains duplicate stage: ${stage.moduleKey}`);
    }
    for (const dependency of stage.dependsOn) {
      if (!ordered.has(dependency)) {
        throw new Error(
          `Channel inception stage ${stage.moduleKey} has missing or unordered dependency ${dependency}`,
        );
      }
    }
    ordered.add(stage.moduleKey);
  }
  if (previous) {
    const nextByModule = new Map(plan.stages.map((stage) => [stage.moduleKey, stage]));
    for (const running of Object.values(previous.stages)) {
      if (running.status !== "running" || (running.leaseExpiresAt ?? 0) <= now) continue;
      const next = nextByModule.get(running.moduleKey);
      const unchanged = Boolean(
        next &&
        next.stageKey === running.stageKey &&
        next.idempotencyKey === running.idempotencyKey &&
        next.inputFingerprint === running.inputFingerprint &&
        next.contractVersion === running.contractVersion &&
        next.maximumCostUsd === running.maximumCostUsd,
      );
      if (!unchanged) {
        throw new Error(
          `Channel inception plan revision conflicts with active stage lease: ${running.moduleKey}`,
        );
      }
    }
  }
  const stages = Object.fromEntries(
    plan.stages.map((stage) => {
      const next = descriptor(stage);
      return [stage.moduleKey, stageRecord(next, previous?.stages[stage.moduleKey])];
    }),
  );
  const readiness = stages["channel-inception-readiness"];
  const complete = readiness?.status === "complete" || readiness?.status === "accepted";
  const blocked = Object.values(stages).some((stage) => stage.status === "blocked");
  return {
    schemaVersion: plan.schemaVersion,
    planKey: plan.inceptionKey,
    requestFingerprint: plan.requestFingerprint,
    requestSnapshot: plan.requestSnapshot,
    admission: { ...plan.admission },
    costReservations: [...(previous?.costReservations ?? [])],
    status: complete
      ? "complete"
      : blocked
        ? "blocked"
        : plan.admission.executionAuthorized
          ? "running"
          : "planned",
    startedAt: previous?.startedAt ?? now,
    updatedAt: now,
    ...(complete ? { completedAt: readiness.finishedAt ?? previous?.completedAt ?? now } : {}),
    stages,
  };
}

export function invalidateChannelInceptionStageAndDescendants(
  ledger: ChannelInceptionLedgerState,
  moduleKey: ChannelInceptionModuleKey,
): void {
  const invalidated = new Set<ChannelInceptionModuleKey>([moduleKey]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const stage of Object.values(ledger.stages)) {
      if (
        !invalidated.has(stage.moduleKey) &&
        stage.dependsOn.some((dependency) => invalidated.has(dependency))
      ) {
        invalidated.add(stage.moduleKey);
        changed = true;
      }
    }
  }
  for (const key of invalidated) {
    const stage = ledger.stages[key];
    if (!stage) continue;
    ledger.stages[key] = {
      ...stage,
      status: "pending",
      attempts: 0,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      startedAt: undefined,
      finishedAt: undefined,
      outputs: undefined,
      outputFingerprint: undefined,
      dependencyOutputFingerprints: undefined,
      executionPhase: undefined,
      error: undefined,
    };
  }
  ledger.status = ledger.admission.executionAuthorized ? "running" : "planned";
  ledger.completedAt = undefined;
}

export function claimChannelInceptionLedgerStage(args: {
  ledger: ChannelInceptionLedgerState;
  stage: ChannelInceptionStageDescriptor;
  claimant: string;
  now: number;
  leaseMs: number;
  maximumAttempts: number;
  observedOutputFingerprint?: string;
}): ChannelInceptionStageClaim {
  if (!args.claimant.trim() || args.claimant.length > 200) {
    throw new Error("Channel inception stage claimant must contain 1-200 characters");
  }
  if (
    !Number.isFinite(args.leaseMs) ||
    args.leaseMs < 1_000 ||
    args.leaseMs > MAX_CHANNEL_INCEPTION_LEASE_MS
  ) {
    throw new Error("Channel inception stage lease must be between one second and two hours");
  }
  if (!Number.isInteger(args.maximumAttempts) || args.maximumAttempts < 1 || args.maximumAttempts > 5) {
    throw new Error("Channel inception stage maximumAttempts must be an integer from 1 to 5");
  }

  const ledger = cloneLedger(args.ledger);
  let stage = requireStage(ledger, args.stage);
  if (ledger.status === "planned") {
    return {
      disposition: "blocked",
      stage: { ...stage, error: "provider execution admission is missing" },
      ledger,
    };
  }
  const dependencies = stage.dependsOn.map((dependency) => ledger.stages[dependency]);
  if (stage.status === "complete" || stage.status === "accepted") {
    const dependencyFingerprintsMatch = dependencies.every((dependency) =>
      dependency?.outputFingerprint &&
      stage.dependencyOutputFingerprints?.[dependency.moduleKey] === dependency.outputFingerprint
    );
    if (
      args.observedOutputFingerprint &&
      args.observedOutputFingerprint === stage.outputFingerprint &&
      dependencyFingerprintsMatch
    ) {
      return { disposition: "reuse", stage: { ...stage }, ledger };
    }
    invalidateChannelInceptionStageAndDescendants(ledger, stage.moduleKey);
    stage = requireStage(ledger, args.stage);
  }
  if (stage.status === "blocked") {
    return { disposition: "blocked", stage: { ...stage }, ledger };
  }
  if (dependencies.some((dependency) => !dependency || dependency.status === "blocked")) {
    return { disposition: "blocked", stage: { ...stage }, ledger };
  }
  const unaddressedDependency = dependencies.find((dependency) =>
    (dependency?.status === "complete" || dependency?.status === "accepted") &&
    !dependency.outputFingerprint
  );
  if (unaddressedDependency) {
    invalidateChannelInceptionStageAndDescendants(ledger, unaddressedDependency.moduleKey);
    ledger.updatedAt = args.now;
    return { disposition: "busy", stage: { ...ledger.stages[stage.moduleKey]! }, ledger };
  }
  if (
    dependencies.some(
      (dependency) => dependency.status !== "complete" && dependency.status !== "accepted",
    )
  ) {
    return { disposition: "busy", stage: { ...stage }, ledger };
  }
  const activeLease = stage.status === "running" && (stage.leaseExpiresAt ?? 0) > args.now;
  if (activeLease && stage.leaseOwner !== args.claimant) {
    return { disposition: "busy", stage: { ...stage }, ledger };
  }
  if (stage.status === "running" && stage.executionPhase === "claimed") {
    const resumed = {
      ...stage,
      leaseOwner: args.claimant,
      leaseVersion: nextLeaseVersion(stage),
      leaseExpiresAt: args.now + args.leaseMs,
    };
    ledger.stages[stage.moduleKey] = resumed;
    ledger.updatedAt = args.now;
    return { disposition: "execute", stage: { ...resumed }, ledger };
  }
  if (
    (stage.status === "running" || stage.status === "failed") &&
    stage.executionPhase === "provider-started"
  ) {
    const recovered = {
      ...stage,
      status: "running" as const,
      leaseOwner: args.claimant,
      leaseVersion: nextLeaseVersion(stage),
      leaseExpiresAt: args.now + args.leaseMs,
    };
    ledger.stages[stage.moduleKey] = recovered;
    ledger.updatedAt = args.now;
    return { disposition: "recover", stage: { ...recovered }, ledger };
  }
  const nextAttempt = stage.attempts + 1;
  if (stage.attempts >= args.maximumAttempts) {
    const blocked: ChannelInceptionLedgerStage = {
      ...stage,
      status: "blocked",
      error: stage.error ?? `maximum attempts reached (${args.maximumAttempts})`,
      finishedAt: args.now,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
    };
    ledger.stages[stage.moduleKey] = blocked;
    ledger.status = "blocked";
    ledger.updatedAt = args.now;
    return { disposition: "blocked", stage: { ...blocked }, ledger };
  }
  if (stage.maximumCostUsd > 0) {
    const isProbe = stage.moduleKey === "channel-inception-probe";
    const authorized = isProbe
      ? ledger.admission.probeAuthorized
      : ledger.admission.executionAuthorized;
    const cap = isProbe ? ledger.admission.probeCapUsd : ledger.admission.executionCapUsd;
    // `maximumCostUsd` is the catalog's hard ceiling. A probe receipt may
    // deliberately authorize less (for example, a $1 per-video budget), so
    // reserve the exact smaller authority instead of rejecting it against $3.
    const reservationCostUsd = isProbe
      ? Math.min(stage.maximumCostUsd, cap)
      : stage.maximumCostUsd;
    const receiptFingerprint = isProbe
      ? ledger.admission.probeReceiptFingerprint
      : ledger.admission.executionReceiptFingerprint;
    const existingReservation = ledger.costReservations.find((reservation) =>
      reservation.lane === (isProbe ? "probe" : "execution") &&
      reservation.receiptFingerprint === receiptFingerprint &&
      reservation.stageKey === stage.stageKey
    );
    const reserved = ledger.costReservations
      .filter((reservation) =>
        reservation.lane === (isProbe ? "probe" : "execution") &&
        reservation.receiptFingerprint === receiptFingerprint)
      .reduce((sum, reservation) => sum + reservation.maximumCostUsd, 0);
    const bound = ledger.admission.boundRequestFingerprint === ledger.requestFingerprint;
    const invalidatedReservationReplay = Boolean(
      existingReservation && stage.status === "pending" && stage.attempts === 0,
    );
    if (invalidatedReservationReplay) {
      return {
        disposition: "blocked",
        stage: {
          ...stage,
          error: "fresh provider approval is required after output invalidation",
        },
        ledger,
      };
    }
    if (
      !authorized ||
      !bound ||
      (isProbe && reservationCostUsd <= 0) ||
      (!existingReservation && reserved + reservationCostUsd > cap + Number.EPSILON)
    ) {
      const blocked: ChannelInceptionLedgerStage = {
        ...stage,
        status: "blocked",
        error: !authorized || !bound || (isProbe && reservationCostUsd <= 0)
          ? "provider execution admission is missing"
          : `channel inception cost ceiling exceeded (${reserved + reservationCostUsd} > ${cap})`,
        finishedAt: args.now,
      };
      ledger.stages[stage.moduleKey] = blocked;
      ledger.status = "blocked";
      ledger.updatedAt = args.now;
      return { disposition: "blocked", stage: { ...blocked }, ledger };
    }
    if (!receiptFingerprint) throw new Error("authorized inception admission has no receipt fingerprint");
    if (!existingReservation) {
      ledger.costReservations.push({
        lane: isProbe ? "probe" : "execution",
        requestFingerprint: ledger.requestFingerprint,
        receiptFingerprint,
        stageKey: stage.stageKey,
        attempt: nextAttempt,
        maximumCostUsd: reservationCostUsd,
        reservedAt: args.now,
      });
    }
  }
  const claimed: ChannelInceptionLedgerStage = {
    ...stage,
    status: "running",
    attempts: nextAttempt,
    leaseOwner: args.claimant,
    leaseVersion: nextLeaseVersion(stage),
    leaseExpiresAt: args.now + args.leaseMs,
    startedAt: stage.startedAt ?? args.now,
    finishedAt: undefined,
    // Preserve durable checkpoints from an expired/failed attempt. The next
    // executor receives them and must resume instead of starting paid work over.
    outputs: stage.outputs,
    executionPhase: "claimed",
    dependencyOutputFingerprints: Object.fromEntries(
      dependencies.map((dependency) => [dependency!.moduleKey, dependency!.outputFingerprint!]),
    ),
    error: undefined,
  };
  ledger.stages[stage.moduleKey] = claimed;
  ledger.status = "running";
  ledger.updatedAt = args.now;
  ledger.completedAt = undefined;
  return { disposition: "execute", stage: { ...claimed }, ledger };
}

export function checkpointChannelInceptionLedgerStage(args: {
  ledger: ChannelInceptionLedgerState;
  stage: ChannelInceptionStageDescriptor;
  claimant: string;
  leaseVersion: number;
  outputs: unknown;
  executionPhase?: "claimed" | "provider-started";
  now: number;
}): ChannelInceptionLedgerState {
  const ledger = cloneLedger(args.ledger);
  const stage = requireStage(ledger, args.stage);
  assertStageLease({
    stage,
    claimant: args.claimant,
    leaseVersion: args.leaseVersion,
    operation: "checkpoint",
  });
  ledger.stages[stage.moduleKey] = {
    ...stage,
    outputs: args.outputs,
    ...(args.executionPhase ? { executionPhase: args.executionPhase } : {}),
  };
  ledger.updatedAt = args.now;
  return ledger;
}

export function heartbeatChannelInceptionLedgerStage(args: {
  ledger: ChannelInceptionLedgerState;
  stage: ChannelInceptionStageDescriptor;
  claimant: string;
  leaseVersion: number;
  now: number;
  leaseMs: number;
}): ChannelInceptionLedgerState {
  if (
    !Number.isFinite(args.leaseMs) ||
    args.leaseMs < 1_000 ||
    args.leaseMs > MAX_CHANNEL_INCEPTION_LEASE_MS
  ) {
    throw new Error("Channel inception heartbeat lease must be between one second and two hours");
  }
  const ledger = cloneLedger(args.ledger);
  const stage = requireStage(ledger, args.stage);
  assertStageLease({
    stage,
    claimant: args.claimant,
    leaseVersion: args.leaseVersion,
    operation: "heartbeat",
  });
  ledger.stages[stage.moduleKey] = {
    ...stage,
    leaseExpiresAt: args.now + args.leaseMs,
  };
  ledger.updatedAt = args.now;
  return ledger;
}

export function completeChannelInceptionLedgerStage(args: {
  ledger: ChannelInceptionLedgerState;
  stage: ChannelInceptionStageDescriptor;
  claimant: string;
  leaseVersion: number;
  status: "accepted" | "complete" | "blocked";
  outputs?: unknown;
  outputFingerprint: string;
  now: number;
}): ChannelInceptionLedgerState {
  const ledger = cloneLedger(args.ledger);
  const stage = requireStage(ledger, args.stage);
  assertStageLease({
    stage,
    claimant: args.claimant,
    leaseVersion: args.leaseVersion,
    operation: "completion",
  });
  if (!/^[a-f0-9]{64}$/.test(args.outputFingerprint)) {
    throw new Error(`Channel inception stage output fingerprint is invalid: ${stage.moduleKey}`);
  }
  const changedDependency = stage.dependsOn.find((dependency) => {
    const current = ledger.stages[dependency]?.outputFingerprint;
    return !current || stage.dependencyOutputFingerprints?.[dependency] !== current;
  });
  if (changedDependency) {
    throw new Error(
      `Channel inception stage dependency changed before completion: ${changedDependency}`,
    );
  }
  const completed: ChannelInceptionLedgerStage = {
    ...stage,
    status: args.status,
    outputs: args.outputs,
    outputFingerprint: args.outputFingerprint,
    finishedAt: args.now,
    leaseOwner: undefined,
    leaseExpiresAt: undefined,
    error: args.status === "blocked" ? stage.error ?? "stage blocked" : undefined,
  };
  ledger.stages[stage.moduleKey] = completed;
  ledger.updatedAt = args.now;
  if (args.status === "blocked") ledger.status = "blocked";
  if (
    stage.moduleKey === "channel-inception-readiness" &&
    (args.status === "complete" || args.status === "accepted")
  ) {
    const incomplete = stage.dependsOn.filter((dependency) => {
      const receipt = ledger.stages[dependency];
      return receipt?.status !== "complete" && receipt?.status !== "accepted";
    });
    if (incomplete.length) {
      throw new Error(
        `Channel inception readiness cannot complete before dependencies: ${incomplete.join(", ")}`,
      );
    }
    ledger.status = "complete";
    ledger.completedAt = args.now;
  }
  return ledger;
}

export function failChannelInceptionLedgerStage(args: {
  ledger: ChannelInceptionLedgerState;
  stage: ChannelInceptionStageDescriptor;
  claimant: string;
  leaseVersion: number;
  error: unknown;
  retryable: boolean;
  now: number;
}): ChannelInceptionLedgerState {
  const ledger = cloneLedger(args.ledger);
  const stage = requireStage(ledger, args.stage);
  assertStageLease({
    stage,
    claimant: args.claimant,
    leaseVersion: args.leaseVersion,
    operation: "failure",
  });
  ledger.stages[stage.moduleKey] = {
    ...stage,
    status: args.retryable ? "failed" : "blocked",
    error: cleanError(args.error),
    finishedAt: args.now,
    leaseOwner: undefined,
    leaseExpiresAt: undefined,
  };
  ledger.status = args.retryable ? "running" : "blocked";
  ledger.updatedAt = args.now;
  return ledger;
}

export interface ChannelInceptionLedgerAdapter {
  claim(
    stage: AnyChannelInceptionStagePlan,
    options: { maximumAttempts: number; observedOutputFingerprint?: string },
  ): Promise<{
    disposition: ChannelInceptionClaimDisposition;
    outputs?: unknown;
    executionPhase?: "claimed" | "provider-started";
    leaseVersion?: number;
  }>;
  complete(
    stage: AnyChannelInceptionStagePlan,
    leaseVersion: number,
    status: "accepted" | "complete" | "blocked",
    outputs: unknown | undefined,
    outputFingerprint: string,
  ): Promise<void>;
  checkpoint(
    stage: AnyChannelInceptionStagePlan,
    leaseVersion: number,
    outputs: unknown,
    executionPhase?: "claimed" | "provider-started",
  ): Promise<void>;
  heartbeat(stage: AnyChannelInceptionStagePlan, leaseVersion: number): Promise<void>;
  fail(
    stage: AnyChannelInceptionStagePlan,
    leaseVersion: number,
    error: unknown,
    retryable: boolean,
  ): Promise<void>;
}

export interface ChannelInceptionPersistedValue<T> {
  value: T;
  evidence?: unknown;
  /** Override when the authoritative domain receipt is richer than `value`. */
  outputFingerprint?: string;
  completionStatus?: "accepted" | "complete" | "blocked";
}

export interface RunChannelInceptionStageOptions<T> {
  plan: ChannelInceptionPlan;
  moduleKey: ChannelInceptionModuleKey;
  ledger: ChannelInceptionLedgerAdapter;
  maximumAttempts?: number;
  /** False on the task's final retry so the ledger cannot remain failed/running forever. */
  retryableOnError?: boolean;
  /** Rehydrate real persisted domain state after a completed ledger receipt. */
  loadCompleted: () => Promise<ChannelInceptionPersistedValue<T> | undefined>;
  /** Adopt real pre-ledger state without invoking a provider. Must be read-only. */
  adoptExisting?: () => Promise<ChannelInceptionPersistedValue<T> | undefined>;
  /**
   * Explicit mode is reserved for durable child/provider operations. The
   * executor must checkpoint its exact child identity, then call
   * `markProviderStarted` immediately before dispatch.
   */
  providerStart?: "automatic" | "explicit";
  recover?: (
    checkpoint: unknown,
    controls: ChannelInceptionExecutionControls,
  ) => Promise<ChannelInceptionPersistedValue<T> | undefined>;
  fingerprint?: (persisted: ChannelInceptionPersistedValue<T>) => string;
  /** The real executor; it must durably persist its domain output before returning. */
  execute: (
    checkpoint: unknown,
    controls: ChannelInceptionExecutionControls,
  ) => Promise<ChannelInceptionPersistedValue<T>>;
}

export interface ChannelInceptionExecutionControls {
  checkpoint(outputs: unknown): Promise<void>;
  markProviderStarted(outputs: unknown): Promise<void>;
}

export interface ChannelInceptionStageRunResult<T> {
  value: T;
  disposition: "reused" | "accepted" | "executed";
}

export class ChannelInceptionStageBusyError extends Error {}
export class ChannelInceptionStageBlockedError extends Error {}

/**
 * Idempotent execution shell shared by the real Trigger task and deterministic
 * tests. It never substitutes a mock executor: callers pass the existing real
 * provider-producing function in `execute`.
 */
export async function runChannelInceptionStage<T>(
  options: RunChannelInceptionStageOptions<T>,
): Promise<ChannelInceptionStageRunResult<T>> {
  const stage = options.plan.stages.find((candidate) => candidate.moduleKey === options.moduleKey);
  if (!stage) throw new Error(`Channel inception module is not applicable: ${options.moduleKey}`);
  const fingerprint = (persisted: ChannelInceptionPersistedValue<T>): string => {
    const value = persisted.outputFingerprint ?? options.fingerprint?.(persisted);
    if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
      throw new Error(`${stage.moduleKey} requires an explicit SHA-256 output fingerprint`);
    }
    return value;
  };
  const observedPersisted = await options.loadCompleted();
  const claim = await options.ledger.claim(stage, {
    maximumAttempts: options.maximumAttempts ?? 3,
    ...(observedPersisted
      ? { observedOutputFingerprint: fingerprint(observedPersisted) }
      : {}),
  });
  if (
    (claim.disposition === "execute" || claim.disposition === "recover") &&
    (!Number.isSafeInteger(claim.leaseVersion) || (claim.leaseVersion ?? 0) <= 0)
  ) {
    throw new Error(`${stage.moduleKey} acquired a lease without a fencing token`);
  }
  const leaseVersion = claim.leaseVersion as number;
  let providerStarted = claim.executionPhase === "provider-started";
  const controls: ChannelInceptionExecutionControls = {
    checkpoint: (outputs) => options.ledger.checkpoint(stage, leaseVersion, outputs),
    markProviderStarted: async (outputs) => {
      await options.ledger.checkpoint(stage, leaseVersion, outputs, "provider-started");
      providerStarted = true;
    },
  };
  if (claim.disposition === "busy") {
    throw new ChannelInceptionStageBusyError(
      `${stage.moduleKey} is waiting for dependencies or already has an active lease`,
    );
  }
  if (claim.disposition === "blocked") {
    throw new ChannelInceptionStageBlockedError(`${stage.moduleKey} is blocked`);
  }
  if (claim.disposition === "recover") {
    const recovered = observedPersisted ??
      await options.recover?.(claim.outputs, controls);
    if (recovered) {
      await options.ledger.complete(
        stage,
        leaseVersion,
        "accepted",
        recovered.evidence,
        fingerprint(recovered),
      );
      return { value: recovered.value, disposition: "accepted" };
    }
    const error = new ChannelInceptionStageBlockedError(
      `${stage.moduleKey} has ambiguous prior provider execution and no durable output to recover`,
    );
    await options.ledger.fail(stage, leaseVersion, error, false);
    throw error;
  }
  if (claim.disposition === "reuse") {
    const persisted = observedPersisted;
    if (!persisted) {
      throw new Error(`${stage.moduleKey} has a completion receipt but its persisted output is missing`);
    }
    return { value: persisted.value, disposition: "reused" };
  }

  try {
    const accepted = await options.adoptExisting?.();
    if (accepted) {
      await options.ledger.complete(
        stage,
        leaseVersion,
        "accepted",
        accepted.evidence,
        fingerprint(accepted),
      );
      return { value: accepted.value, disposition: "accepted" };
    }
    let heartbeatError: unknown;
    let heartbeatQueue = Promise.resolve();
    const heartbeatTimer = setInterval(() => {
      heartbeatQueue = heartbeatQueue
        .then(() => options.ledger.heartbeat(stage, leaseVersion))
        .catch((error) => {
          heartbeatError = error;
        });
    }, 60_000);
    let executed: ChannelInceptionPersistedValue<T>;
    try {
      if (options.providerStart !== "explicit") {
        await controls.markProviderStarted(claim.outputs);
      }
      executed = await options.execute(claim.outputs, controls);
      if (
        options.providerStart === "explicit" &&
        stage.maximumCostUsd > 0 &&
        !providerStarted
      ) {
        throw new Error(`${stage.moduleKey} executed without a provider-start checkpoint`);
      }
    } finally {
      clearInterval(heartbeatTimer);
      await heartbeatQueue;
    }
    if (heartbeatError) throw heartbeatError;
    await options.ledger.complete(
      stage,
      leaseVersion,
      executed.completionStatus ?? "complete",
      executed.evidence,
      fingerprint(executed),
    );
    return { value: executed.value, disposition: "executed" };
  } catch (error) {
    await options.ledger.fail(
      stage,
      leaseVersion,
      error,
      options.retryableOnError !== false,
    );
    throw error;
  }
}

export function channelInceptionStageDescriptor(
  stage: AnyChannelInceptionStagePlan,
): ChannelInceptionStageDescriptor {
  return descriptor({ ...stage, dependsOn: [...stage.dependsOn] });
}
