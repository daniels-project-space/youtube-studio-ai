import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, mkdtempSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { grabFrame } from "@/lib/ffmpeg";

export const ON_SCREEN_TEXT_PROOF_VERSION = "on-screen-text-proof/v1";
export const TESSERACT_BINARY = "tesseract";
export const TESSERACT_LANGUAGE = "eng";
export const TESSERACT_PAGE_SEGMENTATION_MODE = 6;

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const TimedOnScreenTextCueSchema = z.object({
  id: z.string().trim().min(1).max(120).regex(/^[a-z0-9][a-z0-9._-]*$/),
  sampleSec: z.number().finite().nonnegative(),
  expectedText: z.string().trim().min(3).max(4_000),
  minTokenCoverage: z.number().finite().min(0.5).max(1).default(0.8),
}).strict();

export type TimedOnScreenTextCue = z.infer<typeof TimedOnScreenTextCueSchema>;

const CueReceiptSchema = z.object({
  id: z.string().min(1),
  sampleSec: z.number().nonnegative(),
  expectedTextSha256: Sha256Schema,
  expectedTokenCount: z.number().int().positive(),
  recognizedText: z.string(),
  recognizedTokenCount: z.number().int().nonnegative(),
  tokenCoverage: z.number().min(0).max(1),
  minTokenCoverage: z.number().min(0.5).max(1),
  passed: z.boolean(),
}).strict();

export const OnScreenTextProofSchema = z.object({
  version: z.literal(ON_SCREEN_TEXT_PROOF_VERSION),
  engine: z.object({
    name: z.literal("tesseract"),
    version: z.string().regex(/^5\./),
    language: z.literal(TESSERACT_LANGUAGE),
    pageSegmentationMode: z.literal(TESSERACT_PAGE_SEGMENTATION_MODE),
  }).strict(),
  source: z.object({
    sha256: Sha256Schema,
    byteLength: z.number().int().positive(),
  }).strict(),
  cues: z.array(CueReceiptSchema).min(1),
  passed: z.boolean(),
}).strict();

export type OnScreenTextProof = z.infer<typeof OnScreenTextProofSchema>;

export interface OnScreenTextProcessResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export type OnScreenTextRunner = (
  command: string,
  args: readonly string[],
  timeoutMs: number,
) => OnScreenTextProcessResult;

export interface OnScreenTextProofOptions {
  videoPath: string;
  sourceSha256: string;
  cues: readonly TimedOnScreenTextCue[];
  frameExtractor?: (videoPath: string, sampleSec: number, outputPath: string) => Promise<string>;
  runner?: OnScreenTextRunner;
}

function unavailable(detail: string): Error {
  return new Error(`on-screen text proof unavailable: ${detail}`);
}

function normalizedTokens(value: string): string[] {
  return value.toLocaleLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?/gu) ?? [];
}

function tokenCoverage(expected: readonly string[], recognized: readonly string[]): number {
  const available = new Map<string, number>();
  for (const token of recognized) available.set(token, (available.get(token) ?? 0) + 1);
  let matched = 0;
  for (const token of expected) {
    const count = available.get(token) ?? 0;
    if (count > 0) {
      matched += 1;
      available.set(token, count - 1);
    }
  }
  return matched / expected.length;
}

function hashText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function runTesseract(command: string, args: readonly string[], timeoutMs: number): OnScreenTextProcessResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
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

function requireSuccessful(result: OnScreenTextProcessResult, label: string): string {
  if (result.error || result.status !== 0) {
    const detail = result.stderr.trim().slice(-800) || result.error?.message || `exit status ${String(result.status)}`;
    throw unavailable(`${label} failed (${detail})`);
  }
  return result.stdout;
}

function engineVersion(runner: OnScreenTextRunner): string {
  const output = requireSuccessful(runner(TESSERACT_BINARY, ["--version"], 30_000), "Tesseract version check");
  const version = output.match(/^tesseract\s+(\d+\.\d+(?:\.\d+)?)/im)?.[1];
  if (!version || !version.startsWith("5.")) {
    throw unavailable(`Tesseract 5.x is required (received ${version ?? "unknown"})`);
  }
  return version;
}

export async function sha256OnScreenTextSource(videoPath: string): Promise<string> {
  if (!videoPath.trim()) throw unavailable("videoPath is required");
  const hash = createHash("sha256");
  let byteLength = 0;
  try {
    for await (const chunk of createReadStream(videoPath)) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(bytes);
      byteLength += bytes.byteLength;
    }
  } catch (error) {
    throw unavailable(`cannot read final-master bytes (${error instanceof Error ? error.message : String(error)})`);
  }
  if (byteLength <= 0) throw unavailable("final master is empty");
  return hash.digest("hex");
}

/**
 * Independently verify that required words are readable from explicit frames of
 * the exact final master.  This is an OCR legibility proof, not a substitute
 * for visual composition review, and never silently downgrades when Tesseract
 * or frame extraction is absent.
 */
export async function proveOnScreenText(options: OnScreenTextProofOptions): Promise<OnScreenTextProof> {
  const parsedCues = z.array(TimedOnScreenTextCueSchema).min(1).safeParse(options.cues);
  if (!parsedCues.success) throw unavailable(`invalid timed text cues (${parsedCues.error.issues.map((issue) => issue.message).join("; ")})`);
  if (!Sha256Schema.safeParse(options.sourceSha256).success) throw unavailable("source SHA-256 is invalid");
  const actualSourceSha256 = await sha256OnScreenTextSource(options.videoPath);
  if (actualSourceSha256 !== options.sourceSha256) {
    throw unavailable("requested source SHA-256 does not match the final-master bytes");
  }
  let byteLength: number;
  try {
    byteLength = statSync(options.videoPath).size;
  } catch (error) {
    throw unavailable(`cannot stat final master (${error instanceof Error ? error.message : String(error)})`);
  }
  if (byteLength <= 0) throw unavailable("final master is empty");
  const cueIds = new Set<string>();
  for (const cue of parsedCues.data) {
    if (cueIds.has(cue.id)) throw unavailable(`duplicate text cue id ${cue.id}`);
    cueIds.add(cue.id);
    if (normalizedTokens(cue.expectedText).length < 2) {
      throw unavailable(`text cue ${cue.id} needs at least two readable tokens`);
    }
  }

  const runner = options.runner ?? runTesseract;
  const version = engineVersion(runner);
  const extractFrame = options.frameExtractor ?? grabFrame;
  const tempDir = mkdtempSync(join(tmpdir(), "youtube-studio-text-proof-"));
  try {
    const cues = [] as z.infer<typeof CueReceiptSchema>[];
    for (const [index, cue] of parsedCues.data.entries()) {
      const framePath = join(tempDir, `${String(index + 1).padStart(3, "0")}-${cue.id}.jpg`);
      await extractFrame(options.videoPath, cue.sampleSec, framePath);
      const recognizedText = requireSuccessful(
        runner(
          TESSERACT_BINARY,
          [framePath, "stdout", "-l", TESSERACT_LANGUAGE, "--oem", "1", "--psm", String(TESSERACT_PAGE_SEGMENTATION_MODE)],
          60_000,
        ),
        `Tesseract OCR for ${cue.id}`,
      ).trim();
      const expectedTokens = normalizedTokens(cue.expectedText);
      const recognizedTokens = normalizedTokens(recognizedText);
      const coverage = tokenCoverage(expectedTokens, recognizedTokens);
      cues.push({
        id: cue.id,
        sampleSec: cue.sampleSec,
        expectedTextSha256: hashText(cue.expectedText),
        expectedTokenCount: expectedTokens.length,
        recognizedText,
        recognizedTokenCount: recognizedTokens.length,
        tokenCoverage: coverage,
        minTokenCoverage: cue.minTokenCoverage,
        passed: coverage >= cue.minTokenCoverage,
      });
    }
    const proof = {
      version: ON_SCREEN_TEXT_PROOF_VERSION,
      engine: {
        name: "tesseract" as const,
        version,
        language: TESSERACT_LANGUAGE,
        pageSegmentationMode: TESSERACT_PAGE_SEGMENTATION_MODE,
      },
      source: { sha256: options.sourceSha256, byteLength },
      cues,
      passed: cues.every((cue) => cue.passed),
    };
    return OnScreenTextProofSchema.parse(proof);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
