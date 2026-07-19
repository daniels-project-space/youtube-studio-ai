import type { ReactNode } from "react";
import Script from "next/script";
import { AppShell } from "@/components/AppShell";

/** All primary routes render inside the persistent app shell. */
export default function AppGroupLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AppShell>{children}</AppShell>
      <Script
        src="https://jarvis-orcin-six.vercel.app/jarvis-embed.js?v=universal-controls-20260719-1"
        strategy="afterInteractive"
        data-jarvis-app="youtube-studio-ai"
      />
    </>
  );
}
