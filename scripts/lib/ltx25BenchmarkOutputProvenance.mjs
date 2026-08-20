import crypto from "node:crypto";
import { spawn } from "node:child_process";

const SHA256 = /^[a-f0-9]{64}$/;

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  return value;
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function positiveNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
  const rounded = Number(parsed.toFixed(6));
  if (rounded <= 0) throw new Error(`${label} is too small to record safely`);
  return rounded;
}

function frameRate(value) {
  const match = typeof value === "string" && /^(\d+)\/(\d+)$/.exec(value);
  if (!match || Number(match[2]) === 0) {
    throw new Error("ffprobe video frame rate is invalid");
  }
  return positiveNumber(Number(match[1]) / Number(match[2]), "ffprobe video frame rate");
}

function frameCount(stream) {
  const count = stream?.nb_read_frames && stream.nb_read_frames !== "N/A"
    ? stream.nb_read_frames
    : stream?.nb_frames;
  return positiveInteger(count, "ffprobe video frame count");
}

/**
 * Normalize only facts recovered by ffprobe.  The controller never imports
 * this from a worker completion receipt, so a sealed report independently
 * identifies the exact media it downloaded from R2.
 */
export function mediaFactsFromFfprobe(raw) {
  const payload = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!payload || typeof payload !== "object") {
    throw new Error("ffprobe returned no media payload");
  }
  const streams = Array.isArray(payload.streams) ? payload.streams : [];
  const video = streams.find((stream) => stream?.codec_type === "video");
  if (!video) throw new Error("ffprobe did not find a video stream");
  const audioStreams = streams.filter((stream) => stream?.codec_type === "audio");
  if (audioStreams.length !== 1) {
    throw new Error("ffprobe did not find exactly one audio stream");
  }
  const audio = audioStreams[0];

  return {
    container: requiredString(payload.format?.format_name, "ffprobe container"),
    durationSeconds: positiveNumber(payload.format?.duration, "ffprobe duration"),
    video: {
      codec: requiredString(video.codec_name, "ffprobe video codec"),
      pixelFormat: requiredString(video.pix_fmt, "ffprobe pixel format"),
      width: positiveInteger(video.width, "ffprobe video width"),
      height: positiveInteger(video.height, "ffprobe video height"),
      frameRate: frameRate(video.avg_frame_rate || video.r_frame_rate),
      frameCount: frameCount(video),
    },
    audio: {
      present: true,
      codec: requiredString(audio.codec_name, "ffprobe audio codec"),
      channels: positiveInteger(audio.channels, "ffprobe audio channels"),
      sampleRate: positiveInteger(audio.sample_rate, "ffprobe audio sample rate"),
    },
  };
}

async function runFfprobe(bytes) {
  return await new Promise((resolve, reject) => {
    const child = spawn("ffprobe", [
      "-v", "error",
      "-count_frames",
      "-show_entries", "format=format_name,duration:stream=codec_type,codec_name,pix_fmt,width,height,channels,sample_rate,avg_frame_rate,r_frame_rate,nb_read_frames,nb_frames",
      "-of", "json",
      "-i", "pipe:0",
    ], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    child.once("error", (error) => finish(reject, new Error(`ffprobe could not start: ${error.message}`)));
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdin.once("error", (error) => finish(reject, new Error(`ffprobe input failed: ${error.message}`)));
    child.once("close", (code, signal) => {
      if (code !== 0) {
        finish(reject, new Error(`ffprobe failed (${signal || code}): ${stderr.trim().slice(0, 500) || "no diagnostics"}`));
        return;
      }
      finish(resolve, stdout);
    });
    child.stdin.end(bytes);
  });
}

/** Run an independent controller-side ffprobe over the exact downloaded bytes. */
export async function probeLtx25BenchmarkMediaFacts(bytes) {
  return mediaFactsFromFfprobe(await runFfprobe(bytes));
}

/**
 * Construct the content-addressed binding retained in the signed terminal
 * report. `probeMediaFacts` is injected in tests so this has no provider,
 * filesystem, or GPU dependency.
 */
export async function createLtx25BenchmarkOutputBinding({ bytes, probeMediaFacts = probeLtx25BenchmarkMediaFacts }) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1) {
    throw new Error("benchmark output bytes are required for controller provenance");
  }
  const binding = {
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.byteLength,
    media: await probeMediaFacts(bytes),
  };
  assertLtx25BenchmarkOutputBinding(binding);
  return binding;
}

/** Fail closed unless a terminal report carries a complete controller binding. */
export function assertLtx25BenchmarkOutputBinding(binding) {
  if (!binding || typeof binding !== "object" || !SHA256.test(binding.sha256 || "")) {
    throw new Error("controller output proof requires a SHA-256");
  }
  positiveInteger(binding.sizeBytes, "controller output proof sizeBytes");
  const media = binding.media;
  if (!media || typeof media !== "object") throw new Error("controller output proof requires media facts");
  requiredString(media.container, "controller media container");
  positiveNumber(media.durationSeconds, "controller media durationSeconds");
  const video = media.video;
  if (!video || typeof video !== "object") throw new Error("controller media facts require a video stream");
  requiredString(video.codec, "controller media video codec");
  requiredString(video.pixelFormat, "controller media pixel format");
  positiveInteger(video.width, "controller media video width");
  positiveInteger(video.height, "controller media video height");
  positiveNumber(video.frameRate, "controller media video frameRate");
  positiveInteger(video.frameCount, "controller media video frameCount");
  const audio = media.audio;
  if (!audio || typeof audio !== "object" || audio.present !== true) {
    throw new Error("controller media facts require an audio stream");
  }
  requiredString(audio.codec, "controller media audio codec");
  positiveInteger(audio.channels, "controller media audio channels");
  positiveInteger(audio.sampleRate, "controller media audio sampleRate");
}

/** Compare independently probed facts with the worker's sealed render proof. */
export function assertLtx25ControllerMediaMatchesWorkerProof(binding, workerProof) {
  assertLtx25BenchmarkOutputBinding(binding);
  const media = binding.media.video;
  if (!workerProof || typeof workerProof !== "object"
    || media.width !== workerProof.outputWidth
    || media.height !== workerProof.outputHeight
    || media.frameRate !== workerProof.frameRate
    || media.frameCount !== workerProof.frameCount
    || binding.media.audio.present !== workerProof.hasAudio) {
    throw new Error("controller media probe does not match the sealed LTX output proof");
  }
}
