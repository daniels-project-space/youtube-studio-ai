/** Direct production Library/channel playback; no fixtures, proxies or writes. */
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const base = "https://youtube-studio-ai.vercel.app";
const expectedRevision = process.env.EXPECTED_REVISION;
assert.match(expectedRevision ?? "", /^[a-f0-9]{40}$/, "Supply the exact deployed EXPECTED_REVISION");
const title = "7 Secrets of Battlefield Relic Preservation Revealed";
const runId = "js76ghf4s44b4w5d97cs2f49bd89znxa";
const outputDir = await mkdtemp(join(tmpdir(), "ysa-library-player-production-"));
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const results: unknown[] = [], failures: string[] = [];
try {
  for (const [name, route, width] of [["library-desktop", "/library", 1440],
    ["library-phone", "/library", 390],
    ["channel-desktop", "/channels/inked-histories-1783204937695?tab=library", 1440]] as const) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors: string[] = [], writes: string[] = [], requests: unknown[] = [];
    try {
      const health = await (await context.request.get(`${base}/api/health`)).json();
      assert.equal(health.revision, expectedRevision);
      page.on("pageerror", error => errors.push(error.message));
      await page.route(`${base}/api/**`, async request => {
        if (!["GET", "HEAD", "OPTIONS"].includes(request.request().method())) {
          writes.push(new URL(request.request().url()).pathname); await request.abort();
        } else await request.continue();
      });
      page.on("response", response => {
        const url = new URL(response.url());
        if (url.pathname === "/api/asset-url") requests.push({ path: url.pathname, status: response.status() });
      });
      await page.goto(base + route, { waitUntil: "domcontentloaded", timeout: 45000 });
      const opener = page.getByRole("button", { name: `Open ${title}`, exact: true }).first();
      await opener.waitFor({ timeout: 45000 });
      await opener.click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      await page.screenshot({ path: join(outputDir, `${name}-opened.png`) });
      assert.equal(await dialog.locator("iframe").count(), 0, "a retained R2 master must take precedence over its YouTube upload ID");
      const video = dialog.locator("video");
      await video.waitFor({ timeout: 30000 });
      await page.waitForFunction(() => document.querySelector<HTMLVideoElement>('[role="dialog"] video')!.readyState >= 2);
      await video.evaluate(async element => { const media = element as HTMLVideoElement; await media.play(); media.pause(); media.currentTime = 15; });
      await page.waitForFunction(() => { const media = document.querySelector<HTMLVideoElement>('[role="dialog"] video')!;
        return media.readyState >= 2 && !media.seeking && media.paused && Math.abs(media.currentTime - 15) < .1; });
      const playback = await video.evaluate(element => { const media = element as HTMLVideoElement;
        return { sourcePath: new URL(media.currentSrc).pathname, duration: media.duration, time: media.currentTime,
          readyState: media.readyState, error: media.error?.code ?? null, state: media.parentElement?.dataset.signedVideoState }; });
      assert.ok(playback.sourcePath.endsWith(`/runs/${runId}/final.mp4`));
      assert.equal(playback.error, null); assert.equal(playback.state, "ready");
      const geometry = await dialog.evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }));
      assert.ok(geometry.scrollWidth <= geometry.width + 1);
      await page.evaluate(() => document.fonts.ready);
      const screenshot = join(outputDir, `${name}-player.png`);
      await page.screenshot({ path: screenshot });
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      assert.equal(await opener.evaluate(element => element === document.activeElement), true);
      assert.deepEqual(errors, []); assert.deepEqual(writes, []);
      results.push({ name, route, width, revision: health.revision, playback, geometry, screenshot, requests, errors, writes });
    } catch (error) {
      failures.push(`${name}: ${String(error)}`);
      await page.screenshot({ path: join(outputDir, `${name}-failure.png`) }).catch(() => {});
      results.push({ name, route, errors, writes, requests });
    } finally { await page.unrouteAll({ behavior: "ignoreErrors" }); await context.close(); }
  }
} finally {
  await browser.close();
  const report = { base, expectedRevision, outputDir, scope: "Direct retained playback only; not metadata repair or quality approval", results, failures };
  await writeFile(join(outputDir, "results.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
assert.deepEqual(failures, []);
