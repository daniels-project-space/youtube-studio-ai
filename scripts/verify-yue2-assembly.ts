import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { composeMusicLoopDeblur } from "../src/lib/ffmpeg";
import { selfLoopAudio } from "../src/lib/music";
import { validateYuE2EvaluationRequest } from "../src/lib/yue2Evaluation";

async function fileHash(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function main() {
  const { values } = parseArgs({ options: {
    material: { type: "string" }, audio: { type: "string" }, out: { type: "string" }, duration: { type: "string" },
    width: { type: "string", default: "320" }, height: { type: "string", default: "176" },
  }, strict: true, allowPositionals: false });
  if (!values.material || !values.audio || !values.out || !values.duration) throw new Error("--material --audio --out --duration required");
  const duration = Number(values.duration);
  const width = Number(values.width), height = Number(values.height);
  assert.ok(Number.isInteger(width) && width >= 320 && width <= 3840 && width % 2 === 0);
  assert.ok(Number.isInteger(height) && height >= 176 && height <= 2160 && height % 2 === 0);
  assert.ok(Number.isInteger(duration) && duration >= 10 && duration <= 28800);
  const material = JSON.parse(await readFile(values.material, "utf8"));
  const request = validateYuE2EvaluationRequest(material.request);
  assert.equal(request.job.job_id, material.candidate.jobId);
  const source = await readFile(values.audio);
  const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  const sourceSha256 = hash(source);
  assert.equal(sourceSha256, material.candidate.headroom?.audioSha256 ?? material.candidate.audioSha256);
  const directory = resolve(values.out);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "attempt.json"), JSON.stringify({ sourceSha256, duration, width, height,
    jobId: request.job.job_id, productionApproved: false, visualSource: "synthetic_timing_fixture" }), { flag: "wx" });
  const ffmpeg = process.env.FFMPEG_BIN ?? "ffmpeg";
  const ffprobe = process.env.FFPROBE_BIN ?? "ffprobe";
  const inspect = (path: string) => JSON.parse(execFileSync(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", path], { encoding: "utf8" }));
  const original = inspect(values.audio).streams[0];
  assert.equal(original.sample_rate, "48000"); assert.equal(original.channels, 2); assert.equal(original.codec_name, "pcm_f32le");
  const folded = join(directory, "loop.wav");
  await selfLoopAudio(values.audio, folded, { outputFormat: "native_float_wav" });
  const loop = inspect(folded).streams[0];
  assert.equal(loop.sample_rate, "48000"); assert.equal(loop.channels, 2); assert.equal(loop.codec_name, "pcm_f32le");
  assert.equal(Number(loop.duration_ts), Number(original.duration_ts) - 96000);
  const video = join(directory, "timing-source.mp4");
  execFileSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=320x176:r=30:d=1",
    "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", video]);
  const master = join(directory, "timing-master.mp4");
  const start = Date.now();
  await composeMusicLoopDeblur({ loopUnitPath: video, musicPath: folded, outPath: master,
    durationSec: duration, width, height, fps: 30, timeoutMs: 900000 });
  const output = inspect(master);
  const picture = output.streams.find((stream: { codec_type: string }) => stream.codec_type === "video");
  const sound = output.streams.find((stream: { codec_type: string }) => stream.codec_type === "audio");
  await writeFile(join(directory, "inspection.json"), JSON.stringify(output, null, 2) + "\n", { flag: "wx" });
  assert.equal(picture.width, width); assert.equal(picture.height, height);
  assert.equal(Number(picture.nb_frames), duration * 30);
  assert.equal(Number(picture.duration), duration);
  assert.equal(Number(sound.duration), duration);
  assert.equal(Number(sound.sample_rate), 48000); assert.equal(sound.channels, 2);
  assert.equal(Number(output.format.duration), duration);
  assert.equal(hash(await readFile(values.audio)), sourceSha256, "retained listening source must remain unchanged");
  const evidence = { version: "yue2-assembly-timing-proof/v1", sourceSha256, jobId: request.job.job_id,
    sourceFrames: Number(original.duration_ts), loopFrames: Number(loop.duration_ts), durationSec: duration,
    videoFrames: Number(picture.nb_frames), width, height, sampleRateHz: 48000, assemblyWallMs: Date.now() - start,
    masterSha256: await fileHash(master), masterPath: master,
    visualSource: "synthetic_timing_fixture", productionApproved: false, musicalQualityApproved: false,
    loopPerceptualQualityApproved: false };
  await writeFile(join(directory, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(evidence));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
