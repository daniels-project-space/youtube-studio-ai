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
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && (
          <p>{subtitle}</p>
        )}
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
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
