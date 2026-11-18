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
  IconSettings,
  IconSpark,
  IconCalendar,
  IconToolbox,
} from "./icons";
import { StudioMark } from "./StudioMark";

const PRIMARY_NAV_ITEMS = [
  { href: "/", label: "Studio", icon: <IconOverview /> },
  { href: "/channels", label: "Channels", icon: <IconChannels /> },
  { href: "/runs", label: "Production", icon: <IconRuns /> },
  { href: "/schedule", label: "Schedule", icon: <IconCalendar /> },
  { href: "/library", label: "Library", icon: <IconLibrary /> },
];

const AUTOMATION_NAV_ITEMS = [
  { href: "/", label: "Overview", icon: <IconOverview /> },
  { href: "/channels", label: "Channels", icon: <IconChannels /> },
  { href: "/runs", label: "Production", icon: <IconRuns /> },
  { href: "/library", label: "Video Library", icon: <IconLibrary /> },
  { href: "/schedule", label: "Calendar", icon: <IconCalendar /> },
  { href: "/analytics", label: "Analytics", icon: <IconAnalytics /> },
];

const TOOLBOX_NAV_GROUPS = [
  {
    label: "Insights",
    items: [
      { href: "/analytics", label: "Analytics", icon: <IconAnalytics /> },
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
const MOBILE_CORE_ITEMS = PRIMARY_NAV_ITEMS.slice(MOBILE_PRIMARY_COUNT);
const COMPACT_MORE_ITEMS = PRIMARY_NAV_ITEMS.slice(2, MOBILE_PRIMARY_COUNT);
const MOBILE_MORE_ITEMS = [
  ...MOBILE_CORE_ITEMS,
  ...TOOLBOX_NAV_ITEMS,
  SETTINGS_ITEM,
];

/** Desktop rail with a mobile dock that adapts to available width and text size. */
export function Sidebar({ automation = false }: { automation?: boolean }) {
  const pathname = usePathname();
  const primaryItems = automation ? AUTOMATION_NAV_ITEMS : PRIMARY_NAV_ITEMS;
  const mobileCoreItems = automation ? primaryItems.slice(MOBILE_PRIMARY_COUNT) : MOBILE_CORE_ITEMS;
  const compactMoreItems = automation ? primaryItems.slice(2, MOBILE_PRIMARY_COUNT) : COMPACT_MORE_ITEMS;
  const mobileMoreItems = automation ? [...mobileCoreItems, SETTINGS_ITEM] : MOBILE_MORE_ITEMS;
  const [moreOpenForPath, setMoreOpenForPath] = useState<string | null>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreOpen = moreOpenForPath === pathname;
  const moreActive = mobileMoreItems.some((item) =>
    item.href === "/" ? pathname === "/" : pathname.startsWith(item.href),
  );
  const compactMoreActive = moreActive || compactMoreItems.some((item) => pathname.startsWith(item.href));
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
      if (event.key === "Escape") {
        setMoreOpenForPath(null);
        if (moreRef.current?.contains(document.activeElement)) moreButtonRef.current?.focus();
      }
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
    <aside className="studio-sidebar" aria-label={automation ? "Automation navigation" : "Studio navigation"}>
      <div className="studio-brand">
        <span className="studio-brand-mark">
          {automation ? <i className="automation-play" aria-hidden="true" /> : <StudioMark width={23} height={23} />}
        </span>
        <span>
          <strong>{automation ? "YouTube Automation" : "AutoStudio"}</strong>
          {!automation ? <small>Signal / production</small> : null}
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
            {primaryItems.map((item) => (
              <NavItem
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
              />
            ))}
          </div>
        </section>

        {!automation && <details
          className="studio-toolbox"
          open={toolboxActive ? true : undefined}
        >
          <summary className="studio-toolbox-trigger">
            <span className="studio-nav-icon">
              <IconToolbox />
            </span>
            <span className="studio-toolbox-copy">
              <strong>Tools</strong>
              {activeToolboxLabel ? <small>{activeToolboxLabel}</small> : null}
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
        </details>}

        <div className="studio-nav-more" ref={moreRef}>
          <button
            type="button"
            className="studio-nav-item studio-nav-more-trigger"
            ref={moreButtonRef}
            aria-expanded={moreOpen}
            aria-controls="studio-mobile-more-menu"
            data-active={moreActive ? "true" : undefined}
            data-compact-active={compactMoreActive ? "true" : undefined}
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
              aria-label={automation ? "More automation destinations" : "More studio destinations"}
              onClick={(event) => {
                if ((event.target as HTMLElement).closest("a")) {
                  setMoreOpenForPath(null);
                }
              }}
            >
              {compactMoreItems.map((item) => <NavItem key={item.href} {...item} compactOnly />)}
              {mobileCoreItems.map((item) => (
                <NavItem
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                />
              ))}
              {!automation && <details
                className="studio-toolbox studio-mobile-toolbox"
                open={toolboxActive ? true : undefined}
              >
                <summary className="studio-toolbox-trigger studio-mobile-toolbox-trigger">
                  <span className="studio-nav-icon">
                    <IconToolbox />
                  </span>
                  <span className="studio-toolbox-copy">
                    <strong>Tools</strong>
                    {activeToolboxLabel ? <small>{activeToolboxLabel}</small> : null}
                  </span>
                  <span className="studio-toolbox-chevron" aria-hidden="true">+</span>
                </summary>
                <div className="studio-toolbox-items studio-mobile-toolbox-groups">
                  {TOOLBOX_NAV_GROUPS.map((group) => (
                    <section
                      className="studio-mobile-toolbox-group"
                      key={group.label}
                      aria-label={group.label}
                    >
                      <span className="studio-mobile-toolbox-label">{group.label}</span>
                      <div className="studio-mobile-toolbox-items">
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
              </details>}
              <NavItem {...SETTINGS_ITEM} />
            </div>
          )}
        </div>
      </nav>

      <div className="studio-sidebar-footer">
        <div className="studio-rail-status" aria-label="Release posture">
          <span aria-hidden="true" />
          <div>
            <strong>Draft mode</strong>
            <small>Approval required to release</small>
          </div>
        </div>
        <NavItem {...SETTINGS_ITEM} />
      </div>
    </aside>
  );
}
