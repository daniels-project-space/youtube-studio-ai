import { createHash } from "node:crypto";
import { createReadStream, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { z } from "zod";

export const NARRATION_TRANSCRIPT_PROOF_VERSION = "narration-transcript-proof/v1";
export const NARRATION_TRANSCRIPT_PROOF_SCRIPT = "scripts/narration_transcript_proof.py";
export const NARRATION_TRANSCRIPT_MODEL_ID = "Systran/faster-whisper-small.en";
export const NARRATION_TRANSCRIPT_MODEL_REVISION = "d1d751a5f8271d482d14ca55d9e2deeebbae577f";
export const FASTER_WHISPER_VERSION = "1.2.1";
export const NARRATION_TRANSCRIPT_MODEL_DIR = "/opt/youtube-studio-qa-narration-proof/model";
export const NARRATION_TRANSCRIPT_PROOF_PYTHON = "/opt/youtube-studio-qa-narration-proof/bin/python";

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
