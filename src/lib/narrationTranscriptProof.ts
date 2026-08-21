import { createHash } from "node:crypto";
import { createReadStream, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { z } from "zod";

import { canonicalJson } from "@/lib/canonicalJson";

export const NARRATION_TRANSCRIPT_PROOF_VERSION = "narration-transcript-proof/v1";
export const NARRATION_TRANSCRIPT_PROOF_SCRIPT = "scripts/narration_transcript_proof.py";
export const NARRATION_TRANSCRIPT_MODEL_ID = "Systran/faster-whisper-small.en";
export const NARRATION_TRANSCRIPT_MODEL_REVISION = "d1d751a5f8271d482d14ca55d9e2deeebbae577f";
export const FASTER_WHISPER_VERSION = "1.2.1";
export const NARRATION_TRANSCRIPT_MODEL_DIR = "/opt/youtube-studio-qa-narration-proof/model";
export const NARRATION_TRANSCRIPT_PROOF_PYTHON = "/opt/youtube-studio-qa-narration-proof/bin/python";
/**
 * A sealed local-audition receipt for the released master, not merely the
 * pristine TTS source. This deliberately proves intelligible narration only;
 * non-speech diegetic sound still requires its own review evidence.
 */
export const FINAL_MASTER_NARRATION_SEMANTIC_EVIDENCE_VERSION =
  "final-master-narration-semantic-evidence/v1" as const;
/**
 * The full, timestamped local-transcriber receipts are deliberately stored as
 * a separate content-addressed R2 audit object. A 30-minute master can carry
 * thousands of words, which must never force a QA stage/certificate artifact
 * across an inline runner limit.
 */
export const FINAL_MASTER_NARRATION_TRANSCRIPT_AUDIT_VERSION =
  "final-master-narration-transcript-audit/v1" as const;

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const TranscriptWordSchema = z.object({
  text: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
}).strict().superRefine((word, context) => {
  if (word.endMs < word.startMs) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "word end must not precede its start" });
  }
});

export const NarrationTranscriptProofSchema = z.object({
  schemaVersion: z.literal(NARRATION_TRANSCRIPT_PROOF_VERSION),
  provider: z.literal("faster-whisper"),
  model: z.object({
    id: z.literal(NARRATION_TRANSCRIPT_MODEL_ID),
    revision: z.literal(NARRATION_TRANSCRIPT_MODEL_REVISION),
    packageVersion: z.literal(FASTER_WHISPER_VERSION),
    computeType: z.literal("int8-cpu"),
  }).strict(),
  source: z.object({
    sha256: Sha256Schema,
    byteLength: z.number().int().positive(),
  }).strict(),
  expected: z.object({
    textSha256: Sha256Schema,
    wordCount: z.number().int().min(10),
  }).strict(),
  transcript: z.object({
    text: z.string().min(1),
    wordCount: z.number().int().positive(),
    words: z.array(TranscriptWordSchema).min(1),
  }).strict(),
  assessment: z.object({
    wordErrorRate: z.number().min(0),
    lexicalRecall: z.number().min(0).max(1),
    missingNumericTerms: z.array(z.string().min(1)),
    thresholds: z.object({
      maxWordErrorRate: z.literal(0.18),
      minLexicalRecall: z.literal(0.92),
    }).strict(),
    passed: z.boolean(),
  }).strict(),
}).strict();

export type NarrationTranscriptProof = z.infer<typeof NarrationTranscriptProofSchema>;

/** Fixed-size projection of a full transcript proof retained in the R2 audit object. */
export const NarrationTranscriptProofSummarySchema = z.object({
  proofSha256: Sha256Schema,
  provider: z.literal("faster-whisper"),
  model: z.object({
    id: z.literal(NARRATION_TRANSCRIPT_MODEL_ID),
    revision: z.literal(NARRATION_TRANSCRIPT_MODEL_REVISION),
    packageVersion: z.literal(FASTER_WHISPER_VERSION),
    computeType: z.literal("int8-cpu"),
  }).strict(),
  source: z.object({
    sha256: Sha256Schema,
    byteLength: z.number().int().positive(),
  }).strict(),
  expected: z.object({
    textSha256: Sha256Schema,
    wordCount: z.number().int().min(10),
  }).strict(),
  transcript: z.object({
    textSha256: Sha256Schema,
    wordCount: z.number().int().positive(),
    timestampWordCount: z.number().int().positive(),
    timestampWordsSha256: Sha256Schema,
  }).strict(),
  assessment: z.object({
    wordErrorRate: z.number().min(0),
    lexicalRecall: z.number().min(0).max(1),
    missingNumericTermCount: z.number().int().nonnegative(),
    missingNumericTermsSha256: Sha256Schema,
    thresholds: z.object({
      maxWordErrorRate: z.literal(0.18),
      minLexicalRecall: z.literal(0.92),
    }).strict(),
    passed: z.boolean(),
  }).strict(),
}).strict();

export type NarrationTranscriptProofSummary = z.infer<typeof NarrationTranscriptProofSummarySchema>;

/**
 * Complete evidence retained only as canonical JSON in R2. It preserves every
 * word timestamp and missing numeric term for an offline audit.
 */
export const FinalMasterNarrationTranscriptAuditSchema = z.object({
  version: z.literal(FINAL_MASTER_NARRATION_TRANSCRIPT_AUDIT_VERSION),
  finalMaster: z.object({
    sha256: Sha256Schema,
    durationSec: z.number().finite().positive(),
  }).strict(),
  narration: z.object({
    sourceSha256: Sha256Schema,
    expectedTextSha256: Sha256Schema,
    startSec: z.number().finite().nonnegative(),
    durationSec: z.number().finite().positive(),
  }).strict(),
  sourceTranscript: NarrationTranscriptProofSchema,
  finalMasterTranscript: NarrationTranscriptProofSchema,
}).strict();

export type FinalMasterNarrationTranscriptAudit = z.infer<
  typeof FinalMasterNarrationTranscriptAuditSchema
>;

/** Immutable location and exact canonical-byte digest of the R2 audit object. */
export const FinalMasterNarrationTranscriptAuditReferenceSchema = z.object({
  version: z.literal(FINAL_MASTER_NARRATION_TRANSCRIPT_AUDIT_VERSION),
  r2Key: z.string().trim().min(1).max(2_000),
  contentSha256: Sha256Schema,
  byteLength: z.number().int().positive().max(50_000_000),
}).strict();

export type FinalMasterNarrationTranscriptAuditReference = z.infer<
  typeof FinalMasterNarrationTranscriptAuditReferenceSchema
>;

export const FinalMasterNarrationSemanticEvidenceSchema = z.object({
  version: z.literal(FINAL_MASTER_NARRATION_SEMANTIC_EVIDENCE_VERSION),
  finalMaster: z.object({
    sha256: Sha256Schema,
    durationSec: z.number().finite().positive(),
  }).strict(),
  narration: z.object({
    sourceSha256: Sha256Schema,
    expectedTextSha256: Sha256Schema,
    startSec: z.number().finite().nonnegative(),
    durationSec: z.number().finite().positive(),
  }).strict(),
  /** Fixed-size digest of pristine narration; full timestamps live in auditArtifact. */
  sourceTranscript: NarrationTranscriptProofSummarySchema,
  /** Fixed-size digest of the final master; full timestamps live in auditArtifact. */
  finalMasterTranscript: NarrationTranscriptProofSummarySchema,
  /** Content-addressed canonical JSON carrying both complete transcript receipts. */
  auditArtifact: FinalMasterNarrationTranscriptAuditReferenceSchema,
  receiptFingerprint: Sha256Schema,
}).strict();

export type FinalMasterNarrationSemanticEvidence = z.infer<
  typeof FinalMasterNarrationSemanticEvidenceSchema
>;

export type FinalMasterNarrationSemanticEvidenceInput = Omit<
  FinalMasterNarrationSemanticEvidence,
  "receiptFingerprint"
>;

export interface NarrationTranscriptProofProcessResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export type NarrationTranscriptProofRunner = (
  command: string,
  args: readonly string[],
  timeoutMs: number,
) => NarrationTranscriptProofProcessResult;

export interface NarrationTranscriptProofOptions {
  audioPath: string;
  expectedText: string;
  sourceSha256: string;
  runner?: NarrationTranscriptProofRunner;
  timeoutMs?: number;
}

function unavailable(detail: string): Error {
  return new Error(`narration transcript proof unavailable: ${detail}`);
}

function hashText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(canonicalJson(value), "utf8");
}

function hashCanonical(value: unknown): string {
  return createHash("sha256").update(canonicalBytes(value)).digest("hex");
}

export async function sha256NarrationTranscriptSource(audioPath: string): Promise<string> {
  if (!audioPath.trim()) throw unavailable("audioPath is required");
  const hash = createHash("sha256");
  let byteLength = 0;
  try {
    for await (const chunk of createReadStream(audioPath)) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(bytes);
      byteLength += bytes.byteLength;
    }
  } catch (error) {
    throw unavailable(`cannot read narration bytes (${error instanceof Error ? error.message : String(error)})`);
  }
  if (byteLength <= 0) throw unavailable("narration source is empty");
  return hash.digest("hex");
}

export function buildNarrationTranscriptProofInvocation(args: {
  audioPath: string;
  expectedTextPath: string;
  sourceSha256: string;
  expectedTextSha256: string;
}): { command: string; args: readonly string[] } {
  if (!args.audioPath.trim() || !args.expectedTextPath.trim()) throw unavailable("audio and expected-text paths are required");
  if (!Sha256Schema.safeParse(args.sourceSha256).success) throw unavailable("source SHA-256 is invalid");
  if (!Sha256Schema.safeParse(args.expectedTextSha256).success) throw unavailable("expected text SHA-256 is invalid");
  return {
    command: NARRATION_TRANSCRIPT_PROOF_PYTHON,
    args: [
      NARRATION_TRANSCRIPT_PROOF_SCRIPT,
      "--input", args.audioPath,
      "--expected-text", args.expectedTextPath,
      "--source-sha256", args.sourceSha256,
      "--expected-text-sha256", args.expectedTextSha256,
      "--model-dir", NARRATION_TRANSCRIPT_MODEL_DIR,
    ],
  };
}

function runBakedNarrationTranscriptProof(command: string, args: readonly string[], timeoutMs: number): NarrationTranscriptProofProcessResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: timeoutMs,
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    ...(result.error ? { error: result.error } : {}),
  };
}

export function assertNarrationTranscriptProof(proof: NarrationTranscriptProof, expected: {
  sourceSha256: string;
  sourceByteLength: number;
  expectedTextSha256: string;
}): NarrationTranscriptProof {
  const parsed = NarrationTranscriptProofSchema.safeParse(proof);
  if (!parsed.success) {
    throw unavailable(`baked proof emitted an invalid receipt (${parsed.error.issues.map((issue) => issue.message).join("; ")})`);
  }
  const receipt = parsed.data;
  if (receipt.source.sha256 !== expected.sourceSha256 || receipt.source.byteLength !== expected.sourceByteLength) {
    throw unavailable("proof source does not match the authored narration bytes");
  }
  if (receipt.expected.textSha256 !== expected.expectedTextSha256) {
    throw unavailable("proof expected text does not match the exact authored narration script");
  }
  if (receipt.transcript.wordCount !== receipt.transcript.words.length) {
    throw unavailable("proof transcript word count does not match its timestamped words");
  }
  const shouldPass = receipt.assessment.wordErrorRate <= receipt.assessment.thresholds.maxWordErrorRate
    && receipt.assessment.lexicalRecall >= receipt.assessment.thresholds.minLexicalRecall;
  if (receipt.assessment.passed !== shouldPass) {
    throw unavailable("proof pass flag does not match its measured transcript metrics");
  }
  return receipt;
}

/** Compact a validated full receipt without carrying unbounded words/text inline. */
export function summarizeNarrationTranscriptProof(
  proof: NarrationTranscriptProof,
): NarrationTranscriptProofSummary {
  const receipt = assertNarrationTranscriptProof(proof, {
    sourceSha256: proof.source.sha256,
    sourceByteLength: proof.source.byteLength,
    expectedTextSha256: proof.expected.textSha256,
  });
  return NarrationTranscriptProofSummarySchema.parse({
    proofSha256: hashCanonical(receipt),
    provider: receipt.provider,
    model: receipt.model,
    source: receipt.source,
    expected: receipt.expected,
    transcript: {
      textSha256: hashText(receipt.transcript.text),
      wordCount: receipt.transcript.wordCount,
      timestampWordCount: receipt.transcript.words.length,
      timestampWordsSha256: hashCanonical(receipt.transcript.words),
    },
    assessment: {
      wordErrorRate: receipt.assessment.wordErrorRate,
      lexicalRecall: receipt.assessment.lexicalRecall,
      missingNumericTermCount: receipt.assessment.missingNumericTerms.length,
      missingNumericTermsSha256: hashCanonical(receipt.assessment.missingNumericTerms),
      thresholds: receipt.assessment.thresholds,
      passed: receipt.assessment.passed,
    },
  });
}

function assertNarrationTranscriptProofSummary(
  value: unknown,
  expected: {
    sourceSha256: string;
    expectedTextSha256: string;
  },
): NarrationTranscriptProofSummary {
  const summary = NarrationTranscriptProofSummarySchema.parse(value);
  if (summary.source.sha256 !== expected.sourceSha256) {
    throw new Error("final-master narration semantic evidence summary source does not match its bound audio");
  }
  if (summary.expected.textSha256 !== expected.expectedTextSha256) {
    throw new Error("final-master narration semantic evidence summary does not match the approved narration script");
  }
  if (summary.transcript.wordCount !== summary.transcript.timestampWordCount) {
    throw new Error("final-master narration semantic evidence summary word count does not match its timestamp digest");
  }
  const shouldPass = summary.assessment.wordErrorRate <= summary.assessment.thresholds.maxWordErrorRate
    && summary.assessment.lexicalRecall >= summary.assessment.thresholds.minLexicalRecall;
  if (summary.assessment.passed !== shouldPass) {
    throw new Error("final-master narration semantic evidence summary pass flag does not match its metrics");
  }
  return summary;
}

/**
 * Validate the complete two-proof audit and pin it to the exact master/script.
 * This is used before storage and again after fetching the retained R2 object.
 */
export function assertFinalMasterNarrationTranscriptAudit(
  value: unknown,
): FinalMasterNarrationTranscriptAudit {
  const audit = FinalMasterNarrationTranscriptAuditSchema.parse(value);
  const sourceTranscript = assertNarrationTranscriptProof(audit.sourceTranscript, {
    sourceSha256: audit.narration.sourceSha256,
    sourceByteLength: audit.sourceTranscript.source.byteLength,
    expectedTextSha256: audit.narration.expectedTextSha256,
  });
  const finalMasterTranscript = assertNarrationTranscriptProof(audit.finalMasterTranscript, {
    sourceSha256: audit.finalMaster.sha256,
    sourceByteLength: audit.finalMasterTranscript.source.byteLength,
    expectedTextSha256: audit.narration.expectedTextSha256,
  });
  if (!sourceTranscript.assessment.passed) {
    throw new Error("final-master narration transcript audit source transcript did not pass fidelity thresholds");
  }
  if (!finalMasterTranscript.assessment.passed) {
    throw new Error("final-master narration transcript audit final-master transcript did not pass fidelity thresholds");
  }
  if (sourceTranscript.expected.wordCount !== finalMasterTranscript.expected.wordCount) {
    throw new Error("final-master narration transcript audit transcript word-count contracts differ");
  }
  if (audit.narration.startSec + audit.narration.durationSec > audit.finalMaster.durationSec + 0.75) {
    throw new Error("final-master narration transcript audit extends beyond the released master");
  }
  return audit;
}

export function serializeFinalMasterNarrationTranscriptAudit(
  value: FinalMasterNarrationTranscriptAudit,
): Buffer {
  return canonicalBytes(assertFinalMasterNarrationTranscriptAudit(value));
}

export function finalMasterNarrationTranscriptAuditContentSha256(
  value: FinalMasterNarrationTranscriptAudit,
): string {
  return createHash("sha256")
    .update(serializeFinalMasterNarrationTranscriptAudit(value))
    .digest("hex");
}

/** Prepare the full R2 payload and bounded receipt summaries in one audited step. */
export function prepareFinalMasterNarrationTranscriptAudit(
  value: FinalMasterNarrationTranscriptAudit,
): {
  audit: FinalMasterNarrationTranscriptAudit;
  bytes: Buffer;
  contentSha256: string;
  sourceTranscript: NarrationTranscriptProofSummary;
  finalMasterTranscript: NarrationTranscriptProofSummary;
} {
  const audit = assertFinalMasterNarrationTranscriptAudit(value);
  const bytes = serializeFinalMasterNarrationTranscriptAudit(audit);
  return {
    audit,
    bytes,
    contentSha256: createHash("sha256").update(bytes).digest("hex"),
    sourceTranscript: summarizeNarrationTranscriptProof(audit.sourceTranscript),
    finalMasterTranscript: summarizeNarrationTranscriptProof(audit.finalMasterTranscript),
  };
}

/**
 * The only permitted durable key for a full timestamp audit. Keeping the
 * payload digest in both the key and compact receipt makes an accidental or
 * substituted R2 object fail closed during upload verification.
 */
export function finalMasterNarrationTranscriptAuditObjectKey(
  keyPrefix: string,
  runId: string,
  contentSha256: string,
): string {
  const prefix = keyPrefix.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (!prefix) throw new Error("final-master narration transcript audit requires a non-empty key prefix");
  const id = runId.trim();
  if (!id || /[\\/\u0000-\u001f]/.test(id)) {
    throw new Error("final-master narration transcript audit requires a safe run id");
  }
  if (!Sha256Schema.safeParse(contentSha256).success) {
    throw new Error("final-master narration transcript audit requires a SHA-256 content digest");
  }
  return `${prefix}/runs/${id}/narration-transcript-audits/${contentSha256}.json`;
}

/** Parse only the canonical bytes we write to R2; whitespace rewrites are rejected. */
export function parseFinalMasterNarrationTranscriptAuditBytes(
  bytes: Uint8Array,
): FinalMasterNarrationTranscriptAudit {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new Error("final-master narration transcript audit is not valid JSON");
  }
  const audit = assertFinalMasterNarrationTranscriptAudit(decoded);
  if (!Buffer.from(bytes).equals(serializeFinalMasterNarrationTranscriptAudit(audit))) {
    throw new Error("final-master narration transcript audit is not canonical content-addressed JSON");
  }
  return audit;
}

export function finalMasterNarrationSemanticEvidenceFingerprint(
  value: FinalMasterNarrationSemanticEvidenceInput,
): string {
  return createHash("sha256")
    .update(`${FINAL_MASTER_NARRATION_SEMANTIC_EVIDENCE_VERSION}\n${canonicalJson(value)}`)
    .digest("hex");
}

/**
 * Seal a provider-free final-master audition receipt. Both transcript receipts
 * must independently pass their pinned lexical thresholds, and they must bind
 * the same approved spoken text. It intentionally makes no claim about the
 * meaning or quality of non-speech (for example diegetic) audio.
 */
export function sealFinalMasterNarrationSemanticEvidence(
  input: FinalMasterNarrationSemanticEvidenceInput,
): FinalMasterNarrationSemanticEvidence {
  const normalized = FinalMasterNarrationSemanticEvidenceSchema
    .omit({ receiptFingerprint: true })
    .parse(input);
  return assertFinalMasterNarrationSemanticEvidence({
    ...normalized,
    receiptFingerprint: finalMasterNarrationSemanticEvidenceFingerprint(normalized),
  });
}

export function assertFinalMasterNarrationSemanticEvidence(
  value: unknown,
): FinalMasterNarrationSemanticEvidence {
  const evidence = FinalMasterNarrationSemanticEvidenceSchema.parse(value);
  const { receiptFingerprint, ...unsigned } = evidence;
  const expectedFingerprint = finalMasterNarrationSemanticEvidenceFingerprint(unsigned);
  if (receiptFingerprint !== expectedFingerprint) {
    throw new Error("final-master narration semantic evidence fingerprint does not match its payload");
  }
  const expectedTranscript = evidence.narration.expectedTextSha256;
  const sourceTranscript = assertNarrationTranscriptProofSummary(evidence.sourceTranscript, {
    sourceSha256: evidence.narration.sourceSha256,
    expectedTextSha256: expectedTranscript,
  });
  const finalMasterTranscript = assertNarrationTranscriptProofSummary(evidence.finalMasterTranscript, {
    sourceSha256: evidence.finalMaster.sha256,
    expectedTextSha256: expectedTranscript,
  });
  if (!sourceTranscript.assessment.passed) {
    throw new Error("final-master narration semantic evidence source transcript did not pass fidelity thresholds");
  }
  if (!finalMasterTranscript.assessment.passed) {
    throw new Error("final-master narration semantic evidence final-master transcript did not pass fidelity thresholds");
  }
  if (sourceTranscript.expected.wordCount !== finalMasterTranscript.expected.wordCount) {
    throw new Error("final-master narration semantic evidence transcript word-count contracts differ");
  }
  if (evidence.narration.startSec + evidence.narration.durationSec > evidence.finalMaster.durationSec + 0.75) {
    throw new Error("final-master narration semantic evidence extends beyond the released master");
  }
  return evidence;
}

/**
 * Reconnect a compact receipt to its fetched R2 audit payload. The caller must
 * parse canonical bytes first, so the digest binds the exact persisted JSON,
 * not a summary selected after the fact.
 */
export function assertFinalMasterNarrationTranscriptAuditBinding(args: {
  evidence: FinalMasterNarrationSemanticEvidence;
  audit: FinalMasterNarrationTranscriptAudit;
}): void {
  const evidence = assertFinalMasterNarrationSemanticEvidence(args.evidence);
  const prepared = prepareFinalMasterNarrationTranscriptAudit(args.audit);
  if (evidence.auditArtifact.contentSha256 !== prepared.contentSha256) {
    throw new Error("final-master narration semantic evidence audit digest does not match its retained transcript object");
  }
  if (evidence.auditArtifact.byteLength !== prepared.bytes.byteLength) {
    throw new Error("final-master narration semantic evidence audit byte length does not match its retained transcript object");
  }
  if (
    evidence.finalMaster.sha256 !== prepared.audit.finalMaster.sha256
    || evidence.finalMaster.durationSec !== prepared.audit.finalMaster.durationSec
    || evidence.narration.sourceSha256 !== prepared.audit.narration.sourceSha256
    || evidence.narration.expectedTextSha256 !== prepared.audit.narration.expectedTextSha256
    || evidence.narration.startSec !== prepared.audit.narration.startSec
    || evidence.narration.durationSec !== prepared.audit.narration.durationSec
  ) {
    throw new Error("final-master narration semantic evidence does not match its retained transcript audit binding");
  }
  if (
    canonicalJson(evidence.sourceTranscript) !== canonicalJson(prepared.sourceTranscript)
    || canonicalJson(evidence.finalMasterTranscript) !== canonicalJson(prepared.finalMasterTranscript)
  ) {
    throw new Error("final-master narration semantic evidence summary does not match its retained transcript audit");
  }
}

export function proveNarrationTranscript(options: NarrationTranscriptProofOptions): NarrationTranscriptProof {
  const expectedText = options.expectedText.trim();
  if (!expectedText) throw unavailable("expected narration text is required");
  const sourceSha256 = options.sourceSha256;
  if (!Sha256Schema.safeParse(sourceSha256).success) throw unavailable("source SHA-256 is invalid");
  let sourceByteLength: number;
  try {
    sourceByteLength = statSync(options.audioPath).size;
  } catch (error) {
    throw unavailable(`cannot stat narration source (${error instanceof Error ? error.message : String(error)})`);
  }
  if (sourceByteLength <= 0) throw unavailable("narration source is empty");
  const tempDir = mkdtempSync(join(tmpdir(), "youtube-studio-narration-proof-"));
  const expectedTextPath = join(tempDir, "expected-narration.txt");
  const expectedTextSha256 = hashText(expectedText);
  try {
    writeFileSync(expectedTextPath, expectedText, "utf8");
    const invocation = buildNarrationTranscriptProofInvocation({
      audioPath: options.audioPath,
      expectedTextPath,
      sourceSha256,
      expectedTextSha256,
    });
    const result = (options.runner ?? runBakedNarrationTranscriptProof)(
      invocation.command,
      invocation.args,
      options.timeoutMs ?? 30 * 60 * 1000,
    );
    if (result.error || result.status !== 0) {
      const detail = result.stderr.trim().slice(-1200) || result.error?.message || `exit status ${String(result.status)}`;
      throw unavailable(`baked transcriber failed (${detail})`);
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(result.stdout);
    } catch {
      throw unavailable("baked transcriber did not emit a JSON receipt");
    }
    return assertNarrationTranscriptProof(decoded as NarrationTranscriptProof, {
      sourceSha256,
      sourceByteLength,
      expectedTextSha256,
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
