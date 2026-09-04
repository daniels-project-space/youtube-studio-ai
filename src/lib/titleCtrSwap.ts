/**
 * TITLE CTR SWAP — closing the loop metacraft already pays for.
 *
 * Metacraft picks a winner and keeps the runner-up in `titleAlternate`,
 * described in its own docs as "stored for CTR-swap learning". Nothing has ever
 * read it: the field is written to Convex and never consulted, so the second
 * title is generated, judged and paid for on every video and then discarded.
 *
 * This is the decision half of that loop, and it is deliberately ONLY the
 * decision half. Renaming a published video is an outward-facing, viewer-
 * visible act, so the rule that selects a swap is separated from the code that
 * performs one and is pure, inspectable and testable on its own.
 *
 * Three things make a swap defensible rather than superstitious:
 *
 *   1. ENOUGH IMPRESSIONS. Click-through on a few hundred impressions is noise;
 *      swapping on it would be reading randomness and would corrupt the very
 *      history a later decision depends on.
 *   2. A REFERENCE TO LOSE TO. "Low CTR" only means something against the
 *      channel's own median. An absolute threshold punishes a whole channel for
 *      its niche, and rewards another for an easy one.
 *   3. A SETTLING PERIOD. YouTube pushes a new upload to subscribers first,
 *      whose click-through flatters the title. Judging inside that window
 *      measures the audience, not the title.
 *
 * A swap is a test, not a correction: the alternate has never been seen by an
 * audience either. So a swap is recorded with the baseline it must beat, and
 * `judgeSwapOutcome` decides afterwards whether it earned its place — otherwise
 * the loop would keep replacing titles without ever learning which won.
 */

export interface TitleCandidateStats {
  videoId: string;
  title: string;
  /** The runner-up metacraft already produced. No alternate, no test. */
  titleAlternate?: string | null;
  impressions?: number | null;
  ctr?: number | null;
  publishedAt: number;
  /** Set once a swap has been applied, so a video is never swapped twice. */
  swappedAt?: number | null;
}

export interface SwapPolicy {
  /** Below this, click-through is noise rather than signal. */
  minImpressions: number;
  /** Hours a video is left alone so the subscriber surge is not mistaken for the title working. */
  settleHours: number;
  /** How far below the channel median counts as underperforming (0.85 = 15% below). */
  medianRatio: number;
}

export const DEFAULT_SWAP_POLICY: SwapPolicy = {
  minImpressions: 2_000,
  settleHours: 72,
  medianRatio: 0.85,
};

export interface SwapDecision {
  videoId: string;
  action: "swap" | "hold";
  reason: string;
  from?: string;
  to?: string;
  /** The number the alternate has to beat for the swap to have been worth it. */
  baselineCtr?: number;
  channelMedianCtr?: number;
}

export function channelMedianCtr(videos: TitleCandidateStats[]): number | null {
  const measured = videos
    .map((v) => v.ctr)
    .filter((c): c is number => typeof c === "number" && c > 0)
    .sort((a, b) => a - b);
  if (measured.length < 4) return null;
  const mid = Math.floor(measured.length / 2);
  return measured.length % 2 ? measured[mid] : (measured[mid - 1] + measured[mid]) / 2;
}

/**
 * Which videos should have their title swapped for the stored alternate.
 *
 * Every rejection carries its reason. A loop that silently declines to act is
 * indistinguishable from one that is broken, which is how the original
 * `titleAlternate` field went unread for so long without anyone noticing.
 */
export function planTitleSwaps(
  videos: TitleCandidateStats[],
  now: number,
  policy: SwapPolicy = DEFAULT_SWAP_POLICY,
): SwapDecision[] {
  const median = channelMedianCtr(videos);
  return videos.map((video): SwapDecision => {
    const base = { videoId: video.videoId, channelMedianCtr: median ?? undefined };
    if (video.swappedAt) {
      return { ...base, action: "hold", reason: "already swapped once; a second swap would confound the test" };
    }
    if (!video.titleAlternate?.trim()) {
      return { ...base, action: "hold", reason: "no stored alternate to swap to" };
    }
    if (video.titleAlternate.trim() === video.title.trim()) {
      return { ...base, action: "hold", reason: "alternate is identical to the live title" };
    }
    const ageHours = (now - video.publishedAt) / 3_600_000;
    if (ageHours < policy.settleHours) {
      return { ...base, action: "hold", reason: `only ${ageHours.toFixed(0)}h old; the subscriber surge has not settled` };
    }
    if ((video.impressions ?? 0) < policy.minImpressions) {
      return { ...base, action: "hold", reason: `${video.impressions ?? 0} impressions below the ${policy.minImpressions} noise floor` };
    }
    if (typeof video.ctr !== "number" || video.ctr <= 0) {
      return { ...base, action: "hold", reason: "no measured click-through yet" };
    }
    if (median === null) {
      return { ...base, action: "hold", reason: "fewer than 4 measured videos; no channel median to judge against" };
    }
    if (video.ctr >= median * policy.medianRatio) {
      return {
        ...base,
        action: "hold",
        reason: `CTR ${video.ctr.toFixed(1)}% is within ${Math.round((1 - policy.medianRatio) * 100)}% of the channel median ${median.toFixed(1)}%`,
      };
    }
    return {
      ...base,
      action: "swap",
      reason: `CTR ${video.ctr.toFixed(1)}% is below ${(median * policy.medianRatio).toFixed(1)}% (median ${median.toFixed(1)}%) over ${video.impressions} impressions`,
      from: video.title,
      to: video.titleAlternate.trim(),
      baselineCtr: video.ctr,
    };
  });
}

export interface SwapOutcome {
  videoId: string;
  verdict: "alternate_won" | "original_won" | "inconclusive";
  detail: string;
}

/**
 * Did the swap earn its place?
 *
 * Without this the loop would keep swapping and never learn. `inconclusive` is
 * a real answer: a small difference over a modest sample is not a result, and
 * calling it one is how a feedback loop starts amplifying noise.
 */
export function judgeSwapOutcome(args: {
  videoId: string;
  baselineCtr: number;
  postSwapCtr: number | null;
  postSwapImpressions: number | null;
  policy?: SwapPolicy;
}): SwapOutcome {
  const policy = args.policy ?? DEFAULT_SWAP_POLICY;
  if (typeof args.postSwapCtr !== "number" || (args.postSwapImpressions ?? 0) < policy.minImpressions) {
    return {
      videoId: args.videoId,
      verdict: "inconclusive",
      detail: `only ${args.postSwapImpressions ?? 0} impressions since the swap`,
    };
  }
  const delta = args.postSwapCtr - args.baselineCtr;
  // A tenth of a percentage point is within the drift of any week's traffic mix.
  if (Math.abs(delta) < 0.3) {
    return {
      videoId: args.videoId,
      verdict: "inconclusive",
      detail: `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}pp is inside normal drift`,
    };
  }
  return delta > 0
    ? { videoId: args.videoId, verdict: "alternate_won", detail: `+${delta.toFixed(2)}pp CTR after the swap` }
    : { videoId: args.videoId, verdict: "original_won", detail: `${delta.toFixed(2)}pp CTR after the swap` };
}
