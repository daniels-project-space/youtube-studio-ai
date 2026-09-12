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
 * A sequential title edit is NOT a YouTube experiment. YouTube's native title
 * and thumbnail test is concurrent and selects a winner by watch-time share,
 * whereas this ledger only has a point-in-time CTR observation. This module
 * therefore prepares evidence-backed *native-test proposals* only. It must not
 * write `videos.update` and must not teach the title generator that a
 * sequential CTR change proved a winner.
 */

/**
 * ATTRIBUTION ADMISSION.
 *
 * seoReoptimize — the other task that writes titles to YouTube — is hard-blocked
 * by `unavailablePackageAttributionAdmission()`, which refuses to act because
 * the performance ledger has "no immutable package version, raw impressions,
 * freshness boundary, or fully post-package observation". That containment is
 * correct and this must not route around it.
 *
 * A title swap can satisfy it where a general rewrite could not, because the
 * swap knows exactly which title was live and from when:
 *
 *   raw impressions          now carried on the ledger entry
 *   freshness boundary       titleSetAt — when the current title went live
 *   post-package observation the measurement window must start after that
 *   package version          the title string itself, recorded on both sides
 *
 * If any of those is missing the answer is "not admitted", never a substituted
 * proxy. Views are not impressions and a run-stage title is not a published one.
 */
export interface AttributionAdmission {
  admitted: boolean;
  reason: string;
}

export function admitTitleObservation(
  video: TitleCandidateStats,
  now: number,
  policy: SwapPolicy = DEFAULT_SWAP_POLICY,
): AttributionAdmission {
  if (typeof video.thumbnailImpressions !== "number") {
    return { admitted: false, reason: "no raw impressions on this entry — a CTR rate alone cannot support a decision" };
  }
  if (typeof video.ctr !== "number" || video.ctr <= 0) {
    return { admitted: false, reason: "no measured click-through yet" };
  }
  const titleSetAt = video.titleSetAt ?? video.publishedAt;
  if (!titleSetAt) {
    return { admitted: false, reason: "no freshness boundary — unknown when the current title went live" };
  }
  const hoursLive = (now - titleSetAt) / 3_600_000;
  if (hoursLive < policy.settleHours) {
    return {
      admitted: false,
      reason: `the current title has only been live ${hoursLive.toFixed(0)}h; the observation is not yet fully post-package`,
    };
  }
  if (video.thumbnailImpressions < policy.minImpressions) {
    return {
      admitted: false,
      reason: `${video.thumbnailImpressions} impressions below the ${policy.minImpressions} noise floor`,
    };
  }
  return { admitted: true, reason: `${video.thumbnailImpressions} impressions accrued wholly under the current title` };
}

export interface TitleCandidateStats {
  videoId: string;
  title: string;
  /** The runner-up metacraft already produced. No alternate, no test. */
  titleAlternate?: string | null;
  /** Raw denominator behind `ctr`. Absent means the decision cannot be made. */
  thumbnailImpressions?: number | null;
  ctr?: number | null;
  publishedAt: number;
  /** When the CURRENT title went live; defaults to publish time. */
  titleSetAt?: number | null;
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

/** A candidate for a desktop Studio native title test; never an API rename. */
export interface NativeTitleTestProposal {
  videoId: string;
  action: "propose_native_test" | "hold";
  reason: string;
  from?: string;
  to?: string;
  /** The number the alternate has to beat for the swap to have been worth it. */
  baselineCtr?: number;
  baselineImpressions?: number;
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
 * Which videos deserve a native Studio title-test proposal for the stored
 * alternate. This function must never express a sequential metadata rewrite
 * as an available action.
 *
 * Every rejection carries its reason. A loop that silently declines to act is
 * indistinguishable from one that is broken, which is how the original
 * `titleAlternate` field went unread for so long without anyone noticing.
 */
export function planNativeTitleTestProposals(
  videos: TitleCandidateStats[],
  now: number,
  policy: SwapPolicy = DEFAULT_SWAP_POLICY,
): NativeTitleTestProposal[] {
  const median = channelMedianCtr(videos);
  return videos.map((video): NativeTitleTestProposal => {
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
    // Everything about impressions, freshness and post-package observation is
    // decided in one place, so this rule and the containment seoReoptimize
    // enforces cannot drift apart.
    const admission = admitTitleObservation(video, now, policy);
    if (!admission.admitted) {
      return { ...base, action: "hold", reason: admission.reason };
    }
    if (median === null) {
      return { ...base, action: "hold", reason: "fewer than 4 measured videos; no channel median to judge against" };
    }
    if (video.ctr! >= median * policy.medianRatio) {
      return {
        ...base,
        action: "hold",
        reason: `CTR ${video.ctr!.toFixed(1)}% is within ${Math.round((1 - policy.medianRatio) * 100)}% of the channel median ${median.toFixed(1)}%`,
      };
    }
    return {
      ...base,
      action: "propose_native_test",
      reason: `CTR ${video.ctr!.toFixed(1)}% is below ${(median * policy.medianRatio).toFixed(1)}% (median ${median.toFixed(1)}%) over ${video.thumbnailImpressions} impressions`,
      from: video.title,
      to: video.titleAlternate.trim(),
      baselineCtr: video.ctr!,
      baselineImpressions: video.thumbnailImpressions!,
    };
  });
}

export interface NativeTitleTestOutcome {
  videoId: string;
  verdict: "alternate_won" | "original_won" | "inconclusive" | "not_experiment";
  detail: string;
}

/**
 * Admit a result copied from YouTube's native title/thumbnail experiment.
 *
 * Ordinary Analytics API snapshots have a single video-level CTR and cannot
 * establish an A/B winner. A native result needs a durable platform receipt,
 * both variant watch-time-share values, and a verdict consistent with those
 * values. There is deliberately no integration caller yet; this fails closed
 * until an actual Studio-result ingestion surface exists.
 */
export function admitNativeTitleTestOutcome(args: {
  videoId: string;
  platformReceiptId?: string | null;
  originalWatchTimeShare?: number | null;
  alternateWatchTimeShare?: number | null;
  platformVerdict?: "alternate_won" | "original_won" | "inconclusive" | null;
}): NativeTitleTestOutcome {
  const original = args.originalWatchTimeShare;
  const alternate = args.alternateWatchTimeShare;
  const platformVerdict = args.platformVerdict;
  if (
    !args.platformReceiptId?.trim() ||
    !Number.isFinite(original) ||
    !Number.isFinite(alternate) ||
    original! < 0 || original! > 1 || alternate! < 0 || alternate! > 1 ||
    !platformVerdict
  ) {
    return {
      videoId: args.videoId,
      verdict: "not_experiment",
      detail: "native test requires a platform receipt, two finite watch-time-share values, and its recorded verdict",
    };
  }
  const expected = alternate! > original!
    ? "alternate_won"
    : original! > alternate!
      ? "original_won"
      : "inconclusive";
  if (platformVerdict !== expected) {
    return {
      videoId: args.videoId,
      verdict: "not_experiment",
      detail: `platform verdict ${platformVerdict} conflicts with watch-time-share evidence (${original!.toFixed(4)} original, ${alternate!.toFixed(4)} alternate)`,
    };
  }
  return {
    videoId: args.videoId,
    verdict: platformVerdict,
    detail: `native receipt ${args.platformReceiptId.trim()} admits ${platformVerdict} from watch-time share (${original!.toFixed(4)} original, ${alternate!.toFixed(4)} alternate)`,
  };
}

/**
 * Seal a historic sequential swap as non-experimental before it can be used by
 * a learning loop. This is intentionally separate from
 * `admitNativeTitleTestOutcome`: that helper requires a future native-test
 * ingestion to supply compatible, per-variant watch-time-share evidence,
 * while old CTR snapshots never do.
 */
export function rejectSequentialTitleSwap(videoId: string): NativeTitleTestOutcome {
  return {
    videoId,
    verdict: "not_experiment",
    detail: "Sequential title edits are not a concurrent native YouTube A/B test; no watch-time-share winner can be learned.",
  };
}
