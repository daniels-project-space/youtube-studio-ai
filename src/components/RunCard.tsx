import Link from "next/link";
import type { RunRow } from "@/lib/types";
import { fmtDateTime, fmtUsd } from "@/lib/format";
import { StageBadge } from "./StageBadge";
import { Elapsed } from "./Elapsed";
import { ReleaseEvidenceBadge } from "./ReleaseEvidenceBadge";
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
      className="glass run-card"
      data-status={run.status}
      data-release-evidence={run.releaseEvidenceStatus}
    >
      <div className="run-card-main">
        <StageBadge status={run.status} />
        <div className="run-card-copy">
          <div>
            {run.channelName}
          </div>
          <small>
            {fmtDateTime(run.startedAt)}
          </small>
        </div>
      </div>

      <div className="run-card-meta">
        <span className="run-card-cost">
          {fmtUsd(run.costTotal)}
        </span>
        <span className={live ? "run-card-live" : undefined}>
          <Elapsed from={run.startedAt} to={live ? undefined : run.finishedAt} />
        </span>
        {run.youtubeVideoId && (
          <span className="run-card-video">
            video <IconExternal width={13} height={13} />
          </span>
        )}
        <ReleaseEvidenceBadge status={run.releaseEvidenceStatus} />
      </div>
    </Link>
  );
}
