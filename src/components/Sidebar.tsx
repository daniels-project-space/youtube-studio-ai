"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { NavItem } from "./NavItem";
import {
  IconOverview,
  IconChannels,
  IconRuns,
  IconLibrary,
  IconAnalytics,
  IconSeo,
  IconSettings,
  IconSpark,
  IconCalendar,
  IconGolden,
  IconTerminal,
  IconLofi,
  IconLore,
} from "./icons";

const NAV_GROUPS = [
  {
    label: "Command",
    items: [
      { href: "/", label: "Overview", icon: <IconOverview /> },
      { href: "/channels", label: "Channels", icon: <IconChannels /> },
      { href: "/runs", label: "Runs", icon: <IconRuns /> },
      { href: "/schedule", label: "Schedule", icon: <IconCalendar /> },
    ],
  },
  {
    label: "Content",
    items: [
      { href: "/library", label: "Library", icon: <IconLibrary /> },
      { href: "/studio-assets", label: "Studio assets", icon: <IconSpark /> },
    ],
  },
  {
    label: "Growth & evidence",
    items: [
      { href: "/analytics", label: "Analytics", icon: <IconAnalytics /> },
      { href: "/seo", label: "SEO", icon: <IconSeo /> },
      { href: "/editorial-evidence", label: "Evidence desk", icon: <IconSpark /> },
      { href: "/casefile", label: "Casefile desk", icon: <IconSpark /> },
    ],
  },
  {
    label: "Standards",
    items: [
      { href: "/golden", label: "Golden modules", icon: <IconGolden /> },
      { href: "/novita-render", label: "Render lab", icon: <IconTerminal /> },
      { href: "/lofi", label: "Music archive", icon: <IconLofi /> },
      { href: "/loreshort", label: "Lore archive", icon: <IconLore /> },
    ],
  },
  {
    label: "System",
    items: [{ href: "/settings", label: "Settings", icon: <IconSettings /> }],
  },
];

const MOBILE_PRIMARY_COUNT = NAV_GROUPS[0].items.length;
const MOBILE_MORE_ITEMS = NAV_GROUPS.flatMap((group) => group.items).slice(
  MOBILE_PRIMARY_COUNT,
);

/** Grouped desktop rail that becomes a five-item mobile dock with an overflow menu. */
export function Sidebar() {
  const pathname = usePathname();
  const [moreOpenForPath, setMoreOpenForPath] = useState<string | null>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const moreOpen = moreOpenForPath === pathname;
  const moreActive = MOBILE_MORE_ITEMS.some((item) =>
    item.href === "/" ? pathname === "/" : pathname.startsWith(item.href),
  );

  useEffect(() => {
    if (!moreOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!moreRef.current?.contains(event.target as Node))
        setMoreOpenForPath(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpenForPath(null);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [moreOpen]);

  useEffect(() => {
    const root = document.documentElement;
    if (moreOpen) root.dataset.studioMoreOpen = "true";
    else delete root.dataset.studioMoreOpen;

    return () => {
      delete root.dataset.studioMoreOpen;
    };
  }, [moreOpen]);

  return (
    <aside className="studio-sidebar" aria-label="Studio navigation">
      <div className="studio-brand">
        <span className="studio-brand-mark">
          <IconSpark width={19} height={19} />
        </span>
        <span>
          <strong>AutoStudio</strong>
          <small>Production OS</small>
        </span>
      </div>

      <nav className="studio-nav">
        {NAV_GROUPS.map((group) => (
          <section
            className="studio-nav-group"
            key={group.label}
            aria-label={group.label}
            data-nav-group={group.label.toLowerCase()}
          >
            <span className="studio-nav-label">{group.label}</span>
            <div className="studio-nav-items">
              {group.items.map((item) => (
                <NavItem
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                />
              ))}
            </div>
          </section>
        ))}

        <div className="studio-nav-more" ref={moreRef}>
          <button
            type="button"
            className="studio-nav-item studio-nav-more-trigger"
            aria-expanded={moreOpen}
            aria-controls="studio-mobile-more-menu"
            data-active={moreActive ? "true" : undefined}
            onClick={() => setMoreOpenForPath(moreOpen ? null : pathname)}
          >
            <span className="studio-nav-icon">
              <IconSpark />
            </span>
            <span className="studio-nav-copy">More</span>
          </button>
          {moreOpen && (
            <div
              id="studio-mobile-more-menu"
              className="studio-nav-more-menu glass"
              aria-label="More studio destinations"
              onClick={() => setMoreOpenForPath(null)}
            >
              {MOBILE_MORE_ITEMS.map((item) => (
                <NavItem
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                />
              ))}
            </div>
          )}
        </div>
      </nav>

      <div className="studio-sidebar-footer">Studio workspace</div>
    </aside>
  );
}
