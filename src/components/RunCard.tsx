import Link from "next/link";
import type { RunRow } from "@/lib/types";
import { fmtDateTime, fmtUsd } from "@/lib/format";
import { StageBadge } from "./StageBadge";
import { Elapsed } from "./Elapsed";
import { IconExternal } from "./icons";

/**
 * Compact run row used on Overview, Runs, and channel detail. Links to the run
 * detail page. Shows live elapsed time while running.
 */
export function RunCard({ run }: { run: RunRow }) {
  const live = run.status === "running" || run.status === "queued";
  return (
    <Link
      href={`/runs/${run._id}`}
      className="glass glass-shine lift"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "1rem",
        padding: "0.9rem 1.1rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.85rem", minWidth: 0 }}>
        <StageBadge status={run.status} />
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontWeight: 500,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {run.channelName}
          </div>
          <div style={{ fontSize: "0.78rem", color: "var(--color-faint)" }}>
            {fmtDateTime(run.startedAt)}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "1.1rem",
          fontSize: "0.8rem",
          color: "var(--color-muted)",
          whiteSpace: "nowrap",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {fmtUsd(run.costTotal)}
        </span>
        <span style={{ color: live ? "var(--color-secondary)" : "var(--color-faint)" }}>
          <Elapsed from={run.startedAt} to={live ? undefined : run.finishedAt} />
        </span>
        {run.youtubeVideoId && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.3rem",
              color: "var(--color-accent)",
            }}
          >
            video <IconExternal width={13} height={13} />
          </span>
        )}
      </div>
    </Link>
  );
}
