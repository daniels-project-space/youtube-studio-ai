import type { ReactNode } from "react";
import { ConvexClientProvider } from "../ConvexClientProvider";
import { AppShell } from "@/components/AppShell";

/** All primary routes render inside the persistent app shell. */
export default function AppGroupLayout({ children }: { children: ReactNode }) {
  return (
    <ConvexClientProvider>
      <AppShell>{children}</AppShell>
    </ConvexClientProvider>
  );
}
