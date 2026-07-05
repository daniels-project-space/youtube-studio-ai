// VOX-VIDEO-ASSETS — turn stills into seamless looping mp4s for the vox_scene
// `video` layer (moving-image ambience). Uses the wired generateI2V (Higgsfield
// sub → fal FLF2V) + seamlessLoopUnit. FLF2V (tail = start) => genuine loop with
// motion still moving. Outputs output/vox/assets/<id>_loop.mp4. Run once:
//   ./node_modules/.bin/tsx scripts/vox-video-assets.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";

// R2 creds live in .env.local (not the vault); load them before bootstrap.
try {
  for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  }
} catch { /* no .env.local */ }
import { generateI2V } from "../src/lib/i2v.ts";
import { seamlessLoopUnit } from "../src/lib/ffmpeg.ts";
import { putObject, presignDownload } from "../src/lib/storage.ts";
import { generateBananaImage } from "../src/lib/banana.ts";

const ROOT = process.cwd();
const DIR = join(ROOT, "output", "vox", "assets");
const TMP = join(DIR, "vid");
await mkdir(TMP, { recursive: true });
const log = (m) => console.error("[vid]", m);

await bootstrapSecrets(() => {}, { required: ["FAL_KEY", "GEMINI_API_KEY"] });
for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) {
  if (!process.env[k]) throw new Error(`missing ${k} (expected in .env.local)`);
}

async function dl(url, out) {
  const r = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!r.ok) throw new Error("dl " + r.status);
  await writeFile(out, Buffer.from(await r.arrayBuffer()));
}
async function publicUrl(localPath, key, contentType) {
  await putObject(key, await readFile(localPath), { contentType });
  return presignDownload(key, { expiresIn: 3600 });
}
async function makeLoop(id, stillPath, prompt) {
  const out = join(DIR, `${id}_loop.mp4`);
  if (existsSync(out)) { log(`skip ${id} (cached)`); return [id, "cached"]; }
  try {
    const url = await publicUrl(stillPath, `vox-i2v/${id}_src.png`, "image/png");
    log(`${id}: i2v…`);
    const clip = await generateI2V({
      prompt, imageUrl: url, tailImageUrl: url, durationSec: 5, aspectRatio: "16:9", runId: "vox", log,
    });
    const raw = join(TMP, `${id}_raw.mp4`);
    await dl(clip.url, raw);
    await seamlessLoopUnit(raw, out, { crossfadeSec: 0.8 });
    log(`✓ ${id} -> ${out} (${clip.model})`);
    return [id, "ok"];
  } catch (e) {
    log(`✗ ${id}: ${e?.message || e}`);
    return [id, "FAIL " + (e?.message || e)];
  }
}

// fire+smoke on solid black (screen-blended over the bill at render time)
async function ensureFireStill() {
  const p = join(TMP, "fire_src.jpg");
  if (existsSync(p)) return p;
  const buf = await generateBananaImage({
    prompt: "Intense bright orange and yellow flames with rising grey smoke, centered, on a PURE SOLID BLACK background, nothing else, photorealistic fire, high contrast",
    aspectRatio: "16:9", imageSize: "2K", tier: "pro",
  });
  const tmp = join(TMP, "fire_src.png");
  await writeFile(tmp, buf);
  const { spawn } = await import("node:child_process");
  await new Promise((res, rej) => { const c = spawn("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", "-i", tmp, "-q:v", "3", p]); c.on("close", (x) => x === 0 ? res() : rej(new Error("ffmpeg " + x))); });
  return p;
}

const results = [];
results.push(await makeLoop("water", join(DIR, "water.jpg"),
  "Gentle rippling dark ocean water surface, small waves and foam moving, glinting light, LOCKED camera, no pan, no zoom, seamless ambient loop"));
const fireStill = await ensureFireStill();
results.push(await makeLoop("fire", fireStill,
  "Flickering dancing flames, smoke curling upward, on black, LOCKED camera, no pan, no zoom, seamless ambient fire loop"));

console.log("VIDEO ASSET SUMMARY:");
for (const [id, st] of results) console.log(`  ${id}: ${st}`);
console.log("DIR " + DIR);
