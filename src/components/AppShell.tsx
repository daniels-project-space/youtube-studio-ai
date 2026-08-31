import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { ChannelSwitcher } from "./ChannelSwitcher";
import { OwnerProvider } from "@/lib/owner-context";
import { ChannelProvider } from "@/lib/channel-context";
import {
  OperationsAccess,
  OperationsAccessProvider,
} from "./OperationsAccess";
import { StudioLocation } from "./StudioLocation";
import { StudioMark } from "./StudioMark";

/** Responsive app chrome shared by every operating surface. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <OwnerProvider>
      <ChannelProvider>
        <OperationsAccessProvider>
          <div className="studio-shell">
            <div className="studio-ambient" aria-hidden="true">
              <span />
              <span />
            </div>
            <Sidebar />
            <div className="studio-workspace">
              <header className="studio-topbar">
                <div className="studio-mobile-brand">
                  <span aria-hidden="true"><StudioMark width={20} height={20} /></span>
                  <strong>AutoStudio</strong>
                </div>
                <StudioLocation />
                <div className="studio-topbar-actions">
                  <ChannelSwitcher />
                  <OperationsAccess />
                </div>
              </header>
              <main className="studio-main">{children}</main>
            </div>
          </div>
        </OperationsAccessProvider>
      </ChannelProvider>
    </OwnerProvider>
  );
}
