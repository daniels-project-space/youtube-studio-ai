import {
  analyticsRefreshHealth,
  type AnalyticsRefreshHealthInput,
} from "@/lib/analyticsRefreshPresentation";

/**
 * Keeps the portfolio's numerical presentation honest. Analytics snapshots
 * remain valuable after a connector expires, but they are historical evidence
 * until every channel in the displayed scope has a current refresh receipt.
 */
export type AnalyticsDataFreshness = {
  readonly state: "current" | "recorded";
  readonly currentCount: number;
  readonly channelCount: number;
  readonly label: "Live analytics" | "Recorded snapshots";
  readonly detail: string;
};

export function analyticsDataFreshness(
  rows: readonly AnalyticsRefreshHealthInput[],
  now = Date.now(),
): AnalyticsDataFreshness {
  const currentCount = rows.filter((row) => analyticsRefreshHealth(row, now).state === "current").length;
  const channelCount = rows.length;
  const current = channelCount > 0 && currentCount === channelCount;

  return {
    state: current ? "current" : "recorded",
    currentCount,
    channelCount,
    label: current ? "Live analytics" : "Recorded snapshots",
    detail: current
      ? `${currentCount} of ${channelCount} channel${channelCount === 1 ? "" : "s"} current.`
      : `${currentCount} of ${channelCount} channel${channelCount === 1 ? "" : "s"} current; values may include earlier snapshots.`,
  };
}
