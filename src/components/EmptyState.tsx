import type { ReactNode } from "react";
import { IconSpark } from "./icons";

/** Tasteful placeholder for empty lists and not-yet-built pages. */
export function EmptyState({
  title,
  description,
  icon,
}: {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div
      className="glass glass-shine"
      style={{
        padding: "3rem 2rem",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "0.75rem",
      }}
    >
      <span
        style={{
          display: "grid",
          placeItems: "center",
          width: 48,
          height: 48,
          borderRadius: 14,
          background: "var(--color-accent-soft)",
          color: "var(--color-accent)",
        }}
      >
        {icon ?? <IconSpark width={24} height={24} />}
      </span>
      <h3 style={{ fontSize: "1.1rem" }}>{title}</h3>
      {description && (
        <p
          style={{
            margin: 0,
            maxWidth: 380,
            color: "var(--color-muted)",
            fontSize: "0.9rem",
            lineHeight: 1.5,
          }}
        >
          {description}
        </p>
      )}
    </div>
  );
}
