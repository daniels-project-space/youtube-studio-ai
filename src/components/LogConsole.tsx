"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { IconChevron, IconTerminal } from "./icons";
import styles from "./LogConsole.module.css";

/** Max lines kept in the DOM (the query is already capped server-side). */
const TAIL_LIMIT = 500;

type LogLine = {
  _id: string;
  block?: string;
  level: string;
  message: string;
  at: number;
  seq?: number;
};

function fmtClock(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Reactive persisted log tail with an explicit follow/pause control. */
export function LogConsole({ runId, runStatus }: { runId: string; runStatus?: string }) {
  const [open, setOpen] = useState(true);
  const [following, setFollowing] = useState(true);
  const logs = useQuery(api.runLogs.listRunLogs, {
    runId: runId as Id<"runs">,
    limit: TAIL_LIMIT,
  }) as LogLine[] | undefined;
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const live = runStatus === "running" || runStatus === "queued";

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const next = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    stickRef.current = next;
    setFollowing(next);
  }

  function jumpToLatest() {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    stickRef.current = true;
    setFollowing(true);
  }

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && open && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [logs, open]);

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next) {
      stickRef.current = true;
      setFollowing(true);
    }
  }

  const tail = (logs ?? []).slice(-TAIL_LIMIT);
  const count = logs?.length ?? 0;
  const counts = tail.reduce(
    (result, line) => {
      if (line.level === "warn") result.warn += 1;
      else if (line.level === "error") result.error += 1;
      else result.info += 1;
      return result;
    },
    { info: 0, warn: 0, error: 0 },
  );

  return (
    <section className={styles.root} data-live={live ? "true" : undefined} aria-labelledby="run-console-title">
      <header className={styles.header}>
        <div className={styles.identity}>
          <span className={styles.icon}><IconTerminal width={16} height={16} /></span>
          <span>
            <small>03 / reactive log tail</small>
            <strong id="run-console-title">Run console</strong>
            <em>{live ? "New persisted lines arrive automatically." : "The terminal record is complete unless recovery appends more lines."}</em>
          </span>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.feedState} data-following={following ? "true" : undefined}><i />{following ? "Following tail" : "Review paused"}</span>
          <button type="button" className={styles.collapse} onClick={toggleOpen} aria-expanded={open}>
            {open ? "Collapse" : "Open console"}<IconChevron width={14} height={14} data-open={open ? "true" : undefined} />
          </button>
        </div>
      </header>

      {open && (
        <div className={styles.body}>
          <div className={styles.toolbar} aria-label="Log line summary">
            <span><small>Lines</small><strong>{count}{count >= TAIL_LIMIT ? "+" : ""}</strong></span>
            <span data-level="info"><small>Info</small><strong>{counts.info}</strong></span>
            <span data-level="warn"><small>Warnings</small><strong>{counts.warn}</strong></span>
            <span data-level="error"><small>Errors</small><strong>{counts.error}</strong></span>
            {!following && <button type="button" onClick={jumpToLatest}>Jump to latest ↓</button>}
          </div>

          {logs !== undefined && tail.length === 0 ? (
            <div className={styles.empty}>
              <span aria-hidden="true">›_</span>
              <strong>No persisted lines yet</strong>
              <p>The console will populate when the runner flushes its first log batch.</p>
            </div>
          ) : (
            <div ref={scrollRef} onScroll={onScroll} className={styles.lines} aria-busy={logs === undefined}>
              {logs === undefined ? (
                <span className={styles.connecting}>Connecting to the persisted tail…</span>
              ) : (
                tail.map((line) => (
                  <div key={line._id} className={styles.line} data-level={line.level}>
                    <time>{fmtClock(line.at)}</time>
                    <span className={styles.block}>{line.block ?? "system"}</span>
                    <span className={styles.message}>{line.message}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
