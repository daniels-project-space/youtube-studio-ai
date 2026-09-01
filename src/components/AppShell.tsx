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
              <span />
              <svg
                className="studio-ambient-map"
                viewBox="0 0 1200 760"
                preserveAspectRatio="xMidYMid slice"
              >
                <defs>
                  <linearGradient id="studio-signal-gradient" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#73ddff" />
                    <stop offset="0.5" stopColor="#a78bfa" />
                    <stop offset="1" stopColor="#ff7356" />
                  </linearGradient>
                </defs>
                <path className="studio-ambient-path" d="M-80 548C170 394 318 650 552 492S910 252 1280 402" />
                <path className="studio-ambient-path studio-ambient-path-ghost" d="M-100 588C156 438 346 696 580 526S930 294 1300 448" />
                <circle className="studio-ambient-node" cx="552" cy="492" r="5" />
                <circle className="studio-ambient-node studio-ambient-node-late" cx="910" cy="332" r="4" />
              </svg>
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
