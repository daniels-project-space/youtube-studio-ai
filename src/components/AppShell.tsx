import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { ChannelSwitcher } from "./ChannelSwitcher";
import { OwnerProvider } from "@/lib/owner-context";
import { ChannelProvider } from "@/lib/channel-context";
import { OperationsAccess } from "./OperationsAccess";

/** Responsive app chrome shared by every operating surface. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <OwnerProvider>
      <ChannelProvider>
        <div className="studio-shell">
          <Sidebar />
          <div className="studio-workspace">
            <header className="studio-topbar">
              <div className="studio-mobile-brand" aria-label="AutoStudio">
                <span aria-hidden="true">✦</span>
                <strong>AutoStudio</strong>
              </div>
              <div className="studio-topbar-actions">
                <ChannelSwitcher />
                <OperationsAccess />
              </div>
            </header>
            <main className="studio-main">{children}</main>
          </div>
        </div>
      </ChannelProvider>
    </OwnerProvider>
  );
}
