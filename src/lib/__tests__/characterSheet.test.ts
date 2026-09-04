/**
 * The sheet is a conditioning image handed to a renderer, so "a file was
 * produced" proves nothing. What matters is that the right view lands in the
 * right cell at the right size — a wrong xstack layout still writes a
 * plausible-looking PNG of the correct dimensions, and every downstream render
 * would then be conditioned on a scrambled character.
 *
 * So this builds a real sheet from three distinguishable images with ffmpeg and
 * then SAMPLES each panel back, asserting the colour found there is the colour
 * that was put in. That check fails on a layout bug; a dimensions check does not.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  CHARACTER_SHEET_PANEL,
  buildCharacterSheet,
  planCharacterSheet,
  xstackLayout,
} from "@/lib/characterSheet";

const exec = promisify(execFile);
const run = async (bin: string, argv: string[], timeoutMs: number) => {
  await exec(bin, argv, { timeout: timeoutMs });
};

async function solid(dir: string, name: string, colour: string): Promise<string> {
  const path = join(dir, `${name}.png`);
  await exec("ffmpeg", [
    "-y", "-f", "lavfi", "-i", `color=c=${colour}:s=${CHARACTER_SHEET_PANEL}x${CHARACTER_SHEET_PANEL}`,
    "-frames:v", "1", path,
  ]);
  return path;
}

/**
 * Read one pixel back as raw RGB.
 *
 * Deliberately not parsed out of ffmpeg's log: signalstats writes its metadata
 * to stderr, which the first version of this helper read from stdout and got
 * -1 for every channel — a sampling bug that would have silently passed any
 * assertion written as "not equal". Decoding three raw bytes cannot go wrong
 * that way.
 */
async function pixelRgb(path: string, x: number, y: number): Promise<[number, number, number]> {
  const { stdout } = await exec(
    "ffmpeg",
    ["-v", "quiet", "-i", path, "-vf", `crop=1:1:${x}:${y}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    // ffmpeg's banner alone exceeds a 1 KB buffer and the failure surfaces as
    // ERR_CHILD_PROCESS_STDIO_MAXBUFFER rather than anything about pixels.
    { encoding: "buffer", maxBuffer: 1024 * 1024 },
  ) as unknown as { stdout: Buffer };
  return [stdout[0], stdout[1], stdout[2]];
}

async function main(): Promise<void> {
  // ---- pure planning ----------------------------------------------------
  // Canonical view order, so a sheet does not change because its inputs
  // arrived in a different order.
  const shuffled = planCharacterSheet([
    { id: "c", path: "/x", angle: "profile" },
    { id: "a", path: "/x", angle: "front" },
    { id: "b", path: "/x", angle: "three_quarter" },
  ]);
  assert.deepEqual(shuffled.views.map((v) => v.angle), ["front", "three_quarter", "profile"]);
  assert.equal(
    shuffled.digest,
    planCharacterSheet([
      { id: "a", path: "/y", angle: "front" },
      { id: "b", path: "/y", angle: "three_quarter" },
      { id: "c", path: "/y", angle: "profile" },
    ]).digest,
    "the same views in any order are the same sheet",
  );

  // A lone reference passes straight through. Padding it into a grid of
  // duplicates would tell the model the character looks identical from every
  // angle, which is a worse lie than saying nothing.
  const single = planCharacterSheet([{ id: "only", path: "/x", angle: "front" }]);
  assert.equal(single.passthrough, true);

  assert.equal(xstackLayout(2, 2, 1), "0_0|w0_0");
  assert.equal(xstackLayout(4, 2, 2), "0_0|w0_0|0_h0|w0_h0");

  // ---- real composite ---------------------------------------------------
  const dir = await mkdtemp(join(tmpdir(), "charsheet-"));
  try {
    const views = [
      { id: "front", path: await solid(dir, "front", "red"), angle: "front" },
      { id: "tq", path: await solid(dir, "tq", "green"), angle: "three_quarter" },
      { id: "profile", path: await solid(dir, "profile", "blue"), angle: "profile" },
    ];
    const { path, plan } = await buildCharacterSheet({ views, outDir: dir, run });
    assert.equal(plan.passthrough, false);
    assert.equal(plan.width, 2 * CHARACTER_SHEET_PANEL);

    const half = CHARACTER_SHEET_PANEL;
    // Each panel must contain the view that was placed there. A scrambled
    // layout writes a PNG of exactly the right size, so only reading the cells
    // back can catch it.
    const topLeft = await pixelRgb(path, 100, 100);
    const topRight = await pixelRgb(path, half + 100, 100);
    const bottomLeft = await pixelRgb(path, 100, half + 100);
    const dominant = (rgb: [number, number, number]) =>
      ["r", "g", "b"][rgb.indexOf(Math.max(...rgb))];
    assert.equal(dominant(topLeft), "r", `front view (red) must be top-left, got ${topLeft}`);
    assert.equal(dominant(topRight), "g", `three-quarter (green) must be top-right, got ${topRight}`);
    assert.equal(dominant(bottomLeft), "b", `profile (blue) must be bottom-left, got ${bottomLeft}`);

    // Determinism: the same views rebuild to the same path.
    const again = await buildCharacterSheet({ views, outDir: dir, run });
    assert.equal(again.path, path, "the same character must rebuild to the same sheet");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  console.log("CHARACTER SHEET PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
