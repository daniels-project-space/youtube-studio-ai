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
}: {
  status?: string;
  size?: "sm" | "md";
  compact?: boolean;
}) {
  const normalized = normalizeReleaseEvidenceStatus(status);
  const color = COLOR[normalized];
  const pad = size === "sm" ? "0.14rem 0.48rem" : "0.24rem 0.64rem";
  const fontSize = size === "sm" ? "0.68rem" : "0.76rem";
  const label = compact
    ? {
        not_ready: "Evidence pending",
        legacy_unverified: "Legacy unverified",
        evidence_incomplete: "Evidence incomplete",
        release_evidence_recorded: "Evidence recorded",
      }[normalized]
    : releaseEvidenceStatusLabel(normalized);

  return (
    <span
      title={releaseEvidenceStatusDescription(normalized)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.32rem",
        padding: pad,
        fontSize,
        fontWeight: 500,
        borderRadius: 999,
        color,
        background: `color-mix(in srgb, ${color} 13%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 29%, transparent)`,
        whiteSpace: "nowrap",
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
