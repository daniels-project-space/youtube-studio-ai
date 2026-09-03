/**
 * TIERED RENDERING.
 *
 * The critique loop renders up to `maxThumbnailIters` candidates and keeps one.
 * Every candidate — including the ones it is about to throw away — is currently
 * billed at the Nano Banana Pro rate, which is the most expensive image
 * endpoint surveyed. A three-iteration loop therefore pays roughly three times
 * the price of the frame that actually ships.
 *
 * Measured during this work: Nano Banana 2 renders the same brief at roughly
 * 2x lower cost and 2.4x faster than Pro, and on scene construction the two are
 * close. Pro's real, visible advantage is TYPOGRAPHY — bevelled metallic
 * lettering, material integration, clean small copy.
 *
 * That asymmetry decides the architecture. The loop is judging CONCEPT — is the
 * right thing the hero, does the scene enact the story, does the subject carry
 * a stake — and concept transfers between tiers. Typography does not. So a
 * draft is graded on everything EXCEPT the checks that would punish it for
 * being a draft, and the winning concept is re-rendered on Pro and put through
 * the full gate.
 *
 * Getting that backwards is the trap: grading drafts on copy fidelity would
 * reject good concepts for artefacts the shipping render would never have had,
 * and the loop would burn iterations converging on the draft model's
 * limitations instead of on the brief.
 */

export type ThumbnailRenderTier = "draft" | "final";

export interface ThumbnailTierPolicy {
  tier: ThumbnailRenderTier;
  /** fal model slug for this tier. */
  model: string;
  /** Output resolution requested from the provider. */
  resolution: "1K" | "2K";
  /** Pinned unit cost, mirroring how the Pro contract pins its own rate. */
  outputImageUsd: number;
  /**
   * Whether exact-copy gates apply. False on drafts: a draft is selected for
   * its concept, and holding it to Pro's typography would reject good ideas.
   */
  enforceCopyFidelity: boolean;
  /** Whether the 120px squint gate applies. */
  enforceMobileGate: boolean;
  rationale: string;
}

/**
 * Draft tier. `fal-ai/nano-banana-2` rather than the cheaper
 * `fal-ai/nano-banana`, deliberately: Nano Banana 1 was measured dropping
 * mandated headline words and staging heroes far too small, so drafts on it
 * would send the critique loop chasing defects that never reach production.
 * A draft has to be representative or it is worse than no draft.
 *
 * Cost provenance: fal publishes only `Nanobanana $0.0398` on its pricing page;
 * the NB2 and Pro rates are pinned values in this repo, like
 * FAL_NANO_BANANA_PRO_THUMBNAIL_PROFILE's $0.15, and both should be reconciled
 * against a fal invoice rather than trusted as gospel.
 */
export const THUMBNAIL_DRAFT_TIER: ThumbnailTierPolicy = {
  tier: "draft",
  model: "fal-ai/nano-banana-2",
  resolution: "1K",
  outputImageUsd: 0.06,
  enforceCopyFidelity: false,
  enforceMobileGate: true,
  rationale:
    "concept selection only — scene, hero and stake transfer between tiers, typography does not",
};

export const THUMBNAIL_FINAL_TIER: ThumbnailTierPolicy = {
  tier: "final",
  model: "fal-ai/nano-banana-pro",
  resolution: "2K",
  outputImageUsd: 0.15,
  enforceCopyFidelity: true,
  enforceMobileGate: true,
  rationale: "the frame that ships — full copy, spelling, leak and mobile gates apply",
};

/**
 * A single iteration is not worth drafting: there is nothing to select between,
 * so a draft would just add a render before the same Pro render. Tiering only
 * pays once the loop can actually discard something.
 */
export function planThumbnailTiers(args: {
  maxIterations: number;
  /** Set when the operator needs the shipping model for every candidate. */
  forceFinalOnly?: boolean;
}): { perIteration: ThumbnailTierPolicy; finalPass: ThumbnailTierPolicy | null } {
  if (args.forceFinalOnly || args.maxIterations <= 1) {
    return { perIteration: THUMBNAIL_FINAL_TIER, finalPass: null };
  }
  return { perIteration: THUMBNAIL_DRAFT_TIER, finalPass: THUMBNAIL_FINAL_TIER };
}

/** What a tiered loop costs against rendering every candidate on Pro. */
export function estimateTieredCostUsd(args: {
  iterations: number;
  forceFinalOnly?: boolean;
}): { tiered: number; allFinal: number; savedUsd: number; savedPct: number } {
  const allFinal = args.iterations * THUMBNAIL_FINAL_TIER.outputImageUsd;
  const plan = planThumbnailTiers({ maxIterations: args.iterations, forceFinalOnly: args.forceFinalOnly });
  const tiered = plan.finalPass
    ? args.iterations * plan.perIteration.outputImageUsd + plan.finalPass.outputImageUsd
    : allFinal;
  const savedUsd = Math.round((allFinal - tiered) * 1e4) / 1e4;
  return {
    tiered: Math.round(tiered * 1e4) / 1e4,
    allFinal: Math.round(allFinal * 1e4) / 1e4,
    savedUsd,
    savedPct: allFinal === 0 ? 0 : Math.round((savedUsd / allFinal) * 100),
  };
}
