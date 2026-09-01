import type { ReactNode } from "react";

/** Standard page title block. */
export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <header
      className="page-header"
      data-has-actions={actions ? "true" : "false"}
    >
      <div className="page-header-copy">
        {eyebrow ? (
          <span className="page-header-eyebrow">
            <i aria-hidden="true" />
            {eyebrow}
          </span>
        ) : null}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </header>
  );
}

/** Sub-section heading within a page. */
export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="section-title">{children}</h2>;
}
