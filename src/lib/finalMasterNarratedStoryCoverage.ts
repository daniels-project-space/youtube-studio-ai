import { createHash } from "node:crypto";

import { z } from "zod";

import {
  StorySpineSchema,
  storySpineFingerprint,
  validateStorySpine,
  type StorySpine,
} from "@/engine/storySpine";
import { canonicalJson } from "@/lib/canonicalJson";
import {
  assertFinalMasterNarrationSemanticEvidence,
  assertFinalMasterNarrationTranscriptAudit,
  assertFinalMasterNarrationTranscriptAuditBinding,
  type FinalMasterNarrationSemanticEvidence,
  type FinalMasterNarrationTranscriptAudit,
} from "@/lib/narrationTranscriptProof";
import {
  NarrationCueTimingEvidenceSchema,
  type NarrationCueTimingEvidence,
} from "@/lib/narrationCueTiming";

/**
 * A provider-free proof that a validated Story Spine's spoken beats survived
 * into the exact final master. It deliberately does not assert visual-shot
 * realization; visual sequence evidence remains a separate contract.
 */
export const FINAL_MASTER_NARRATED_STORY_COVERAGE_VERSION =
  "final-master-narrated-story-coverage/v1" as const;
export const FINAL_MASTER_NARRATED_STORY_COVERAGE_AUDIT_VERSION =
  "final-master-narrated-story-coverage-audit/v1" as const;
export const FINAL_MASTER_NARRATED_STORY_COVERAGE_SOURCE =
  "final-master-narrated-story-coverage/v1" as const;

export const FINAL_MASTER_NARRATED_STORY_MIN_COVERAGE_RATIO = 0.95;
export const FINAL_MASTER_NARRATED_STORY_MIN_BEAT_TOKEN_COVERAGE = 0.85;
export const FINAL_MASTER_NARRATED_STORY_MIN_BEAT_TIMING_COVERAGE = 0.85;

const SHA256 = z.string().regex(/^[a-f0-9]{64}$/i, "expected SHA-256");
const objectKey = z.string().trim().min(1).max(2_000);
const finite = z.number().finite();
const MAX_STORY_SENTENCES = 12_000;
const MAX_STORY_BEATS = 12_000;
const TIMING_TOLERANCE_SEC = 0.65;
const NARRATION_DURATION_TOLERANCE_SEC = 0.75;
const MAX_TRANSCRIPT_LOOKAHEAD_TOKENS = 160;

const sentenceTimingSchema = z.object({
  text: z.string().trim().min(1).max(8_000),
  start: finite.nonnegative(),
  end: finite.positive(),
}).strict().superRefine((value, ctx) => {
  if (value.end <= value.start) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "sentence timing end must follow start" });
  }
});

export const FinalMasterNarratedStorySentenceTimingsSchema = z
  .array(sentenceTimingSchema)
  .min(1)
  .max(MAX_STORY_SENTENCES);

const finalMasterSchema = z.object({
  sha256: SHA256,
  durationSec: finite.positive(),
}).strict();

const storySpineBindingSchema = z.object({
  fingerprint: SHA256,
  narrationDurationSec: finite.positive(),
  sentenceCount: z.number().int().positive().max(MAX_STORY_SENTENCES),
  beatCount: z.number().int().positive().max(MAX_STORY_BEATS),
  /** Plan provenance only; this receipt does not claim visual-shot coverage. */
  shotCount: z.number().int().positive().max(MAX_STORY_BEATS * 12),
}).strict();

const narrationBindingSchema = z.object({
  semanticReceiptFingerprint: SHA256,
  transcriptAudit: z.object({
    version: z.literal("final-master-narration-transcript-audit/v1"),
    r2Key: objectKey,
    contentSha256: SHA256,
    byteLength: z.number().int().positive(),
  }).strict(),
  sourceSha256: SHA256,
  expectedTextSha256: SHA256,
  startSec: finite.nonnegative(),
  durationSec: finite.positive(),
  cueTimingFingerprint: SHA256,
}).strict();

const coverageSummarySchema = z.object({
  coverageRatio: finite.min(0).max(1),
  minimumCoverageRatio: z.literal(FINAL_MASTER_NARRATED_STORY_MIN_COVERAGE_RATIO),
  totalBeatCount: z.number().int().positive().max(MAX_STORY_BEATS),
  passingBeatCount: z.number().int().nonnegative().max(MAX_STORY_BEATS),
  failingBeatCount: z.number().int().nonnegative().max(MAX_STORY_BEATS),
  minimumBeatTokenCoverage: z.literal(FINAL_MASTER_NARRATED_STORY_MIN_BEAT_TOKEN_COVERAGE),
  minimumBeatTimingCoverage: z.literal(FINAL_MASTER_NARRATED_STORY_MIN_BEAT_TIMING_COVERAGE),
}).strict().superRefine((value, ctx) => {
  if (value.passingBeatCount + value.failingBeatCount !== value.totalBeatCount) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "story coverage beat totals do not reconcile" });
  }
});

const beatCoverageSchema = z.object({
  id: z.string().trim().min(1).max(240),
  sourceSentenceIds: z.array(z.string().trim().min(1).max(240)).min(1).max(128),
  planStartSec: finite.nonnegative(),
  planEndSec: finite.positive(),
  finalMasterStartSec: finite.nonnegative(),
  finalMasterEndSec: finite.positive(),
  durationSec: finite.positive(),
  expectedTokenCount: z.number().int().positive().max(100_000),
  matchedTokenCount: z.number().int().nonnegative().max(100_000),
  timingAlignedTokenCount: z.number().int().nonnegative().max(100_000),
  tokenCoverage: finite.min(0).max(1),
  timingCoverage: finite.min(0).max(1),
  passed: z.boolean(),
}).strict().superRefine((value, ctx) => {
  if (value.planEndSec <= value.planStartSec) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "story beat plan window is not positive" });
  }
  if (value.finalMasterEndSec <= value.finalMasterStartSec) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "story beat final-master window is not positive" });
  }
  if (value.matchedTokenCount > value.expectedTokenCount) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "story beat matched-token count exceeds expected tokens" });
  }
  if (value.timingAlignedTokenCount > value.matchedTokenCount) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "story beat timing-aligned tokens exceed matched tokens" });
  }
  const expectedTokenCoverage = rounded(value.matchedTokenCount / value.expectedTokenCount);
  const expectedTimingCoverage = rounded(value.timingAlignedTokenCount / value.expectedTokenCount);
  if (value.tokenCoverage !== expectedTokenCoverage || value.timingCoverage !== expectedTimingCoverage) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "story beat coverage ratios do not match measured token counts" });
  }
  const expectedPass =
    value.tokenCoverage >= FINAL_MASTER_NARRATED_STORY_MIN_BEAT_TOKEN_COVERAGE &&
    value.timingCoverage >= FINAL_MASTER_NARRATED_STORY_MIN_BEAT_TIMING_COVERAGE;
  if (value.passed !== expectedPass) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "story beat pass flag does not match coverage policy" });
  }
});

const coverageAuditArtifactSchema = z.object({
  version: z.literal(FINAL_MASTER_NARRATED_STORY_COVERAGE_AUDIT_VERSION),
  r2Key: objectKey,
  contentSha256: SHA256,
  byteLength: z.number().int().positive(),
}).strict();

/** Full private sidecar: stores the entire Story Spine and every beat measurement. */
export const FinalMasterNarratedStoryCoverageAuditSchema = z.object({
  version: z.literal(FINAL_MASTER_NARRATED_STORY_COVERAGE_AUDIT_VERSION),
  source: z.literal(FINAL_MASTER_NARRATED_STORY_COVERAGE_SOURCE),
  measurementKind: z.literal("narration_semantic"),
  finalMaster: finalMasterSchema,
  storySpine: StorySpineSchema,
  sentenceTimings: FinalMasterNarratedStorySentenceTimingsSchema,
  storySpineBinding: storySpineBindingSchema,
  narration: narrationBindingSchema,
  coverage: coverageSummarySchema,
  beats: z.array(beatCoverageSchema).min(1).max(MAX_STORY_BEATS),
}).strict();

export type FinalMasterNarratedStoryCoverageAudit = z.infer<
  typeof FinalMasterNarratedStoryCoverageAuditSchema
>;

/** Bounded certificate-safe projection of the full per-beat audit. */
export const FinalMasterNarratedStoryCoverageReceiptSchema = z.object({
  version: z.literal(FINAL_MASTER_NARRATED_STORY_COVERAGE_VERSION),
  source: z.literal(FINAL_MASTER_NARRATED_STORY_COVERAGE_SOURCE),
  measurementKind: z.literal("narration_semantic"),
  finalMaster: finalMasterSchema,
  storySpine: storySpineBindingSchema,
  narration: narrationBindingSchema,
  coverage: coverageSummarySchema,
  auditArtifact: coverageAuditArtifactSchema,
  receiptFingerprint: SHA256,
}).strict();

export type FinalMasterNarratedStoryCoverageReceipt = z.infer<
  typeof FinalMasterNarratedStoryCoverageReceiptSchema
>;

export interface DeriveFinalMasterNarratedStoryCoverageInput {
  /** Seven reconstructed Story Spine artifacts, never an unscoped EpisodeSpec. */
  storySpine: unknown;
  /** Plan-time immutable fingerprint retained by story_spine before rendering. */
  expectedStorySpineFingerprint: unknown;
  /** Ordinary narration_tts timings: ordered text/start/end, deliberately no IDs required. */
  sentenceTimings: unknown;
  narrationCueTiming: unknown;
  finalMasterNarration: unknown;
  narrationAudit: unknown;
  keyPrefix: string;
  runId: string;
}

export interface PreparedFinalMasterNarratedStoryCoverageAudit {
  audit: FinalMasterNarratedStoryCoverageAudit;
  bytes: Buffer;
  contentSha256: string;
}

export interface DerivedFinalMasterNarratedStoryCoverage {
  receipt: FinalMasterNarratedStoryCoverageReceipt;
  preparedAudit: PreparedFinalMasterNarratedStoryCoverageAudit;
}

type TimedSentence = z.infer<typeof sentenceTimingSchema>;
type BeatCoverage = z.infer<typeof beatCoverageSchema>;
type CoverageSummary = z.infer<typeof coverageSummarySchema>;

function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(canonicalJson(value));
}

function canonicalFingerprint(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

function normalizedText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function tokens(value: string): string[] {
  return value.toLocaleLowerCase("en-US").match(/[a-z0-9]+(?:'[a-z0-9]+)?/g) ?? [];
}

function normalizePrefix(keyPrefix: string): string {
  const value = keyPrefix.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (!value) throw new Error("final-master narrated-story coverage requires a non-empty key prefix");
  return value;
}

function assertSafeRunId(runId: string): string {
  const value = runId.trim();
  if (!value || /[\\/\u0000-\u001f]/.test(value)) {
    throw new Error("final-master narrated-story coverage requires a safe run id");
  }
  return value;
}

/** The only durable location for a canonical Story Spine narration-coverage audit. */
export function finalMasterNarratedStoryCoverageAuditObjectKey(
  keyPrefix: string,
  runId: string,
  contentSha256: string,
): string {
  if (!SHA256.safeParse(contentSha256).success) {
    throw new Error("final-master narrated-story coverage audit requires a SHA-256 content digest");
  }
  return `${normalizePrefix(keyPrefix)}/runs/${assertSafeRunId(runId)}/narrated-story-coverage-audits/${contentSha256}.json`;
}

/** Validate the self-contained private audit before serializing or parsing it. */
export function assertFinalMasterNarratedStoryCoverageAudit(
  value: unknown,
): FinalMasterNarratedStoryCoverageAudit {
  const audit = FinalMasterNarratedStoryCoverageAuditSchema.parse(value);
  const spine = validateStorySpine(audit.storySpine);
  const expectedSpineBinding = storySpineBinding(spine);
  if (canonicalJson(audit.storySpineBinding) !== canonicalJson(expectedSpineBinding)) {
    throw new Error("final-master narrated-story coverage audit Story Spine binding does not match its retained plan");
  }
  validateOrderedSentenceTimings(spine, audit.sentenceTimings, audit.narration.durationSec);
  if (audit.narration.startSec + audit.narration.durationSec > audit.finalMaster.durationSec + NARRATION_DURATION_TOLERANCE_SEC) {
    throw new Error("final-master narrated-story coverage audit narration window extends beyond the final master");
  }
  if (
    canonicalJson(audit.beats.map((beat) => beat.id)) !==
    canonicalJson(spine.narrativeBeats.map((beat) => beat.id))
  ) {
    throw new Error("final-master narrated-story coverage audit beats do not match its Story Spine");
  }
  const totalDuration = audit.beats.reduce((total, beat) => total + beat.durationSec, 0);
  if (!totalDuration) {
    throw new Error("final-master narrated-story coverage audit has no measured beat duration");
  }
  const expectedCoverageRatio = rounded(audit.beats.reduce(
    (total, beat) => total + beat.durationSec * Math.min(beat.tokenCoverage, beat.timingCoverage),
    0,
  ) / totalDuration);
  const expectedPassingBeatCount = audit.beats.filter((beat) => beat.passed).length;
  if (
    audit.coverage.coverageRatio !== expectedCoverageRatio ||
    audit.coverage.passingBeatCount !== expectedPassingBeatCount ||
    audit.coverage.failingBeatCount !== audit.beats.length - expectedPassingBeatCount ||
    audit.coverage.totalBeatCount !== audit.beats.length
  ) {
    throw new Error("final-master narrated-story coverage audit summary does not match its per-beat measurements");
  }
  return audit;
}

export function serializeFinalMasterNarratedStoryCoverageAudit(
  value: FinalMasterNarratedStoryCoverageAudit,
): Buffer {
  return canonicalBytes(assertFinalMasterNarratedStoryCoverageAudit(value));
}

export function prepareFinalMasterNarratedStoryCoverageAudit(
  value: FinalMasterNarratedStoryCoverageAudit,
): PreparedFinalMasterNarratedStoryCoverageAudit {
  const audit = assertFinalMasterNarratedStoryCoverageAudit(value);
  const bytes = serializeFinalMasterNarratedStoryCoverageAudit(audit);
  return { audit, bytes, contentSha256: sha256Hex(bytes) };
}

/** Reject JSON-equivalent whitespace rewrites as well as malformed sidecars. */
export function parseFinalMasterNarratedStoryCoverageAuditBytes(
  bytes: Uint8Array,
): FinalMasterNarratedStoryCoverageAudit {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new Error("final-master narrated-story coverage audit is not valid JSON");
  }
  const audit = assertFinalMasterNarratedStoryCoverageAudit(decoded);
  if (!Buffer.from(bytes).equals(serializeFinalMasterNarratedStoryCoverageAudit(audit))) {
    throw new Error("final-master narrated-story coverage audit is not canonical content-addressed JSON");
  }
  return audit;
}

function receiptFingerprint(
  value: Omit<FinalMasterNarratedStoryCoverageReceipt, "receiptFingerprint">,
): string {
  return sha256Hex(`${FINAL_MASTER_NARRATED_STORY_COVERAGE_VERSION}\n${canonicalJson(value)}`);
}

export function sealFinalMasterNarratedStoryCoverageReceipt(
  value: Omit<FinalMasterNarratedStoryCoverageReceipt, "receiptFingerprint">,
): FinalMasterNarratedStoryCoverageReceipt {
  const normalized = FinalMasterNarratedStoryCoverageReceiptSchema
    .omit({ receiptFingerprint: true })
    .parse(value);
  return assertFinalMasterNarratedStoryCoverageReceipt({
    ...normalized,
    receiptFingerprint: receiptFingerprint(normalized),
  });
}

export function assertFinalMasterNarratedStoryCoverageReceipt(
  value: unknown,
): FinalMasterNarratedStoryCoverageReceipt {
  const receipt = FinalMasterNarratedStoryCoverageReceiptSchema.parse(value);
  const { receiptFingerprint: actual, ...unsigned } = receipt;
  if (actual !== receiptFingerprint(unsigned)) {
    throw new Error("final-master narrated-story coverage receipt fingerprint does not match its payload");
  }
  if (receipt.narration.startSec + receipt.narration.durationSec > receipt.finalMaster.durationSec + NARRATION_DURATION_TOLERANCE_SEC) {
    throw new Error("final-master narrated-story coverage narration window extends beyond the final master");
  }
  if (receipt.coverage.passingBeatCount + receipt.coverage.failingBeatCount !== receipt.storySpine.beatCount) {
    throw new Error("final-master narrated-story coverage receipt beat totals do not match its Story Spine");
  }
  return receipt;
}

function validateNarrationContext(args: {
  finalMasterNarration: unknown;
  narrationAudit: unknown;
  narrationCueTiming: unknown;
}): {
  semantic: FinalMasterNarrationSemanticEvidence;
  audit: FinalMasterNarrationTranscriptAudit;
  cueTiming: NarrationCueTimingEvidence;
} {
  const semantic = assertFinalMasterNarrationSemanticEvidence(args.finalMasterNarration);
  const audit = assertFinalMasterNarrationTranscriptAudit(args.narrationAudit);
  assertFinalMasterNarrationTranscriptAuditBinding({ evidence: semantic, audit });
  const cueTiming = NarrationCueTimingEvidenceSchema.parse(args.narrationCueTiming);
  if (cueTiming.sourceSha256 !== semantic.narration.sourceSha256) {
    throw new Error("final-master narrated-story coverage cue timing belongs to a different narration source");
  }
  if (cueTiming.matchedTokenRatio < 0.68 || cueTiming.timingAlignedTokenRatio < 0.85) {
    throw new Error("final-master narrated-story coverage requires passing source narration cue timing");
  }
  return { semantic, audit, cueTiming };
}

function validateOrderedSentenceTimings(
  storySpine: StorySpine,
  input: unknown,
  narrationDurationSec: number,
): TimedSentence[] {
  const timings = FinalMasterNarratedStorySentenceTimingsSchema.parse(input);
  if (timings.length !== storySpine.timedScript.sentences.length) {
    throw new Error("final-master narrated-story coverage sentence timing count does not match the Story Spine");
  }
  let previousEnd = 0;
  for (const [index, timing] of timings.entries()) {
    const sentence = storySpine.timedScript.sentences[index]!;
    if (normalizedText(timing.text) !== normalizedText(sentence.text)) {
      throw new Error(`final-master narrated-story coverage sentence ${index + 1} text does not match the Story Spine`);
    }
    if (timing.start < previousEnd - 0.08) {
      throw new Error(`final-master narrated-story coverage sentence ${index + 1} overlaps its predecessor`);
    }
    if (timing.end > narrationDurationSec + NARRATION_DURATION_TOLERANCE_SEC) {
      throw new Error(`final-master narrated-story coverage sentence ${index + 1} extends beyond the narrated source`);
    }
    previousEnd = timing.end;
  }
  if (Math.abs(storySpine.timedScript.narrationDurationSec - narrationDurationSec) > NARRATION_DURATION_TOLERANCE_SEC) {
    throw new Error("final-master narrated-story coverage Story Spine duration does not match narration evidence");
  }
  return timings;
}

interface TranscriptToken {
  token: string;
  startSec: number;
  endSec: number;
  midpointSec: number;
}

function finalMasterTranscriptTokens(
  audit: FinalMasterNarrationTranscriptAudit,
): TranscriptToken[] {
  const rawWords = audit.finalMasterTranscript.transcript.words;
  const output: TranscriptToken[] = [];
  let previousStart = -1;
  let previousEnd = -1;
  for (const word of rawWords) {
    if (word.startMs < previousStart || word.endMs < previousEnd) {
      throw new Error("final-master narrated-story coverage transcript timestamps are not monotonic");
    }
    previousStart = word.startMs;
    previousEnd = word.endMs;
    const startSec = word.startMs / 1_000;
    const endSec = word.endMs / 1_000;
    if (endSec > audit.finalMaster.durationSec + NARRATION_DURATION_TOLERANCE_SEC) {
      throw new Error("final-master narrated-story coverage transcript extends beyond the released master");
    }
    for (const token of tokens(word.text)) {
      output.push({ token, startSec, endSec, midpointSec: (startSec + endSec) / 2 });
    }
  }
  if (!output.length) throw new Error("final-master narrated-story coverage transcript has no matchable words");
  return output;
}

function storySpineBinding(storySpine: StorySpine) {
  return {
    fingerprint: storySpineFingerprint(storySpine),
    narrationDurationSec: storySpine.timedScript.narrationDurationSec,
    sentenceCount: storySpine.timedScript.sentences.length,
    beatCount: storySpine.narrativeBeats.length,
    shotCount: storySpine.shotList.length,
  };
}

function narrationBinding(
  semantic: FinalMasterNarrationSemanticEvidence,
  cueTiming: NarrationCueTimingEvidence,
) {
  return {
    semanticReceiptFingerprint: semantic.receiptFingerprint,
    transcriptAudit: semantic.auditArtifact,
    sourceSha256: semantic.narration.sourceSha256,
    expectedTextSha256: semantic.narration.expectedTextSha256,
    startSec: semantic.narration.startSec,
    durationSec: semantic.narration.durationSec,
    cueTimingFingerprint: canonicalFingerprint(cueTiming),
  };
}

function deriveBeatCoverage(args: {
  storySpine: StorySpine;
  sentenceTimings: TimedSentence[];
  narrationStartSec: number;
  finalMasterDurationSec: number;
  transcriptTokens: TranscriptToken[];
}): { beats: BeatCoverage[]; coverage: CoverageSummary } {
  const sentenceIndexById = new Map(
    args.storySpine.timedScript.sentences.map((sentence, index) => [sentence.id, index]),
  );
  const beats: BeatCoverage[] = [];
  let cursor = 0;
  let weightedCoverage = 0;
  let totalDuration = 0;

  for (const beat of args.storySpine.narrativeBeats) {
    const sentenceIndexes = [...new Set(beat.sourceSentenceIds.map((id) => {
      const index = sentenceIndexById.get(id);
      if (index === undefined) throw new Error(`final-master narrated-story coverage beat ${beat.id} references an unknown sentence`);
      return index;
    }))].sort((left, right) => left - right);
    const selectedTimings = sentenceIndexes.map((index) => args.sentenceTimings[index]!);
    const expectedTokens = sentenceIndexes.flatMap((index) => tokens(args.storySpine.timedScript.sentences[index]!.text));
    if (!expectedTokens.length) {
      throw new Error(`final-master narrated-story coverage beat ${beat.id} has no matchable spoken tokens`);
    }
    const planStartSec = Math.min(...selectedTimings.map((timing) => timing.start));
    const planEndSec = Math.max(...selectedTimings.map((timing) => timing.end));
    const finalMasterStartSec = Math.max(0, rounded(planStartSec + args.narrationStartSec));
    const finalMasterEndSec = Math.min(
      args.finalMasterDurationSec,
      rounded(planEndSec + args.narrationStartSec),
    );
    if (finalMasterEndSec <= finalMasterStartSec) {
      throw new Error(`final-master narrated-story coverage beat ${beat.id} has no usable final-master window`);
    }

    while (
      cursor < args.transcriptTokens.length &&
      args.transcriptTokens[cursor]!.endSec < finalMasterStartSec - TIMING_TOLERANCE_SEC
    ) {
      cursor++;
    }
    let matchedTokenCount = 0;
    let timingAlignedTokenCount = 0;
    for (const expectedToken of expectedTokens) {
      const searchEnd = Math.min(
        args.transcriptTokens.length,
        cursor + MAX_TRANSCRIPT_LOOKAHEAD_TOKENS,
      );
      let matchedIndex = -1;
      for (let index = cursor; index < searchEnd; index++) {
        const candidate = args.transcriptTokens[index]!;
        if (candidate.startSec > finalMasterEndSec + TIMING_TOLERANCE_SEC) break;
        if (
          candidate.token === expectedToken &&
          candidate.endSec >= finalMasterStartSec - TIMING_TOLERANCE_SEC
        ) {
          matchedIndex = index;
          break;
        }
      }
      if (matchedIndex < 0) continue;
      const candidate = args.transcriptTokens[matchedIndex]!;
      cursor = matchedIndex + 1;
      matchedTokenCount++;
      if (
        candidate.midpointSec >= finalMasterStartSec - TIMING_TOLERANCE_SEC &&
        candidate.midpointSec <= finalMasterEndSec + TIMING_TOLERANCE_SEC
      ) {
        timingAlignedTokenCount++;
      }
    }
    const tokenCoverage = rounded(matchedTokenCount / expectedTokens.length);
    const timingCoverage = rounded(timingAlignedTokenCount / expectedTokens.length);
    const passed =
      tokenCoverage >= FINAL_MASTER_NARRATED_STORY_MIN_BEAT_TOKEN_COVERAGE &&
      timingCoverage >= FINAL_MASTER_NARRATED_STORY_MIN_BEAT_TIMING_COVERAGE;
    const durationSec = rounded(planEndSec - planStartSec);
    totalDuration += durationSec;
    weightedCoverage += durationSec * Math.min(tokenCoverage, timingCoverage);
    beats.push({
      id: beat.id,
      sourceSentenceIds: [...beat.sourceSentenceIds],
      planStartSec: rounded(planStartSec),
      planEndSec: rounded(planEndSec),
      finalMasterStartSec,
      finalMasterEndSec,
      durationSec,
      expectedTokenCount: expectedTokens.length,
      matchedTokenCount,
      timingAlignedTokenCount,
      tokenCoverage,
      timingCoverage,
      passed,
    });
  }
  if (!totalDuration) throw new Error("final-master narrated-story coverage Story Spine has no measured duration");
  const passingBeatCount = beats.filter((beat) => beat.passed).length;
  return {
    beats: z.array(beatCoverageSchema).min(1).max(MAX_STORY_BEATS).parse(beats),
    coverage: coverageSummarySchema.parse({
      coverageRatio: rounded(weightedCoverage / totalDuration),
      minimumCoverageRatio: FINAL_MASTER_NARRATED_STORY_MIN_COVERAGE_RATIO,
      totalBeatCount: beats.length,
      passingBeatCount,
      failingBeatCount: beats.length - passingBeatCount,
      minimumBeatTokenCoverage: FINAL_MASTER_NARRATED_STORY_MIN_BEAT_TOKEN_COVERAGE,
      minimumBeatTimingCoverage: FINAL_MASTER_NARRATED_STORY_MIN_BEAT_TIMING_COVERAGE,
    }),
  };
}

function evaluateCoverage(args: {
  storySpine: unknown;
  sentenceTimings: unknown;
  finalMasterNarration: unknown;
  narrationAudit: unknown;
  narrationCueTiming: unknown;
  expectedStorySpineFingerprint?: string;
}) {
  const storySpine = validateStorySpine(StorySpineSchema.parse(args.storySpine));
  const spineBinding = storySpineBinding(storySpine);
  if (args.expectedStorySpineFingerprint && spineBinding.fingerprint !== args.expectedStorySpineFingerprint) {
    throw new Error("final-master narrated-story coverage Story Spine fingerprint does not match the plan retained before rendering");
  }
  const { semantic, audit, cueTiming } = validateNarrationContext({
    finalMasterNarration: args.finalMasterNarration,
    narrationAudit: args.narrationAudit,
    narrationCueTiming: args.narrationCueTiming,
  });
  if (
    semantic.finalMaster.sha256 !== audit.finalMaster.sha256 ||
    semantic.finalMaster.durationSec !== audit.finalMaster.durationSec
  ) {
    throw new Error("final-master narrated-story coverage narration evidence belongs to a different master");
  }
  const timings = validateOrderedSentenceTimings(
    storySpine,
    args.sentenceTimings,
    semantic.narration.durationSec,
  );
  const measured = deriveBeatCoverage({
    storySpine,
    sentenceTimings: timings,
    narrationStartSec: semantic.narration.startSec,
    finalMasterDurationSec: semantic.finalMaster.durationSec,
    transcriptTokens: finalMasterTranscriptTokens(audit),
  });
  return {
    storySpine,
    sentenceTimings: timings,
    storySpineBinding: spineBinding,
    narration: narrationBinding(semantic, cueTiming),
    finalMaster: semantic.finalMaster,
    ...measured,
  };
}

/**
 * Mint an in-memory, content-addressed audit plus compact receipt. It performs
 * no storage I/O, provider request, review request, or render operation.
 */
export function deriveFinalMasterNarratedStoryCoverage(
  input: DeriveFinalMasterNarratedStoryCoverageInput,
): DerivedFinalMasterNarratedStoryCoverage {
  const expectedStorySpineFingerprint = SHA256.parse(input.expectedStorySpineFingerprint);
  const evaluated = evaluateCoverage({
    storySpine: input.storySpine,
    sentenceTimings: input.sentenceTimings,
    finalMasterNarration: input.finalMasterNarration,
    narrationAudit: input.narrationAudit,
    narrationCueTiming: input.narrationCueTiming,
    expectedStorySpineFingerprint,
  });
  const audit = FinalMasterNarratedStoryCoverageAuditSchema.parse({
    version: FINAL_MASTER_NARRATED_STORY_COVERAGE_AUDIT_VERSION,
    source: FINAL_MASTER_NARRATED_STORY_COVERAGE_SOURCE,
    measurementKind: "narration_semantic",
    finalMaster: evaluated.finalMaster,
    storySpine: evaluated.storySpine,
    sentenceTimings: evaluated.sentenceTimings,
    storySpineBinding: evaluated.storySpineBinding,
    narration: evaluated.narration,
    coverage: evaluated.coverage,
    beats: evaluated.beats,
  });
  const preparedAudit = prepareFinalMasterNarratedStoryCoverageAudit(audit);
  const receipt = sealFinalMasterNarratedStoryCoverageReceipt({
    version: FINAL_MASTER_NARRATED_STORY_COVERAGE_VERSION,
    source: FINAL_MASTER_NARRATED_STORY_COVERAGE_SOURCE,
    measurementKind: "narration_semantic",
    finalMaster: evaluated.finalMaster,
    storySpine: evaluated.storySpineBinding,
    narration: evaluated.narration,
    coverage: evaluated.coverage,
    auditArtifact: {
      version: FINAL_MASTER_NARRATED_STORY_COVERAGE_AUDIT_VERSION,
      r2Key: finalMasterNarratedStoryCoverageAuditObjectKey(
        input.keyPrefix,
        input.runId,
        preparedAudit.contentSha256,
      ),
      contentSha256: preparedAudit.contentSha256,
      byteLength: preparedAudit.bytes.byteLength,
    },
  });
  return { receipt, preparedAudit };
}

/**
 * Recompute every per-beat measurement from the retained private Story Spine,
 * raw timings, and final-master transcript audit before accepting a compact
 * certificate receipt.
 */
export function assertFinalMasterNarratedStoryCoverageReceiptBinding(args: {
  receipt: unknown;
  finalMasterNarration: unknown;
  narrationAudit: unknown;
  narrationCueTiming: unknown;
  coverageAudit: unknown;
}): FinalMasterNarratedStoryCoverageReceipt {
  const receipt = assertFinalMasterNarratedStoryCoverageReceipt(args.receipt);
  const coverageAudit = FinalMasterNarratedStoryCoverageAuditSchema.parse(args.coverageAudit);
  const preparedAudit = prepareFinalMasterNarratedStoryCoverageAudit(coverageAudit);
  if (
    receipt.auditArtifact.contentSha256 !== preparedAudit.contentSha256 ||
    receipt.auditArtifact.byteLength !== preparedAudit.bytes.byteLength
  ) {
    throw new Error("final-master narrated-story coverage receipt does not match its retained audit object");
  }
  const semantic = assertFinalMasterNarrationSemanticEvidence(args.finalMasterNarration);
  const narrationAudit = assertFinalMasterNarrationTranscriptAudit(args.narrationAudit);
  assertFinalMasterNarrationTranscriptAuditBinding({ evidence: semantic, audit: narrationAudit });
  const cueTiming = NarrationCueTimingEvidenceSchema.parse(args.narrationCueTiming);
  const evaluated = evaluateCoverage({
    storySpine: coverageAudit.storySpine,
    sentenceTimings: coverageAudit.sentenceTimings,
    finalMasterNarration: semantic,
    narrationAudit,
    narrationCueTiming: cueTiming,
    expectedStorySpineFingerprint: coverageAudit.storySpineBinding.fingerprint,
  });
  const expectedAudit = FinalMasterNarratedStoryCoverageAuditSchema.parse({
    version: FINAL_MASTER_NARRATED_STORY_COVERAGE_AUDIT_VERSION,
    source: FINAL_MASTER_NARRATED_STORY_COVERAGE_SOURCE,
    measurementKind: "narration_semantic",
    finalMaster: evaluated.finalMaster,
    storySpine: evaluated.storySpine,
    sentenceTimings: evaluated.sentenceTimings,
    storySpineBinding: evaluated.storySpineBinding,
    narration: evaluated.narration,
    coverage: evaluated.coverage,
    beats: evaluated.beats,
  });
  if (canonicalJson(coverageAudit) !== canonicalJson(expectedAudit)) {
    throw new Error("final-master narrated-story coverage audit does not match its retained Story Spine or final-master transcript evidence");
  }
  if (
    receipt.finalMaster.sha256 !== semantic.finalMaster.sha256 ||
    receipt.finalMaster.durationSec !== semantic.finalMaster.durationSec ||
    receipt.narration.semanticReceiptFingerprint !== semantic.receiptFingerprint ||
    canonicalJson(receipt.narration.transcriptAudit) !== canonicalJson(semantic.auditArtifact)
  ) {
    throw new Error("final-master narrated-story coverage receipt belongs to a different narration semantic receipt");
  }
  if (
    canonicalJson(receipt.storySpine) !== canonicalJson(coverageAudit.storySpineBinding) ||
    canonicalJson(receipt.narration) !== canonicalJson(coverageAudit.narration) ||
    canonicalJson(receipt.coverage) !== canonicalJson(coverageAudit.coverage)
  ) {
    throw new Error("final-master narrated-story coverage receipt does not match its retained audit summary");
  }
  return receipt;
}
