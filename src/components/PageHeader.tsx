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
  return <h2 className="section-title">{children}</h2>;
}
