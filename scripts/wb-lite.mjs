// WHITEBOARD DRAW-ON LITE — deterministic reveal (NO video model, 0 Higgsfield
// credits). Reuses v3's style-locked complete stills; reveals each via an ffmpeg
// wipe with a hand PNG riding the frontier. 5 panels x 4s = 20s preview.
import { join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
import { generateBananaImage } from "../src/lib/banana.ts";

const log = (m) => console.error(`[lite] ${m}`);
await bootstrapSecrets((m) => console.error(`[boot] ${m}`), { required: ["GEMINI_API_KEY"] });

const SRC = join(process.cwd(), "output", "whiteboard", "samurai-v3", "stills");
const DIR = join(process.cwd(), "output", "whiteboard", "lite");
await mkdir(DIR, { recursive: true });

const W = 1280, H = 720, PANEL = 4; // seconds
const PANELS = [0, 1, 2, 3, 4].map((i) => join(SRC, `panel_${i}_complete.png`)).filter((p) => existsSync(p));
log(`reusing ${PANELS.length} v3 complete stills`);

function ff(args) {
  return new Promise((res, rej) => {
    const c = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    c.stderr.on("data", (d) => (err += d.toString()));
    c.on("close", (code) => (code === 0 ? res() : rej(new Error(err.slice(-500)))));
  });
}

// Background = a solid board-tone (matches the v3 still's board so the reveal
// has no seam — only the ink + frame appear). No separate board image needed.
const BOARD_TONE = "0xF3F1EB";
const handPng = join(DIR, "hand.png");
if (!existsSync(handPng)) {
  await writeFile(handPng, await generateBananaImage({
    prompt: `A single photorealistic human hand holding a black dry-erase marker, the marker tip pointing toward the UPPER-LEFT, isolated on a SOLID pure chroma-green #00FF00 background, fully filling the background with that exact green, no shadows, nothing else.`,
    aspectRatio: "1:1",
  }));
  log("hand ✓");
}

// 2. per-panel reveal: wipe the complete still in over the board; hand at frontier.
const clips = [];
for (let i = 0; i < PANELS.length; i++) {
  const out = join(DIR, `clip_${i}.mp4`);
  const filter =
    `[0:v]setsar=1[bg];` +
    `[1:v]scale=${W}:${H},setsar=1[fg];` +
    `[bg][fg]xfade=transition=wiperight:duration=${PANEL}:offset=0[rev];` +
    `[2:v]scale=-1:480,colorkey=0x00ff00:0.30:0.12,despill[hand];` +
    `[rev][hand]overlay=x='${W}*(t/${PANEL})-120':y='${H}-400':shortest=1,` +
    `trim=duration=${PANEL},format=yuv420p[out]`;
  await ff([
    "-y",
    "-f", "lavfi", "-t", String(PANEL), "-i", `color=c=${BOARD_TONE}:s=${W}x${H}`,
    "-loop", "1", "-t", String(PANEL), "-i", PANELS[i],
    "-loop", "1", "-t", String(PANEL), "-i", handPng,
    "-filter_complex", filter,
    "-map", "[out]", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
    out,
  ]);
  clips.push(out);
  log(`panel ${i} reveal ✓`);
}

// 3. concat → 20s preview.
const listFile = join(DIR, "concat.txt");
await writeFile(listFile, clips.map((c) => `file '${c}'`).join("\n"));
const finalOut = join(DIR, "wb-lite.mp4");
await ff(["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", finalOut]);
log(`DONE → ${finalOut} (${clips.length * PANEL}s, 0 Higgsfield credits)`);
console.log(JSON.stringify({ out: finalOut, panels: clips.length, seconds: clips.length * PANEL }, null, 2));
