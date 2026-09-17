/**
 * Deterministic full-duration validator for the local chess replay proof.
 *
 * This is intentionally an evidence tool, not a production release gate: the
 * proof renders are visual-only and contain synthetic timing. It still uses
 * the same fail-closed media checks that a production route needs before a
 * native scene can be trusted.
 */
import { execFile } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { join, resolve } from "node:path";

const execFileAsync = promisify(execFile);

type ProofReceipt = {
  videoPath: string;
  videoSha256: string;
  manifest: {
    durationSec: number;
    scenes: Array<{ id: string; t0: number; t1: number }>;
  };
};

type Probe = {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  frames: number;
};

type RenderValidation = {
  name: string;
  videoPath: string;
  manifestDurationSec: number;
  measuredDurationSec: number;
  durationDeltaSec: number;
  width: number;
  height: number;
  fps: number;
  frames: number;
  expectedFrames: number;
  sampledFrames: number;
  uniqueSampledFrames: number;
  blackIntervals: Array<{ startSec: number; endSec: number; durationSec: number }>;
  sceneCoverage: { contiguous: boolean; startsAtZero: boolean; endsAtManifest: boolean };
  defects: string[];
};

async function probeVideo(videoPath: string): Promise<Probe> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_type,width,height,avg_frame_rate,nb_frames",
    "-of", "json",
    videoPath,
  ]);
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<Record<string, string | undefined>>;
  };
  const video = parsed.streams?.find((stream) => stream.codec_type === "video");
  if (!video) throw new Error(`no video stream in ${videoPath}`);
  const durationSec = Number(parsed.format?.duration);
  const width = Number(video.width);
  const height = Number(video.height);
  const [num, den] = String(video.avg_frame_rate ?? "0/1").split("/").map(Number);
  const fps = den > 0 ? num / den : 0;
  let frames = Number(video.nb_frames ?? 0);
  if (!Number.isSafeInteger(frames) || frames <= 0) {
    const { stdout: count } = await execFileAsync("ffprobe", [
      "-v", "error", "-select_streams", "v:0", "-count_packets",
      "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", videoPath,
    ]);
    frames = Number(count.trim());
  }
  if (![durationSec, width, height, fps, frames].every(Number.isFinite) || frames <= 0) {
    throw new Error(`incomplete ffprobe evidence in ${videoPath}`);
  }
  return { durationSec, width, height, fps, frames };
}

async function sampledFrameHashes(videoPath: string): Promise<string[]> {
  const { stdout } = await execFileAsync("ffmpeg", [
    "-v", "error", "-i", videoPath, "-map", "0:v:0",
    "-vf", "fps=4,scale=320:-2,format=gray", "-f", "framemd5", "-",
  ], { maxBuffer: 8 * 1024 * 1024 });
  return stdout
    .split("\n")
    .map((line) => /,\s*([a-f0-9]{32})\s*$/i.exec(line)?.[1]?.toLowerCase())
    .filter((hash): hash is string => Boolean(hash));
}

async function blackIntervals(videoPath: string): Promise<Array<{ startSec: number; endSec: number; durationSec: number }>> {
  const { stderr } = await execFileAsync("ffmpeg", [
    "-v", "error", "-i", videoPath, "-map", "0:v:0",
    "-vf", "fps=4,blackdetect=d=0.35:pix_th=0.02", "-an", "-f", "null", "-",
  ], { maxBuffer: 8 * 1024 * 1024 });
  return [...stderr.matchAll(/black_start:([\d.]+).*?black_end:([\d.]+).*?black_duration:([\d.]+)/g)]
    .map((match) => ({ startSec: Number(match[1]), endSec: Number(match[2]), durationSec: Number(match[3]) }));
}

function sceneCoverage(scenes: ProofReceipt["manifest"]["scenes"], durationSec: number) {
  const epsilon = 0.05;
  const ordered = [...scenes].sort((a, b) => a.t0 - b.t0);
  return {
    contiguous: ordered.every((scene, index) => index === 0 || Math.abs(scene.t0 - ordered[index - 1]!.t1) <= epsilon),
    startsAtZero: ordered.length > 0 && Math.abs(ordered[0]!.t0) <= epsilon,
    endsAtManifest: ordered.length > 0 && Math.abs(ordered.at(-1)!.t1 - durationSec) <= epsilon,
  };
}

async function validateReceipt(receiptPath: string): Promise<RenderValidation> {
  const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as ProofReceipt;
  const videoPath = resolve(receipt.videoPath);
  const name = receiptPath.split("/").at(-1)!.replace(/\.json$/u, "");
  const probe = await probeVideo(videoPath);
  const hashes = await sampledFrameHashes(videoPath);
  const blacks = await blackIntervals(videoPath);
  const coverage = sceneCoverage(receipt.manifest.scenes, receipt.manifest.durationSec);
  const expectedFrames = Math.round(receipt.manifest.durationSec * 30);
  const defects: string[] = [];
  if (probe.width !== 1920 || probe.height !== 1080) defects.push(`geometry ${probe.width}x${probe.height} is not 1920x1080`);
  if (Math.abs(probe.fps - 30) > 0.01) defects.push(`fps ${probe.fps} is not 30`);
  if (Math.abs(probe.durationSec - receipt.manifest.durationSec) > 0.1) defects.push("video duration does not match scene manifest");
  if (Math.abs(probe.frames - expectedFrames) > 3) defects.push(`frame count ${probe.frames} does not match expected ${expectedFrames}`);
  if (hashes.length < Math.max(4, Math.ceil(probe.durationSec * 2))) defects.push("full-duration sample did not decode enough frames");
  if (new Set(hashes).size < Math.min(4, hashes.length)) defects.push("render is visually frozen across the sampled duration");
  if (blacks.length) defects.push(`unexpected black interval(s): ${blacks.map((interval) => `${interval.startSec.toFixed(2)}-${interval.endSec.toFixed(2)}s`).join(", ")}`);
  if (!coverage.contiguous || !coverage.startsAtZero || !coverage.endsAtManifest) defects.push("scene manifest has a timing gap, non-zero start, or uncovered tail");
  return {
    name, videoPath, manifestDurationSec: receipt.manifest.durationSec, measuredDurationSec: probe.durationSec,
    durationDeltaSec: Number((probe.durationSec - receipt.manifest.durationSec).toFixed(4)),
    width: probe.width, height: probe.height, fps: Number(probe.fps.toFixed(4)), frames: probe.frames,
    expectedFrames, sampledFrames: hashes.length, uniqueSampledFrames: new Set(hashes).size,
    blackIntervals: blacks, sceneCoverage: coverage, defects,
  };
}

async function main(): Promise<void> {
  const outputDir = resolve(process.argv[2] ?? "/tmp/chess-replay-proof-20260912");
  const prefix = process.argv[3]?.trim();
  const receipts = (await readdir(outputDir))
    .filter((file) => file.endsWith(".json") && !file.includes("validation"))
    .filter((file) => !prefix || file.startsWith(prefix))
    .sort();
  if (!receipts.length) throw new Error(`no proof receipts found in ${outputDir}`);
  const renders = await Promise.all(receipts.map((file) => validateReceipt(join(outputDir, file))));
  const report = {
    contract: "chess-replay-render-validation/v1",
    status: renders.every((render) => render.defects.length === 0) ? "pass" : "fail",
    scope: "native visual-only diagnostic; synthetic timing; not narrated channel qualification",
    outputDir, renders,
  };
  await writeFile(join(outputDir, "chess-replay-proof-validation.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "pass") process.exitCode = 1;
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });

