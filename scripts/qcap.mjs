// Quick sanity capture: 7 frames across the timeline + surfaces page/console errors.
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
const PAGE = process.env.PAGE;
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome-stable", args: ["--no-sandbox", "--disable-gpu", "--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--allow-file-access-from-files", "--disable-web-security", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on("pageerror", (e) => console.error("PAGEERR", e.message));
page.on("console", (m) => { if (m.type() === "error") console.error("CONSOLE", m.text()); });
await page.goto(pathToFileURL(PAGE).href, { waitUntil: "load" });
await page.waitForFunction("window.__ready===true", { timeout: 45000 });
await page.waitForTimeout(800);
const ts = [0.02, 0.12, 0.513, 0.520, 0.527, 0.74, 0.96];
for (let i = 0; i < ts.length; i++) {
  await page.evaluate((t) => window.__frame(t), ts[i]);
  await page.evaluate(() => window.__settle());
  await page.screenshot({ path: `/tmp/q_${i}.png` });
}
console.log("DONE 7 frames");
await browser.close();
