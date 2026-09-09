/** Read-only real run inspection. Local mode renders local UI with the deployed
 * viewer-token and asset-signing endpoints; it never injects data or owner auth.
 * Production mode has no request replacement. No generation or mutation controls.
 */
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";

const production = "https://youtube-studio-ai.vercel.app";
const base = process.env.UI_PROOF_BASE ?? production;
assert.ok([production, "http://127.0.0.1:3010", "http://127.0.0.1:3312"].includes(base));
const local = base !== production;
const runId = "js74tws8jvgzc4tvat86htgv4h88ny68";
const outputDir = await mkdtemp(join(tmpdir(), "ysa-run-media-layout-"));
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const errors: string[] = [], results: unknown[] = [];
try {
  for (const [name, width, fontSize] of [["desktop", 1440, 16], ["mobile", 390, 16], ["large-text", 390, 32]] as const) {
    const context = await browser.newContext({ viewport: { width, height: 1100 } });
    try {
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      const queries: string[] = [];
      page.on("websocket", (socket) => socket.on("framesent", ({ payload }) => {
        try { const message = JSON.parse(String(payload));
          for (const item of message.modifications ?? []) if (item.type === "Add") queries.push(item.udfPath);
        } catch { /* binary or transport frame, not a query */ }
      }));
      if (local) for (const path of ["/api/auth/convex-token", "/api/asset-url"]) {
        await page.route(`${base}${path}*`, async (route) => {
          assert.equal(route.request().method(), "GET");
          const url = new URL(route.request().url());
          const response = await context.request.get(production + url.pathname + url.search);
          await route.fulfill({ response });
        });
      }
      await page.goto(`${base}/runs/${runId}`, { waitUntil: "domcontentloaded" });
      const section = page.getByRole("region", { name: "Media", exact: true });
      await section.waitFor({ timeout: 45_000 });
      await page.evaluate((size) => { document.documentElement.style.fontSize = `${size}px`; }, fontSize);
      await section.locator("[data-current-thumbnail] img").waitFor();
      await section.locator("[data-current-thumbnail] img").scrollIntoViewIfNeeded();
      await page.waitForFunction(() => {
        const image = document.querySelector<HTMLImageElement>("[data-current-thumbnail] img");
        return image?.complete && image.naturalWidth > 0;
      });
      await page.waitForFunction(() => [...document.querySelectorAll<HTMLMediaElement>(
        '[aria-labelledby="recorded-work-title"] video, [aria-labelledby="recorded-work-title"] audio',
      )].length === 3 && [...document.querySelectorAll<HTMLMediaElement>(
        '[aria-labelledby="recorded-work-title"] video, [aria-labelledby="recorded-work-title"] audio',
      )].every((media) => media.readyState >= 2 && !media.error), undefined, { timeout: 30_000 });
      await section.scrollIntoViewIfNeeded();
      const geometry = await section.evaluate((root) => ({
        viewport: innerWidth, document: document.documentElement.scrollWidth,
        height: root.getBoundingClientRect().height,
        cards: [...root.querySelectorAll<HTMLElement>("[data-media-type]")].map((node) => ({
          type: node.dataset.mediaType, width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height,
        })),
        overflowing: [...root.querySelectorAll<HTMLElement>("*")].filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && (rect.right > innerWidth + 1 || rect.left < -1);
        }).map((node) => ({ tag: node.tagName, class: node.className })),
        media: [...root.querySelectorAll<HTMLMediaElement>("video,audio")].map((media) => ({
          type: media.tagName, duration: media.duration, ready: media.readyState, error: media.error?.code ?? null,
        })),
      }));
      await section.screenshot({ path: join(outputDir, `${name}.png`) });
      await page.screenshot({ path: join(outputDir, `${name}-page.png`), fullPage: true });
      console.log(JSON.stringify({ outputDir, name, geometry }));
      assert.deepEqual(geometry.overflowing, [], `${name}: nested horizontal clipping`);
      assert.ok(geometry.document <= geometry.viewport, `${name}: page overflow`);
      if (name === "desktop") assert.ok(geometry.cards.find((card) => card.type === "file")!.height < 210,
        "captions must not stretch to the video height");
      const captions = section.locator('[data-media-type="file"]').first();
      assert.equal(await captions.locator("video,audio,img").count(), 0);
      const captionUrl = await captions.getByRole("link", { name: /Open captions source/ }).getAttribute("href");
      assert.ok(captionUrl);
      const captionResponse = await context.request.get(captionUrl);
      assert.equal(captionResponse.status(), 200);
      assert.match(await captionResponse.text(), /\d{2}:\d{2}:\d{2},\d{3} --> /);
      for (const media of await section.locator("video,audio").all()) {
        const played = await media.evaluate(async (node: HTMLMediaElement) => {
          node.muted = true;
          const start = node.currentTime;
          await node.play();
          try {
            await new Promise((resolve) => setTimeout(resolve, 750));
            return node.currentTime > start + 0.1;
          } finally { node.pause(); }
        });
        assert.equal(played, true, "each saved video/audio control must start real muted playback");
      }
      await captions.locator("summary").focus(); await page.keyboard.press("Enter");
      assert.equal(await captions.locator("details[open]").count(), 1, "storage disclosure works by keyboard");
      assert.equal(queries.filter((query) => query === "videos:getRunMediaPresentation").length, 1);
      assert.ok(!queries.some((query) => ["assets:listRunAssets", "videos:getRunCurrentThumbnail"].includes(query)));
      results.push({ name, ...geometry, captionRead: true, playbackControls: 3, mediaQueryCount: 1 });
    } finally { await context.close(); }
  }
  assert.deepEqual(errors, []);
  await writeFile(join(outputDir, "results.json"), JSON.stringify({ base, localViewerProxy: local, runId, results, errors }, null, 2));
  console.log(JSON.stringify({ outputDir, base, localViewerProxy: local, results, errors }, null, 2));
} finally { await browser.close(); }
