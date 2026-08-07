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
    <div className="glass stat-card">
      <div className="stat-card-heading">
        <span>{label}</span>
        {icon && <span className="stat-card-icon" style={{ color: accent }}>{icon}</span>}
      </div>
      <div className="stat-card-value" style={{ color: accent }}>
        {value}
      </div>
      {hint && <div className="stat-card-hint">{hint}</div>}
    </div>
  );
}
