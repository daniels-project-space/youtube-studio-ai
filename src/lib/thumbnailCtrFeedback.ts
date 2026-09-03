/**
 * CTR FEEDBACK.
 *
 * Every craft rule in this module is currently an ASSERTION.
 * `OWNER_SELECTED_THUMBNAIL_PREFERENCE_RULES` is hand-extracted from the
 * owner's A/B picks and frozen in source; `GOLDEN_THUMBNAIL_CRAFT_RULES` and
 * `RESEARCH_PRINCIPLES` are distilled beliefs. None of them has ever been
 * checked against whether the thumbnails that follow them actually get clicked.
 *
 * The tempting version of this module reads a CTR column, sorts it, and
 * promotes whatever is on top. That version is worse than nothing, because
 * thumbnail CTR is extremely noisy: it moves with title, topic, publish time,
 * subscriber mix, session context and where the impression was served, and a
 * channel publishing weekly takes months to separate a real 1-point effect
 * from sampling noise. Promoting a rule off six impressions would bake luck
 * into every future render and there would be no way to tell.
 *
 * So this module is deliberately conservative and, just as deliberately, it
 * REFUSES to conclude anything until the evidence supports it. Its most
 * important output is usually "not yet".
 */

export interface ThumbnailPerformanceSample {
  channelName: string;
  videoKey: string;
  /** Attributes of the thumbnail, e.g. layoutMode, textObject, vantage, energy. */
  traits: Record<string, string>;
  impressions: number;
  clicks: number;
  publishedAt: number;
}

export interface TraitEffect {
  trait: string;
  value: string;
  withCtr: number;
  withoutCtr: number;
  /** Percentage points. */
  liftPoints: number;
  withImpressions: number;
  withoutImpressions: number;
  /** Whether the difference clears the significance bar below. */
  significant: boolean;
}

export interface CtrFeedbackReport {
  /** True only when there is enough evidence to say anything at all. */
  conclusive: boolean;
  /** Why not, when inconclusive — stated plainly rather than implied. */
  limitation?: string;
  sampleSize: number;
  totalImpressions: number;
  effects: TraitEffect[];
  /** Rules safe to promote, most confident first. Empty until conclusive. */
  suggestedRules: string[];
  /**
   * The advisory block for the art director, already framed as subordinate.
   * Empty until conclusive.
   */
  advisory: string;
}

/**
 * CTR evidence is a ROUGH HINT and is framed as one.
 *
 * The craft rules in this module encode things CTR cannot see: whether the
 * channel still looks like itself, whether the identity contract holds, whether
 * the subject is worth a thumbnail at all. Observed CTR, by contrast, is
 * confounded by title, topic, publish time, subscriber mix and where the
 * impression was served — it can tell you a pattern correlated with clicks on
 * past videos, and nothing about whether it will on the next one.
 *
 * So the advisory says so explicitly, and states its own rank. A channel that
 * chases its own CTR history converges on whatever it happened to publish
 * before, which is the opposite of the variety the sameness gate protects.
 */
export const CTR_ADVISORY_PREAMBLE =
  "OBSERVED CTR (rough signal, LOWEST priority — it ranks below the channel identity contract, " +
  "the golden craft bar and the story-interest doctrine, all of which override it wherever they " +
  "disagree). This is correlation from past videos on this channel, confounded by title and topic. " +
  "Treat it as a tiebreak between two otherwise equally strong concepts, never as a reason to " +
  "repeat a past composition or to weaken a stronger idea:";

/** Traits worth testing, because each is a craft decision the module can act on. */
export const TRACKED_THUMBNAIL_TRAITS = [
  "layoutMode",
  "vantage",
  "textObject",
  "energy",
  "subjectClass",
  "headlineWordCount",
  "hasNumberCallout",
] as const;

function ctr(clicks: number, impressions: number): number {
  return impressions > 0 ? clicks / impressions : 0;
}

/**
 * Two-proportion z-test. Not sophisticated — the point is simply that a
 * difference has to be larger than the noise before anyone acts on it, and
 * eyeballing a percentage cannot tell you that.
 */
function isSignificant(args: {
  clicksA: number; impressionsA: number;
  clicksB: number; impressionsB: number;
  z?: number;
}): boolean {
  const { clicksA, impressionsA, clicksB, impressionsB } = args;
  if (impressionsA < 1 || impressionsB < 1) return false;
  const pA = clicksA / impressionsA;
  const pB = clicksB / impressionsB;
  const pooled = (clicksA + clicksB) / (impressionsA + impressionsB);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / impressionsA + 1 / impressionsB));
  if (!Number.isFinite(se) || se === 0) return false;
  return Math.abs(pA - pB) / se >= (args.z ?? 1.96);
}

/**
 * Compare each trait value against every thumbnail that did NOT have it.
 *
 * Deliberately one trait at a time and deliberately not causal: traits
 * correlate with topic and with each other, so this surfaces candidates for
 * human judgement, never an automatic rewrite of the craft rules.
 */
export function analyseThumbnailCtr(args: {
  samples: readonly ThumbnailPerformanceSample[];
  /** Minimum thumbnails carrying a trait before it is even considered. */
  minSamplesPerArm?: number;
  /** Minimum impressions on each side before a comparison means anything. */
  minImpressionsPerArm?: number;
}): CtrFeedbackReport {
  const minSamplesPerArm = args.minSamplesPerArm ?? 8;
  const minImpressionsPerArm = args.minImpressionsPerArm ?? 5_000;
  const samples = args.samples;
  const totalImpressions = samples.reduce((sum, sample) => sum + sample.impressions, 0);

  const effects: TraitEffect[] = [];
  const traitValues = new Map<string, Set<string>>();
  for (const sample of samples) {
    for (const [trait, value] of Object.entries(sample.traits)) {
      const values = traitValues.get(trait) ?? new Set<string>();
      values.add(value);
      traitValues.set(trait, values);
    }
  }

  for (const [trait, values] of traitValues) {
    for (const value of values) {
      const withArm = samples.filter((sample) => sample.traits[trait] === value);
      const withoutArm = samples.filter((sample) => sample.traits[trait] !== undefined && sample.traits[trait] !== value);
      if (withArm.length < minSamplesPerArm || withoutArm.length < minSamplesPerArm) continue;

      const withImpressions = withArm.reduce((sum, s) => sum + s.impressions, 0);
      const withoutImpressions = withoutArm.reduce((sum, s) => sum + s.impressions, 0);
      if (withImpressions < minImpressionsPerArm || withoutImpressions < minImpressionsPerArm) continue;

      const withClicks = withArm.reduce((sum, s) => sum + s.clicks, 0);
      const withoutClicks = withoutArm.reduce((sum, s) => sum + s.clicks, 0);
      const withCtr = ctr(withClicks, withImpressions);
      const withoutCtr = ctr(withoutClicks, withoutImpressions);

      effects.push({
        trait,
        value,
        withCtr: Math.round(withCtr * 1e4) / 1e4,
        withoutCtr: Math.round(withoutCtr * 1e4) / 1e4,
        liftPoints: Math.round((withCtr - withoutCtr) * 1000) / 10,
        withImpressions,
        withoutImpressions,
        significant: isSignificant({
          clicksA: withClicks, impressionsA: withImpressions,
          clicksB: withoutClicks, impressionsB: withoutImpressions,
        }),
      });
    }
  }
  effects.sort((left, right) => Math.abs(right.liftPoints) - Math.abs(left.liftPoints));

  const significant = effects.filter((effect) => effect.significant && effect.liftPoints > 0);
  if (!significant.length) {
    return {
      advisory: "",
      conclusive: false,
      limitation: effects.length
        ? `${effects.length} trait(s) had enough volume to test and none cleared significance — ` +
          `the observed differences are indistinguishable from noise at this sample size`
        : `no trait has ${minSamplesPerArm} thumbnails and ${minImpressionsPerArm} impressions on both sides yet`,
      sampleSize: samples.length,
      totalImpressions,
      effects,
      suggestedRules: [],
    };
  }

  // Cap it. Even when several traits clear significance, a long list of
  // observed correlations would start to outweigh the craft rules simply by
  // volume of text in the brief.
  const promoted = significant.slice(0, 2);
  const suggestedRules = promoted.map((effect) =>
    `${effect.trait}="${effect.value}" measured +${effect.liftPoints} CTR points across ` +
    `${effect.withImpressions.toLocaleString()} impressions on this channel`,
  );
  return {
    advisory: `${CTR_ADVISORY_PREAMBLE} ${suggestedRules.join("; ")}.`,
    conclusive: true,
    sampleSize: samples.length,
    totalImpressions,
    effects,
    suggestedRules,
  };
}
