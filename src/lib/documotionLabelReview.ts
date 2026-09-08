import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import type { ModelUsageGroup, ModelUsageSummary } from "@/lib/modelUsage";

export const DOCUMOTION_LABEL_REVIEW_VERSION = "documotion-label-review/v1" as const;
export const DOCUMOTION_LABEL_REVIEW_CLAIM_VERSION = "documotion-label-review-claim/v1" as const;
export const DOCUMOTION_LABEL_REVIEW_RECONCILIATION_MARKER =
  "DOCUMOTION_LABEL_REVIEW_RECONCILIATION_REQUIRED";

export type DocuLabelReviewOutcome = "reviewed" | "not_needed" | "unavailable";

export interface DocuLabelReviewClaim {
  version: typeof DOCUMOTION_LABEL_REVIEW_CLAIM_VERSION;
  styleId: string;
  inputPlanFingerprint: string;
  attemptId: string;
  claimedAt: number;
}

export interface DocuLabelReviewReceipt {
  version: typeof DOCUMOTION_LABEL_REVIEW_VERSION;
  styleId: string;
  inputPlanFingerprint: string;
  outputPlanFingerprint: string;
  outcome: DocuLabelReviewOutcome;
  outputPlan: unknown;
  modelUsage: ModelUsageSummary;
  completedAt: number;
}

export interface DocuLabelReviewCheckpoint {
  loadReceipt(): Promise<unknown | null>;
  claim(value: DocuLabelReviewClaim): Promise<"acquired" | "pending">;
  saveReceipt(value: DocuLabelReviewReceipt): Promise<void>;
}

export function docuLabelReviewPlanFingerprint(plan: unknown): string {
  return sha256Hex(canonicalJson(plan));
}

export function docuLabelReviewRecordFingerprint(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

function finiteNonNegative(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`documotion label-review receipt has invalid ${label}`);
  }
  return value;
}

function parseUsageGroup(value: unknown, index: number): ModelUsageGroup {
  if (!value || typeof value !== "object") {
    throw new Error(`documotion label-review receipt has invalid modelUsage.groups[${index}]`);
  }
  const row = value as Record<string, unknown>;
  if (typeof row.provider !== "string" || !row.provider.trim()
    || typeof row.model !== "string" || !row.model.trim()
    || !["text", "vision", "audio", "video", "embedding", "other"].includes(String(row.kind))) {
    throw new Error(`documotion label-review receipt has invalid model usage identity at group ${index}`);
  }
  if (!Array.isArray(row.unpricedReasons) || row.unpricedReasons.some((reason) => typeof reason !== "string")) {
    throw new Error(`documotion label-review receipt has invalid unpriced reasons at group ${index}`);
  }
  return {
    provider: row.provider,
    model: row.model,
    kind: row.kind as ModelUsageGroup["kind"],
    calls: finiteNonNegative(row.calls, `groups[${index}].calls`),
    cacheHits: finiteNonNegative(row.cacheHits, `groups[${index}].cacheHits`),
    inputTokens: finiteNonNegative(row.inputTokens, `groups[${index}].inputTokens`),
    outputTokens: finiteNonNegative(row.outputTokens, `groups[${index}].outputTokens`),
    reasoningTokens: finiteNonNegative(row.reasoningTokens, `groups[${index}].reasoningTokens`),
    cachedInputTokens: finiteNonNegative(row.cachedInputTokens, `groups[${index}].cachedInputTokens`),
    totalTokens: finiteNonNegative(row.totalTokens, `groups[${index}].totalTokens`),
    costUsd: finiteNonNegative(row.costUsd, `groups[${index}].costUsd`),
    unpricedCalls: finiteNonNegative(row.unpricedCalls, `groups[${index}].unpricedCalls`),
    unpricedReasons: [...row.unpricedReasons] as string[],
  };
}

export function parseDocuLabelReviewReceipt(value: unknown): DocuLabelReviewReceipt {
  if (!value || typeof value !== "object") {
    throw new Error("documotion label-review receipt is missing");
  }
  const row = value as Record<string, unknown>;
  if (row.version !== DOCUMOTION_LABEL_REVIEW_VERSION
    || typeof row.styleId !== "string" || !row.styleId.trim()
    || typeof row.inputPlanFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(row.inputPlanFingerprint)
    || typeof row.outputPlanFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(row.outputPlanFingerprint)
    || !["reviewed", "not_needed", "unavailable"].includes(String(row.outcome))
    || !row.outputPlan || typeof row.outputPlan !== "object"
    || !Number.isSafeInteger(row.completedAt) || Number(row.completedAt) < 0) {
    throw new Error("documotion label-review receipt contract is invalid");
  }
  const usage = row.modelUsage as Record<string, unknown> | undefined;
  if (!usage || !Array.isArray(usage.groups)) {
    throw new Error("documotion label-review receipt model usage is missing");
  }
  const modelUsage: ModelUsageSummary = {
    calls: finiteNonNegative(usage.calls, "modelUsage.calls"),
    cacheHits: finiteNonNegative(usage.cacheHits, "modelUsage.cacheHits"),
    inputTokens: finiteNonNegative(usage.inputTokens, "modelUsage.inputTokens"),
    outputTokens: finiteNonNegative(usage.outputTokens, "modelUsage.outputTokens"),
    reasoningTokens: finiteNonNegative(usage.reasoningTokens, "modelUsage.reasoningTokens"),
    cachedInputTokens: finiteNonNegative(usage.cachedInputTokens, "modelUsage.cachedInputTokens"),
    totalTokens: finiteNonNegative(usage.totalTokens, "modelUsage.totalTokens"),
    costUsd: finiteNonNegative(usage.costUsd, "modelUsage.costUsd"),
    unpricedCalls: finiteNonNegative(usage.unpricedCalls, "modelUsage.unpricedCalls"),
    groups: usage.groups.map(parseUsageGroup),
  };
  const summedUsage = summarizeUsageGroups(modelUsage.groups);
  for (const key of SUMMARY_NUMBER_KEYS) {
    const mismatch = key === "costUsd"
      ? Math.abs(modelUsage[key] - summedUsage[key]) > 1e-12
      : modelUsage[key] !== summedUsage[key];
    if (mismatch) {
      throw new Error(`documotion label-review receipt modelUsage.${key} does not match its groups`);
    }
  }
  if (docuLabelReviewPlanFingerprint(row.outputPlan) !== row.outputPlanFingerprint) {
    throw new Error("documotion label-review receipt output fingerprint mismatch");
  }
  return {
    version: DOCUMOTION_LABEL_REVIEW_VERSION,
    styleId: row.styleId,
    inputPlanFingerprint: row.inputPlanFingerprint,
    outputPlanFingerprint: row.outputPlanFingerprint,
    outcome: row.outcome as DocuLabelReviewOutcome,
    outputPlan: row.outputPlan,
    modelUsage,
    completedAt: Number(row.completedAt),
  };
}

export function reusableDocuLabelReviewReceipt(args: {
  value: unknown;
  styleId: string;
  currentPlan: unknown;
}): DocuLabelReviewReceipt {
  const receipt = parseDocuLabelReviewReceipt(args.value);
  const currentFingerprint = docuLabelReviewPlanFingerprint(args.currentPlan);
  if (receipt.styleId !== args.styleId) {
    throw new Error("documotion label-review receipt style identity mismatch");
  }
  if (currentFingerprint !== receipt.inputPlanFingerprint
    && currentFingerprint !== receipt.outputPlanFingerprint) {
    throw new Error("documotion label-review receipt plan identity mismatch");
  }
  return receipt;
}

export function buildDocuLabelReviewReceipt(args: {
  styleId: string;
  inputPlanFingerprint: string;
  outputPlan: unknown;
  outcome: DocuLabelReviewOutcome;
  modelUsage: ModelUsageSummary;
  completedAt: number;
}): DocuLabelReviewReceipt {
  return parseDocuLabelReviewReceipt({
    version: DOCUMOTION_LABEL_REVIEW_VERSION,
    styleId: args.styleId,
    inputPlanFingerprint: args.inputPlanFingerprint,
    outputPlanFingerprint: docuLabelReviewPlanFingerprint(args.outputPlan),
    outcome: args.outcome,
    outputPlan: args.outputPlan,
    modelUsage: args.modelUsage,
    completedAt: args.completedAt,
  });
}

function groupKey(group: Pick<ModelUsageGroup, "provider" | "model" | "kind">): string {
  return `${group.provider.toLowerCase()}\u0000${group.model.toLowerCase()}\u0000${group.kind}`;
}

const SUMMARY_NUMBER_KEYS = [
  "calls", "cacheHits", "inputTokens", "outputTokens", "reasoningTokens",
  "cachedInputTokens", "totalTokens", "costUsd", "unpricedCalls",
] as const;

export function subtractModelUsageSummary(
  after: ModelUsageSummary,
  before: ModelUsageSummary,
): ModelUsageSummary {
  const beforeGroups = new Map(before.groups.map((group) => [groupKey(group), group]));
  const groups = after.groups.flatMap((group) => {
    const prior = beforeGroups.get(groupKey(group));
    const delta = { ...group, unpricedReasons: [...group.unpricedReasons] };
    for (const key of SUMMARY_NUMBER_KEYS) {
      if (key in delta) {
        (delta[key] as number) = Math.max(0, group[key] - (prior?.[key] ?? 0));
      }
    }
    return SUMMARY_NUMBER_KEYS.some((key) => delta[key] > 0) ? [delta] : [];
  });
  return summarizeUsageGroups(groups);
}

export function mergeModelUsageSummaries(
  summaries: readonly ModelUsageSummary[],
): ModelUsageSummary {
  const groups = new Map<string, ModelUsageGroup>();
  for (const summary of summaries) {
    for (const incoming of summary.groups) {
      const key = groupKey(incoming);
      const current = groups.get(key) ?? {
        ...incoming,
        calls: 0,
        cacheHits: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        unpricedCalls: 0,
        unpricedReasons: [],
      };
      for (const numberKey of SUMMARY_NUMBER_KEYS) current[numberKey] += incoming[numberKey];
      current.unpricedReasons = [...new Set([...current.unpricedReasons, ...incoming.unpricedReasons])];
      groups.set(key, current);
    }
  }
  return summarizeUsageGroups([...groups.values()]);
}

function summarizeUsageGroups(groups: ModelUsageGroup[]): ModelUsageSummary {
  return groups.reduce<ModelUsageSummary>((summary, group) => ({
    calls: summary.calls + group.calls,
    cacheHits: summary.cacheHits + group.cacheHits,
    inputTokens: summary.inputTokens + group.inputTokens,
    outputTokens: summary.outputTokens + group.outputTokens,
    reasoningTokens: summary.reasoningTokens + group.reasoningTokens,
    cachedInputTokens: summary.cachedInputTokens + group.cachedInputTokens,
    totalTokens: summary.totalTokens + group.totalTokens,
    costUsd: summary.costUsd + group.costUsd,
    unpricedCalls: summary.unpricedCalls + group.unpricedCalls,
    groups,
  }), {
    calls: 0,
    cacheHits: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedInputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    unpricedCalls: 0,
    groups,
  });
}
