// VOX-REPRO — faithful reproduction of the reference intro (0:00–0:47) using the
// vox_scene layer engine + real generated/sourced assets (output/vox/assets).
//   ./node_modules/.bin/tsx scripts/vox-repro.mjs          -> stills (fast QC)
//   ./node_modules/.bin/tsx scripts/vox-repro.mjs full     -> full mp4
import { readFile, mkdir } from "node:fs/promises";
import { existsSync, copyFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { renderDocuMotion, renderDocuStills } from "../src/lib/remotionRender.ts";
import { getStyle } from "../src/remotion/docuStyles.ts";

const ROOT = process.cwd();
const A = join(ROOT, "output", "vox", "assets");
const OUT = "/tmp/vox-repro";
await mkdir(join(OUT, "stills"), { recursive: true });
const log = (m) => console.error("[repro]", m);

async function uri(name) {
  const p = join(A, name);
  if (!existsSync(p)) { log(`MISSING ${name}`); return ""; }
  const b = await readFile(p);
  const ext = name.toLowerCase().endsWith(".jpg") ? "jpeg" : "png";
  return `data:image/${ext};base64,${b.toString("base64")}`;
}
const IMG = {};
for (const n of ["white_house", "newspaper", "oil_tanker", "us_map", "tiananmen", "dollar_bill", "oil_barrel", "worker", "soldier", "trump", "khamenei", "xi", "putin"]) IMG[n] = await uri(n + ".png");
IMG.water = await uri("water.jpg");

// moving-image loops (file:// for OffthreadVideo) + probed frame counts
const VID = {};
{
  const probeFrames = (p) => {
    try {
      const o = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", p], { encoding: "utf8" });
      return Math.max(1, Math.round((parseFloat((o.stdout || "").trim()) || 5) * 30));
    } catch { return 150; }
  };
  // OffthreadVideo needs an http(s) src → serve via staticFile from public/.
  const PUB = join(ROOT, "public", "vox");
  mkdirSync(PUB, { recursive: true });
  for (const n of ["water", "fire"]) {
    const p = join(A, `${n}_loop.mp4`);
    if (existsSync(p)) {
      copyFileSync(p, join(PUB, `${n}_loop.mp4`));
      VID[n] = { src: `vox/${n}_loop.mp4`, frames: probeFrames(p) }; // relative → staticFile()
    } else VID[n] = null;
    log(`video ${n}: ${VID[n] ? VID[n].frames + "f" : "MISSING (fallback)"}`);
  }
}

const FPS = 30;
const sec = (s) => Math.round(s * FPS);

// each scene = a vox_scene shot with an ordered layers[] stack (back → front)
const scenes = [
  { // 1) White House + leaders (characters BEHIND the building, heads peek above)
    dur: 7.0,
    layers: [
      { type: "character", src: IMG.trump, xPct: 27, hPct: 74, enter: "pop", delay: 12, parallax: 1.2, blur: true },
      { type: "character", src: IMG.khamenei, xPct: 73, hPct: 74, enter: "pop", delay: 20, parallax: 1.2, blur: true },
      { type: "plate", src: IMG.white_house, hPct: 55, enter: "rise", delay: 2, parallax: 1.0 },
      { type: "label", text: "THE U.S. + IRAN", anchor: "top", xPct: 18, yPct: 12, size: 26, enter: "fade", delay: 34 },
    ],
  },
  { // 2) Newspaper slides in
    dur: 4.0,
    layers: [
      { type: "plate", src: IMG.newspaper, anchor: "center", xPct: 50, yPct: 50, hPct: 84, enter: "slideL", delay: 2, parallax: 0.5 },
      { type: "highlight", anchor: "center", xPct: 35, yPct: 35, wPct: 30, hPct: 4, color: "rgba(240,205,50,0.5)", delay: 24 },
      { type: "label", text: "THE DOWNFALL BEGINS", anchor: "top", xPct: 26, yPct: 9, size: 26, color: "#e8641a", enter: "fade", delay: 30 },
    ],
  },
  { // 3) Oil tanker on water + price counter
    dur: 8.0,
    layers: [
      // tanker FIRST (back), then water IN FRONT so the waves cover the hull bottom → ship sits in the sea
      { type: "plate", src: IMG.oil_tanker, anchor: "bottom", xPct: 50, wPct: 74, yPct: 21, enter: "slideL", delay: 2, idle: "bob", parallax: 0.9, blur: true },
      VID.water
        ? { type: "video", src: VID.water.src, loopFrames: VID.water.frames, anchor: "bottom", xPct: 50, wPct: 100, hPct: 30, yPct: 0, enter: "none", parallax: 0.15 }
        : { type: "water", src: IMG.water, yPct: 70 },
      { type: "counter", src: IMG.oil_barrel, anchor: "top", xPct: 78, yPct: 22, steps: [40, 103, 116], prefix: "$", sublabel: "PER BARREL", size: 108, enter: "pop", delay: 34 },
    ],
  },
  { // 4) Inflation chart (draws on) + callout
    dur: 5.0,
    layers: [
      { type: "chart", anchor: "center", xPct: 50, yPct: 50, wPct: 66, hPct: 66,
        chartTitle: "U.S. INFLATION RATE",
        series: [1.3, 2.1, 2.4, 1.8, 1.4, 4.7, 8.0, 4.1, 3.2, 3.4, 4.2],
        seriesPrev: [1.4, 2.0, 2.3, 1.9, 1.5, 3.0, 5.8, 3.4, 2.6, 2.9, 3.1],
        xLabels: ["2016", "2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026"],
        yMax: 9, callout: { title: "2026 HIGH", value: "+4.2%" }, enter: "slideL", delay: 2, parallax: 0.4 },
    ],
  },
  { // 5) US map + $39T
    dur: 5.0,
    layers: [
      { type: "plate", src: IMG.us_map, anchor: "center", xPct: 52, yPct: 56, hPct: 54, enter: "slideR", delay: 2, idle: "bob", parallax: 0.6 },
      { type: "stat", text: "$39 TRILLION", anchor: "center", xPct: 50, yPct: 20, size: 120, enter: "pop", delay: 20 },
      { type: "underline", anchor: "center", xPct: 32, yPct: 27, wPct: 36, size: 11, color: "#d6402a", delay: 30 },
    ],
  },
  { // 6) Interest vs military — worker + soldier rise
    dur: 4.0,
    layers: [
      { type: "character", src: IMG.worker, anchor: "bottom", xPct: 20, hPct: 48, enter: "rise", delay: 8, parallax: 1.1 },
      { type: "character", src: IMG.soldier, anchor: "bottom", xPct: 80, hPct: 48, enter: "rise", delay: 16, parallax: 1.1 },
      { type: "label", text: "INTEREST ALONE > ITS MILITARY", anchor: "center", xPct: 50, yPct: 34, size: 42, color: "#1b1712", enter: "pop", delay: 26 },
    ],
  },
  { // 7) Xi + Putin on the gate + speech bubbles
    dur: 6.0,
    layers: [
      { type: "plate", src: IMG.tiananmen, anchor: "bottom", xPct: 50, wPct: 66, yPct: 0, enter: "rise", delay: 2, parallax: 0.8 },
      { type: "character", src: IMG.xi, anchor: "bottom", xPct: 40, hPct: 62, yPct: 34, enter: "pop", delay: 12, parallax: 1.1, blur: true },
      { type: "character", src: IMG.putin, anchor: "bottom", xPct: 60, hPct: 62, yPct: 34, enter: "pop", delay: 18, flip: true, parallax: 1.1, blur: true },
      // bubbles sit in the clear side-space (OFF the faces); tail aims at each speaker's mouth
      { type: "bubble", text: "LET'S TRADE IN YUAN", xPct: 16, yPct: 15, delay: 42, bubble: { pointXPct: 39, pointYPct: 47 } },
      { type: "bubble", text: "OK, DEAL!", xPct: 85, yPct: 22, delay: 66, bubble: { bg: "#e8641a", color: "#fff", pointXPct: 61, pointYPct: 42 } },
    ],
  },
  { // 8) Burning dollar + typewriter payoff → fade to black
    dur: 8.0,
    fadeOut: true,
    layers: [
      { type: "plate", src: IMG.dollar_bill, anchor: "bottom", xPct: 50, wPct: 32, yPct: 5, enter: "pop", delay: 6, parallax: 0.6 },
      VID.fire
        ? { type: "video", src: VID.fire.src, loopFrames: VID.fire.frames, anchor: "bottom", xPct: 50, wPct: 54, hPct: 56, yPct: 0, enter: "fade", delay: 10, blend: "screen", parallax: 0.4 }
        : { type: "fire", xPct: 50, yPct: 70, fireW: 22 },
      { type: "typewriter", anchor: "center", xPct: 50, yPct: 37, size: 52, delay: 12,
        lines: ["EMPIRES DON'T END WITH A WAR.", "THEY END WITH A BILL THEY CAN NO LONGER PAY."] },
    ],
  },
];

// assemble shots + scene start frames
const shots = [];
const starts = [];
let acc = 0;
for (const s of scenes) {
  const durF = sec(s.dur);
  starts.push(acc);
  shots.push({ kind: "vox_scene", durationInFrames: durF, vox: { layers: s.layers, fadeOut: s.fadeOut, push: 0.04 } });
  acc += durF;
}
const total = acc;
log(`${scenes.length} scenes, ${total}f (${(total / FPS).toFixed(1)}s)`);

const THEME = getStyle("vox_explainer").theme;
const common = { shots, theme: THEME, width: 1920, height: 1080 };

if (process.argv.includes("full")) {
  log("rendering FULL mp4…");
  await renderDocuMotion({ ...common, outPath: join(OUT, "final.mp4"), concurrency: 3, log });
  console.log("DONE " + join(OUT, "final.mp4"));
} else {
  // one still per scene at 78% through the scene (motion settled)
  const frames = starts.map((st, i) => st + Math.round(sec(scenes[i].dur) * 0.78));
  const outPaths = frames.map((_, i) => join(OUT, "stills", `s${i + 1}.jpg`));
  log("rendering stills: " + frames.join(","));
  await renderDocuStills({ ...common, frames, outPaths, width: 1280, height: 720, log });
  console.log("STILLS " + join(OUT, "stills"));
}
