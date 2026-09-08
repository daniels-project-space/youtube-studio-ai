export type LibrarySummaryRun = {
  id: string;
  status: string;
  youtubeVideoId?: string;
  libraryState?: "active" | "archived";
};

export type LibraryStateSummary = {
  activeCount: number;
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
  let activeCount = 0;
  let archivedCount = 0;
  for (const run of runs) {
    const finished = Boolean(run.youtubeVideoId)
      || (run.status !== "failed" && runIdsWithVideoAssets.has(run.id));
    if (!finished) continue;
    if (run.libraryState === "archived") archivedCount += 1;
    else activeCount += 1;
  }
  return {
    activeCount,
    archivedCount,
    totalCount: activeCount + archivedCount,
  };
}
