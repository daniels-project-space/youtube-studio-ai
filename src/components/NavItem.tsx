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
      className="studio-nav-item"
      data-active={active ? "true" : undefined}
    >
      <span className="studio-nav-icon">{icon}</span>
      <span className="studio-nav-copy">{label}</span>
    </Link>
  );
}
