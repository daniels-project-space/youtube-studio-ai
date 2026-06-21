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
  IconLore,
  IconLofi,
} from "./icons";

const NAV = [
  { href: "/", label: "Overview", icon: <IconOverview /> },
  { href: "/channels", label: "Channels", icon: <IconChannels /> },
  { href: "/golden", label: "Golden Pipeline", icon: <IconGolden /> },
  { href: "/loreshort", label: "Lore Short", icon: <IconLore /> },
  { href: "/lofi", label: "Lofi Loop", icon: <IconLofi /> },
  { href: "/schedule", label: "Schedule", icon: <IconCalendar /> },
  { href: "/runs", label: "Runs", icon: <IconRuns /> },
  { href: "/library", label: "Library", icon: <IconLibrary /> },
  { href: "/analytics", label: "Analytics", icon: <IconAnalytics /> },
  { href: "/seo", label: "SEO", icon: <IconSeo /> },
  { href: "/settings", label: "Settings", icon: <IconSettings /> },
];

/** Fixed 240px left rail: brand + primary navigation. */
export function Sidebar() {
  return (
    <aside
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        bottom: 0,
        width: 240,
        display: "flex",
        flexDirection: "column",
        padding: "1.25rem 0.9rem",
        borderRight: "1px solid var(--color-border)",
        background: "rgba(14, 14, 16, 0.55)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        zIndex: 20,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.6rem",
          padding: "0.25rem 0.5rem 1.25rem",
        }}
      >
        <span
          style={{
            display: "grid",
            placeItems: "center",
            width: 34,
            height: 34,
            borderRadius: 10,
            background:
              "linear-gradient(135deg, var(--color-accent), var(--color-secondary))",
            color: "#0a0a0b",
          }}
        >
          <IconSpark width={19} height={19} />
        </span>
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "1.15rem",
            fontWeight: 600,
            letterSpacing: "-0.01em",
          }}
        >
          Studio AI
        </span>
      </div>

      <nav style={{ display: "grid", gap: "0.25rem" }}>
        {NAV.map((n) => (
          <NavItem key={n.href} href={n.href} label={n.label} icon={n.icon} />
        ))}
      </nav>

      <div
        style={{
          marginTop: "auto",
          padding: "0.5rem",
          fontSize: "0.72rem",
          color: "var(--color-faint)",
        }}
      >
        Autonomous channel pipeline
      </div>
    </aside>
  );
}
