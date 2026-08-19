/**
 * Pinned PySceneDetect evidence adapter.
 *
 * This is deliberately a standalone analysis module. It records a reproducible
 * scene-boundary receipt for a final master, but no render or publishing gate
 * consumes it yet. Wiring a future policy consumer is a separate decision.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { z } from "zod";

export const SHOT_ANALYSIS_SCHEMA_VERSION = "1.0.0";
export const PYSCENEDETECT_HEADLESS_VERSION = "0.7.1";
export const OPENCV_PYTHON_HEADLESS_VERSION = "4.12.0.88";
export const SHOT_ANALYSIS_SCRIPT = "scripts/shot_analysis.py";
// Do not rely on PATH: the worker also carries an isolated narration-proof
// venv. Calling the exact interpreter keeps both QA proofs available.
export const SHOT_ANALYSIS_PYTHON = "/opt/youtube-studio-qa-scene-analysis/bin/python";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, "must be a lowercase SHA-256 hex digest");

export const ShotAnalysisConfigSchema = z.object({
  adaptiveThreshold: z.number().finite().positive(),
  minSceneLenFrames: z.number().int().positive(),
  windowWidth: z.number().int().positive(),
  minContentVal: z.number().finite().positive(),
}).strict();
export type ShotAnalysisConfig = z.infer<typeof ShotAnalysisConfigSchema>;

/** Adaptive detection reduces false cuts when motion or lighting varies within a shot. */
export const DEFAULT_SHOT_ANALYSIS_CONFIG: ShotAnalysisConfig = {
  adaptiveThreshold: 3.0,
  minSceneLenFrames: 15,
  windowWidth: 2,
  minContentVal: 15.0,
};

export const ShotAnalysisSceneSchema = z.object({
  startFrame: z.number().int().nonnegative(),
  endFrameExclusive: z.number().int().positive(),
  startSec: z.number().finite().nonnegative(),
  endSecExclusive: z.number().finite().positive(),
}).strict().superRefine((scene, context) => {
  if (scene.endFrameExclusive <= scene.startFrame) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "scene end frame must be after its start frame" });
  }
  if (scene.endSecExclusive <= scene.startSec) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "scene end time must be after its start time" });
  }
});
export type ShotAnalysisScene = z.infer<typeof ShotAnalysisSceneSchema>;

export const ShotAnalysisReceiptSchema = z.object({
  schemaVersion: z.literal(SHOT_ANALYSIS_SCHEMA_VERSION),
  provider: z.literal("pyscenedetect"),
  detector: z.literal("adaptive"),
  versions: z.object({
    scenedetectHeadless: z.literal(PYSCENEDETECT_HEADLESS_VERSION),
    opencvPythonHeadless: z.literal(OPENCV_PYTHON_HEADLESS_VERSION),
  }).strict(),
  config: ShotAnalysisConfigSchema,
  source: z.object({
    sha256: Sha256Schema,
    byteLength: z.number().int().positive(),
  }).strict(),
  scenes: z.array(ShotAnalysisSceneSchema),
}).strict().superRefine((receipt, context) => {
  for (let index = 1; index < receipt.scenes.length; index += 1) {
    const previous = receipt.scenes[index - 1]!;
    const current = receipt.scenes[index]!;
    if (current.startFrame < previous.endFrameExclusive || current.startSec < previous.endSecExclusive) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scenes", index],
        message: "scene list must be chronological and non-overlapping",
      });
    }
  }
});
export type ShotAnalysisReceipt = z.infer<typeof ShotAnalysisReceiptSchema>;

export interface ShotAnalysisInvocation {
  command: typeof SHOT_ANALYSIS_PYTHON;
  args: string[];
  config: ShotAnalysisConfig;
}

export interface ShotAnalysisOptions {
  videoPath: string;
  /** Canonical SHA-256 of the exact final-master bytes expected by the caller. */
  sourceSha256: string;
  config?: Partial<ShotAnalysisConfig>;
  runner?: ShotAnalysisRunner;
  timeoutMs?: number;
}

export interface ShotAnalysisProcessResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

/**
 * Hash the exact local final-master bytes before asking the baked detector to
 * decode them. This keeps the detector receipt tied to the same master final
 * QA is inspecting, without buffering a long video in memory.
 */
export async function sha256ShotAnalysisSource(videoPath: string): Promise<string> {
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
  if (byteLength <= 0) throw unavailable("final-master byte length is zero");
  return hash.digest("hex");
}

/** Narrow test seam; production always executes the baked Python script directly. */
export type ShotAnalysisRunner = (
  command: string,
  args: readonly string[],
  timeoutMs: number,
) => ShotAnalysisProcessResult;

function unavailable(detail: string): Error {
  return new Error(
    `shot analysis unavailable: ${detail}. The pinned build-image runtime did not complete; runtime pip fallback is forbidden.`,
  );
}

function normaliseConfig(config: Partial<ShotAnalysisConfig> | undefined): ShotAnalysisConfig {
  const parsed = ShotAnalysisConfigSchema.safeParse({ ...DEFAULT_SHOT_ANALYSIS_CONFIG, ...config });
  if (!parsed.success) {
    throw unavailable(`invalid adaptive-detector configuration (${parsed.error.issues.map((issue) => issue.message).join("; ")})`);
  }
  return parsed.data;
}

function sourceHash(value: string): string {
  const parsed = Sha256Schema.safeParse(value);
  if (!parsed.success) throw unavailable("sourceSha256 must be a lowercase SHA-256 digest");
  return parsed.data;
}

export function buildShotAnalysisInvocation(options: Pick<ShotAnalysisOptions, "videoPath" | "sourceSha256" | "config">): ShotAnalysisInvocation {
  if (!options.videoPath.trim()) throw unavailable("videoPath is required");
  const config = normaliseConfig(options.config);
  const expectedHash = sourceHash(options.sourceSha256);
  return {
    command: SHOT_ANALYSIS_PYTHON,
    args: [
      SHOT_ANALYSIS_SCRIPT,
      "--input", options.videoPath,
      "--source-sha256", expectedHash,
      "--adaptive-threshold", String(config.adaptiveThreshold),
      "--min-scene-len-frames", String(config.minSceneLenFrames),
      "--window-width", String(config.windowWidth),
      "--min-content-val", String(config.minContentVal),
    ],
    config,
  };
}

function runBakedSceneAnalyzer(command: string, args: readonly string[], timeoutMs: number): ShotAnalysisProcessResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
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

/**
 * Runs only the Python executable baked into the Trigger base image. Any
 * missing command, wrong version, invalid receipt, or source mismatch fails
 * closed; this module never installs dependencies at task time.
 */
export function analyzeShotBoundaries(options: ShotAnalysisOptions): ShotAnalysisReceipt {
  const invocation = buildShotAnalysisInvocation(options);
  const timeoutMs = options.timeoutMs ?? 20 * 60 * 1000;
  const runner = options.runner ?? runBakedSceneAnalyzer;
  const result = runner(invocation.command, invocation.args, timeoutMs);
  if (result.error || result.status !== 0) {
    const detail = result.stderr.trim().slice(-1200) || result.error?.message || `exit status ${String(result.status)}`;
    throw unavailable(`baked analyzer failed (${detail})`);
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(result.stdout);
  } catch {
    throw unavailable("baked analyzer did not emit a JSON receipt");
  }
  const parsed = ShotAnalysisReceiptSchema.safeParse(decoded);
  if (!parsed.success) {
    throw unavailable(`baked analyzer emitted an invalid receipt (${parsed.error.issues.map((issue) => issue.message).join("; ")})`);
  }
  const receipt = parsed.data;
  const expectedHash = sourceHash(options.sourceSha256);
  if (receipt.source.sha256 !== expectedHash) {
    throw unavailable("receipt source SHA-256 does not match the requested final master");
  }
  if (JSON.stringify(receipt.config) !== JSON.stringify(invocation.config)) {
    throw unavailable("receipt detector configuration does not match the requested analysis configuration");
  }
  return receipt;
}
