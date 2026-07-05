// Parallel headless frame-capture: WORKERS chromium pages in one browser render
// strided frame subsets concurrently (≈2× on SwiftShader). Viewport sets resolution,
// so preview passes can run small/fast. Contract: window.__ready/__dur/__frame(tn)/__settle.
import { chromium } from "playwright";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";

const PAGE = process.env.PAGE, OUT = process.env.OUTDIR;
const FPS = parseInt(process.env.FPS || "30", 10);
const W = parseInt(process.env.WIDTH || "1920", 10), H = parseInt(process.env.HEIGHT || "1080", 10);
const WORKERS = parseInt(process.env.WORKERS || "3", 10);
if (!PAGE || !OUT) { console.error("PAGE and OUTDIR required"); process.exit(1); }
if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || "/usr/bin/google-chrome-stable", args: ["--no-sandbox", "--disable-gpu", "--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--hide-scrollbars", "--allow-file-access-from-files", "--disable-web-security", "--disable-dev-shm-usage"] });

async function newReady() {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("PAGEERR", e.message));
  await page.goto(pathToFileURL(PAGE).href, { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true", { timeout: 60000 });
  await page.waitForTimeout(400);
  return page;
}

const probe = await newReady();
const dur = await probe.evaluate(() => window.__dur || 6);
const N = Math.max(2, Math.round(dur * FPS));
let done = 0;

async function worker(wi, page) {
  for (let i = wi; i < N; i += WORKERS) {
    await page.evaluate((t) => window.__frame(t), i / (N - 1));
    await page.evaluate(() => (window.__settle ? window.__settle() : new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))));
    await page.screenshot({ path: `${OUT}/f_${String(i).padStart(4, "0")}.png`, type: "png" });
    if (++done % 40 === 0) console.log(`captured ${done}/${N}`);
  }
  await page.close();
}

const pages = [probe];
for (let w = 1; w < WORKERS; w++) pages.push(await newReady());
await Promise.all(pages.map((p, w) => worker(w, p)));
console.log(`DONE ${N} frames (${dur}s) @${W}x${H} x${WORKERS} -> ${OUT}`);
await browser.close();
