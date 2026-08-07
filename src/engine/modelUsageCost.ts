import type { CostModelUsageKind, StageContext } from "./types";

/**
 * Exact tracked token cost plus a caller-declared estimate only for provider
 * responses that were explicitly recorded as unpriced. Cache hits and priced
 * calls never receive the fallback, so composite patches cannot double-count.
 */
export function accountedModelUsageCost(
  ctx: Pick<StageContext, "modelUsageAccounting" | "modelUsageCostUsd">,
  kinds: readonly CostModelUsageKind[],
  unpricedCallFallbackUsd: number,
): number {
  const accounting = ctx.modelUsageAccounting?.(kinds);
  if (!accounting) return ctx.modelUsageCostUsd?.(kinds) ?? 0;
  return (
    accounting.costUsd +
    accounting.unpricedCalls * Math.max(0, unpricedCallFallbackUsd)
  );
}
