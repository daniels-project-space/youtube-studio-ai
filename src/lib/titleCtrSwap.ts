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
  /**
   * YouTube Studio does not offer native title/thumbnail tests for made-for-
   * kids videos. Keep this in the proposal input so automated operations never
   * recommend a workflow the channel is ineligible to start.
   */
  madeForKids?: boolean | null;
  /** The runner-up metacraft already produced. No alternate, no test. */
  titleAlternate?: string | null;
  /** Additional receipt-derived title-only candidates, ordered after the runner-up. */
  titleAlternates?: readonly string[] | null;
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
  /** Current live title plus up to two receipt-derived alternates. */
  titleVariants?: string[];
  /** The number the alternate has to beat for the swap to have been worth it. */
  baselineCtr?: number;
  baselineImpressions?: number;
  channelMedianCtr?: number;
}

export const MAX_NATIVE_TITLE_TEST_VARIANTS = 3;

/**
 * Build the exact bounded title-only slate for desktop Studio. The legacy
 * runner stays first for compatibility; newer verified candidates fill the
 * remaining slot. No thumbnail pair or platform outcome is inferred here.
 */
export function nativeTitleTestVariants(video: TitleCandidateStats): string[] {
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ");
  const identity = (value: string) => normalize(value).toLocaleLowerCase();
  const live = normalize(video.title);
  if (!live) return [];
  const seen = new Set([identity(live)]);
  const variants = [live];
  for (const raw of [video.titleAlternate, ...(video.titleAlternates ?? [])]) {
    if (typeof raw !== "string") continue;
    const title = normalize(raw);
    if (!title || title.length > 100 || seen.has(identity(title))) continue;
    seen.add(identity(title));
    variants.push(title);
    if (variants.length === MAX_NATIVE_TITLE_TEST_VARIANTS) break;
  }
  return variants;
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
    if (video.madeForKids === true) {
      return {
        ...base,
        action: "hold",
        reason: "YouTube native title tests are unavailable for made-for-kids videos",
      };
    }
    if (video.swappedAt) {
      return { ...base, action: "hold", reason: "already swapped once; a second swap would confound the test" };
    }
    const titleVariants = nativeTitleTestVariants(video);
    if (titleVariants.length < 2) {
      return { ...base, action: "hold", reason: "no distinct, stored judged alternate for a native title test" };
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
      reason: `CTR ${video.ctr!.toFixed(1)}% is below ${(median * policy.medianRatio).toFixed(1)}% (median ${median.toFixed(1)}%) over ${video.thumbnailImpressions} impressions; prepare ${titleVariants.length} title-only variants`,
      from: video.title,
      to: titleVariants[1],
      titleVariants,
      baselineCtr: video.ctr!,
      baselineImpressions: video.thumbnailImpressions!,
    };
  });
}

export interface NativeTitleTestOutcome {
  videoId: string;
  verdict: "variant_won" | "alternate_won" | "original_won" | "inconclusive" | "not_experiment";
  detail: string;
  /** Index in the immutable proposal slate; never inferred from CTR. */
  winnerIndex?: number;
  winnerTitle?: string;
}

export type NativeTitleTestVariantObservation = {
  title: string;
  watchTimeShare: number;
};

type NativePlatformVerdict = "variant_won" | "inconclusive";

function normalizeNativeTitleVariants(
  values: readonly NativeTitleTestVariantObservation[] | null | undefined,
): NativeTitleTestVariantObservation[] | null {
  if (!Array.isArray(values) || values.length < 2 || values.length > MAX_NATIVE_TITLE_TEST_VARIANTS) return null;
  const seen = new Set<string>();
  const normalized: NativeTitleTestVariantObservation[] = [];
  for (const value of values) {
    if (!value || typeof value.title !== "string" || !Number.isFinite(value.watchTimeShare)) return null;
    const title = value.title.trim().replace(/\s+/g, " ");
    const identity = title.toLocaleLowerCase();
    if (!title || title.length > 100 || seen.has(identity) || value.watchTimeShare < 0 || value.watchTimeShare > 1) return null;
    seen.add(identity);
    normalized.push({ title, watchTimeShare: value.watchTimeShare });
  }
  return normalized;
}

/**
 * Admit a result copied from YouTube's native title/thumbnail experiment.
 *
 * Ordinary Analytics API snapshots have a single video-level CTR and cannot
 * establish an A/B winner. A native result needs a durable platform receipt,
 * two or three exact title variants, their watch-time-share values, and the
 * platform's recorded verdict. There is deliberately no integration caller
 * yet; this fails closed until an actual Studio-result ingestion surface exists.
 */
export function admitNativeTitleTestOutcome(args: {
  videoId: string;
  platformReceiptId?: string | null;
  /** Preferred exact input: the immutable 2–3 title proposal slate. */
  variants?: readonly NativeTitleTestVariantObservation[] | null;
  platformOutcome?: NativePlatformVerdict | null;
  platformWinnerTitle?: string | null;
  /** Legacy two-variant compatibility input. */
  originalWatchTimeShare?: number | null;
  alternateWatchTimeShare?: number | null;
  platformVerdict?: "alternate_won" | "original_won" | "inconclusive" | null;
}): NativeTitleTestOutcome {
  const variants = normalizeNativeTitleVariants(args.variants);
  if (args.variants !== undefined && args.variants !== null) {
    if (!args.platformReceiptId?.trim() || !variants || !args.platformOutcome) {
      return {
        videoId: args.videoId,
        verdict: "not_experiment",
        detail: "native test requires a platform receipt, an exact 2–3 title slate, finite watch-time shares, and its recorded verdict",
      };
    }
    if (args.platformOutcome === "inconclusive") {
      if (args.platformWinnerTitle?.trim()) {
        return {
          videoId: args.videoId,
          verdict: "not_experiment",
          detail: "an inconclusive platform result cannot name a winner",
        };
      }
      return {
        videoId: args.videoId,
        verdict: "inconclusive",
        detail: `native receipt ${args.platformReceiptId.trim()} records an inconclusive result across ${variants.length} title variants`,
      };
    }
    const winner = args.platformWinnerTitle?.trim().replace(/\s+/g, " ");
    const winnerIndex = winner
      ? variants.findIndex((variant) => variant.title.toLocaleLowerCase() === winner.toLocaleLowerCase())
      : -1;
    if (winnerIndex < 0) {
      return {
        videoId: args.videoId,
        verdict: "not_experiment",
        detail: "a winning native result must name one title from the exact proposal slate",
      };
    }
    const winnerShare = variants[winnerIndex]!.watchTimeShare;
    if (variants.some((variant, index) => index !== winnerIndex && variant.watchTimeShare >= winnerShare)) {
      return {
        videoId: args.videoId,
        verdict: "not_experiment",
        detail: "the named platform winner does not have a strictly higher recorded watch-time share",
      };
    }
    return {
      videoId: args.videoId,
      verdict: winnerIndex === 0 ? "original_won" : winnerIndex === 1 ? "alternate_won" : "variant_won",
      winnerIndex,
      winnerTitle: variants[winnerIndex]!.title,
      detail: `native receipt ${args.platformReceiptId.trim()} admits winner ${winnerIndex + 1}/${variants.length} from recorded watch-time share`,
    };
  }
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
