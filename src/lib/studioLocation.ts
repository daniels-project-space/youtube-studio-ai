/** A concise, data-free orientation label for the persistent Studio top bar. */
export type StudioLocation = {
  area: string;
  title: string;
};

const EXACT_LOCATIONS: Record<string, StudioLocation> = {
  "/": { area: "Workspace", title: "Overview" },
  "/channels": { area: "Channel workspace", title: "Channels" },
  "/channels/new": { area: "Channel workspace", title: "New channel" },
  "/schedule": { area: "Production command", title: "Schedule" },
  "/runs": { area: "Production command", title: "Run history" },
  "/library": { area: "Content library", title: "Released work" },
  "/analytics": { area: "Learning loop", title: "Analytics" },
  "/golden": { area: "Production standards", title: "Golden modules" },
  "/studio-assets": { area: "Production standards", title: "Studio assets" },
  "/casefile": { area: "Evidence desk", title: "Casefile" },
  "/editorial-evidence": { area: "Evidence desk", title: "Editorial evidence" },
  "/seo": { area: "Audience development", title: "Packaging research" },
  "/settings": { area: "Workspace", title: "Settings" },
  "/novita-render": { area: "Runtime operations", title: "Novita render fleet" },
  "/lofi": { area: "Program archive", title: "Lofi" },
  "/loreshort": { area: "Program archive", title: "Lore shorts" },
};

export function studioLocationForPathname(pathname: string): StudioLocation {
  if (EXACT_LOCATIONS[pathname]) return EXACT_LOCATIONS[pathname];
  if (pathname.startsWith("/channels/")) {
    return { area: "Channel workspace", title: "Channel detail" };
  }
  if (pathname.startsWith("/runs/")) {
    return { area: "Production command", title: "Run detail" };
  }
  return { area: "Workspace", title: "AutoStudio" };
}
