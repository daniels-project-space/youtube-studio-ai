import type { ReactNode } from "react";

/**
 * A single headline metric in a glass card. `accent` tints the value + a thin
 * top rule for visual rhythm across a stat row.
 */
export function StatCard({
  label,
  value,
  hint,
  accent = "var(--color-fg)",
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  accent?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="glass glass-shine lift" style={{ padding: "1.1rem 1.2rem" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "0.6rem",
        }}
      >
        <span
          style={{
            fontSize: "0.72rem",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--color-muted)",
          }}
        >
          {label}
        </span>
        {icon && <span style={{ color: accent, opacity: 0.85 }}>{icon}</span>}
      </div>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "1.9rem",
          fontWeight: 600,
          lineHeight: 1,
          color: accent,
        }}
      >
        {value}
      </div>
      {hint && (
        <div
          style={{
            marginTop: "0.5rem",
            fontSize: "0.8rem",
            color: "var(--color-faint)",
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}
