export type ChannelCardRun = {
  status: string;
  youtubeVideoId?: string;
  costTotal?: number;
};

export function isAcceptedChannelArtworkRun(run: ChannelCardRun): boolean {
  return run.status === "ok" || Boolean(run.youtubeVideoId);
}

export function summarizeChannelCardRuns(runs: ChannelCardRun[]) {
  return {
    recentRunCount: runs.length,
    recentPublishedCount: runs.filter((run) => Boolean(run.youtubeVideoId)).length,
    recentSpend: runs.reduce((total, run) => total + (run.costTotal ?? 0), 0),
    lastRunStatus: runs[0]?.status ?? null,
  };
}
