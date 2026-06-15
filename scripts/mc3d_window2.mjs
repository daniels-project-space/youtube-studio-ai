// Resumable windowed capture. Env: PAGE, OUTDIR, T0, T1 (sec), FPS, OFFSET (global
// frame index for this window). Writes f_<OFFSET+i>.png and SKIPS any that exist,
// so re-running after an interruption continues where it stopped.
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
const PAGE = process.env.PAGE, OUT = process.env.OUTDIR;
const FPS = parseInt(process.env.FPS || "30", 10);
const T0 = parseFloat(process.env.T0 || "0"), T1 = parseFloat(process.env.T1 || "5");
const OFFSET = parseInt(process.env.OFFSET || "0", 10);
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome-stable", args: ["--no-sandbox", "--disable-gpu", "--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--allow-file-access-from-files", "--disable-web-security", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on("pageerror", (e) => console.error("PAGEERR", e.message));
await page.goto(pathToFileURL(PAGE).href, { waitUntil: "load" });
await page.waitForFunction("window.__ready===true", { timeout: 45000 });
await page.waitForTimeout(600);
const total = await page.evaluate(() => window.__dur);
const N = Math.round((T1 - T0) * FPS);
for (let i = 0; i < N; i++) {
  const gi = OFFSET + i, fn = `${OUT}/f_${String(gi).padStart(4, "0")}.png`;
  if (existsSync(fn)) continue;
  const t = (T0 + i / FPS) / total;
  await page.evaluate((tt) => window.__frame(tt), Math.min(1, Math.max(0, t)));
  await page.evaluate(() => window.__settle());
  await page.screenshot({ path: fn });
  if ((i + 1) % 60 === 0) console.log(`half[off ${OFFSET}] ${i + 1}/${N}`);
}
console.log(`half done [${T0}-${T1}] offset ${OFFSET}`);
await browser.close();
