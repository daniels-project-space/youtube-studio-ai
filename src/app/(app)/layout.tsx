import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";

/** All primary routes render inside the persistent app shell. */
export default function AppGroupLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
