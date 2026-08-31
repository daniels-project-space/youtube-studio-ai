"use client";

import { usePathname } from "next/navigation";
import { studioLocationForPathname } from "@/lib/studioLocation";

/** Persistent, route-derived orientation. It contains no channel or run data. */
export function StudioLocation() {
  const location = studioLocationForPathname(usePathname());
  return (
    <div className="studio-topbar-context" aria-label="Current workspace">
      <span>{location.area}</span>
      <strong>{location.title}</strong>
    </div>
  );
}
