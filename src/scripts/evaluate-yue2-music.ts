import { constants } from "node:fs";
import { chmod, link, lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";
import { canonicalJson } from "@/lib/canonicalJson";
import { AcceptedMusicArrangementSchema } from "@/engine/acceptedMusicArrangement";
import {
  createYuE2EvaluationRequest, createYuE2AcceptedArrangementRequest, validateYuE2EvaluationRequest, verifyYuE2Audio, verifyYuE2Completion, yue2Sha256,
  YUE2_QUALIFICATION, YUE2_ARRANGEMENT_EVALUATION_VERSION, YuE2EvaluationClient, YuE2EvaluationError,
  type YuE2CompletedResult, type YuE2BoundEvaluationRequest,
} from "@/lib/yue2Evaluation";

const execute = promisify(execFile);
const MAX_JSON = 4 * 1024 * 1024;
const MAX_AUDIO = 256 * 1024 * 1024;

export async function readYuE2File(path: string, maximum: number): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maximum) throw new Error("Evaluation file is not a bounded regular file");
    const bytes = Buffer.alloc(stat.size + 1);
    let count = 0;
    while (count < bytes.length) {
      const { bytesRead } = await file.read(bytes, count, bytes.length - count, null);
      if (!bytesRead) break;
      count += bytesRead;
    }
    if (count !== stat.size) throw new Error("Evaluation file changed while reading");
    return bytes.subarray(0, count);
  } finally { await file.close(); }
}

function parseFileJson(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function immutable(path: string, bytes: Uint8Array): Promise<boolean> {
  const temporary = join(dirname(path), `.publish-${randomUUID()}`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.chmod(0o444);
  } finally { await handle.close(); }
  try {
    try { await link(temporary, path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const previous = await readYuE2File(path, Math.max(bytes.byteLength, 1));
      if (!previous.equals(Buffer.from(bytes))) throw new Error("Immutable YuE2 artifact conflict");
      return false;
    }
    await syncDirectory(dirname(path));
    return true;
  } finally { await unlink(temporary); }
}

function jsonBytes(value: unknown): Buffer { return Buffer.from(`${canonicalJson(value)}\n`); }

export async function probeYuE2NativeWav(path: string, result: YuE2CompletedResult, expectedBytes: number): Promise<void> {
  let stdout: string;
  try {
    ({ stdout } = await execute("ffprobe", [
      "-v", "error", "-show_entries",
      "stream=codec_type,codec_name,sample_fmt,sample_rate,channels,bits_per_sample,duration_ts,time_base:format=format_name,size",
      "-of", "json", path,
    ], { timeout: 30000, maxBuffer: 65536, encoding: "utf8" }));
  } catch { throw new Error("Native WAV inspection failed; candidate remains unqualified"); }
  const parsed = z.object({
    streams: z.array(z.object({
      codec_type: z.literal("audio"), codec_name: z.literal("pcm_f32le"), sample_fmt: z.literal("flt"),
      sample_rate: z.literal("48000"), channels: z.literal(2), bits_per_sample: z.literal(32),
      duration_ts: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), time_base: z.literal("1/48000"),
    })).length(1),
    format: z.object({ format_name: z.literal("wav"), size: z.string().regex(/^\d+$/u) }),
  }).parse(JSON.parse(stdout));
  if (parsed.streams[0].duration_ts !== result.frames || Number(parsed.format.size) !== expectedBytes) {
    throw new Error("Native WAV frame count or container length disagrees with receipt");
  }
}

const CandidateSchema = z.object({
  version: z.literal("studio-yue2-candidate/v1"), jobId: z.string(), programFingerprint: z.string(),
  requestSha256: z.string(), provenanceSha256: z.string(), audioSha256: z.string(), audioBytes: z.number().int(),
  nativeFormatVerified: z.literal(true), qualified: z.literal(false), productionApproved: z.literal(false),
  manualAudition: z.literal("pending"), costStatus: z.literal("not_measured"), qualification: z.unknown(),
  acceptedArrangement: AcceptedMusicArrangementSchema.optional(),
}).strict();

export async function reuseYuE2Candidate(directory: string, request: YuE2BoundEvaluationRequest): Promise<boolean> {
  request = validateYuE2EvaluationRequest(request);
  const path = join(directory, "candidate.json");
  if (!await exists(path)) return false;
  const candidate = CandidateSchema.parse(parseFileJson(await readYuE2File(path, MAX_JSON)));
  const input = await readYuE2File(join(directory, "request.json"), MAX_JSON);
  const provenance = await readYuE2File(join(directory, "provenance.json"), MAX_JSON);
  const audioPath = join(directory, "audio-native.wav");
  const audio = await readYuE2File(audioPath, MAX_AUDIO);
  const saved = z.object({ version: z.literal("studio-yue2-provenance/v1"), request: z.unknown(), statusResponse: z.unknown() }).strict().parse(parseFileJson(provenance));
  const acceptedArrangement = request.version === YUE2_ARRANGEMENT_EVALUATION_VERSION ? request.acceptedArrangement : undefined;
  if (canonicalJson(candidate.acceptedArrangement ?? null) !== canonicalJson(acceptedArrangement ?? null)) {
    throw new Error("Cached YuE2 candidate accepted arrangement mismatch");
  }
  if (canonicalJson(saved.request) !== canonicalJson(request) || !input.equals(jsonBytes(request)) ||
      candidate.jobId !== request.job.job_id || candidate.programFingerprint !== request.programFingerprint ||
      candidate.requestSha256 !== yue2Sha256(input) || candidate.provenanceSha256 !== yue2Sha256(provenance) ||
      candidate.audioSha256 !== yue2Sha256(audio) || candidate.audioBytes !== audio.length ||
      canonicalJson(candidate.qualification) !== canonicalJson(YUE2_QUALIFICATION)) throw new Error("Cached YuE2 candidate integrity failure");
  const completion = verifyYuE2Completion(request, saved.statusResponse);
  verifyYuE2Audio(completion, audio);
  await probeYuE2NativeWav(audioPath, completion.result, audio.length);
  return true;
}

async function candidateDirectory(root: string, id: string): Promise<string> {
  const absoluteRoot = resolve(root);
  await mkdir(absoluteRoot, { recursive: true, mode: 0o700 });
  if (await realpath(absoluteRoot) !== absoluteRoot) throw new Error("Evaluation output root must not contain symlinks");
  const directory = join(absoluteRoot, id);
  await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe evaluation output directory");
  return directory;
}

export async function executeYuE2Evaluation(input: {
  request: YuE2BoundEvaluationRequest; outputRoot: string; endpoint: string; bearerToken: string;
  recoverOnly?: boolean;
}): Promise<{ status: "completed" | "pending"; directory: string; reused: boolean }> {
  input = { ...input, request: validateYuE2EvaluationRequest(input.request) };
  const directory = await candidateDirectory(input.outputRoot, input.request.job.job_id);
  await immutable(join(directory, "request.json"), jsonBytes(input.request));
  if (await reuseYuE2Candidate(directory, input.request)) return { status: "completed", directory, reused: true };
  const marker = join(directory, "submission-attempt.json");
  const client = new YuE2EvaluationClient({ endpoint: input.endpoint, bearerToken: input.bearerToken });
  const result = await client.evaluate(input.request, {
    submit: true, recoverOnly: input.recoverOnly || await exists(marker),
    beforeSubmit: () => immutable(marker, jsonBytes({ version: 1, request: input.request, recovery: "same_job_get_only" })),
  });
  if (result.status === "pending") return { status: "pending", directory, reused: false };
  // Publish the native file first, then verify its real container before sealing a candidate.
  const audioPath = join(directory, "audio-native.wav");
  await immutable(audioPath, result.audio);
  await probeYuE2NativeWav(audioPath, result.completion.result, result.audio.length);
  const provenance = jsonBytes({ version: "studio-yue2-provenance/v1", request: input.request, statusResponse: result.completion.statusResponse });
  await immutable(join(directory, "provenance.json"), provenance);
  const candidate = CandidateSchema.parse({
    version: "studio-yue2-candidate/v1", jobId: input.request.job.job_id, programFingerprint: input.request.programFingerprint,
    requestSha256: yue2Sha256(jsonBytes(input.request)), provenanceSha256: yue2Sha256(provenance),
    audioSha256: result.completion.audio.sha256, audioBytes: result.audio.length,
    nativeFormatVerified: true, qualified: false, productionApproved: false, manualAudition: "pending",
    costStatus: "not_measured", qualification: YUE2_QUALIFICATION,
    ...(input.request.version === YUE2_ARRANGEMENT_EVALUATION_VERSION ? { acceptedArrangement: input.request.acceptedArrangement } : {}),
  });
  await immutable(join(directory, "candidate.json"), jsonBytes(candidate));
  await chmod(directory, 0o700);
  return { status: "completed", directory, reused: false };
}

export async function runYuE2EvaluationCli(argv: string[], environment: Readonly<Record<string, string | undefined>> = process.env): Promise<void> {
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index] === "--style" ? "--style-file" : argv[index];
    if (["--submit", "--personal-creator", "--recover-only", "--help"].includes(key)) {
      if (flags.has(key)) throw new Error("Duplicate evaluation argument");
      flags.add(key);
    } else if (["--arrangement", "--program", "--style-file", "--seed", "--out"].includes(key)) {
      if (values[key] !== undefined || !argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error("Invalid evaluation argument");
      values[key] = argv[++index];
    } else { throw new Error("Unknown evaluation argument"); }
  }
  if (flags.has("--help")) {
    console.log("Usage: tsx src/scripts/evaluate-yue2-music.ts (--arrangement ARRANGEMENT.json | --program PROGRAM.json --style-file STYLE.txt) --seed INTEGER --personal-creator [--out DIRECTORY] [--submit [--recover-only]]\n--style is an alias for --style-file. Arrangement mode forbids an independent program or style. Default: local validation only. --submit uses YUE2_EVALUATION_URL and YUE2_EVALUATION_TOKEN. Every result remains unqualified; manual audition pending.");
    return;
  }
  const arrangementMode = values["--arrangement"] !== undefined;
  if (arrangementMode && (values["--program"] !== undefined || values["--style-file"] !== undefined)) {
    throw new Error("--arrangement is mutually exclusive with --program and independent style files");
  }
  if ((!arrangementMode && (!values["--program"] || !values["--style-file"])) || !/^\d+$/u.test(values["--seed"] ?? "") || !flags.has("--personal-creator")) {
    throw new Error("Explicit arrangement or program/style files, seed and --personal-creator acknowledgement are required");
  }
  if (flags.has("--recover-only") && !flags.has("--submit")) throw new Error("--recover-only requires explicit --submit to enable network access");
  const request = arrangementMode
    ? createYuE2AcceptedArrangementRequest({
        arrangement: parseFileJson(await readYuE2File(resolve(values["--arrangement"]), 256 * 1024)),
        seed: Number(values["--seed"]), personalCreatorAcknowledged: true,
      })
    : createYuE2EvaluationRequest({
        program: parseFileJson(await readYuE2File(resolve(values["--program"]), 256 * 1024)),
        style: new TextDecoder("utf-8", { fatal: true }).decode(await readYuE2File(resolve(values["--style-file"]), 32000)),
        seed: Number(values["--seed"]), personalCreatorAcknowledged: true,
      });
  if (!flags.has("--submit")) {
    console.log(JSON.stringify({ mode: "validate_only", request, networkRequests: 0, qualification: YUE2_QUALIFICATION, manualAudition: "pending" }, null, 2));
    return;
  }
  const endpoint = environment.YUE2_EVALUATION_URL;
  const bearerToken = environment.YUE2_EVALUATION_TOKEN;
  if (!endpoint || !bearerToken) throw new Error("YUE2_EVALUATION_URL and YUE2_EVALUATION_TOKEN are required for --submit");
  const result = await executeYuE2Evaluation({ request, endpoint, bearerToken,
    outputRoot: values["--out"] ?? "output/yue2-evaluation", recoverOnly: flags.has("--recover-only") });
  console.log(JSON.stringify({ ...result, jobId: request.job.job_id, qualified: false, manualAudition: "pending", costStatus: "not_measured" }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void runYuE2EvaluationCli(process.argv.slice(2)).catch((error: unknown) => {
    // Validation and subprocess errors may include user content; keep CLI failures generic.
    console.error(error instanceof YuE2EvaluationError ? error.message : "YuE2 evaluation refused or failed validation; retained artifacts require review; no automatic retry.");
    process.exitCode = 1;
  });
}
