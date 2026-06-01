import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { ChannelSwitcher } from "./ChannelSwitcher";
import { OwnerProvider } from "@/lib/owner-context";
import { ChannelProvider } from "@/lib/channel-context";

/**
 * App chrome: fixed left Sidebar + top bar (ChannelSwitcher) + scrollable main.
 * Wraps children in the Owner + Channel client providers so every page can read
 * the active owner and the selected channel.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <OwnerProvider>
      <ChannelProvider>
        <div style={{ minHeight: "100vh" }}>
          <Sidebar />
          <div style={{ marginLeft: 240, display: "flex", flexDirection: "column", minHeight: "100vh" }}>
            <header
              style={{
                position: "sticky",
                top: 0,
                zIndex: 15,
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: "1rem",
                padding: "0.85rem 1.75rem",
                borderBottom: "1px solid var(--color-border)",
                background: "rgba(10, 10, 11, 0.6)",
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
              }}
            >
              <ChannelSwitcher />
            </header>
            <main
              style={{
                flex: 1,
                padding: "2rem 1.75rem 4rem",
                maxWidth: 1200,
                width: "100%",
                margin: "0 auto",
              }}
            >
              {children}
            </main>
          </div>
        </div>
      </ChannelProvider>
    </OwnerProvider>
  );
}
