export const ANALYTICS_FLEET_PAGE_SIZE = 6;

export function nextAnalyticsFleetLimit(current: number, total: number): number {
  const safeCurrent = Number.isSafeInteger(current) && current > 0
    ? current
    : ANALYTICS_FLEET_PAGE_SIZE;
  const safeTotal = Number.isSafeInteger(total) && total > 0 ? total : 0;
  return Math.min(safeTotal, safeCurrent + ANALYTICS_FLEET_PAGE_SIZE);
}
