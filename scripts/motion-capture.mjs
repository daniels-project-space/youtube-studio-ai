// Generic headless frame-capture for any motion-graphics tool that exposes the
// contract: window.__ready (bool), window.__dur (seconds), window.__frame(t in
// 0..1), window.__settle() (Promise resolving when the frame is render-ready).
// Drives MapLibre (tile-idle settle) and p5/DOM (rAF settle) uniformly.
import { chromium } from "playwright";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";

const PAGE = process.env.PAGE;                 // absolute path to the stamped .html
const OUT = process.env.OUTDIR;                // frames dir
const FPS = parseInt(process.env.FPS || "30", 10);
if (!PAGE || !OUT) { console.error("PAGE and OUTDIR required"); process.exit(1); }
if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || "/usr/bin/google-chrome-stable", args: ["--no-sandbox", "--disable-gpu", "--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--hide-scrollbars", "--allow-file-access-from-files", "--disable-web-security", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.error("PAGEERR", e.message));
await page.goto(pathToFileURL(PAGE).href, { waitUntil: "load" });
await page.waitForFunction("window.__ready === true", { timeout: 40000 });
await page.waitForTimeout(900);
const dur = await page.evaluate(() => window.__dur || 6);
const N = Math.max(2, Math.round(dur * FPS));
for (let i = 0; i < N; i++) {
  await page.evaluate((t) => window.__frame(t), i / (N - 1));
  await page.evaluate(() => (window.__settle ? window.__settle() : new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))));
  await page.screenshot({ path: `${OUT}/f_${String(i).padStart(4, "0")}.png`, type: "png" });
  if ((i + 1) % 30 === 0) console.log(`captured ${i + 1}/${N}`);
}
console.log(`DONE ${N} frames (${dur}s) → ${OUT}`);
await browser.close();
