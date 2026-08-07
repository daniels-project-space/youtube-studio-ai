import { createHash } from "node:crypto";
import { PRICE } from "@/engine/pricing";
import { canonicalJson } from "@/lib/canonicalJson";
import type { ImageUsageSummary } from "@/lib/imageUsage";
import type { ModelUsageSummary } from "@/lib/modelUsage";
import {
  PLAN_WEEK_CONTRACT_VERSION,
  PLAN_WEEK_IMAGE_UNIT_USD,
  planWeekContractReservation,
} from "@/lib/planWeekContract";

export {
  PLAN_WEEK_CONTRACT_VERSION,
  PLAN_WEEK_IMAGE_UNIT_USD,
} from "@/lib/planWeekContract";

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how", "in", "into",
  "is", "it", "of", "on", "or", "the", "through", "to", "what", "when", "why", "with", "your",
]);

export interface PlanWeekReservation {
  modelUsd: number;
  imageUsd: number;
  totalUsd: number;
  imageUnitUsd: number;
}

export interface PlanWeekUsageCheckpoint {
  contractVersion: typeof PLAN_WEEK_CONTRACT_VERSION;
  fingerprint: string;
  costUsd: number;
  accountingComplete: boolean;
  modelUsage: ModelUsageSummary;
  imageUsage: ImageUsageSummary;
}

export interface PlanWeekTopicItem {
  topic: string;
  title: string;
  description: string;
  sceneSeed?: string;
}

export interface PlanWeekTopicCheckpoint {
  contractVersion: typeof PLAN_WEEK_CONTRACT_VERSION;
  batchId: string;
  attempt: number;
  usageCheckpointKey: string;
  items: PlanWeekTopicItem[];
  usage: PlanWeekUsageCheckpoint;
  artifactFingerprint: string;
}

function roundUsd(value: number): number {
  return Number(value.toFixed(6));
}

/**
 * Conservative pre-provider envelope for the only paid paths left in the
 * planner: Topicraft's bounded two-slate generator/judge and one attested
 * Novita image per accepted item. Actual spend comes from signed receipts; the
 * reservation uses the hard per-image admission ceiling.
 */
export function planWeekReservation(count: number): PlanWeekReservation {
  const liveImageUnitUsd = roundUsd(PRICE.novitaImageUsd);
  if (liveImageUnitUsd > PLAN_WEEK_IMAGE_UNIT_USD + 0.000001) {
    throw new Error(
      `plan-week pricing $${liveImageUnitUsd.toFixed(4)} exceeds ${PLAN_WEEK_CONTRACT_VERSION}; bump the contract`,
    );
  }
  return planWeekContractReservation(count);
}

function stem(token: string): string {
  if (token.length >= 6 && token.endsWith("ing")) {
    const root = token.slice(0, -3);
    return root.endsWith("is") ? `${root}e` : root;
  }
  if (token.length > 5 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 5 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

function topicTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
      .map(stem),
  );
}

export function topicsNearEquivalent(left: string, right: string): boolean {
  const a = topicTokens(left);
  const b = topicTokens(right);
  if (a.size === 0 || b.size === 0) return left.trim().toLowerCase() === right.trim().toLowerCase();
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap++;
  const union = a.size + b.size - overlap;
  const jaccard = overlap / Math.max(1, union);
  const containment = overlap / Math.max(1, Math.min(a.size, b.size));
  return jaccard >= 0.62 || (overlap >= 3 && containment >= 0.75);
}

/** Stable, embedding-free guard against duplicates in both history and slate. */
export function dedupePlanCandidates<T extends { topic: string }>(
  candidates: readonly T[],
  existingTopics: readonly string[],
): T[] {
  const accepted: T[] = [];
  for (const candidate of candidates) {
    const topic = candidate.topic.trim();
    if (!topic) continue;
    const seen = [...existingTopics, ...accepted.map((item) => item.topic)];
    if (seen.some((other) => topicsNearEquivalent(topic, other))) continue;
    accepted.push({ ...candidate, topic });
  }
  return accepted;
}

export function buildPlanWeekUsageCheckpoint(
  modelUsage: ModelUsageSummary,
  imageUsage: ImageUsageSummary,
): PlanWeekUsageCheckpoint {
  const costUsd = roundUsd(modelUsage.costUsd + imageUsage.costUsd);
  const accountingComplete = modelUsage.unpricedCalls === 0 &&
    imageUsage.records.every((record) => Number.isFinite(record.costUsd) && record.costUsd >= 0);
  const payload = {
    contractVersion: PLAN_WEEK_CONTRACT_VERSION as typeof PLAN_WEEK_CONTRACT_VERSION,
    costUsd,
    accountingComplete,
    modelUsage,
    imageUsage,
  };
  return {
    ...payload,
    fingerprint: createHash("sha256").update(canonicalJson(payload)).digest("hex"),
  };
}

export function buildPlanWeekTopicCheckpoint(args: {
  batchId: string;
  attempt: number;
  usageCheckpointKey: string;
  items: PlanWeekTopicItem[];
  usage: PlanWeekUsageCheckpoint;
}): PlanWeekTopicCheckpoint {
  const payload = {
    contractVersion: PLAN_WEEK_CONTRACT_VERSION as typeof PLAN_WEEK_CONTRACT_VERSION,
    batchId: args.batchId,
    attempt: args.attempt,
    usageCheckpointKey: args.usageCheckpointKey,
    items: args.items,
    usage: args.usage,
  };
  return {
    ...payload,
    artifactFingerprint: createHash("sha256").update(canonicalJson(payload)).digest("hex"),
  };
}

export function parsePlanWeekTopicCheckpoint(value: unknown): PlanWeekTopicCheckpoint | null {
  try {
    const checkpoint = value as PlanWeekTopicCheckpoint;
    const rebuiltUsage = buildPlanWeekUsageCheckpoint(
      checkpoint.usage.modelUsage,
      checkpoint.usage.imageUsage,
    );
    if (checkpoint.usage.fingerprint !== rebuiltUsage.fingerprint) return null;
    const rebuilt = buildPlanWeekTopicCheckpoint({
      batchId: checkpoint.batchId,
      attempt: checkpoint.attempt,
      usageCheckpointKey: checkpoint.usageCheckpointKey,
      items: checkpoint.items,
      usage: rebuiltUsage,
    });
    if (checkpoint.contractVersion !== PLAN_WEEK_CONTRACT_VERSION ||
        !Number.isInteger(checkpoint.attempt) || checkpoint.attempt < 0 ||
        checkpoint.artifactFingerprint !== rebuilt.artifactFingerprint ||
        !Array.isArray(checkpoint.items) || checkpoint.items.length === 0) return null;
    return rebuilt;
  } catch {
    return null;
  }
}

const USAGE_METADATA_KEY = "plan-week-usage";

export function planWeekUsageMetadata(checkpoint: PlanWeekUsageCheckpoint): Record<string, string> {
  const encoded = Buffer.from(JSON.stringify(checkpoint), "utf8").toString("base64url");
  if (encoded.length > 6_000) throw new Error("plan-week usage metadata exceeds safe R2 metadata size");
  return {
    [USAGE_METADATA_KEY]: encoded,
    "plan-week-contract": PLAN_WEEK_CONTRACT_VERSION,
    "plan-week-fingerprint": checkpoint.fingerprint,
  };
}

export function parsePlanWeekUsageMetadata(
  metadata: Record<string, string | undefined> | undefined,
): PlanWeekUsageCheckpoint | null {
  const encoded = metadata?.[USAGE_METADATA_KEY];
  if (!encoded) return null;
  try {
    const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as PlanWeekUsageCheckpoint;
    const rebuilt = buildPlanWeekUsageCheckpoint(value.modelUsage, value.imageUsage);
    if (value.contractVersion !== PLAN_WEEK_CONTRACT_VERSION || value.fingerprint !== rebuilt.fingerprint) return null;
    return rebuilt;
  } catch {
    return null;
  }
}

export function deterministicPlanDescription(topic: string, niche: string): string {
  const subject = topic.trim().replace(/\s+/g, " ");
  const lane = niche.trim() ? ` for ${niche.trim()} viewers` : "";
  return `${subject} — a focused, evidence-led video${lane} that delivers the promised answer without filler.`;
}
