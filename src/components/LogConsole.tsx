"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { EmptyState } from "./EmptyState";
import { IconChevron, IconTerminal } from "./icons";

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

const LEVEL_COLOR: Record<string, string> = {
  info: "var(--color-muted)",
  warn: "var(--color-amber)",
  error: "var(--color-failed)",
};

function fmtClock(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Live, reactive console for a run's streamed `ctx.log` output. Subscribes to
 * `runLogs.listRunLogs` (chronological asc) — updates push in automatically, no
 * polling. Dark terminal look matching the design tokens, level-coloured lines,
 * auto-scroll to bottom on new lines with a "scrolled up → pause auto-scroll"
 * guard, tail-capped. Renders as a collapsible "Logs" panel.
 */
export function LogConsole({ runId }: { runId: string }) {
  const [open, setOpen] = useState(true);
  const logs = useQuery(api.runLogs.listRunLogs, {
    runId: runId as Id<"runs">,
    limit: TAIL_LIMIT,
  }) as LogLine[] | undefined;

  const scrollRef = useRef<HTMLDivElement>(null);
  // When true, new lines auto-scroll to the bottom. Set false once the user
  // scrolls up, restored when they return to (near) the bottom.
  const stickRef = useRef(true);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;
    stickRef.current = distanceFromBottom < 40;
  }

  // After each render with new lines, stick to bottom if the user hasn't
  // scrolled away. useLayoutEffect avoids a visible jump.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && open && stickRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs, open]);

  // Re-stick when (re)opening the panel.
  useEffect(() => {
    if (open) stickRef.current = true;
  }, [open]);

  const tail = (logs ?? []).slice(-TAIL_LIMIT);
  const count = logs?.length ?? 0;

  return (
    <div
      className="glass"
      style={{ overflow: "hidden", borderColor: "var(--color-border)" }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          font: "inherit",
          textAlign: "left",
          cursor: "pointer",
          background: "transparent",
          border: "none",
          color: "inherit",
          display: "flex",
          alignItems: "center",
          gap: "0.7rem",
          padding: "0.8rem 1.05rem",
        }}
      >
        <IconTerminal width={16} height={16} style={{ color: "var(--color-faint)" }} />
        <span style={{ fontWeight: 500, fontSize: "0.95rem", flex: 1 }}>Logs</span>
        {count > 0 && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.72rem",
              color: "var(--color-faint)",
            }}
          >
            {count}
            {count >= TAIL_LIMIT ? "+" : ""} line{count === 1 ? "" : "s"}
          </span>
        )}
        <IconChevron
          width={15}
          height={15}
          style={{
            transition: "transform 0.18s ease",
            transform: open ? "rotate(180deg)" : "none",
            color: "var(--color-muted)",
          }}
        />
      </button>

      {open && (
        <div style={{ borderTop: "1px solid var(--color-border)" }}>
          {logs !== undefined && tail.length === 0 ? (
            <div style={{ padding: "1.25rem" }}>
              <EmptyState
                title="No logs yet"
                description="Streamed console output will appear here as the run executes."
                icon={<IconTerminal width={22} height={22} />}
              />
            </div>
          ) : (
            <div
              ref={scrollRef}
              onScroll={onScroll}
              style={{
                maxHeight: 420,
                overflowY: "auto",
                padding: "0.9rem 1.05rem",
                background: "var(--color-bg)",
                fontFamily: "var(--font-mono)",
                fontSize: "0.76rem",
                lineHeight: 1.65,
              }}
            >
              {logs === undefined ? (
                <span style={{ color: "var(--color-faint)" }}>Connecting…</span>
              ) : (
                tail.map((line) => (
                  <div
                    key={line._id}
                    style={{
                      display: "flex",
                      gap: "0.7rem",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    <span
                      style={{
                        color: "var(--color-faint)",
                        flexShrink: 0,
                        userSelect: "none",
                      }}
                    >
                      {fmtClock(line.at)}
                    </span>
                    {line.block && (
                      <span
                        style={{
                          color: "var(--color-secondary)",
                          flexShrink: 0,
                          userSelect: "none",
                        }}
                      >
                        {line.block}
                      </span>
                    )}
                    <span
                      style={{
                        color: LEVEL_COLOR[line.level] ?? "var(--color-muted)",
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      {line.message}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
