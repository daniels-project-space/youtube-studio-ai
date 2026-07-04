/**
 * Provider unit prices (USD) used by paid blocks to report per-block spend, so
 * the runner can roll cost into `runs.costTotal` and enforce the per-run budget
 * ceiling (decision: a run must not silently blow past `channel.budget`).
 *
 * IMPORTANT — these are conservative DEFAULTS, not invoices.
 *  - Tune them to your real provider pricing, or override per-deploy via the
 *    `PRICE_*` env vars (same pattern as REPLICATE_FLUX_MODEL).
 *  - They are deliberately on the low side so a stale rate UNDER-counts (a
 *    weaker guard) rather than falsely aborting healthy runs. Verify against
 *    actual bills and raise them.
 *
 * The one non-guessed anchor: Topaz video-upscale is documented at ~$0.25 per
 * loop unit in the upscale block (legacy topaz.py parity).
 */
function rate(envName: string, fallback: number): number {
  const raw = process.env[envName];
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const PRICE = {
  /** Per keyframe still (Higgsfield/Flux). keyframes renders 2. */
  fluxStillUsd: rate("PRICE_FLUX_STILL_USD", 0.01),
  /** Per Nano Banana PRO image (gemini-3-pro-image-preview, 2K). The ledger
   *  previously had NO Gemini image rate at all — the exact spend that blew
   *  up the Google bill was invisible to budget enforcement. */
  bananaProUsd: rate("PRICE_BANANA_PRO_USD", 0.13),
  /** Per classic Nano Banana image (gemini-2.5-flash-image). */
  bananaFlashUsd: rate("PRICE_BANANA_FLASH_USD", 0.04),
  /** Per image-to-video clip (~5s, Higgsfield/Kling). loop_clips renders 2. */
  videoClipUsd: rate("PRICE_VIDEO_CLIP_USD", 0.35),
  /** Per loop-unit Topaz upscale (block comment anchor: ~$0.25). */
  topazUpscaleUsd: rate("PRICE_TOPAZ_UPSCALE_USD", 0.25),
  /** Per generated music track (Mureka/Suno). */
  musicTrackUsd: rate("PRICE_MUSIC_TRACK_USD", 0.05),
  /** Narration TTS, per 1000 characters (Fish Audio ~$0.006/1k). */
  ttsPerKCharUsd: rate("PRICE_TTS_PER_KCHAR_USD", 0.006),
  // ElevenLabs v3 is ~20-50x Fish per character — the flat Fish rate made the
  // budget guard blind exactly when the premium voice was cast.
  ttsElevenPerKCharUsd: rate("PRICE_TTS_ELEVEN_PER_KCHAR_USD", 0.12),
  // fal FLUX image (the IMAGE_DISABLE_GEMINI route) — counters track it like
  // the banana tiers so per-run cost stays real on the no-Google path.
  bananaFalUsd: rate("PRICE_BANANA_FAL_USD", 0.04),
} as const;
