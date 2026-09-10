export type ComparableViewSignal = {
  views: number;
  overlap: number;
};

export type ViewBenchmark = {
  estimatedViews: number;
  source: "tag_overlap" | "niche_fallback";
  matches: number;
  method: "weighted_median" | "niche_median";
};

const MAX_COMPARABLES = 20;
const MIN_COMPARABLES = 3;

function safeViews(value: number): number | null {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Estimate a comparable-video benchmark without letting one viral outlier
 * masquerade as the expected result. Overlap remains the relevance weight;
 * the weighted median is the central comparable value, not an audience
 * promise. The stable tie-break keeps receipts deterministic across retries.
 */
export function weightedTagOverlapBenchmark(
  signals: readonly ComparableViewSignal[],
  fallback: number,
): ViewBenchmark {
  const safeFallback = Math.round(safeViews(fallback) ?? 0);
  const selected = signals
    .map((signal) => ({ views: safeViews(signal.views), overlap: signal.overlap }))
    .filter((signal): signal is { views: number; overlap: number } =>
      signal.views !== null && Number.isFinite(signal.overlap) && signal.overlap > 0,
    )
    .sort((left, right) =>
      right.overlap - left.overlap || right.views - left.views,
    )
    .slice(0, MAX_COMPARABLES);

  if (selected.length < MIN_COMPARABLES) {
    return {
      estimatedViews: safeFallback,
      source: "niche_fallback",
      matches: selected.length,
      method: "niche_median",
    };
  }

  // Select by relevance first, then order by the measured value so the
  // cumulative overlap weight defines a real weighted median.
  const ranked = [...selected].sort((left, right) =>
    left.views - right.views || right.overlap - left.overlap,
  );
  const totalWeight = ranked.reduce((sum, signal) => sum + signal.overlap, 0);
  let cumulativeWeight = 0;
  for (const signal of ranked) {
    cumulativeWeight += signal.overlap;
    if (cumulativeWeight * 2 >= totalWeight) {
      return {
        estimatedViews: Math.round(signal.views),
        source: "tag_overlap",
        matches: selected.length,
        method: "weighted_median",
      };
    }
  }

  // The loop always returns for a positive totalWeight, but keep the fallback
  // explicit so malformed future inputs can never become a false zero.
  return {
    estimatedViews: safeFallback,
    source: "niche_fallback",
    matches: ranked.length,
    method: "niche_median",
  };
}
