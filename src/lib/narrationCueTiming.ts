import { z } from "zod";

import {
  NarrationTranscriptProofSchema,
  type NarrationTranscriptProof,
} from "./narrationTranscriptProof";

/**
 * Source-backed proof that the timecodes used to place captions, review frames,
 * and story beats still describe the audio that was actually spoken. The
 * transcript proof certifies the words; this contract certifies that its
 * independent word timestamps agree with the persisted cue timeline.
 */
export const NARRATION_CUE_TIMING_EVIDENCE_VERSION = "narration-cue-timing/v1";

const TIMING_TOLERANCE_SEC = 0.65;
const MIN_MATCHED_TOKEN_RATIO = 0.68;
const MIN_TIMING_ALIGNED_TOKEN_RATIO = 0.85;
const MAX_TRANSCRIPT_LOOKAHEAD_WORDS = 96;

const TimedSentenceSchema = z
  .object({
    text: z.string().min(1),
    start: z.number().finite().nonnegative(),
    end: z.number().finite().positive(),
  })
  .strict()
  .superRefine((cue, context) => {
    if (cue.end <= cue.start) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "cue end must follow its start",
      });
    }
  });

export const NarrationCueTimingEvidenceSchema = z
  .object({
    version: z.literal(NARRATION_CUE_TIMING_EVIDENCE_VERSION),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    cueCount: z.number().int().positive(),
    transcriptWordCount: z.number().int().positive(),
    expectedTokenCount: z.number().int().positive(),
    matchedTokenCount: z.number().int().positive(),
    timingAlignedTokenCount: z.number().int().positive(),
    matchedTokenRatio: z.number().min(0).max(1),
    timingAlignedTokenRatio: z.number().min(0).max(1),
    maxTimingDriftSec: z.number().finite().nonnegative(),
  })
  .strict();

export type NarrationCueTimingEvidence = z.infer<
  typeof NarrationCueTimingEvidenceSchema
>;

function tokens(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+(?:'[a-z0-9]+)?/g) ?? [];
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function timingFailure(detail: string): Error {
  return new Error(`narration cue timing evidence unavailable: ${detail}`);
}

/**
 * Reject a cue timeline that is syntactically plausible but no longer maps to
 * the independently transcribed narration audio. Matching tolerates normal ASR
 * error, while a shifted or hand-edited timeline fails on observed timestamps.
 * It is a timing proof, not a claim of word-perfect forced alignment.
 */
export function assertNarrationCueTimingEvidence(args: {
  sentenceTimings: unknown;
  transcriptProof: NarrationTranscriptProof;
  narrationDurationSec: number;
}): NarrationCueTimingEvidence {
  const proof = NarrationTranscriptProofSchema.safeParse(args.transcriptProof);
  if (!proof.success) {
    throw timingFailure(
      `transcript receipt is malformed (${proof.error.issues.map((issue) => issue.message).join("; ")})`,
    );
  }
  if (!proof.data.assessment.passed) {
    throw timingFailure(
      "transcript receipt did not pass its own fidelity assessment",
    );
  }
  if (proof.data.transcript.wordCount !== proof.data.transcript.words.length) {
    throw timingFailure(
      "transcript word count does not match its timestamped words",
    );
  }
  const cues = z
    .array(TimedSentenceSchema)
    .min(1)
    .safeParse(args.sentenceTimings);
  if (!cues.success) {
    throw timingFailure(
      `sentenceTimings are missing or malformed (${cues.error.issues.map((issue) => issue.message).join("; ")})`,
    );
  }
  const narrationDurationSec = Number(args.narrationDurationSec);
  if (!Number.isFinite(narrationDurationSec) || narrationDurationSec < 1.5) {
    throw timingFailure(
      "authored narration duration is missing or implausible",
    );
  }

  let previousCueEnd = 0;
  for (const [index, cue] of cues.data.entries()) {
    if (cue.start < previousCueEnd - 0.08) {
      throw timingFailure(`sentence cue ${index + 1} overlaps its predecessor`);
    }
    if (cue.end > narrationDurationSec + TIMING_TOLERANCE_SEC) {
      throw timingFailure(
        `sentence cue ${index + 1} extends beyond the authored narration duration`,
      );
    }
    previousCueEnd = cue.end;
  }

  const words = proof.data.transcript.words
    .map((word) => ({
      ...word,
      tokens: tokens(word.text),
      midpointSec: (word.startMs + word.endMs) / 2000,
    }))
    .filter((word) => word.tokens.length > 0);
  if (!words.length)
    throw timingFailure("timestamped transcript contains no matchable words");

  let previousWordStart = -1;
  let previousWordEnd = -1;
  for (const [index, word] of words.entries()) {
    if (word.startMs < previousWordStart || word.endMs < previousWordEnd) {
      throw timingFailure(
        `transcript word timestamps are not monotonic at word ${index + 1}`,
      );
    }
    if (word.endMs / 1000 > narrationDurationSec + TIMING_TOLERANCE_SEC) {
      throw timingFailure(
        `transcript word ${index + 1} extends beyond the authored narration duration`,
      );
    }
    previousWordStart = word.startMs;
    previousWordEnd = word.endMs;
  }

  const cueTokens = cues.data.map((cue) => tokens(cue.text));
  const expectedTokenCount = cueTokens.reduce(
    (count, values) => count + values.length,
    0,
  );
  if (!expectedTokenCount)
    throw timingFailure("sentence cues contain no spoken words");

  const firstCue = cues.data[0]!;
  const lastCue = cues.data.at(-1)!;
  const firstWordSec = words[0]!.startMs / 1000;
  const lastWordSec = words.at(-1)!.endMs / 1000;
  if (
    firstWordSec < firstCue.start - TIMING_TOLERANCE_SEC ||
    firstWordSec > firstCue.end + TIMING_TOLERANCE_SEC
  ) {
    throw timingFailure(
      "first spoken word falls outside the first persisted sentence cue",
    );
  }
  if (
    lastWordSec < lastCue.start - TIMING_TOLERANCE_SEC ||
    lastWordSec > lastCue.end + TIMING_TOLERANCE_SEC
  ) {
    throw timingFailure(
      "last spoken word falls outside the last persisted sentence cue",
    );
  }

  let wordCursor = 0;
  let matchedTokenCount = 0;
  let timingAlignedTokenCount = 0;
  let maxTimingDriftSec = 0;
  for (const [cueIndex, cue] of cues.data.entries()) {
    for (const token of cueTokens[cueIndex]!) {
      let matchedIndex = -1;
      const searchEnd = Math.min(
        words.length,
        wordCursor + MAX_TRANSCRIPT_LOOKAHEAD_WORDS,
      );
      for (let index = wordCursor; index < searchEnd; index++) {
        if (words[index]!.tokens.includes(token)) {
          matchedIndex = index;
          break;
        }
      }
      if (matchedIndex < 0) continue;
      const word = words[matchedIndex]!;
      wordCursor = matchedIndex + 1;
      matchedTokenCount++;
      const drift =
        word.midpointSec < cue.start
          ? cue.start - word.midpointSec
          : word.midpointSec > cue.end
            ? word.midpointSec - cue.end
            : 0;
      maxTimingDriftSec = Math.max(maxTimingDriftSec, drift);
      if (drift <= TIMING_TOLERANCE_SEC) timingAlignedTokenCount++;
    }
  }

  const matchedTokenRatio = matchedTokenCount / expectedTokenCount;
  if (matchedTokenRatio < MIN_MATCHED_TOKEN_RATIO) {
    throw timingFailure(
      `only ${(matchedTokenRatio * 100).toFixed(1)}% of cue words align to the independently transcribed narration (minimum ${(MIN_MATCHED_TOKEN_RATIO * 100).toFixed(0)}%)`,
    );
  }
  const timingAlignedTokenRatio = timingAlignedTokenCount / matchedTokenCount;
  if (timingAlignedTokenRatio < MIN_TIMING_ALIGNED_TOKEN_RATIO) {
    throw timingFailure(
      `only ${(timingAlignedTokenRatio * 100).toFixed(1)}% of matched cue words occur in their persisted time windows (minimum ${(MIN_TIMING_ALIGNED_TOKEN_RATIO * 100).toFixed(0)}%)`,
    );
  }

  return NarrationCueTimingEvidenceSchema.parse({
    version: NARRATION_CUE_TIMING_EVIDENCE_VERSION,
    sourceSha256: proof.data.source.sha256,
    cueCount: cues.data.length,
    transcriptWordCount: words.length,
    expectedTokenCount,
    matchedTokenCount,
    timingAlignedTokenCount,
    matchedTokenRatio: round(matchedTokenRatio),
    timingAlignedTokenRatio: round(timingAlignedTokenRatio),
    maxTimingDriftSec: round(maxTimingDriftSec),
  });
}
