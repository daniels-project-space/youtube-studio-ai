import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assembleBeatBody, probe } from "@/lib/ffmpeg";

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "studio-reusable-media-assembly-"));
  try {
  const fresh = join(dir, "fresh-red.mp4");
  const banked = join(dir, "banked-blue.mp4");
  const output = join(dir, "assembled.mp4");
  for (const [path, color] of [[fresh, "red"], [banked, "blue"]] as const) {
    execFileSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", `color=c=${color}:s=640x360:r=12:d=4`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", path,
    ]);
  }

  const bankedBytes = readFileSync(banked);
  const sealedBankSha256 = createHash("sha256").update(bankedBytes).digest("hex");
  assert.equal(
    createHash("sha256").update(readFileSync(banked)).digest("hex"),
    sealedBankSha256,
    "the exact banked bytes must survive materialization before assembly",
  );

  const accepted: Array<{ index: number; screenSeconds: number }> = [];
  await assembleBeatBody({
    clipPaths: [fresh, banked],
    outPath: output,
    targetSec: 6,
    tmpDir: dir,
    maxSegSec: 3,
    segDurationsSec: [3, 3],
    width: 640,
    height: 360,
    fps: 12,
    preset: "ultrafast",
    onSegmentAccepted: (segment) => accepted.push(segment),
  });
  const media = await probe(output);
  assert.equal(media.hasVideo, true);
  assert.equal(media.width, 640);
  assert.equal(media.height, 360);
  assert(Math.abs(media.durationSec - 6) < 0.15, `expected an exact 6s body, received ${media.durationSec}`);
  assert.deepEqual(accepted, [
    { index: 0, screenSeconds: 3 },
    { index: 1, screenSeconds: 3 },
  ], "only exact segments that survived the black-frame gate may be counted");

  const pixelAt = (seconds: number): Buffer => execFileSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-ss", String(seconds), "-i", output,
    "-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1",
  ]);
  const freshPixel = pixelAt(1);
  const bankPixel = pixelAt(4.5);
  assert(freshPixel[0]! > freshPixel[2]! + 100, "fresh red source must lead the body");
  assert(bankPixel[2]! > bankPixel[0]! + 100, "banked blue source must remain visible in its planned position");

  console.log("studio reusable media actual FFmpeg assembly passed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

void main();
