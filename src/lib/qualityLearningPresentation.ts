/**
 * Browser-safe projection for the retention analyst's owner-scoped API response.
 * It deliberately exposes evidence and review state, never the proposed playbook
 * mutation or raw provider transcript.
 */

export type QualityLearningStatus = "proposed" | "approved" | "activated" | "rejected";

export type QualityLearningOpening =
  | Readonly<{
      status: "measured";
      scope: "youtube_intro_30_sec" | "short_opening_10pct";
      targetSec: number;
      retentionRatio: number;
      relativeRetention?: number;
    }>
  | Readonly<{ status: "unavailable" }>;

export type QualityLearningInsight = Readonly<{
  id: string;
  channelId: string;
  status: QualityLearningStatus;
  createdAt: number;
  sourceVideoCount: number;
  sampleSize: number;
  evidencePassed: boolean;
  diagnosis?: string;
  opening: QualityLearningOpening;
}>;

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function boundedText(value: unknown, maximum = 260): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.slice(0, maximum);
}

function status(value: unknown): QualityLearningStatus | undefined {
  return value === "proposed" || value === "approved" || value === "activated" || value === "rejected"
    ? value
    : undefined;
}

function openingFromUnknown(value: unknown): QualityLearningOpening {
  const input = record(value);
  if (
    !input ||
    input.status !== "measured" ||
    (input.scope !== "youtube_intro_30_sec" && input.scope !== "short_opening_10pct")
  ) {
    return { status: "unavailable" };
  }
  const targetSec = finite(input.targetSec);
  const retentionRatio = finite(input.observedRetentionRatio);
  const relativeRetention = finite(input.observedRelativeRetention);
  if (targetSec === undefined || targetSec < 0 || retentionRatio === undefined || retentionRatio < 0 || retentionRatio > 1) {
    return { status: "unavailable" };
  }
  return {
    status: "measured",
    scope: input.scope,
    targetSec,
    retentionRatio,
    ...(relativeRetention === undefined || relativeRetention < 0 || relativeRetention > 1
      ? {}
      : { relativeRetention }),
  };
}

/** Parse and reduce an untrusted API payload to retention evidence only. */
export function qualityLearningInsightsFromUnknown(value: unknown): readonly QualityLearningInsight[] {
  if (!Array.isArray(value)) return [];
  const insights = value.flatMap((row): QualityLearningInsight[] => {
    const input = record(row);
    if (!input || input.kind !== "retention_rule") return [];
    const id = boundedText(input._id, 120);
    const channelId = boundedText(input.channelId, 120);
    const recommendationStatus = status(input.status);
    const createdAt = finite(input.createdAt);
    const offlineEvaluation = record(input.offlineEvaluation);
    const proposal = record(input.proposal);
    const sampleSize = finite(offlineEvaluation?.sampleSize);
    const evidencePassed = offlineEvaluation?.passed;
    if (
      !id ||
      !channelId ||
      !recommendationStatus ||
      createdAt === undefined ||
      createdAt < 0 ||
      sampleSize === undefined ||
      sampleSize < 0 ||
      typeof evidencePassed !== "boolean"
    ) {
      return [];
    }
    return [{
      id,
      channelId,
      status: recommendationStatus,
      createdAt,
      sourceVideoCount: Array.isArray(input.sourceVideoIds) ? input.sourceVideoIds.filter((id) => typeof id === "string").length : 0,
      sampleSize,
      evidencePassed,
      ...(boundedText(proposal?.diagnosis) ? { diagnosis: boundedText(proposal?.diagnosis) } : {}),
      opening: openingFromUnknown(proposal?.openingRetention),
    }];
  });
  return insights.sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id));
}

export function describeQualityLearningOpening(opening: QualityLearningOpening): string {
  if (opening.status === "unavailable") return "Opening retention has not settled yet";
  const scope = opening.scope === "youtube_intro_30_sec" ? "30-second intro" : "Short opening";
  const relative = opening.relativeRetention === undefined
    ? ""
    : ` · relative ${Math.round(opening.relativeRetention * 100)}%`;
  return `${scope} ${Math.round(opening.retentionRatio * 100)}% at ${opening.targetSec.toFixed(1)}s${relative}`;
}
