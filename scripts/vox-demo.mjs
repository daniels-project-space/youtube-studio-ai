// VOX-DEMO — a ~41s reel that exercises the whole `vox_explainer` documentary
// path (all 6 Vox shot kinds) end-to-end, to prove the engine renders clean,
// multi-layer, consistent Vox-style motion. NO API spend: halftone figures use
// bg-removed cutouts from prior documotion runs; illustrated objects (building,
// map, banknote) are inline flat-vector SVGs. Theme comes straight from the
// registered vox_explainer DocuStyleDef so it matches the production path.
//
//   npx tsx scripts/vox-demo.mjs   ->  /tmp/vox-demo/final.mp4
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { renderDocuMotion } from "../src/lib/remotionRender.ts";
import { getStyle } from "../src/remotion/docuStyles.ts";

const ROOT = process.cwd();
const OUT = "/tmp/vox-demo";
await mkdir(OUT, { recursive: true });
const log = (m) => console.error("[vox]", m);

/* -------------------------------------------------------------- assets -- */
const svgUri = (svg) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
async function pngUri(rel) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) {
    log(`MISSING ${rel}`);
    return null;
  }
  const b = await readFile(p);
  const ext = p.toLowerCase().endsWith(".png") ? "png" : "jpeg";
  return `data:image/${ext};base64,${b.toString("base64")}`;
}

function buildingSvg() {
  let cols = "";
  for (let i = 0; i < 5; i++) {
    const x = 128 + i * 82;
    cols += `<rect x='${x}' y='150' width='40' height='208' fill='#ece7db' stroke='#9a9284' stroke-width='2'/>`;
  }
  return `<svg xmlns='http://www.w3.org/2000/svg' width='640' height='400' viewBox='0 0 640 400'>
    <rect x='70' y='140' width='500' height='230' fill='#dfd9cc' stroke='#9a9284' stroke-width='3'/>
    <polygon points='320,58 84,150 556,150' fill='#d3ccbd' stroke='#9a9284' stroke-width='3'/>
    ${cols}
    <rect x='286' y='250' width='68' height='108' fill='#c3bcab' stroke='#9a9284' stroke-width='2'/>
    <rect x='70' y='358' width='500' height='16' fill='#c9c2b3'/>
  </svg>`;
}
function mapSvg() {
  return `<svg xmlns='http://www.w3.org/2000/svg' width='720' height='460' viewBox='0 0 720 460'>
    <path d='M60 210 C90 120 210 70 320 90 C420 108 470 60 560 90 C660 122 690 210 640 290 C600 355 470 350 400 380 C320 414 210 410 150 360 C86 306 40 290 60 210 Z' fill='#d9d3c5' stroke='#9a9284' stroke-width='4'/>
    <circle cx='430' cy='232' r='13' fill='#e8641a' stroke='#1b1712' stroke-width='3'/>
    <path d='M430 219 L430 176' stroke='#1b1712' stroke-width='3'/>
  </svg>`;
}
function billSvg() {
  return `<svg xmlns='http://www.w3.org/2000/svg' width='520' height='232' viewBox='0 0 520 232'>
    <rect x='6' y='6' width='508' height='220' rx='12' fill='#c6d6be' stroke='#5f7a57' stroke-width='4'/>
    <rect x='24' y='24' width='472' height='184' rx='8' fill='none' stroke='#5f7a57' stroke-width='2'/>
    <ellipse cx='260' cy='116' rx='72' ry='86' fill='#b4c7aa' stroke='#5f7a57' stroke-width='3'/>
    <circle cx='86' cy='60' r='24' fill='none' stroke='#5f7a57' stroke-width='3'/>
    <circle cx='434' cy='172' r='24' fill='none' stroke='#5f7a57' stroke-width='3'/>
  </svg>`;
}

const [portraitA, portraitB, figA, figB] = await Promise.all([
  pngUri("output/documotion/fordlandia/assets/s0_fg_cut.png"),
  pngUri("output/documotion/detective/assets/s3_cutout2_cut.png"),
  pngUri("output/documotion/fordlandia/assets/s6_cutout1_cut.png"),
  pngUri("output/documotion/fordlandia/assets/s6_cutout2_cut.png"),
]);

const building = svgUri(buildingSvg());
const map = svgUri(mapSvg());
const bill = svgUri(billSvg());

const keep = (arr) => arr.filter(Boolean);

/* -------------------------------------------------------------- shots -- */
const shots = [
  // 1) REVEAL — grid + rising building anchor + two halftone figures slide in
  {
    kind: "vox_reveal",
    durationInFrames: 210,
    vox: {
      kicker: "THE SETUP",
      anchor: building,
      anchorHPct: 60,
      cutouts: keep([
        portraitA && { src: portraitA, from: "left", xPct: 30, hPct: 58, delay: 14 },
        portraitB && { src: portraitB, from: "right", xPct: 70, hPct: 58, delay: 24, flip: true },
      ]),
    },
    title: "A DEAL IS SIGNED",
  },
  // 2) COUNTER — oil price ticks up
  {
    kind: "vox_counter",
    durationInFrames: 150,
    vox: { kicker: "OIL PRICE", counterFrom: 40, counterTo: 116, counterPrefix: "$", counterLabel: "PER BARREL" },
  },
  // 3) CHART — inflation line self-draws + orange callout
  {
    kind: "vox_chart",
    durationInFrames: 210,
    vox: {
      chartTitle: "U.S. INFLATION RATE",
      series: [1.3, 2.1, 2.4, 1.8, 1.4, 4.7, 8.0, 4.1, 3.2, 3.4, 4.2],
      seriesPrev: [1.4, 2.0, 2.3, 1.9, 1.5, 3.0, 5.8, 3.4, 2.6, 2.9, 3.1],
      xLabels: ["2016", "2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026"],
      yMax: 9,
      callout: { title: "2026 HIGH", value: "+4.2%" },
    },
  },
  // 4) MAP — plate slides in from the right, big debt stat pops, figures rise
  {
    kind: "vox_map",
    durationInFrames: 180,
    vox: {
      slideBg: map,
      stat: "$39T",
      statLabel: "NATIONAL DEBT",
      statDelay: 22,
      cutouts: keep([
        figA && { src: figA, xPct: 24, hPct: 30, delay: 30 },
        figB && { src: figB, xPct: 78, hPct: 30, delay: 38, flip: true },
      ]),
    },
  },
  // 5) DIALOGUE — two figures + sequential speech bubbles
  {
    kind: "vox_dialogue",
    durationInFrames: 180,
    vox: {
      cutouts: keep([
        portraitB && { src: portraitB, from: "left", xPct: 34, hPct: 62, delay: 6 },
        portraitA && { src: portraitA, from: "right", xPct: 66, hPct: 62, delay: 12, flip: true },
      ]),
      bubbles: [
        { text: "LET'S TRADE IN YUAN ¥", xPct: 33, yPct: 26, delay: 34, tail: "down" },
        { text: "OK, DEAL!", xPct: 70, yPct: 40, delay: 74, tail: "down", bg: "#e8641a", color: "#fff" },
      ],
    },
  },
  // 6) TYPEWRITER — payoff lines type out over the grid, banknote hero
  {
    kind: "vox_typewriter",
    durationInFrames: 300,
    vox: {
      typeLines: ["EMPIRES DON'T END WITH A WAR.", "THEY END WITH A BILL THEY CAN NO LONGER PAY."],
      hero: bill,
      heroHPct: 22,
    },
  },
];

const total = shots.reduce((s, x) => s + x.durationInFrames, 0);
log(`shots=${shots.length} total=${total}f (${(total / 30).toFixed(1)}s)`);

const THEME = getStyle("vox_explainer").theme;

log("rendering Remotion (vox_explainer)…");
await renderDocuMotion({
  shots,
  theme: THEME,
  width: 1920,
  height: 1080,
  outPath: join(OUT, "final.mp4"),
  concurrency: 3,
  log,
});
console.log("DONE " + join(OUT, "final.mp4"));
