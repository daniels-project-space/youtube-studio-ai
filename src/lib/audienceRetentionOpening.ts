/**
 * A small, provider-free interpretation layer for YouTube's normalized
 * audience-retention curve. Long-form uses the platform's familiar 30-second
 * intro boundary; shorter videos use a separately labelled 10%-of-duration
 * opening read so we never claim a full 30-second intro where none exists.
 */
export const AUDIENCE_OPENING_RETENTION_VERSION = "youtube-audience-opening-retention/v1" as const;

export interface AudienceRetentionCurvePoint {
  readonly ratio: number;
  readonly watch: number;
  readonly relative?: number;
}

export type AudienceOpeningRetentionEvidence =
  | Readonly<{
      version: typeof AUDIENCE_OPENING_RETENTION_VERSION;
      status: "measured";
      scope: "youtube_intro_30_sec" | "short_opening_10pct";
      targetSec: number;
      targetRatio: number;
      observedRetentionRatio: number;
      observedRelativeRetention?: number;
      interpolation: "linear_curve_segment" | "exact_curve_point";
    }>
  | Readonly<{
      version: typeof AUDIENCE_OPENING_RETENTION_VERSION;
      status: "unavailable";
      scope: "youtube_intro_30_sec" | "short_opening_10pct";
      targetSec: number;
      targetRatio: number;
      reason: "invalid_duration" | "insufficient_curve_coverage";
    }>;

function finiteRatio(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function interpolate(
  left: AudienceRetentionCurvePoint,
  right: AudienceRetentionCurvePoint,
  targetRatio: number,
): { readonly value: number; readonly exact: boolean } {
  if (left.ratio === right.ratio || targetRatio === left.ratio || targetRatio === right.ratio) {
    return { value: targetRatio === right.ratio ? right.watch : left.watch, exact: true };
  }
  const progress = (targetRatio - left.ratio) / (right.ratio - left.ratio);
  return { value: left.watch + (right.watch - left.watch) * progress, exact: false };
}

/**
 * The output is observation only. No threshold is embedded here: a later
 * channel-specific learning policy may use it as evidence, but it cannot
 * authorize a package rewrite, render, or publication on its own.
 */
export function deriveAudienceOpeningRetention(input: {
  readonly durationSec: number;
  readonly curve: readonly AudienceRetentionCurvePoint[];
}): AudienceOpeningRetentionEvidence {
  const longForm = input.durationSec >= 60;
  const scope = longForm ? "youtube_intro_30_sec" as const : "short_opening_10pct" as const;
  if (!Number.isFinite(input.durationSec) || input.durationSec <= 0) {
    return Object.freeze({
      version: AUDIENCE_OPENING_RETENTION_VERSION,
      status: "unavailable",
      scope,
      targetSec: 0,
      targetRatio: 0,
      reason: "invalid_duration",
    });
  }
  const targetSec = longForm ? 30 : Math.min(3, input.durationSec * 0.1);
  const targetRatio = targetSec / input.durationSec;
  const points = input.curve
    .filter((point) => finiteRatio(point.ratio) && finiteRatio(point.watch))
    .slice()
    .sort((left, right) => left.ratio - right.ratio);
  const left = [...points].reverse().find((point) => point.ratio <= targetRatio);
  const right = points.find((point) => point.ratio >= targetRatio);
  if (!left || !right) {
    return Object.freeze({
      version: AUDIENCE_OPENING_RETENTION_VERSION,
      status: "unavailable",
      scope,
      targetSec,
      targetRatio,
      reason: "insufficient_curve_coverage",
    });
  }
  const retention = interpolate(left, right, targetRatio);
  let observedRelativeRetention: number | undefined;
  if (typeof left.relative === "number" && Number.isFinite(left.relative) && typeof right.relative === "number" && Number.isFinite(right.relative)) {
    observedRelativeRetention = interpolate(
      { ratio: left.ratio, watch: left.relative },
      { ratio: right.ratio, watch: right.relative },
      targetRatio,
    ).value;
  }
  return Object.freeze({
    version: AUDIENCE_OPENING_RETENTION_VERSION,
    status: "measured",
    scope,
    targetSec,
    targetRatio,
    observedRetentionRatio: retention.value,
    ...(observedRelativeRetention === undefined ? {} : { observedRelativeRetention }),
    interpolation: retention.exact ? "exact_curve_point" : "linear_curve_segment",
  });
}

export function describeAudienceOpeningRetention(evidence: AudienceOpeningRetentionEvidence): string {
  if (evidence.status === "unavailable") {
    return `opening retention unavailable (${evidence.reason})`;
  }
  const scope = evidence.scope === "youtube_intro_30_sec" ? "30-second intro" : "short opening";
  const relative = evidence.observedRelativeRetention === undefined
    ? ""
    : ` · relative ${(evidence.observedRelativeRetention * 100).toFixed(0)}%`;
  return `${scope} ${(evidence.observedRetentionRatio * 100).toFixed(0)}% at ${evidence.targetSec.toFixed(1)}s${relative}`;
}
