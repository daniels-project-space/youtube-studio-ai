"use client";

import { ReactNode, useMemo } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";

/**
 * Client-side Convex provider. Reads NEXT_PUBLIC_CONVEX_URL (inlined at build
 * time). Wrapping in useMemo keeps a single client instance per mount.
 */
export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url) return null;
    return new ConvexReactClient(url);
  }, []);

  if (!client) {
    return (
      <div style={{ padding: "2rem", fontFamily: "system-ui", color: "#f87171" }}>
        Misconfigured: NEXT_PUBLIC_CONVEX_URL is not set.
      </div>
    );
  }

  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
