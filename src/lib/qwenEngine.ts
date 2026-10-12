import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { canonicalJson } from "./canonicalJson";
import { executeStudioEngineAudio } from "./studioRenderEngineAudio";
import { StudioRenderEngineClient, STUDIO_ENGINE_PROJECT } from "./studioRenderEngineClient";
import { STUDIO_ENGINE_AUDIO_WORKFLOWS } from "./studioRenderEngineWorkflows";
import { EngineQwenReceiptSchema } from "../engine/qwenEngineReceipt";

const workflow = STUDIO_ENGINE_AUDIO_WORKFLOWS["qwen3-tts"];
const Usage = z.object({ gpuSeconds: z.number().nonnegative(), costUsd: z.number().nonnegative(), complete: z.boolean() });
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

export function engineQwenRequest(input: {
  text: string; speaker: string; language: string; instruction: string; seed: number; scope?: string;
}) {
  if (input.speaker !== "Ryan" || input.language !== "English") {
    throw new Error("Render Engine Qwen currently supports English/Ryan; refusing to replace the requested voice or language");
  }
  if (!input.text.trim() || input.text.length > 4000 || input.instruction.length > 1000 ||
    !Number.isSafeInteger(input.seed) || input.seed < 1 || input.seed > 0xffffffff) throw new Error("Unsupported Engine Qwen input bounds");
  const scope = input.scope ?? "studio-manual";
  if (!scope || scope.length > 200) throw new Error("Qwen request scope is invalid");
  const requestKey = hash(canonicalJson({ textSha256: hash(input.text), speaker: input.speaker, language: input.language,
    instructionSha256: hash(input.instruction), seed: input.seed, scope, profile: workflow.profileRevisionSha256 }));
  return { requestKey, request: { version: 1, idempotencyKey: `studio:qwen:${requestKey}`, sourceId: `studio-qwen-${requestKey}`,
    profileRevisionSha256: workflow.profileRevisionSha256, text: input.text, speaker: input.speaker, language: input.language,
    instruct: input.instruction, seed: input.seed, maxAudioSeconds: 120,
    output: { contentType: "audio/wav", sampleRateHz: 24000, channels: 1 } } };
}

/** Parse the actual bounded RIFF stream, not a duration supplied by a client. */
export function engineQwenWavDuration(value: Uint8Array): number {
  const bytes = Buffer.from(value);
  if (bytes.length < 44 || bytes.length > 36_000_000 || bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE" || bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error("Invalid Engine Qwen WAV");
  let format: { rate: number; channels: number; block: number; bits: number; code: number } | undefined;
  let dataBytes: number | undefined;
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw new Error("Truncated WAV chunk");
    const size = bytes.readUInt32LE(offset + 4), end = offset + 8 + size;
    if (end > bytes.length) throw new Error("Truncated WAV chunk");
    const tag = bytes.toString("ascii", offset, offset + 4);
    if (tag === "fmt ") {
      if (format || size < 16) throw new Error("Invalid WAV format chunk");
      format = { code: bytes.readUInt16LE(offset + 8), channels: bytes.readUInt16LE(offset + 10),
        rate: bytes.readUInt32LE(offset + 12), block: bytes.readUInt16LE(offset + 20), bits: bytes.readUInt16LE(offset + 22) };
    } else if (tag === "data") {
      if (dataBytes !== undefined) throw new Error("Duplicate WAV data chunk");
      dataBytes = size;
    }
    offset = end + size % 2;
  }
  if (!format || dataBytes === undefined || format.rate !== 24000 || format.channels !== 1 ||
    !((format.code === 1 && [16, 24, 32].includes(format.bits)) || (format.code === 3 && format.bits === 32)) ||
    format.block !== format.bits / 8 || dataBytes % format.block) throw new Error("Engine Qwen output differs from 24kHz mono PCM contract");
  const duration = dataBytes / format.block / format.rate;
  if (duration < 0.25 || duration > 120) throw new Error("Engine Qwen duration is out of bounds");
  return duration;
}

/** A seekable encode retains MP3 delay metadata; private scratch is always removed. */
export async function encodeEngineNarrationMp3(bytes: Uint8Array, format: "qwen" | "fish"): Promise<Uint8Array> {
  if (format !== "qwen" && format !== "fish") throw new Error("Unsupported narration compatibility format");
  const directory = await mkdtemp(join(tmpdir(), "studio-engine-qwen-"));
  const path = join(directory, "take.mp3");
  try {
  await new Promise<void>((resolve, reject) => {
    // The executable is supplied by the Trigger image, not a project asset.
    const child = spawn(/* turbopackIgnore: true */ process.env.FFMPEG_BIN ?? "ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", "pipe:0",
      "-ar", format === "fish" ? "44100" : "24000", "-ac", "1", "-c:a", "libmp3lame", "-b:a", format === "fish" ? "192k" : "160k", "-f", "mp3", path], { stdio: ["pipe", "ignore", "pipe"] });
    let failed = false;
    const timer = setTimeout(() => { failed = true; child.kill("SIGKILL"); }, 90_000);
    child.stderr.resume();
    child.stdin.on("error", () => { failed = true; });
    child.on("error", () => { failed = true; });
    child.on("close", code => {
      clearTimeout(timer);
      if (failed || code !== 0) reject(new Error("Engine narration compatibility encoding failed"));
      else resolve();
    });
    child.stdin.end(bytes);
  });
  const info = await stat(path);
  if (!info.isFile() || info.size < 1000 || info.size > 36_000_000) throw new Error("Encoded narration take exceeds bounds");
  return await readFile(path);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export function encodeEngineQwenMp3(bytes: Uint8Array): Promise<Uint8Array> { return encodeEngineNarrationMp3(bytes, "qwen"); }

export async function renderEngineQwen(input: {
  text: string; speaker: string; language: string; instruction: string; seed: number; maxCostUsd: number; scope?: string;
}, options: {
  client: StudioRenderEngineClient; authorize: () => Promise<void>;
  wait: (seconds: number, key: string) => Promise<void>;
}) {
  if (!Number.isFinite(input.maxCostUsd) || input.maxCostUsd <= 0) throw new Error("Qwen narration needs a finite stage budget");
  const { requestKey, request } = engineQwenRequest(input);
  const result = await executeStudioEngineAudio({ model: "qwen3-tts", workflowId: workflow.workflowId, request }, {
    ...options, onAccepted: async () => undefined,
  });
  let knownCostUsd: number | undefined;
  try {
  const status = await options.client.observeAudio({ jobId: result.jobId, state: "completed", manifestSha256: result.manifestSha256 }, "qwen3-tts", workflow.workflowId);
  if (status.status !== "completed" || status.outputRetired || !status.output || status.output.sha256 !== result.output.sha256) {
    throw new Error("Engine Qwen output is no longer a current completion");
  }
  const usage = Usage.parse(status.usage);
  knownCostUsd = usage.costUsd;
  if (!usage.complete || usage.costUsd > input.maxCostUsd) throw Object.assign(
    new Error("Engine Qwen output retained; usage requires reconciliation before narration can advance"),
    { engineJobId: result.jobId, requestKey, retryable: false, additionalObservedCostUsd: usage.costUsd });
  const durationSec = engineQwenWavDuration(result.bytes);
  const audio = await encodeEngineQwenMp3(result.bytes);
  await options.authorize();
  const finalStatus = await options.client.observeAudio({ jobId: result.jobId, state: "completed", manifestSha256: result.manifestSha256 }, "qwen3-tts", workflow.workflowId);
  if (finalStatus.status !== "completed" || finalStatus.outputRetired || !finalStatus.output ||
    finalStatus.output.sha256 !== result.output.sha256 || finalStatus.output.key !== result.output.key ||
    finalStatus.output.bytes !== result.output.bytes || finalStatus.output.bucket !== result.output.bucket ||
    finalStatus.output.verifiedAt !== result.output.verifiedAt || !Usage.parse(finalStatus.usage).complete ||
    Usage.parse(finalStatus.usage).costUsd !== usage.costUsd) throw new Error("Engine Qwen completion changed during encoding");
  const receipt = EngineQwenReceiptSchema.parse({ schema: "studio-engine-qwen-receipt/v1", requestKey, requestScope: input.scope ?? "studio-manual",
    model: "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice", revision: "0c0e3051f131929182e2c023b9537f8b1c68adfe",
    textSha256: hash(input.text), instructionSha256: hash(input.instruction), speaker: input.speaker, language: input.language,
    seed: input.seed, audioSha256: hash(audio), audioFormat: "mp3", sampleRateHz: 24000, durationSec,
    engine: { projectName: STUDIO_ENGINE_PROJECT, workflowId: workflow.workflowId, profileRevisionSha256: workflow.profileRevisionSha256,
      jobId: result.jobId, requestSha256: result.manifestSha256, nativeOutput: result.output,
      transformation: "ffmpeg-libmp3lame-160k-24khz-mono/v1" },
    runtime: { provider: "render-engine", accounting: "engine-reported-usage", ...usage },
  });
  return { audio, receipt };
  } catch (error) {
    if (error instanceof Error) Object.assign(error, { engineJobId: result.jobId, requestKey, retryable: false,
      ...(knownCostUsd === undefined ? {} : { additionalObservedCostUsd: knownCostUsd }) });
    throw error;
  }
}
