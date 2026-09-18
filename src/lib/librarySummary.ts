import type { ReleaseEvidenceStatus } from "./releaseEvidenceStatus";

export type LibrarySummaryRun = {
  id: string;
  status: string;
  youtubeVideoId?: string;
  libraryState?: "active" | "archived";
  /** Only a recorded release certificate promotes an active row to current. */
  releaseEvidenceStatus?: ReleaseEvidenceStatus;
};

export type LibraryStateSummary = {
  /** Active rows with a retained final-master release record. */
  currentCount: number;
  /** Active rows retained from before (or without) release-proof records. */
  legacyCount: number;
  archivedCount: number;
  totalCount: number;
};

/**
 * Counts the same finished-master population as videos.listVideos without
 * constructing its title, metadata, certificate, thumbnail, or playback rows.
 */
export function summarizeLibraryStates(
  runs: readonly LibrarySummaryRun[],
  runIdsWithVideoAssets: ReadonlySet<string>,
): LibraryStateSummary {
  let currentCount = 0;
  let legacyCount = 0;
  let archivedCount = 0;
  for (const run of runs) {
    const finished = Boolean(run.youtubeVideoId)
      || (run.status !== "failed" && runIdsWithVideoAssets.has(run.id));
    if (!finished) continue;
    if (run.libraryState === "archived") {
      archivedCount += 1;
    } else if (run.releaseEvidenceStatus === "release_evidence_recorded") {
      currentCount += 1;
    } else {
      legacyCount += 1;
    }
  }
  return {
    currentCount,
    legacyCount,
    archivedCount,
    totalCount: currentCount + legacyCount + archivedCount,
  };
}
