/** Measured construction provenance, not sample alignment or pronunciation approval.
 * Browser-safe: only plain JSON, hashing and schemas; no media/provider IO. */
import { z } from "zod";
import { canonicalJson } from "./canonicalJson";
import { sha256Hex } from "./sha256";

export const NARRATION_SEGMENT_CLOCK_VERSION = "narration-segment-clock/v1" as const;
const hash = (value: unknown) => sha256Hex(canonicalJson(value));
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const positive = z.number().finite().positive().max(86_400);
const nonnegative = z.number().finite().nonnegative().max(86_400);
const sampleRate = z.number().int().finite().min(8_000).max(192_000);
const sampleCount = z.number().int().finite().positive().max(Number.MAX_SAFE_INTEGER);
const DecodedAudioSampleSchema = z.object({
  source: z.literal("ffprobe_decoded_samples"),
  sampleRate,
  sampleCount,
  durationSec: positive,
}).strict().superRefine((value, ctx) => {
  if (!sameNumber(value.durationSec, value.sampleCount / value.sampleRate)) {
    ctx.addIssue({ code: "custom", message: "decoded audio duration does not match its sample count and rate" });
  }
});
export type DecodedAudioSampleObservation = z.infer<typeof DecodedAudioSampleSchema>;
const AttemptSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("measured"), durationSec: positive, hasAudio: z.literal(true) }).strict(),
  z.object({ outcome: z.literal("unavailable") }).strict(),
  z.object({ outcome: z.literal("invalid"), reason: z.enum(["duration", "no_audio"]) }).strict(),
]);
export type NarrationSegmentProbeAttempt = z.infer<typeof AttemptSchema>;
export const NarrationSegmentMeasurementSchema = z.object({
  source: z.enum(["ffprobe_format_duration", "word_count_estimate"]),
  durationSec: positive,
  wordCount: z.number().int().positive().max(100_000),
  attempts: z.array(AttemptSchema).min(1).max(2),
  /** Optional decoded clock; legacy format-duration receipts remain valid. */
  decoded: DecodedAudioSampleSchema.optional(),
}).strict().superRefine((measurement, ctx) => {
  const successes = measurement.attempts.filter((attempt) => attempt.outcome === "measured");
  const last = measurement.attempts.at(-1)!;
  const valid = measurement.source === "ffprobe_format_duration"
    ? successes.length === 1 && last.outcome === "measured" && last.durationSec === measurement.durationSec
    : successes.length === 0 && measurement.durationSec === Math.max(1, measurement.wordCount / 2.5);
  if (!valid) ctx.addIssue({ code: "custom", message: "segment duration does not match its actual probe/fallback observations" });
});
export type NarrationSegmentMeasurement = z.infer<typeof NarrationSegmentMeasurementSchema>;

const SegmentSchema = z.object({
  textSha256: sha,
  audio: z.object({ sha256: sha, byteLength: z.number().int().positive().max(256 * 1024 * 1024) }).strict(),
  measurement: NarrationSegmentMeasurementSchema,
  cueIndex: z.number().int().nonnegative().max(255).nullable(),
  gapAfterSec: nonnegative,
}).strict();
export type NarrationClockSegment = z.infer<typeof SegmentSchema>;
export const NarrationSegmentClockSchema = z.object({
  version: z.literal(NARRATION_SEGMENT_CLOCK_VERSION),
  bindingFingerprint: sha,
  mode: z.enum(["sentence", "chapter"]),
  segments: z.array(SegmentSchema).min(1).max(256),
  finalDuration: z.object({
    source: z.enum(["ffprobe_format_duration", "cursor_fallback"]),
    usedSec: positive,
    performanceProbeSec: positive,
  }).strict(),
  reconciliation: z.object({ inputCursorSec: positive, measuredDurationSec: positive, scale: positive }).strict(),
  /** Present only when every retained part and the final assembled file were
   * decoded and reconciled at the same sample rate. */
  decodedFinal: DecodedAudioSampleSchema.optional(),
}).strict().superRefine((clock, ctx) => {
  let cursor = 0, cueCount = 0;
  for (const [index, segment] of clock.segments.entries()) {
    if ((clock.mode === "sentence" && segment.cueIndex === null)
      || (segment.cueIndex !== null && segment.cueIndex !== cueCount++)) {
      ctx.addIssue({ code: "custom", message: "segment clock has missing, duplicate or reordered cue mapping" });
    }
    if (index === clock.segments.length - 1 && segment.gapAfterSec !== 0) {
      ctx.addIssue({ code: "custom", message: "segment clock has a trailing gap that was not assembled" });
    }
    cursor += segment.measurement.durationSec + segment.gapAfterSec;
  }
  if (!cueCount || !sameNumber(cursor, clock.reconciliation.inputCursorSec)) {
    ctx.addIssue({ code: "custom", message: "segment clock cursor differs from its measured/fallback parts and gaps" });
  }
  const expectedScale = clock.mode === "chapter" || Math.abs(clock.reconciliation.measuredDurationSec - cursor) <= 1.5
    ? 1 : clock.reconciliation.measuredDurationSec / cursor;
  const expectedMeasuredDuration = clock.mode === "sentence" && clock.segments.some((segment) => segment.measurement.source === "word_count_estimate")
    ? clock.finalDuration.usedSec : clock.reconciliation.inputCursorSec;
  if (!sameNumber(clock.reconciliation.scale, expectedScale)
    || clock.reconciliation.measuredDurationSec !== expectedMeasuredDuration) {
    ctx.addIssue({ code: "custom", message: "segment clock reconciliation differs from the applied duration transform" });
  }
  if (clock.decodedFinal) {
    const parts = clock.segments.map((segment) => segment.measurement.decoded);
    if (parts.some((part) => !part)) {
      ctx.addIssue({ code: "custom", message: "decoded final clock requires decoded observations for every retained segment" });
    } else {
      const decoded = parts as DecodedAudioSampleObservation[];
      const rate = clock.decodedFinal.sampleRate;
      if (decoded.some((part) => part.sampleRate !== rate)) {
        ctx.addIssue({ code: "custom", message: "decoded narration segments use inconsistent sample rates" });
      }
      const expectedSamples = decoded.reduce((sum, part, index) => sum + part.sampleCount + audioGapSamples(clock.segments[index]!.gapAfterSec, rate), 0);
      if (expectedSamples !== clock.decodedFinal.sampleCount) {
        ctx.addIssue({ code: "custom", message: "decoded final sample count does not equal retained parts plus assembled gaps" });
      }
    }
  }
});
export type NarrationSegmentClock = z.infer<typeof NarrationSegmentClockSchema>;
export type NarrationSegmentClockObservations = Omit<NarrationSegmentClock, "version" | "bindingFingerprint">;
/** Floating arithmetic identity tolerance only; not an audio alignment tolerance. */
function sameNumber(left: number, right: number): boolean {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 1e-8;
}

/** FFmpeg's concat helper rounds each `apad=pad_dur` argument to three
 * decimals. Keep the receipt's integer timeline tied to that exact command,
 * never to an unrounded user-facing gap. */
export function audioGapSamples(gapSec: number, rate: number): number {
  if (!Number.isFinite(gapSec) || gapSec < 0 || !Number.isInteger(rate) || rate <= 0) {
    throw new Error("audio gap sample conversion requires a finite non-negative gap and positive integer rate");
  }
  return Math.round(Number(Math.max(0, gapSec).toFixed(3)) * rate);
}

type BoundAudio = { spokenSequence: readonly string[]; segmentClock?: NarrationSegmentClock };
export function narrationClockBindingFingerprint(binding: object): string {
  const { segmentClock: _clock, ...core } = binding as Record<string, unknown>;
  void _clock;
  return hash(core);
}

/** Validate any present child without making it mandatory for legacy audio restoration. */
export function assertNarrationSegmentClockBinding(binding: BoundAudio): NarrationSegmentClock | undefined {
  if (!Object.hasOwn(binding, "segmentClock")) return;
  const clock = NarrationSegmentClockSchema.parse(binding.segmentClock);
  if (clock.bindingFingerprint !== narrationClockBindingFingerprint(binding)) throw new Error("segment clock belongs to a different audio/input/timing binding");
  if (clock.segments.length !== binding.spokenSequence.length) throw new Error("segment clock does not cover the complete submitted speech");
  clock.segments.forEach((segment, index) => {
    const text = binding.spokenSequence[index];
    if (segment.textSha256 !== sha256Hex(text) || segment.measurement.wordCount !== text.split(/\s+/).filter(Boolean).length) {
      throw new Error("segment clock does not match the ordered submitted text");
    }
  });
  return clock;
}

export function createNarrationSegmentClock(binding: BoundAudio, observations: NarrationSegmentClockObservations): NarrationSegmentClock {
  const clock = NarrationSegmentClockSchema.parse({
    version: NARRATION_SEGMENT_CLOCK_VERSION, ...observations,
    bindingFingerprint: narrationClockBindingFingerprint(binding),
  });
  assertNarrationSegmentClockBinding({ ...binding, segmentClock: clock });
  return clock;
}

/** Check the persisted transform against real output fields; never derive measurement from the final total. */
export function assertNarrationSegmentClockOutputs(binding: BoundAudio, outputs: Readonly<Record<string, unknown>>, measuredOnly = false): NarrationSegmentClock | undefined {
  const clock = assertNarrationSegmentClockBinding(binding);
  if (!clock) {
    if (measuredOnly) throw new Error("arithmetic visual measured segment clock is unavailable; retain audio without regenerating it");
    return;
  }
  const timings = z.array(z.object({ text: z.string(), start: nonnegative, end: positive }).strict()).parse(outputs.sentenceTimings);
  const performance = outputs.narrationPerformanceEvidence as { durationSec?: unknown } | undefined;
  if (clock.finalDuration.usedSec !== outputs.narrationDurationSec || clock.finalDuration.performanceProbeSec !== performance?.durationSec) {
    throw new Error("segment clock final duration differs from bound audio outputs");
  }
  let cursor = 0, cueCount = 0;
  for (const [index, segment] of clock.segments.entries()) {
    if (segment.cueIndex !== null) {
      const cue = timings[cueCount++];
      if (!cue || cue.text !== binding.spokenSequence[index]
        || !sameNumber(cue.start, cursor * clock.reconciliation.scale)
        || !sameNumber(cue.end, (cursor + segment.measurement.durationSec) * clock.reconciliation.scale)) {
        throw new Error("segment clock does not reconstruct the exact bound sentence timeline");
      }
    }
    cursor += segment.measurement.durationSec + segment.gapAfterSec;
  }
  if (cueCount !== timings.length) throw new Error("segment clock omits persisted sentence cues");
  if (measuredOnly && (clock.mode !== "sentence" || clock.segments.some((segment) => segment.measurement.source !== "ffprobe_format_duration")
    || clock.reconciliation.scale !== 1 || clock.finalDuration.usedSec !== clock.finalDuration.performanceProbeSec)) {
    throw new Error("arithmetic visual requires an unscaled all-measured segment clock; estimates cannot qualify a reveal");
  }
  return clock;
}

/**
 * Arithmetic visual admission requires the decoded (audible) sample clock in
 * addition to the legacy format-duration clock. This is deliberately a
 * separate assertion so old receipts remain restorable while an old receipt
 * can never silently drive a new reveal timeline.
 */
export function assertNarrationSegmentClockDecodedOutputs(binding: BoundAudio, outputs: Readonly<Record<string, unknown>>): NarrationSegmentClock {
  const clock = assertNarrationSegmentClockOutputs(binding, outputs, true);
  if (!clock || !clock.decodedFinal) throw new Error("arithmetic visual decoded sample clock is unavailable; retain audio without regenerating it");
  if (clock.segments.some((segment) => !segment.measurement.decoded)) {
    throw new Error("arithmetic visual decoded sample clock is missing a retained segment observation");
  }
  return clock;
}

/** Reconstruct sentence cues from integer decoded samples, preserving the
 * exact three-decimal gap rounding used by `concatAudioWithGaps`. */
export function decodedSentenceTimings(clock: NarrationSegmentClock, spokenSequence: readonly string[]): Array<{ text: string; start: number; end: number }> {
  if (clock.mode !== "sentence" || !clock.decodedFinal || clock.segments.some((segment) => !segment.measurement.decoded)) {
    throw new Error("decoded sentence timings require a complete sentence sample clock");
  }
  if (spokenSequence.length !== clock.segments.length) throw new Error("decoded sentence timings do not cover the submitted speech");
  const rate = clock.decodedFinal.sampleRate;
  let cursorSamples = 0;
  return clock.segments.map((segment, index) => {
    const decoded = segment.measurement.decoded!;
    if (decoded.sampleRate !== rate) throw new Error("decoded sentence timings use inconsistent sample rates");
    const start = cursorSamples / rate;
    cursorSamples += decoded.sampleCount;
    const end = cursorSamples / rate;
    cursorSamples += audioGapSamples(segment.gapAfterSec, rate);
    return { text: spokenSequence[index]!, start, end };
  });
}

export function narrationSegmentClockFingerprint(clock: NarrationSegmentClock): string { return hash(clock); }
