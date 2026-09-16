import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

/**
 * Automatic operating policy shared by scheduled runs, provider adapters, and
 * the operations view.  It is intentionally provider-neutral: adapters still
 * own credentials, live capacity calls, and paid dispatches.
 */
export const AUTOMATIC_OPERATIONS_VERSION = "automatic-operations/v1" as const;

export type AutomaticProvider =
  | "salad-ernie"
  | "salad-music3"
  | "salad-h3"
  | "novita-image"
  | "novita-music3"
  | "novita-h3"
  | "fal-nano-banana"
  | "qwen-cloud"
  | "openrouter"
  | "local-deterministic";

export type ProviderCircuitState = {
  status: "closed" | "open" | "half_open";
  consecutiveFailures: number;
  openedAt?: number;
  nextProbeAt?: number;
};

export type AutomaticProviderPlan = {
  version: typeof AUTOMATIC_OPERATIONS_VERSION;
  mode: "automatic-primary-fallback";
  modules: readonly {
    moduleId: string;
    primary: AutomaticProvider;
    fallbacks: readonly AutomaticProvider[];
    circuit: "closed" | "open" | "half_open";
  }[];
  blockedModules: readonly string[];
  fingerprint: string;
};

type ProviderCandidate = {
  provider: AutomaticProvider;
  fallbacks: readonly AutomaticProvider[];
};

const MODULE_ROUTES: readonly {
  match: (moduleId: string) => boolean;
  route: ProviderCandidate;
}[] = [
  { match: (id) => /thumbnail/i.test(id), route: { provider: "fal-nano-banana", fallbacks: [] } },
  { match: (id) => /ernie|image|channel_art|keyframe/i.test(id), route: { provider: "salad-ernie", fallbacks: ["novita-image"] } },
  { match: (id) => /h3|minimax.*video|video.*minimax/i.test(id), route: { provider: "salad-h3", fallbacks: ["novita-h3"] } },
  { match: (id) => /music|audio/i.test(id), route: { provider: "salad-music3", fallbacks: ["novita-music3"] } },
  { match: (id) => /narration|tts|voice/i.test(id), route: { provider: "qwen-cloud", fallbacks: ["openrouter"] } },
  { match: (id) => /script|title|metadata|seo|topic/i.test(id), route: { provider: "openrouter", fallbacks: ["local-deterministic"] } },
];

function routeForModule(moduleId: string): ProviderCandidate {
  return MODULE_ROUTES.find((entry) => entry.match(moduleId))?.route ?? {
    provider: "local-deterministic",
    fallbacks: [],
  };
}

function circuitFor(provider: AutomaticProvider, circuits: Readonly<Partial<Record<AutomaticProvider, ProviderCircuitState>>>): ProviderCircuitState {
  return circuits[provider] ?? { status: "closed", consecutiveFailures: 0 };
}

/** Build the exact provider order before any provider-capable block runs. */
export function buildAutomaticProviderPlan(input: {
  moduleIds: readonly string[];
  circuits?: Readonly<Partial<Record<AutomaticProvider, ProviderCircuitState>>>;
}): AutomaticProviderPlan {
  const modules = [...new Set(input.moduleIds.map((id) => id.trim()).filter(Boolean))].sort().map((moduleId) => {
    const route = routeForModule(moduleId);
    const candidates = [route.provider, ...route.fallbacks].filter((provider) => circuitFor(provider, input.circuits ?? {}).status !== "open");
    const primary = candidates[0];
    return {
      moduleId,
      primary: primary ?? route.provider,
      fallbacks: (primary ? candidates.slice(1) : route.fallbacks),
      circuit: circuitFor(route.provider, input.circuits ?? {}).status,
    };
  });
  const body = {
    version: AUTOMATIC_OPERATIONS_VERSION,
    mode: "automatic-primary-fallback" as const,
    modules,
    blockedModules: modules.filter((module) => module.primary === undefined).map((module) => module.moduleId),
  };
  return { ...body, fingerprint: sha256Hex(canonicalJson(body)) };
}

export function nextProviderCircuitState(input: {
  previous?: ProviderCircuitState;
  outcome: "success" | "failure";
  now: number;
  failureThreshold?: number;
  cooldownMs?: number;
}): ProviderCircuitState {
  if (!Number.isSafeInteger(input.now) || input.now < 0) throw new Error("provider circuit timestamp is invalid");
  const threshold = input.failureThreshold ?? 3;
  const cooldownMs = input.cooldownMs ?? 15 * 60_000;
  if (!Number.isInteger(threshold) || threshold < 1 || !Number.isSafeInteger(cooldownMs) || cooldownMs < 1) {
    throw new Error("provider circuit policy is invalid");
  }
  const previous = input.previous ?? { status: "closed", consecutiveFailures: 0 };
  if (input.outcome === "success") return { status: "closed", consecutiveFailures: 0 };
  const failures = previous.consecutiveFailures + 1;
  if (failures >= threshold) {
    return { status: "open", consecutiveFailures: failures, openedAt: input.now, nextProbeAt: input.now + cooldownMs };
  }
  return { status: "closed", consecutiveFailures: failures };
}

export type CapacityEta = {
  state: "ready" | "waiting" | "fallback_due";
  nextCheckAt: number;
  fallbackAt?: number;
};

/** Explain the next automatic action, never pretend that market capacity is predictable. */
export function capacityEta(input: {
  now: number;
  requiredWorkers: number;
  availableWorkers: number;
  retryEveryMs: number;
  fallbackAfterMs?: number;
}): CapacityEta {
  if (![input.now, input.requiredWorkers, input.availableWorkers, input.retryEveryMs].every(Number.isSafeInteger) ||
      input.now < 0 || input.requiredWorkers < 1 || input.availableWorkers < 0 || input.retryEveryMs < 1) {
    throw new Error("capacity ETA input is invalid");
  }
  if (input.availableWorkers >= input.requiredWorkers) return { state: "ready", nextCheckAt: input.now };
  const fallbackAt = input.fallbackAfterMs === undefined ? undefined : input.now + input.fallbackAfterMs;
  if (fallbackAt !== undefined && input.fallbackAfterMs! < 0) throw new Error("capacity fallback window is invalid");
  if (fallbackAt !== undefined && input.now >= fallbackAt) return { state: "fallback_due", nextCheckAt: input.now, fallbackAt };
  return { state: "waiting", nextCheckAt: input.now + input.retryEveryMs, ...(fallbackAt === undefined ? {} : { fallbackAt }) };
}

export type AutomaticQualityGateContract = {
  version: typeof AUTOMATIC_OPERATIONS_VERSION;
  status: "measurement_required";
  minimumVisualScore: number;
  maximumBlackFrameFraction: number;
  maximumDuplicateFrameFraction: number;
  minimumFrameCoverage: number;
  fingerprint: string;
};

export function createAutomaticQualityGateContract(input: {
  minimumVisualScore?: number;
  maximumBlackFrameFraction?: number;
  maximumDuplicateFrameFraction?: number;
  minimumFrameCoverage?: number;
} = {}): AutomaticQualityGateContract {
  const body = {
    version: AUTOMATIC_OPERATIONS_VERSION,
    status: "measurement_required" as const,
    minimumVisualScore: input.minimumVisualScore ?? 7,
    maximumBlackFrameFraction: input.maximumBlackFrameFraction ?? 0.01,
    maximumDuplicateFrameFraction: input.maximumDuplicateFrameFraction ?? 0.08,
    minimumFrameCoverage: input.minimumFrameCoverage ?? 0.9,
  };
  if (body.minimumVisualScore < 0 || body.minimumVisualScore > 10 || body.maximumBlackFrameFraction < 0 ||
      body.maximumDuplicateFrameFraction < 0 || body.minimumFrameCoverage < 0 || body.minimumFrameCoverage > 1) {
    throw new Error("automatic quality gate thresholds are invalid");
  }
  return { ...body, fingerprint: sha256Hex(canonicalJson(body)) };
}

export type AutomaticReleaseRollbackPlan = {
  version: typeof AUTOMATIC_OPERATIONS_VERSION;
  mode: "private-first-reversible";
  runId: string;
  actionOnQualityFailure: "retain-prior-master-and-block-release";
  actionOnUploadFailure: "retain-private-intent-for-retry";
  fingerprint: string;
};

export function createAutomaticReleaseRollbackPlan(input: { runId: string }): AutomaticReleaseRollbackPlan {
  if (!input.runId.trim()) throw new Error("rollback plan run identity is required");
  const body = {
    version: AUTOMATIC_OPERATIONS_VERSION,
    mode: "private-first-reversible" as const,
    runId: input.runId,
    actionOnQualityFailure: "retain-prior-master-and-block-release" as const,
    actionOnUploadFailure: "retain-private-intent-for-retry" as const,
  };
  return { ...body, fingerprint: sha256Hex(canonicalJson(body)) };
}

export type WeeklyOperationsDigest = {
  version: typeof AUTOMATIC_OPERATIONS_VERSION;
  weekStart: number;
  weekEnd: number;
  runs: { total: number; succeeded: number; failed: number; active: number; spentUsd: number };
  providerFailures: number;
  actionItems: readonly string[];
  fingerprint: string;
};

/** Return the immediately completed UTC week for the scheduled digest. */
export function previousUtcWeekWindow(now: number): { weekStart: number; weekEnd: number } {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("weekly digest timestamp is invalid");
  const date = new Date(now);
  const day = date.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  const thisMonday = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysSinceMonday);
  const weekStart = thisMonday - 7 * 24 * 60 * 60_000;
  return { weekStart, weekEnd: thisMonday - 1 };
}

export function buildWeeklyOperationsDigest(input: {
  weekStart: number;
  weekEnd: number;
  runs: readonly { status?: string; costTotal?: number; error?: string }[];
}): WeeklyOperationsDigest {
  if (!Number.isSafeInteger(input.weekStart) || !Number.isSafeInteger(input.weekEnd) || input.weekEnd < input.weekStart) {
    throw new Error("weekly digest range is invalid");
  }
  const succeeded = input.runs.filter((run) => run.status === "ok").length;
  const failed = input.runs.filter((run) => run.status === "failed").length;
  const active = input.runs.filter((run) => run.status === "queued" || run.status === "running").length;
  const spentUsd = Number(input.runs.reduce((sum, run) => sum + (Number.isFinite(run.costTotal) ? run.costTotal! : 0), 0).toFixed(6));
  const providerFailures = input.runs.filter((run) => /provider|capacity|gpu|novita|salad/i.test(run.error ?? "")).length;
  const actionItems = [
    ...(failed > 0 ? [`Review ${failed} failed run${failed === 1 ? "" : "s"}`] : []),
    ...(providerFailures > 0 ? [`Provider/capacity failures: ${providerFailures}`] : []),
    ...(active > 0 ? [`${active} run${active === 1 ? " is" : "s are"} still active`] : []),
  ];
  const body = {
    version: AUTOMATIC_OPERATIONS_VERSION,
    weekStart: input.weekStart,
    weekEnd: input.weekEnd,
    runs: { total: input.runs.length, succeeded, failed, active, spentUsd },
    providerFailures,
    actionItems,
  };
  return { ...body, fingerprint: sha256Hex(canonicalJson(body)) };
}
