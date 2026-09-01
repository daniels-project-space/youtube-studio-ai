/** A concise, data-free orientation label for the persistent Studio top bar. */
export type StudioLocation = {
  area: string;
  title: string;
};

const EXACT_LOCATIONS: Record<string, StudioLocation> = {
  "/": { area: "Workspace", title: "Studio" },
  "/channels": { area: "Channel workspace", title: "Channels" },
  "/channels/new": { area: "Channel workspace", title: "New channel" },
  "/schedule": { area: "Production", title: "Schedule" },
  "/runs": { area: "Production", title: "Run history" },
  "/library": { area: "Workspace", title: "Library" },
  "/analytics": { area: "Workspace", title: "Analytics" },
  "/golden": { area: "Toolbox · Assurance", title: "Golden modules" },
  "/studio-assets": { area: "Toolbox · Craft", title: "Studio assets" },
  "/casefile": { area: "Toolbox · Assurance", title: "Casefile" },
  "/editorial-evidence": { area: "Toolbox · Assurance", title: "Editorial evidence" },
  "/seo": { area: "Toolbox · Craft", title: "Packaging research" },
  "/settings": { area: "Workspace", title: "Settings" },
  "/novita-render": { area: "Toolbox · Infrastructure", title: "Render fleet" },
  "/lofi": { area: "Toolbox · Infrastructure", title: "Music references" },
  "/loreshort": { area: "Toolbox · Infrastructure", title: "Lore references" },
};

export function studioLocationForPathname(pathname: string): StudioLocation {
  if (EXACT_LOCATIONS[pathname]) return EXACT_LOCATIONS[pathname];
  if (pathname.startsWith("/channels/")) {
    return { area: "Channel workspace", title: "Operating room" };
  }
  if (pathname.startsWith("/runs/")) {
    return { area: "Production", title: "Run detail" };
  }
  return { area: "Workspace", title: "AutoStudio" };
}
