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

function rate(envName: string, fallback: number): number {
  const raw = process.env[envName];
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const falRates = falImageRates();

export const PRICE = {
  /** Per keyframe still (Higgsfield/Flux). keyframes renders 2. */
  fluxStillUsd: rate("PRICE_FLUX_STILL_USD", 0.01),
  /** Per Nano Banana PRO image (gemini-3-pro-image-preview, 2K). The ledger
   *  previously had NO Gemini image rate at all — the exact spend that blew
   *  up the Google bill was invisible to budget enforcement. */
  // Official Gemini pricing is $0.134 for a 1K/2K output; round up so the
  // preflight envelope also covers the small prompt-input charge.
  bananaProUsd: rate("PRICE_BANANA_PRO_USD", 0.135),
  /** Per classic Nano Banana image (gemini-2.5-flash-image). */
  bananaFlashUsd: rate("PRICE_BANANA_FLASH_USD", 0.04),
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
  /** Legacy planning estimate only; runtime accounting uses the signed bridge receipt. */
  novitaImageUsd: rate("NOVITA_IMAGE_COST_USD", 0.02),
  /** Legacy planning estimate only; runtime accounting uses the signed bridge receipt. */
  novitaVideoUsd: rate("NOVITA_VIDEO_COST_USD", 0.08),
  /** Hard admission ceilings. These reserve budget but never claim actual spend. */
  novitaImageMaxUsd: rate("NOVITA_IMAGE_MAX_COST_USD", 0.5),
  novitaVideoMaxUsd: rate("NOVITA_VIDEO_MAX_COST_USD", 5),
  /** One managed vision-grader request. */
  visionGraderUsd: rate("VISION_GRADER_COST_USD", 0.003),
  /** Conservative ceiling for the bounded 1,000-token Flash thumbnail concept
   * pass (actual token spend is recorded by the runner scope). */
  thumbnailConceptUsd: rate("PRICE_THUMBNAIL_CONCEPT_USD", 0.01),
  /** Conservative allowance for the normal frame-sampled production QA pass. */
  qaBaseUsd: rate("PRICE_QA_BASE_USD", 0.04),
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

export function qaVisualCost(params: Readonly<Record<string, unknown>>): number {
  const clampFrames = (value: unknown, fallback: number, max: number): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(8, Math.min(max, Math.floor(parsed)));
  };
  // The evidence review performs a broad pass plus a focused re-watch. Reserve
  // a full managed-vision allowance per 12-image batch; runtime accounting
  // still records the provider's observed usage separately.
  const broadFrames = clampFrames(params["visualReviewFrames"], 48, 72);
  const focusFrames = clampFrames(params["visualReviewFocusFrames"], 24, 36);
  const evidenceBatches = Math.ceil(broadFrames / 12) + Math.ceil(focusFrames / 12);
  return (
    PRICE.qaBaseUsd * evidenceBatches +
    (params["nativeWatch"] === true ? PRICE.nativeVideoQaUsd : 0) +
    (params["audioQa"] === true ? PRICE.audioQaUsd : 0)
  );
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
