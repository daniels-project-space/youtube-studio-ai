import type { ReactNode } from "react";
import { ConvexClientProvider } from "../ConvexClientProvider";
import { AppShell } from "@/components/AppShell";

/** All primary routes render inside the persistent app shell. */
export default function AppGroupLayout({ children }: { children: ReactNode }) {
  return (
    <ConvexClientProvider>
      <AppShell automation={process.env.YOUTUBE_AUTOMATION_PRIVATE === "1"}>{children}</AppShell>
    </ConvexClientProvider>
  );
}
