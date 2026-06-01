"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Sidebar navigation link. Active when the pathname matches exactly (for "/")
 * or starts with the href (for section routes like /channels/[slug]).
 */
export function NavItem({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: ReactNode;
}) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.7rem",
        padding: "0.6rem 0.75rem",
        borderRadius: 10,
        fontSize: "0.9rem",
        fontWeight: active ? 600 : 500,
        color: active ? "var(--color-fg)" : "var(--color-muted)",
        background: active ? "var(--color-accent-soft)" : "transparent",
        border: `1px solid ${active ? "color-mix(in srgb, var(--color-accent) 28%, transparent)" : "transparent"}`,
        transition: "background 0.15s ease, color 0.15s ease",
      }}
    >
      <span style={{ color: active ? "var(--color-accent)" : "inherit", display: "grid", placeItems: "center" }}>
        {icon}
      </span>
      {label}
    </Link>
  );
}
