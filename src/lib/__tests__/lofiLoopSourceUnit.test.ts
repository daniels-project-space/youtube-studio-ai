import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  composeLoopSourceUnit,
  measureLoopSeamDiff,
  measureVideoBoundaryDiff,
  probe,
} from "@/lib/ffmpeg";

const ffmpeg = process.env.FFMPEG_BIN ?? "ffmpeg";

function solid(path: string, color: string): void {
  execFileSync(ffmpeg, [
    "-y",
    "-f", "lavfi",
    "-i", `color=c=${color}:s=320x176:r=25:d=1`,
    "-an",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    path,
  ], { stdio: "ignore" });
}

async function main(): Promise<void> {
  const workDir = await mkdtemp(join(tmpdir(), "lofi-loop-source-test-"));
  try {
  const anchorA = join(workDir, "anchor-a.mp4");
  const anchorB = join(workDir, "anchor-b.mp4");
  const discontinuous = join(workDir, "discontinuous.mp4");
  solid(anchorA, "0x172333");
  solid(anchorB, "0x172333");
  solid(discontinuous, "0xe4572e");

  const accepted = await composeLoopSourceUnit({
    segmentPaths: [anchorA, anchorB],
    outPath: join(workDir, "accepted.mp4"),
    segmentSeconds: 1,
    fps: 25,
  });
  assert.ok(Math.abs((await probe(accepted)).durationSec - 2) <= 0.08, "two nominal segments must produce one exact source duration");
  assert.ok(
    await measureVideoBoundaryDiff(accepted, workDir, { boundarySec: 1, label: "accepted-internal" }) < 0.01,
    "matching anchored segments must pass the internal join measurement",
  );
  assert.ok(
    await measureLoopSeamDiff(accepted, workDir) < 0.01,
    "matching anchored segments must pass the wraparound measurement",
  );

  const rejected = await composeLoopSourceUnit({
    segmentPaths: [anchorA, discontinuous],
    outPath: join(workDir, "rejected.mp4"),
    segmentSeconds: 1,
    fps: 25,
  });
  assert.ok(
    await measureVideoBoundaryDiff(rejected, workDir, { boundarySec: 1, label: "rejected-internal" }) > 0.12,
    "an abrupt internal source change must exceed the production seam gate",
  );
  assert.ok(
    await measureLoopSeamDiff(rejected, workDir) > 0.12,
    "an abrupt wraparound source change must exceed the production seam gate",
  );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().then(
  () => console.log("lofi two-segment source-unit ffmpeg tests passed"),
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
