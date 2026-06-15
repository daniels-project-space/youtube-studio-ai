// 5-second windowed capture for fast per-issue iteration.
// Env: PAGE, OUTDIR, T0 (sec), T1 (sec), FPS. Renders only that slice of the timeline.
import { chromium } from "playwright";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";
const PAGE = process.env.PAGE, OUT = process.env.OUTDIR;
const FPS = parseInt(process.env.FPS || "30", 10);
const T0 = parseFloat(process.env.T0 || "0"), T1 = parseFloat(process.env.T1 || "5");
if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome-stable", args: ["--no-sandbox", "--disable-gpu", "--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--allow-file-access-from-files", "--disable-web-security", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on("pageerror", (e) => console.error("PAGEERR", e.message));
await page.goto(pathToFileURL(PAGE).href, { waitUntil: "load" });
await page.waitForFunction("window.__ready===true", { timeout: 45000 });
await page.waitForTimeout(600);
const total = await page.evaluate(() => window.__dur);
const N = Math.max(2, Math.round((T1 - T0) * FPS));
for (let i = 0; i < N; i++) {
  const t = (T0 + i / FPS) / total;
  await page.evaluate((tt) => window.__frame(tt), Math.min(1, Math.max(0, t)));
  await page.evaluate(() => (window.__settle ? window.__settle() : new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))));
  await page.screenshot({ path: `${OUT}/f_${String(i).padStart(4, "0")}.png` });
}
console.log(`DONE ${N} frames [${T0}-${T1}s] -> ${OUT}`);
await browser.close();
