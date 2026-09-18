import {
  normalizeReleaseEvidenceStatus,
  releaseEvidenceStatusDescription,
  releaseEvidenceStatusLabel,
} from "@/lib/releaseEvidenceStatus";

const COLOR = {
  not_ready: "var(--color-queued)",
  legacy_unverified: "var(--color-accent)",
  evidence_incomplete: "var(--color-failed)",
  release_evidence_recorded: "var(--color-ok)",
} as const;

/**
 * Provenance status, intentionally separate from the run's execution / publish
 * badge. Green means the release record is retained, not that media bytes were
 * replayed or independently re-reviewed by this UI.
 */
export function ReleaseEvidenceBadge({
  status,
  size = "sm",
  compact = false,
  wrap = false,
  labelContext = "run",
  completedWithoutEvidence = false,
}: {
  status?: string;
  size?: "sm" | "md";
  compact?: boolean;
  wrap?: boolean;
  /** Optional surface context; compact Library cards need to distinguish
   * master-release evidence from the adjacent thumbnail provenance label. */
  labelContext?: "run" | "master";
  /** A finished run with no certificate is historical/unverified, not actively
   * waiting for release evidence. This keeps dense run history truthful. */
  completedWithoutEvidence?: boolean;
}) {
  const normalized = normalizeReleaseEvidenceStatus(status);
  const color = COLOR[normalized];
  const pad = size === "sm" ? "0.14rem 0.48rem" : "0.24rem 0.64rem";
  const fontSize = size === "sm" ? "0.68rem" : "0.76rem";
  const completedUnverified = normalized === "not_ready" && completedWithoutEvidence && labelContext === "run";
  const label = completedUnverified
    ? "Completed · unverified"
    : compact
    ? labelContext === "master"
      ? {
          not_ready: "Master evidence pending",
          legacy_unverified: "Master unverified",
          evidence_incomplete: "Master evidence incomplete",
          release_evidence_recorded: "Master evidence recorded",
        }[normalized]
      : {
        not_ready: "Evidence pending",
        legacy_unverified: "Legacy unverified",
        evidence_incomplete: "Evidence incomplete",
        release_evidence_recorded: "Evidence recorded",
      }[normalized]
    : releaseEvidenceStatusLabel(normalized);
  const description = completedUnverified
    ? "This completed run has no retained final-master release evidence."
    : releaseEvidenceStatusDescription(normalized);

  return (
    <span
      title={description}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.32rem",
        padding: pad,
        fontSize,
        fontWeight: 500,
        borderRadius: wrap ? "0.65rem" : 999,
        color,
        background: `color-mix(in srgb, ${color} 13%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 29%, transparent)`,
        whiteSpace: wrap ? "normal" : "nowrap",
        ...(wrap ? { minWidth: 0, maxWidth: "100%" } : {}),
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: color,
          flexShrink: 0,
        }}
      />
      {label}
    </span>
  );
}
