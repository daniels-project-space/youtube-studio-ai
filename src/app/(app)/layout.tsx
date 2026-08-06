import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Script from "next/script";
import { ConvexClientProvider } from "../ConvexClientProvider";
import { AppShell } from "@/components/AppShell";
import {
  hasValidOperatorSession,
  STUDIO_SESSION_COOKIE,
} from "@/lib/operatorSession";

/** All primary routes render inside the persistent app shell. */
export default async function AppGroupLayout({ children }: { children: ReactNode }) {
  const session = (await cookies()).get(STUDIO_SESSION_COOKIE)?.value;
  if (!(await hasValidOperatorSession(session))) {
    redirect("/operator-login");
  }

  return (
    <ConvexClientProvider>
      <AppShell>{children}</AppShell>
      <Script
        src="https://jarvis-orcin-six.vercel.app/jarvis-embed.js?v=universal-controls-20260719-1"
        strategy="afterInteractive"
        data-jarvis-app="youtube-studio-ai"
      />
    </ConvexClientProvider>
  );
}
