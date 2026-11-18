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
export function AppShell({ children, automation = false }: { children: ReactNode; automation?: boolean }) {
  return (
    <OwnerProvider>
      <ChannelProvider>
        <OperationsAccessProvider>
          <div className="studio-shell" data-automation={automation || undefined}>
            <div className="studio-ambient" aria-hidden="true">
              <span />
              <span />
            </div>
            <Sidebar automation={automation} />
            <div className="studio-workspace">
              <header className="studio-topbar">
                <div className="studio-mobile-brand">
                  <span aria-hidden="true">{automation ? <i className="automation-play" /> : <StudioMark width={20} height={20} />}</span>
                  <strong>{automation ? "YouTube Automation" : "AutoStudio"}</strong>
                </div>
                <StudioLocation automation={automation} />
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
