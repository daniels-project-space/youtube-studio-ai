// VOX-ASSETS — generate/source the real asset set for the faithful Vox-style
// reproduction. Plates via Gemini image-gen (generateBananaImage), real figures
// via Wikimedia, generic figures generated; all cutouts bg-removed (fal.ai
// BiRefNet). Cached to output/vox/assets/. Halftone is applied at RENDER time,
// not baked here. Run once:  ./node_modules/.bin/tsx scripts/vox-assets.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { bootstrapSecrets } from "../src/lib/bootstrap.ts";
import { generateBananaImage } from "../src/lib/banana.ts";
import { searchWikimediaImageUrl } from "../src/lib/wikimedia.ts";

const ROOT = process.cwd();
const DIR = join(ROOT, "output", "vox", "assets");
const RAW = join(DIR, "raw");
await mkdir(RAW, { recursive: true });
const log = (m) => console.error("[assets]", m);

await bootstrapSecrets(() => {}, { required: ["GEMINI_API_KEY", "FAL_KEY"] });

function sh(cmd, args) {
  return new Promise((res, rej) => {
    const c = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let e = "";
    c.stderr.on("data", (d) => (e += d));
    c.on("close", (x) => (x === 0 ? res() : rej(new Error(`${cmd} ${x}: ${e.slice(-200)}`))));
  });
}
async function downloadTo(url, out) {
  const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error("dl " + r.status);
  await writeFile(out, Buffer.from(await r.arrayBuffer()));
}
async function removeBg(imgPath, outPng) {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY missing");
  const dataUri = `data:image/jpeg;base64,${(await readFile(imgPath)).toString("base64")}`;
  let last = "";
  for (const ep of ["fal-ai/birefnet/v2", "fal-ai/birefnet"]) {
    try {
      const res = await fetch(`https://fal.run/${ep}`, {
        method: "POST",
        headers: { Authorization: `Key ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ image_url: dataUri }),
        signal: AbortSignal.timeout(120_000),
      });
      const j = await res.json();
      if (!res.ok) { last = `${ep} ${res.status}`; continue; }
      const url = j?.image?.url;
      if (!url) { last = `${ep} no url`; continue; }
      await downloadTo(url, outPng);
      return outPng;
    } catch (e) { last = `${ep}: ${e?.message || e}`; }
  }
  throw new Error("bg removal failed: " + last);
}

// id, source: banana|wiki, prompt/query, ar, alpha (bg-remove), allowText
const JOBS = [
  { id: "white_house", src: "banana", ar: "16:9", alpha: true,
    prompt: "A photorealistic straight-on symmetrical view of the White House north facade, the full neoclassical building with columns and flag, isolated on a plain solid white background, no sky, no people, no ground, sharp clean edges" },
  { id: "newspaper", src: "banana", ar: "3:4", alpha: true, allowText: true,
    prompt: "A photorealistic newspaper opinion page, dense grey columns of text with one bold black headline reading THE NATION, slightly angled, isolated on a plain solid white background, sharp edges" },
  { id: "oil_tanker", src: "banana", ar: "16:9", alpha: true,
    prompt: "A photorealistic full side profile of a large black crude oil supertanker ship, entire vessel from bow to stern visible, white superstructure, isolated on a plain solid white background, no water, no sky" },
  { id: "water", src: "banana", ar: "16:9", alpha: false,
    prompt: "A photorealistic close top-down texture of dark choppy grey-blue ocean sea water surface with small waves and foam, filling the entire frame edge to edge, no sky, no horizon, no objects" },
  { id: "us_map", src: "banana", ar: "4:3", alpha: true,
    prompt: "A 3D isometric extruded map of the contiguous United States, its top surface textured with the American flag stars and stripes, thick extruded sides, soft drop shadow, isolated on a plain solid white background" },
  { id: "tiananmen", src: "banana", ar: "16:9", alpha: true,
    prompt: "A photorealistic front view of the Tiananmen Gate rostrum building in Beijing, red walls, yellow tiled roof, the central portrait panel left blank and empty, isolated on a plain solid white background, no people, no portrait" },
  { id: "dollar_bill", src: "banana", ar: "4:3", alpha: true, allowText: true,
    prompt: "A single crisp US one hundred dollar bill lying flat at a slight angle, front side with Benjamin Franklin, isolated on a plain solid white background, no fire, no smoke" },
  { id: "oil_barrel", src: "banana", ar: "1:1", alpha: true,
    prompt: "A single bright orange industrial oil barrel drum, straight-on front view, with ribbed metal bands, isolated on a plain solid white background, simple product photo" },
  { id: "worker", src: "banana", ar: "3:4", alpha: true,
    prompt: "A photorealistic construction worker wearing a bright orange hard hat, ear defenders and a hi-vis vest, waist-up, facing the camera, neutral expression, isolated on a plain solid white studio background" },
  { id: "soldier", src: "banana", ar: "3:4", alpha: true,
    prompt: "A photorealistic soldier in a modern camouflage combat uniform and helmet, waist-up, facing the camera, neutral expression, isolated on a plain solid white studio background" },
  { id: "trump", src: "wiki", alpha: true, query: "Donald Trump official portrait 2017" },
  { id: "khamenei", src: "wiki", alpha: true, query: "Ali Khamenei portrait" },
  { id: "xi", src: "wiki", alpha: true, query: "Xi Jinping 2019 portrait" },
  { id: "putin", src: "wiki", alpha: true, query: "Vladimir Putin 2017 portrait" },
];

async function ensureRaw(job) {
  const rawJpg = join(RAW, `${job.id}.jpg`);
  if (existsSync(rawJpg)) return rawJpg;
  if (job.src === "banana") {
    const buf = await generateBananaImage({
      prompt: job.prompt, aspectRatio: job.ar, imageSize: "2K", tier: "pro",
      allowText: job.allowText ?? false,
    });
    const tmp = join(RAW, `${job.id}.src`);
    await writeFile(tmp, buf);
    await sh("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", "-i", tmp, "-q:v", "3", rawJpg]);
  } else {
    const url = await searchWikimediaImageUrl(job.query, 1400);
    if (!url) throw new Error(`wikimedia: nothing for "${job.query}"`);
    const tmp = join(RAW, `${job.id}.src`);
    await downloadTo(url, tmp);
    await sh("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", "-i", tmp, "-q:v", "3", rawJpg]);
  }
  return rawJpg;
}

const results = [];
for (const job of JOBS) {
  const finalPath = join(DIR, job.alpha ? `${job.id}.png` : `${job.id}.jpg`);
  if (existsSync(finalPath)) { log(`skip ${job.id} (cached)`); results.push([job.id, "cached"]); continue; }
  try {
    const raw = await ensureRaw(job);
    if (job.alpha) await removeBg(raw, finalPath);
    else await sh("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", "-i", raw, "-q:v", "3", finalPath]);
    log(`✓ ${job.id} -> ${finalPath}`);
    results.push([job.id, "ok"]);
  } catch (e) {
    log(`✗ ${job.id}: ${e?.message || e}`);
    results.push([job.id, "FAIL " + (e?.message || e)]);
  }
}

// contact sheet: zero-padded thumbs (labelled) → ffmpeg glob+tile grid
try {
  let i = 0;
  const cols = 5;
  for (const job of JOBS) {
    const f = join(DIR, job.alpha ? `${job.id}.png` : `${job.id}.jpg`);
    const idx = String(i).padStart(2, "0");
    i++;
    if (!existsSync(f)) continue;
    const th = join(RAW, `th_${idx}.jpg`);
    await sh("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", "-i", f,
      "-vf",
      `scale=360:360:force_original_aspect_ratio=decrease,pad=360:360:(ow-iw)/2:(oh-ih)/2:color=0xdddddd,` +
      `drawtext=text='${job.id}':x=6:y=6:fontsize=22:fontcolor=black:box=1:boxcolor=white@0.8`,
      th]);
  }
  const rows = Math.ceil(JOBS.length / cols);
  await sh("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", "-framerate", "1",
    "-pattern_type", "glob", "-i", join(RAW, "th_*.jpg"),
    "-vf", `tile=${cols}x${rows}:color=0xcccccc`, "-frames:v", "1",
    join(ROOT, "output", "vox", "contact.jpg")]);
  log("contact sheet -> output/vox/contact.jpg");
} catch (e) { log("contact sheet skipped: " + (e?.message || e)); }

console.log("ASSET SUMMARY:");
for (const [id, st] of results) console.log(`  ${id}: ${st}`);
console.log("DIR " + DIR);
