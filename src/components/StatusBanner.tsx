"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useConvex, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useOwnerId } from "@/lib/owner-context";
import { failureReason } from "@/lib/failureReason";
import type { RunRow } from "@/lib/types";
import styles from "./StatusBanner.module.css";

const DISMISS_KEY = "studio.dismissedFailures";

/** Compact, expandable issue inbox for the Overview status bar. */
export function StatusBanner({
  overdueCount = 0,
  channelSlug,
}: {
  overdueCount?: number;
  channelSlug?: string | null;
}) {
  const convex = useConvex();
  const ownerId = useOwnerId();
  const [wsDown, setWsDown] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = localStorage.getItem(DISMISS_KEY);
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    let checks = 0;
    const tick = () => {
      let connected = true;
      try {
        connected = convex.connectionState().isWebSocketConnected;
      } catch {
        connected = false;
      }
      checks += 1;
      setWsDown(!connected && checks >= 4);
    };
    const timer = window.setInterval(tick, 1500);
    tick();
    return () => window.clearInterval(timer);
  }, [convex]);

  const recent = useQuery(api.runs.listRecent, { ownerId, limit: 30 }) as
    | RunRow[]
    | undefined;
  const failures = useMemo(() => {
    if (!recent) return [];
    return recent
      .filter((run) => !channelSlug || run.channelSlug === channelSlug)
      .filter((run) => run.status === "failed")
      .filter((run) => !dismissed.has(run._id))
      .filter((run) => !/cancell?ed/i.test(run.error ?? ""));
  }, [recent, dismissed, channelSlug]);
  const visibleFailures = failures.slice(0, 6);

  const dismiss = (id: string) => {
    setDismissed((previous) => {
      const next = new Set(previous).add(id);
      try {
        localStorage.setItem(DISMISS_KEY, JSON.stringify([...next].slice(-200)));
      } catch {
        // The widget still dismisses for this session.
      }
      return next;
    });
  };

  const issueCount = failures.length + (wsDown ? 1 : 0) + overdueCount;
  if (issueCount === 0) return null;

  return (
    <details className={styles.widget}>
      <summary aria-label={`Open ${issueCount} studio issue${issueCount === 1 ? "" : "s"}`}>
        <span aria-hidden="true" />
        {issueCount} issue{issueCount === 1 ? "" : "s"}
      </summary>
      <div className={styles.panel}>
        <header>
          <strong>Needs review</strong>
          <small>{issueCount} open</small>
        </header>

        {wsDown && (
          <div className={styles.issueRow}>
            <span className={styles.warningDot} aria-hidden="true" />
            <span>
              <strong>Realtime connection</strong>
              <small>Offline — retrying automatically</small>
            </span>
          </div>
        )}

        {visibleFailures.map((run) => {
          const info = failureReason(run.error);
          return (
            <div className={styles.issueRow} key={run._id}>
              <span className={styles.errorDot} aria-hidden="true" />
              <Link href={`/runs/${run._id}`}>
                <strong>{run.channelName}</strong>
                <small>{info.reason}{info.block ? ` · ${info.block}` : ""}</small>
              </Link>
              <button
                type="button"
                onClick={() => dismiss(run._id)}
                aria-label={`Dismiss ${run.channelName} failure`}
              >
                ×
              </button>
            </div>
          );
        })}

        {failures.length > visibleFailures.length && (
          <Link className={styles.moreIssues} href="/runs?status=failed">
            +{failures.length - visibleFailures.length} more failed run{failures.length - visibleFailures.length === 1 ? "" : "s"}
          </Link>
        )}

        {overdueCount > 0 && (
          <div className={styles.issueRow}>
            <span className={styles.warningDot} aria-hidden="true" />
            <Link href="/schedule">
              <strong>{overdueCount} overdue item{overdueCount === 1 ? "" : "s"}</strong>
              <small>Review the publishing schedule</small>
            </Link>
          </div>
        )}
      </div>
    </details>
  );
}
