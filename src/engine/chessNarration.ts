import { z } from "zod";

import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

import { ChessReplaySchema, type ChessReplay, type ChessReplayEvent } from "./chessReplay";

/**
 * A deliberately source-only spoken track for a verified game replay. This is
 * not an engine-analysis or commentary layer: it names only facts recovered
 * from the supplied PGN. Editorial analysis belongs in a separately reviewed
 * module, never in the artifact that drives legal board timing.
 */
export const CHESS_NARRATION_PLAN_VERSION = "chess-narration-plan/v1" as const;
export const CHESS_NARRATION_TIMING_VERSION = "chess-narration-timing/v1" as const;

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const segmentId = z.string().regex(/^chess-narration-ply-[1-9][0-9]{0,2}$/);
const nonEmptyText = z.string().trim().min(1).max(420);
const time = z.number().finite().nonnegative();

export const ChessNarrationSegmentSchema = z.object({
  id: segmentId,
  eventId: z.string().regex(/^ply-[1-9][0-9]{0,2}$/),
  text: nonEmptyText,
}).strict();
export type ChessNarrationSegment = z.infer<typeof ChessNarrationSegmentSchema>;

export const ChessNarrationPlanShape = z.object({
  version: z.literal(CHESS_NARRATION_PLAN_VERSION),
  replay: ChessReplaySchema,
  replayFingerprint: digest,
  segments: z.array(ChessNarrationSegmentSchema).min(1).max(256),
  narrationText: nonEmptyText,
  fingerprint: digest,
}).strict();
export type ChessNarrationPlan = z.infer<typeof ChessNarrationPlanShape>;

export const ChessNarrationTimingSegmentSchema = ChessNarrationSegmentSchema.extend({
  start: time,
  end: time,
}).strict().superRefine((value, ctx) => {
  if (value.end <= value.start) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "chess narration timing must end after it starts" });
  }
  if (value.end - value.start < 1.2 - 1e-6) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "chess narration timing needs at least 1.2 seconds per legal move" });
  }
});
export type ChessNarrationTimingSegment = z.infer<typeof ChessNarrationTimingSegmentSchema>;

export const ChessNarrationTimingShape = z.object({
  version: z.literal(CHESS_NARRATION_TIMING_VERSION),
  narrationPlanFingerprint: digest,
  replayFingerprint: digest,
  segments: z.array(ChessNarrationTimingSegmentSchema).min(1).max(256),
  narrationDurationSec: z.number().finite().positive().max(86_400),
  fingerprint: digest,
}).strict();
export type ChessNarrationTiming = z.infer<typeof ChessNarrationTimingShape>;

const PIECE_NAMES = {
  p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king",
} as const;

function colorName(color: ChessReplayEvent["color"]): "White" | "Black" {
  return color === "w" ? "White" : "Black";
}

function narrationFor(event: ChessReplayEvent): string {
  const side = colorName(event.color);
  const adversary = event.color === "w" ? "Black" : "White";
  const castle = event.piece === "k" && Math.abs(event.to.charCodeAt(0) - event.from.charCodeAt(0)) === 2;
  const action = castle
    ? `${side} plays ${event.san}: the king castles ${event.to[0] === "g" ? "kingside" : "queenside"} from ${event.from} to ${event.to}`
    : event.captured
      ? `${side} plays ${event.san}: the ${PIECE_NAMES[event.piece]} captures ${adversary}'s ${PIECE_NAMES[event.captured]} and moves from ${event.from} to ${event.to}`
      : `${side} plays ${event.san}: the ${PIECE_NAMES[event.piece]} moves from ${event.from} to ${event.to}`;
  const promotion = event.promotion ? `, promoting to a ${PIECE_NAMES[event.promotion]}` : "";
  const result = event.checkmate ? ", delivering checkmate" : event.check ? ", giving check" : "";
  return `${action}${promotion}${result}.`;
}

function planPayload(replay: ChessReplay) {
  const segments = replay.events.map((event) => ({
    id: `chess-narration-ply-${event.ply}`,
    eventId: event.id,
    text: narrationFor(event),
  }));
  return {
    version: CHESS_NARRATION_PLAN_VERSION,
    replay,
    replayFingerprint: replay.fingerprint,
    segments,
    narrationText: segments.map((segment) => segment.text).join(" "),
  } as const;
}

/** Build every spoken move directly from the immutable legal replay. */
export function buildChessNarrationPlan(rawReplay: unknown): ChessNarrationPlan {
  const replay = ChessReplaySchema.parse(rawReplay);
  const payload = planPayload(replay);
  return ChessNarrationPlanShape.parse({
    ...payload,
    fingerprint: sha256Hex(canonicalJson(payload)),
  });
}

/** Reject an altered sentence even if its caller recomputed a superficial hash. */
export function assertChessNarrationPlan(value: unknown): ChessNarrationPlan {
  const plan = ChessNarrationPlanShape.parse(value);
  const rebuilt = buildChessNarrationPlan(plan.replay);
  if (canonicalJson(rebuilt) !== canonicalJson(plan)) {
    throw new Error("chess narration plan differs from its immutable legal replay");
  }
  return plan;
}

/**
 * Binds the fixed legal-move script to measured TTS sentence cues. A caller
 * cannot collapse, reorder, rewrite or manually re-time a move after voice
 * generation; the animation receives the same intervals the listener hears.
 */
export function bindChessNarrationTiming(args: {
  narrationPlan: unknown;
  sentenceTimings: unknown;
  narrationDurationSec: unknown;
}): ChessNarrationTiming {
  const plan = assertChessNarrationPlan(args.narrationPlan);
  const sentenceTimings = z.array(z.object({
    text: nonEmptyText,
    start: time,
    end: time,
  }).strict().refine((cue) => cue.end > cue.start, "narration cue must end after it starts"))
    .min(1).max(2_000).parse(args.sentenceTimings);
  const narrationDurationSec = z.number().finite().positive().max(86_400).parse(args.narrationDurationSec);
  if (sentenceTimings.length !== plan.segments.length) {
    throw new Error("chess narration timing must contain exactly one measured sentence per legal move");
  }
  const segments = plan.segments.map((segment, index) => {
    const cue = sentenceTimings[index]!;
    if (cue.text.trim() !== segment.text) {
      throw new Error(`chess narration timing sentence ${index + 1} differs from the source-bound legal move`);
    }
    if (index === 0 && cue.start > 0.12) {
      throw new Error("chess narration timing must begin with the first spoken move");
    }
    if (index > 0 && cue.start < sentenceTimings[index - 1]!.end - 1e-6) {
      throw new Error(`chess narration timing sentence ${index + 1} overlaps its predecessor`);
    }
    if (cue.end > narrationDurationSec + 0.12) {
      throw new Error(`chess narration timing sentence ${index + 1} extends beyond the measured narration`);
    }
    return { ...segment, start: cue.start, end: cue.end };
  });
  const lastEnd = segments.at(-1)!.end;
  if (Math.abs(lastEnd - narrationDurationSec) > 0.5) {
    throw new Error("chess narration timing final move does not reach the measured narration end");
  }
  const payload = {
    version: CHESS_NARRATION_TIMING_VERSION,
    narrationPlanFingerprint: plan.fingerprint,
    replayFingerprint: plan.replayFingerprint,
    segments,
    narrationDurationSec,
  } as const;
  return ChessNarrationTimingShape.parse({ ...payload, fingerprint: sha256Hex(canonicalJson(payload)) });
}

/** Rebuild proof from the source-only plan and reject altered timing receipts. */
export function assertChessNarrationTiming(value: unknown, narrationPlan: unknown): ChessNarrationTiming {
  const timing = ChessNarrationTimingShape.parse(value);
  const plan = assertChessNarrationPlan(narrationPlan);
  if (timing.narrationPlanFingerprint !== plan.fingerprint || timing.replayFingerprint !== plan.replayFingerprint) {
    throw new Error("chess narration timing does not belong to the current legal replay plan");
  }
  const rebuilt = bindChessNarrationTiming({
    narrationPlan: plan,
    sentenceTimings: timing.segments.map(({ text, start, end }) => ({ text, start, end })),
    narrationDurationSec: timing.narrationDurationSec,
  });
  if (canonicalJson(rebuilt) !== canonicalJson(timing)) {
    throw new Error("chess narration timing receipt differs from its source-bound move cues");
  }
  return timing;
}
