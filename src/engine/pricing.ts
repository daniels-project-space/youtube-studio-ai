/**
 * Provider unit prices (USD) used by paid blocks to report per-block spend, so
 * the runner can roll cost into `runs.costTotal` and enforce the per-run budget
 * ceiling (decision: a run must not silently blow past `channel.budget`).
 *
 * IMPORTANT — these are conservative DEFAULTS, not invoices.
 *  - Defaults round current public/provider rates up where practical so stale
 *    config fails safe instead of silently undercounting.
 *  - Tune or override them per deploy via the `PRICE_*` or provider-specific
 *    env vars after checking actual bills; overrides remain operator-controlled.
 *
 * The one non-guessed anchor: Topaz video-upscale is documented at ~$0.25 per
 * loop unit in the upscale block (legacy topaz.py parity).
 */
import {
  falFluxProV11CostUsd,
  falImageRates,
  selectedFalImageCostUsd,
} from "@/lib/falImagePricing";
import {
  qaVisualReviewFrameLimits,
  qaVisualReviewProviderCallCount,
  visualReviewProviderBatchCount,
} from "./visualReviewBudget";

function rate(envName: string, fallback: number): number {
  const raw = process.env[envName];
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const falRates = falImageRates();

/**
 * A cinematic QA stage may make at most this many targeted regeneration
 * attempts for one rejected still or LTX shot. This is intentionally a source
 * constant rather than a channel parameter: a bad channel configuration must
 * never turn quality recovery into an unbounded paid loop.
 */
export const NOVITA_CINEMATIC_QA_REPAIR_CAP = 2;

/**
 * A source-bound final master reviews every lock and every actual cut. The
 * reviewer is pinned to one Groq attempt followed by one fal fallback attempt.
 * Keep that fixed two-provider envelope explicit so an unavailable first
 * provider cannot erase the spend rail before LTX starts.
 */
export const CINEMATIC_FINAL_MASTER_QA_MAX_REVIEW_CALLS = 479;

export const PRICE = {
  /** Legacy-named per-keyframe rate for the attested direct Novita still path. keyframes renders 2. */
  fluxStillUsd: rate("PRICE_FLUX_STILL_USD", 0.01),
  /** Per Nano Banana PRO image (gemini-3-pro-image-preview, 2K). The ledger
   *  previously had NO Gemini image rate at all — the exact spend that blew
   *  up the Google bill was invisible to budget enforcement. */
  // Official Gemini pricing is $0.134 for a 1K/2K output; round up so the
  // preflight envelope also covers the small prompt-input charge.
  bananaProUsd: rate("PRICE_BANANA_PRO_USD", 0.135),
  /** Per classic Nano Banana image (gemini-2.5-flash-image). */
  bananaFlashUsd: rate("PRICE_BANANA_FLASH_USD", 0.04),
  /**
   * Conservative preflight ceiling for one fal.ai Nano Banana 2 Visual Matter
   * anchor at 1K. Runtime refuses to spend unless the operator-reviewed
   * FAL_NANO_BANANA_2_COST_USD rate is explicitly configured.
   */
  falNanoBanana2Usd: rate("FAL_NANO_BANANA_2_COST_USD", 0.08),
  /** Per loop-unit Topaz upscale (block comment anchor: ~$0.25). */
  topazUpscaleUsd: rate("PRICE_TOPAZ_UPSCALE_USD", 0.25),
  /** Per generated music track (Mureka/Suno). */
  musicTrackUsd: rate("PRICE_MUSIC_TRACK_USD", 0.05),
  /** Narration TTS, per 1000 characters (Fish Audio ~$0.006/1k). */
  ttsPerKCharUsd: rate("PRICE_TTS_PER_KCHAR_USD", 0.006),
  // ElevenLabs v3 is ~20-50x Fish per character — the flat Fish rate made the
  // budget guard blind exactly when the premium voice was cast.
  ttsElevenPerKCharUsd: rate("PRICE_TTS_ELEVEN_PER_KCHAR_USD", 0.12),
  /** Fal public rates. Per-output cost is derived from the selected model and
   * actual dimensions; none of these is a universal per-image fallback. */
  falSchnellUsdPerMegapixel: falRates.schnellUsdPerMegapixel,
  falKontextUsdPerImage: falRates.kontextUsdPerImage,
  falFluxProV11UsdPerMegapixel: falRates.fluxProV11UsdPerMegapixel,
  /** Planning estimate only; direct workers persist a teardown-verified lifecycle receipt. */
  novitaImageUsd: rate("NOVITA_IMAGE_COST_USD", 0.02),
  /** Planning estimate only; direct workers persist a teardown-verified lifecycle receipt. */
  novitaVideoUsd: rate("NOVITA_VIDEO_COST_USD", 0.08),
  /**
   * One direct render worker is exactly one RTX 4090 and is hard-killed within
   * two hours. $0.35 is the rounded upper bound at the verified $0.17/hr spot
   * rate, not a quality downgrade or a cross-GPU fallback allowance. Runtime
   * admission still intersects these with the live provider price and the
   * configured per-job/fleet ceiling.
   */
  novitaImageMaxUsd: rate("NOVITA_IMAGE_MAX_COST_USD", 0.35),
  novitaVideoMaxUsd: rate("NOVITA_VIDEO_MAX_COST_USD", 0.35),
  /** One managed vision-grader request. */
  visionGraderUsd: rate("VISION_GRADER_COST_USD", 0.003),
  /**
   * Conservative ceiling for ONE bounded (<1.5k token) text pass — entity
   * extraction, hook drafting, and the per-candidate critiques in their
   * produce→critique loops. These calls were previously accounted at zero,
   * so their spend was invisible to the budget guard entirely.
   */
  boundedTextPassUsd: rate("PRICE_BOUNDED_TEXT_PASS_USD", 0.004),
  /** Conservative ceiling for the bounded 1,000-token Flash thumbnail concept
   * pass (actual token spend is recorded by the runner scope). */
  thumbnailConceptUsd: rate("PRICE_THUMBNAIL_CONCEPT_USD", 0.01),
  /** Conservative allowance for the normal frame-sampled production QA pass. */
  qaBaseUsd: rate("PRICE_QA_BASE_USD", 0.04),
  /**
   * Conservative non-Google spend for one final-master lock/cut verdict. This
   * is the complete one-Groq/one-fal logical review, not a per-frame price.
   * The normal twelve-shot sequence stays inside qa_visual's explicit release-review cap.
   */
  cinematicFinalMasterQaReviewUsd: rate(
    "PRICE_CINEMATIC_FINAL_MASTER_QA_REVIEW_USD",
    0.08,
  ),
  /** Optional two-pass native full-video review. */
  nativeVideoQaUsd: rate("PRICE_NATIVE_VIDEO_QA_USD", 0.45),
  /** Optional local audio-aesthetics pass, including its worker compute. */
  audioQaUsd: rate("PRICE_AUDIO_QA_USD", 0.03),
} as const;

export type BananaPriceTier = "flash" | "pro";

/**
 * Resolve the image unit rate with the same routing precedence as
 * generateBananaImage. Passing an env object keeps preflight/tests deterministic
 * without mutating process-wide state.
 */
export function bananaUnitRate(
  tier: BananaPriceTier,
  env: Readonly<Record<string, string | undefined>> = process.env,
  request: Readonly<{ aspectRatio?: string; hasReferences?: boolean }> = {},
): number {
  const providers = (env.IMAGE_PROVIDERS ?? "")
    .split(",")
    .map((provider) => provider.trim().toLowerCase())
    .filter(Boolean);
  if (env.IMAGE_DISABLE_GEMINI === "1" || providers[0] === "fal") {
    return selectedFalImageCostUsd({ tier, ...request }, env);
  }
  const forcedModel = (env.BANANA_FORCE_MODEL ?? "").toLowerCase();
  if (forcedModel.includes("gemini-3-pro")) return PRICE.bananaProUsd;
  if (forcedModel.includes("flash")) return PRICE.bananaFlashUsd;
  return tier === "pro" ? PRICE.bananaProUsd : PRICE.bananaFlashUsd;
}

export function cinematicFinalMasterQaReviewCost(reviewCallCount: unknown): number {
  const calls = Number(reviewCallCount);
  if (
    !Number.isInteger(calls) ||
    calls < 0 ||
    calls > CINEMATIC_FINAL_MASTER_QA_MAX_REVIEW_CALLS
  ) {
    throw new Error(
      `cinematic final-master QA review count must be an integer between 0 and ${CINEMATIC_FINAL_MASTER_QA_MAX_REVIEW_CALLS}`,
    );
  }
  return calls * PRICE.cinematicFinalMasterQaReviewUsd;
}

export function qaVisualCost(
  params: Readonly<Record<string, unknown>>,
  cinematicFinalMasterQaCostUsd: unknown = 0,
  completeFocusFrameCount: unknown = 0,
): number {
  const { broadFrames, focusFrames } = qaVisualReviewFrameLimits(params);
  const completeFocusFrames = Number(completeFocusFrameCount);
  if (!Number.isInteger(completeFocusFrames) || completeFocusFrames < 0) {
    throw new Error("complete-focus frame count must be a non-negative integer");
  }
  // The evidence review performs a broad pass plus a regular/reactive re-watch.
  // A cinematic route adds every sealed cut/lock frame; a whiteboard route
  // adds one exact hand-trace frame per layer and one completed state per
  // panel. The provider limit is shared with execution, so an explicit block
  // cost covers every permitted call rather than a larger hidden batch.
  const evidenceBatches = qaVisualReviewProviderCallCount({
    broadFrames,
    focusFrames,
    completeFocusFrames,
  });
  const finalMasterCost = Number(cinematicFinalMasterQaCostUsd);
  if (!Number.isFinite(finalMasterCost) || finalMasterCost < 0) {
    throw new Error("cinematic final-master QA cost must be a finite non-negative amount");
  }
  return (
    PRICE.qaBaseUsd * evidenceBatches +
    (params["audioQa"] === true ? PRICE.audioQaUsd : 0) +
    finalMasterCost
  );
}

/**
 * The derivative-Short release gate uses the same bounded non-Google visual
 * review mechanics as final-master QA, but on the actual 9:16 crop after its
 * captions are burned. Keep this separately costed: a parent-master review
 * cannot cover a new transform, and a hidden review call must never evade the
 * frozen run budget.
 */
export function shortsSpinoffReleaseEvidenceCost(
  params: Readonly<Record<string, unknown>>,
): number {
  const clampFrames = (value: unknown, fallback: number, max: number): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(8, Math.min(max, Math.floor(parsed)));
  };
  const broadFrames = clampFrames(params["shortVisualReviewFrames"], 36, 72);
  const focusFrames = clampFrames(params["shortVisualReviewFocusFrames"], 18, 36);
  const evidenceBatches =
    visualReviewProviderBatchCount(broadFrames) + visualReviewProviderBatchCount(focusFrames);
  return PRICE.qaBaseUsd * evidenceBatches;
}

/** Exact observed spend for narration TTS plus its Gemini audio gate. */
export function narrationTtsCost(
  provider: string,
  billableCharacters: number,
  audioJudgeCalls: number,
): number {
  const characters = Number.isFinite(billableCharacters)
    ? Math.max(0, billableCharacters)
    : 0;
  const judges = Number.isFinite(audioJudgeCalls)
    ? Math.max(0, Math.floor(audioJudgeCalls))
    : 0;
  const ttsRate = provider.toLowerCase() === "elevenlabs"
    ? PRICE.ttsElevenPerKCharUsd
    : PRICE.ttsPerKCharUsd;
  return (characters * ttsRate) / 1_000 + judges * PRICE.visionGraderUsd;
}

export interface BananaGenerationCounters {
  pro: number;
  flash: number;
  fal: number;
  /** Exact successful Fal response cost; never derive it from `fal` count. */
  falCostUsd: number;
}

export function thumbnailGenerationCost(
  before: Readonly<BananaGenerationCounters>,
  after: Readonly<BananaGenerationCounters>,
  referenceJudgeCalls = 0,
  extraCostUsd = 0,
): number {
  const pro = Math.max(0, after.pro - before.pro);
  const flash = Math.max(0, after.flash - before.flash);
  const falCostUsd = Math.max(0, after.falCostUsd - before.falCostUsd);
  return (
    pro * PRICE.bananaProUsd +
    flash * PRICE.bananaFlashUsd +
    falCostUsd +
    // Image generation no longer launches hidden candidate judges. Only the
    // explicit post-render publishing alarm is charged here.
    Math.max(0, referenceJudgeCalls) * PRICE.visionGraderUsd +
    Math.max(0, extraCostUsd)
  );
}

/** Exact configured cost for the direct FLUX Pro v1.1 helper's output size. */
export function falFluxProImageCost(
  width = 1344,
  height = 768,
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  return falFluxProV11CostUsd(width, height, env);
}
