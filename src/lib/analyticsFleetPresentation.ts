export const ANALYTICS_FLEET_PAGE_SIZE = 6;

export function analyticsFleetRowsForMetric<T extends { channelId: string }>(
  rows: readonly T[], metric: string, snapshotChannelIds: ReadonlySet<string>,
): T[] {
  return metric === "totalViews" || metric === "subscriberCount"
    ? rows.filter(row => snapshotChannelIds.has(row.channelId))
    : [...rows];
}

export function nextAnalyticsFleetLimit(current: number, total: number): number {
  const safeCurrent = Number.isSafeInteger(current) && current > 0
    ? current
    : ANALYTICS_FLEET_PAGE_SIZE;
  const safeTotal = Number.isSafeInteger(total) && total > 0 ? total : 0;
  return Math.min(safeTotal, safeCurrent + ANALYTICS_FLEET_PAGE_SIZE);
}
