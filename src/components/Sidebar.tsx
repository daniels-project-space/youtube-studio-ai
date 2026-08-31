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
  IconAssets,
  IconEvidence,
  IconToolbox,
} from "./icons";
import { StudioMark } from "./StudioMark";

const PRIMARY_NAV_ITEMS = [
  { href: "/", label: "Studio", icon: <IconOverview /> },
  { href: "/channels", label: "Channels", icon: <IconChannels /> },
  { href: "/runs", label: "Production", icon: <IconRuns /> },
  { href: "/schedule", label: "Schedule", icon: <IconCalendar /> },
  { href: "/library", label: "Library", icon: <IconLibrary /> },
  { href: "/analytics", label: "Analytics", icon: <IconAnalytics /> },
];

const TOOLBOX_NAV_GROUPS = [
  {
    label: "Craft",
    items: [
      { href: "/seo", label: "Packaging research", icon: <IconSeo /> },
      { href: "/studio-assets", label: "Studio assets", icon: <IconAssets /> },
    ],
  },
  {
    label: "Assurance",
    items: [
      { href: "/golden", label: "Golden modules", icon: <IconGolden /> },
      { href: "/editorial-evidence", label: "Editorial evidence", icon: <IconEvidence /> },
      { href: "/casefile", label: "Casefile", icon: <IconEvidence /> },
    ],
  },
  {
    label: "Infrastructure",
    items: [
      { href: "/novita-render", label: "Render fleet", icon: <IconTerminal /> },
      { href: "/lofi", label: "Music references", icon: <IconLofi /> },
      { href: "/loreshort", label: "Lore references", icon: <IconLore /> },
    ],
  },
];

const SETTINGS_ITEM = {
  href: "/settings",
  label: "Settings",
  icon: <IconSettings />,
};
const MOBILE_PRIMARY_COUNT = 4;
const TOOLBOX_NAV_ITEMS = TOOLBOX_NAV_GROUPS.flatMap((group) => group.items);
const MOBILE_MORE_ITEMS = [
  ...PRIMARY_NAV_ITEMS.slice(MOBILE_PRIMARY_COUNT),
  ...TOOLBOX_NAV_ITEMS,
  SETTINGS_ITEM,
];

/** Grouped desktop rail that becomes a five-item mobile dock with an overflow menu. */
export function Sidebar() {
  const pathname = usePathname();
  const [moreOpenForPath, setMoreOpenForPath] = useState<string | null>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const moreOpen = moreOpenForPath === pathname;
  const moreActive = MOBILE_MORE_ITEMS.some((item) =>
    item.href === "/" ? pathname === "/" : pathname.startsWith(item.href),
  );
  const toolboxActive = TOOLBOX_NAV_ITEMS.some((item) =>
    pathname.startsWith(item.href),
  );
  const activeToolboxLabel = TOOLBOX_NAV_ITEMS.find((item) =>
    pathname.startsWith(item.href),
  )?.label;

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
          <StudioMark width={23} height={23} />
        </span>
        <span>
          <strong>AutoStudio</strong>
          <small>Production OS</small>
        </span>
      </div>

      <nav className="studio-nav">
        <section
          className="studio-nav-group"
          aria-label="Workspace"
          data-nav-group="workspace"
        >
          <span className="studio-nav-label">Workspace</span>
          <div className="studio-nav-items">
            {PRIMARY_NAV_ITEMS.map((item) => (
              <NavItem
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
              />
            ))}
          </div>
        </section>

        <details
          className="studio-toolbox"
          open={toolboxActive ? true : undefined}
        >
          <summary className="studio-toolbox-trigger">
            <span className="studio-nav-icon">
              <IconToolbox />
            </span>
            <span className="studio-toolbox-copy">
              <strong>Toolbox</strong>
              <small>{activeToolboxLabel ?? "Specialist desks & labs"}</small>
            </span>
            <span className="studio-toolbox-chevron" aria-hidden="true">+</span>
          </summary>
          <div className="studio-toolbox-items">
            {TOOLBOX_NAV_GROUPS.map((group) => (
              <section
                className="studio-nav-group"
                key={group.label}
                aria-label={group.label}
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
          </div>
        </details>

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

      <div className="studio-sidebar-footer">
        <NavItem {...SETTINGS_ITEM} />
      </div>
    </aside>
  );
}
