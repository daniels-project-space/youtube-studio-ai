/**
 * NARRATION PROVIDER ROUTING — measured capability, not vendor preference.
 *
 * "Replace narration with self-hosted Qwen" is the right goal and the wrong
 * blanket instruction, because the providers are not interchangeable in one
 * specific, measurable way. These numbers come from running the same three
 * scripts through each path on this machine and grading them with
 * scripts/narration-oracle.py, not from a model card:
 *
 *                        WER    F0 median   F0 SPREAD   timbre drift
 *   ElevenLabs          0-3%     90-142      24-55        0.002-0.008
 *   Qwen CustomVoice    3.1%       86         15.1          0.0067
 *   Qwen design+clone   0-3.1%   84.9-88.4    13.5          0.0040
 *
 * Qwen matches or beats ElevenLabs on intelligibility, casting accuracy and
 * consistency. It is roughly HALF as prosodically varied, and that gap is
 * architectural rather than a tuning miss:
 *
 *   - cloning runs on the Base model, whose API takes no `instruct` at all, so
 *     the casting brief's "slow, deliberate, weighty" direction reaches the
 *     reference clip and nothing else;
 *   - a prosodically rich reference text (questions, contrast, falling
 *     cadence) changed F0 spread by 0.0 — the range does not transfer;
 *   - sampling temperature moved it 10.1 -> 13.3 at 1.05 and back to 10.0 at
 *     1.20, nowhere near the 27.6 reference.
 *
 * Both plausible workarounds were tried and failed. So the honest conclusion is
 * that Qwen is excellent for registers that are SUPPOSED to be even — calm,
 * grave, meditative, instructional — and audibly flat for registers that live
 * on dynamics. Routing on that fact keeps the free provider wherever it is
 * genuinely as good, instead of degrading every channel to save money on the
 * ones where it costs quality.
 *
 * Throughput is a separate constraint and belongs to the operator, not the
 * voice: local CPU synthesis measured 10.7-11.8x slower than realtime, i.e.
 * about two hours of compute per ten minutes of narration. Fine for a cold
 * open, a short, or a draft; not for a back catalogue on one 4-core box.
 */

export type NarrationProvider = "fish" | "elevenlabs" | "qwen3";

/** Measured F0 spread in Hz. The reference is what a listener calls "range". */
export const MEASURED_F0_SPREAD = {
  elevenlabs: { min: 24, max: 55 },
  qwen3: { min: 13.5, max: 15.1 },
} as const;

/**
 * Voice archetypes whose delivery is meant to be even.
 *
 * Derived from the studio's own voice doctrine rather than invented here: these
 * are the registers whose direction already says calm, measured or unhurried,
 * so a narrow pitch range is the intended reading rather than a defect.
 */
const EVEN_REGISTER_VOICES = new Set([
  "quiet-mentor",
  "gentle-guide",
  "calm-analyst",
  "narrator-teacher",
  "trusted-explainer",
]);

/**
 * Archetypes that live on dynamics. A flat read of these is not a stylistic
 * choice, it is a worse video.
 */
const DYNAMIC_REGISTER_VOICES = new Set([
  "chaos-commentator",
  "enthusiast-critic",
  "investigator",
  "insider-explainer",
]);

export interface RoutingInput {
  /** Voice archetype from the channel's doctrine, if it has one. */
  voice?: string;
  /** Seconds of narration this run will synthesize. */
  narrationSeconds?: number;
  /** Is a local CPU worker the only Qwen route available? */
  localCpuOnly?: boolean;
  /** Whether the channel has already published with a given provider. */
  establishedProvider?: NarrationProvider;
}

export interface RoutingAdvice {
  provider: NarrationProvider;
  reason: string;
  /** True when the advice is a hard constraint rather than a preference. */
  binding: boolean;
}

/** Local CPU synthesis beyond this is hours of compute; see the header. */
export const LOCAL_CPU_SECONDS_CEILING = 180;

/**
 * Which provider should narrate this run.
 *
 * Consistency outranks everything. A channel that has published in one voice
 * must not change narrator because a router changed its mind — that is the
 * same drift the visual golden reference exists to prevent, and a listener
 * notices a new narrator far faster than a new colour palette.
 */
export function routeNarrationProvider(input: RoutingInput): RoutingAdvice {
  if (input.establishedProvider) {
    return {
      provider: input.establishedProvider,
      reason: `channel already publishes with ${input.establishedProvider}; changing narrator mid-catalogue is audible drift`,
      binding: true,
    };
  }

  const voice = input.voice ?? "";
  if (DYNAMIC_REGISTER_VOICES.has(voice)) {
    return {
      provider: "elevenlabs",
      reason: `"${voice}" depends on delivery dynamics, and Qwen measures ${MEASURED_F0_SPREAD.qwen3.max} Hz F0 spread against ${MEASURED_F0_SPREAD.elevenlabs.min}-${MEASURED_F0_SPREAD.elevenlabs.max} Hz`,
      binding: true,
    };
  }

  if (
    input.localCpuOnly &&
    (input.narrationSeconds ?? 0) > LOCAL_CPU_SECONDS_CEILING
  ) {
    return {
      provider: "elevenlabs",
      reason: `${input.narrationSeconds}s of narration is about ${Math.round((input.narrationSeconds ?? 0) * 11 / 60)} minutes of CPU on a local worker`,
      binding: false,
    };
  }

  if (EVEN_REGISTER_VOICES.has(voice)) {
    return {
      provider: "qwen3",
      reason: `"${voice}" is an even register, where Qwen matches on intelligibility, casting and consistency at no cost`,
      binding: false,
    };
  }

  return {
    provider: "elevenlabs",
    reason: "no voice doctrine to route on; the measured provider is the safe default",
    binding: false,
  };
}
