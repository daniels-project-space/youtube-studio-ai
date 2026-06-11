"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useConvex, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useOwnerId } from "@/lib/owner-context";
import { failureReason } from "@/lib/failureReason";
import type { RunRow } from "@/lib/types";

const DISMISS_KEY = "studio.dismissedFailures";

/**
 * Compact status strip — MAIN OVERVIEW ONLY (mounted on the home page, not the
 * app shell). Shows small horizontal PILLS for recent failed runs (friendly
 * reason) + a connection pill if the realtime websocket is down. Dismissed pills
 * are remembered in localStorage and never reappear.
 */
export function StatusBanner() {
  const convex = useConvex();
  const ownerId = useOwnerId();

  // connection state (grace period avoids a startup flash)
  const [wsDown, setWsDown] = useState(false);
  useEffect(() => {
    let mountedFor = 0;
    const tick = () => {
      let connected = true;
      try { connected = convex.connectionState().isWebSocketConnected; } catch { connected = false; }
      mountedFor += 1;
      setWsDown(!connected && mountedFor >= 4);
    };
    const id = setInterval(tick, 1500);
    tick();
    return () => clearInterval(id);
  }, [convex]);

  // persisted dismissals
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DISMISS_KEY);
      if (raw) setDismissed(new Set(JSON.parse(raw) as string[]));
    } catch { /* ignore */ }
  }, []);
  const dismiss = (id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev).add(id);
      try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...next].slice(-200))); } catch { /* ignore */ }
      return next;
    });
  };

  const recent = useQuery(api.runs.listRecent, { ownerId, limit: 30 }) as RunRow[] | undefined;
  const failures = useMemo(() => {
    if (!recent) return [];
    return recent
      .filter((r) => r.status === "failed")
      .filter((r) => !dismissed.has(r._id))
      .filter((r) => !/cancell?ed/i.test(r.error ?? ""))
      .slice(0, 6);
  }, [recent, dismissed]);

  if (!wsDown && failures.length === 0) return null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "1.1rem" }}>
      {wsDown && (
        <span style={pill("rgba(245,158,11,0.45)", "rgba(245,158,11,0.12)", "#fbbf24")} title="Realtime backend unreachable — usually a VPN/proxy blocking the websocket">
          ⚠ offline — retrying
        </span>
      )}
      {failures.map((r) => {
        const info = failureReason(r.error);
        return (
          <span key={r._id} style={pill("rgba(248,113,113,0.4)", "rgba(248,113,113,0.10)", "#fca5a5")} title={`${r.channelName}: ${info.reason}${info.block ? ` (${info.block})` : ""}`}>
            <a href={`/runs/${r._id}`} style={{ color: "inherit", textDecoration: "none", maxWidth: 230, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {r.channelName} — {info.reason}
            </a>
            <button
              onClick={() => dismiss(r._id)}
              aria-label="Dismiss"
              style={{ background: "transparent", border: "none", color: "rgba(252,165,165,0.8)", cursor: "pointer", fontSize: "0.78rem", lineHeight: 1, padding: 0, marginLeft: 2 }}
            >
              ✕
            </button>
          </span>
        );
      })}
    </div>
  );
}

function pill(border: string, bg: string, color: string): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4rem",
    maxWidth: 280,
    padding: "0.2rem 0.55rem",
    borderRadius: 999,
    border: `1px solid ${border}`,
    background: bg,
    color,
    fontSize: "0.72rem",
    lineHeight: 1.2,
  };
}
