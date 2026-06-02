/**
 * Local functional test for composeWithIntro (no paid APIs). Builds synthetic
 * inputs with ffmpeg lavfi and asserts the composed output's structure matches
 * the narrated (card + ducked music + narration + fade) and lofi (card + full
 * music, 4K body preserved) timelines.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { composeWithIntro, probe } from "@/lib/ffmpeg";

const FF = process.env.FFMPEG_BIN ?? "ffmpeg";

function sh(bin: string, args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    const c = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    c.stderr.on("data", (d) => (err += d));
    c.on("close", (code) => (code === 0 ? res() : rej(new Error(err.slice(-500)))));
  });
}

async function color(out: string, c: string, w: number, h: number, sec: number) {
  await sh(FF, ["-y", "-f", "lavfi", "-i", `color=c=${c}:s=${w}x${h}:r=30:d=${sec}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", out]);
}
async function tone(out: string, freq: number, sec: number) {
  await sh(FF, ["-y", "-f", "lavfi", "-i", `sine=frequency=${freq}:duration=${sec}`, "-c:a", "libmp3lame", out]);
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "compose-"));
  const card = join(dir, "card.mp4");
  const bodyN = join(dir, "bodyN.mp4");
  const body4k = join(dir, "body4k.mp4");
  const narr = join(dir, "narr.mp3");
  const music = join(dir, "music.mp3");

  console.log("building synthetic inputs…");
  await color(card, "navy", 1920, 1080, 5);
  await color(bodyN, "darkgreen", 1280, 720, 8); // different size → exercises scalePad
  await color(body4k, "maroon", 3840, 2160, 4);
  await tone(narr, 200, 10); // narration 10s
  await tone(music, 440, 6); // music 6s (shorter → must loop)

  // ---- NARRATED: card(5) + narration(10) + tail(3) = 18s, 1920x1080, A+V ----
  console.log("\n[narrated] card + ducked music + narration + fade");
  const outN = join(dir, "narrated.mp4");
  await composeWithIntro({
    introCardPath: card,
    loopBodyPath: bodyN,
    musicPath: music,
    narrationPath: narr,
    outPath: outN,
    introSec: 5,
    bodySec: 10,
    tailSec: 3,
    fadeOutSec: 2,
    width: 1920,
    height: 1080,
  });
  const pN = await probe(outN);
  console.log("  probe:", JSON.stringify(pN));
  assert(pN.hasVideo && pN.hasAudio, "narrated has video+audio");
  assert(Math.abs(pN.durationSec - 18) <= 1, `narrated ~18s (got ${pN.durationSec})`);
  assert(pN.width === 1920 && pN.height === 1080, "narrated 1920x1080");

  // ---- LOFI: card(5) + body(6) = 11s, 4K preserved, no narration ----
  console.log("\n[lofi] card + full music, 4K body preserved, no narration");
  const outL = join(dir, "lofi.mp4");
  await composeWithIntro({
    introCardPath: card,
    loopBodyPath: body4k,
    musicPath: music,
    outPath: outL,
    introSec: 5,
    bodySec: 6,
    tailSec: 0,
    fadeOutSec: 0,
    width: 3840,
    height: 2160,
  });
  const pL = await probe(outL);
  console.log("  probe:", JSON.stringify(pL));
  assert(pL.hasVideo && pL.hasAudio, "lofi has video+audio");
  assert(Math.abs(pL.durationSec - 11) <= 1, `lofi ~11s (got ${pL.durationSec})`);
  assert(pL.height === 2160, `lofi 4K height preserved (got ${pL.height})`);

  // ---- DEGRADE: no card (render failed) → narration starts at 0 ----
  console.log("\n[degrade] no card → body+narration only");
  const outD = join(dir, "degrade.mp4");
  await composeWithIntro({
    loopBodyPath: bodyN,
    musicPath: music,
    narrationPath: narr,
    outPath: outD,
    introSec: 0,
    bodySec: 10,
    tailSec: 2,
    fadeOutSec: 1,
    width: 1920,
    height: 1080,
  });
  const pD = await probe(outD);
  console.log("  probe:", JSON.stringify(pD));
  assert(pD.hasVideo && pD.hasAudio, "degrade has video+audio");
  assert(Math.abs(pD.durationSec - 12) <= 1, `degrade ~12s (got ${pD.durationSec})`);

  console.log("\nALL COMPOSE TESTS PASSED");
}

main().catch((e) => {
  console.error("\nCOMPOSE TEST FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
