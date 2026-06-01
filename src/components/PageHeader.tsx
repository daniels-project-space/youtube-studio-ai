import type { ReactNode } from "react";

/** Standard page title block. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: "1rem",
        marginBottom: "1.75rem",
      }}
    >
      <div>
        <h1 style={{ fontSize: "1.9rem", fontWeight: 600 }}>{title}</h1>
        {subtitle && (
          <p style={{ margin: "0.4rem 0 0", color: "var(--color-muted)", fontSize: "0.92rem" }}>
            {subtitle}
          </p>
        )}
      </div>
      {actions}
    </div>
  );
}

/** Sub-section heading within a page. */
export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2
      style={{
        fontSize: "1.05rem",
        fontWeight: 600,
        margin: "0 0 0.85rem",
      }}
    >
      {children}
    </h2>
  );
}
