/** Read-only app proof: scrolling content must not paint through navigation. */
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const production = "https://youtube-studio-ai.vercel.app";
const base = process.env.UI_PROOF_BASE ?? production;
assert.ok([production, "http://127.0.0.1:3312"].includes(base));
const outputDir = await mkdtemp(join(tmpdir(), "ysa-topbar-contrast-"));
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const results: unknown[] = [], failures: string[] = [], errors: string[] = [], privateRequests: string[] = [];
try {
  for (const [name, width, fontSize, path] of [
    ["desktop-library", 1440, 16, "/library"],
    ["phone-library", 390, 16, "/library"],
    ["phone-large-assets", 390, 32, "/studio-assets"],
    ["small-library", 320, 16, "/library"],
    ["desktop-golden", 1440, 16, "/golden"],
    ["desktop-large-golden", 1440, 32, "/golden"],
    ["phone-channels", 390, 16, "/channels"],
    ["tablet-production", 768, 16, "/runs"],
    ["phone-large-lofi", 390, 32, "/lofi"],
  ] as const) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
    try {
      const page = await context.newPage();
      page.on("pageerror", error => errors.push(error.message));
      page.on("request", request => {
        if (new URL(request.url()).pathname === "/api/studio-assets") privateRequests.push(request.method());
      });
      if (base !== production) for (const endpoint of ["/api/auth/convex-token", "/api/asset-url", "/api/operations/elevation"]) {
        await page.route(`${base}${endpoint}*`, async route => {
          assert.equal(route.request().method(), "GET");
          const url = new URL(route.request().url());
          await route.fulfill({ response: await context.request.get(production + url.pathname + url.search) });
        });
      }
      await page.goto(base + path, { waitUntil: "domcontentloaded" });
      const header = page.locator(".studio-topbar"), main = page.locator("main.studio-main");
      await main.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 45000 });
      const switcher = header.locator(".channel-switcher-button");
      await switcher.click();
      await page.getByRole("listbox").getByRole("option").nth(1).waitFor({ timeout: 45000 });
      await switcher.click();
      // Channel data can arrive before the Library collection. A short
      // loading skeleton cannot exercise the required scrolled-content test.
      if (path === "/library") await main.locator(".video-grid .video-card").first().waitFor({ timeout: 45000 });
      if (path !== "/library") await page.locator(".operations-access-label")
        .filter({ hasText: /^Verify owner$/ }).waitFor({ state: "attached" });
      await page.mouse.move(0, 0);
      await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; }, fontSize);
      await page.evaluate(() => document.fonts.ready);
      // Keep the genuine content and layout. Place its heading underneath the
      // sticky bar; only the comparison capture temporarily hides the main.
      await main.getByRole("heading", { level: 1 }).first().evaluate(node => {
        window.scrollTo({ top: window.scrollY + node.getBoundingClientRect().top - 8, behavior: "instant" });
      });
      await page.screenshot({ path: join(outputDir, `${name}.png`), animations: "disabled", caret: "hide" });
      const surfaces = width <= 860 ? ["header", "dock", "menu"] : ["header"];
      for (const surface of surfaces) {
        const navigation = surface === "header" ? header : page.locator(
          surface === "dock" ? ".studio-sidebar" : ".studio-nav-more-menu");
        const more = page.getByRole("button", { name: "More", exact: true });
        if (surface === "menu") {
          await more.focus();
          await page.keyboard.press("Enter");
          await navigation.waitFor();
          const tools = navigation.locator("summary");
          if (!await tools.evaluate(node => node.parentElement!.hasAttribute("open"))) {
            await tools.focus(); await page.keyboard.press("Enter");
          }
          await page.mouse.move(0, 0);
          await page.screenshot({ path: join(outputDir, `${name}-menu-page.png`), animations: "disabled", caret: "hide" });
        }
        const bounds = (await navigation.boundingBox())!;
        // Inward integer edges exclude fractional screenshot padding outside
        // the bar; an outer page pixel is not navigation text bleed.
        const clip = { x: Math.ceil(bounds.x), y: Math.ceil(bounds.y),
          width: Math.floor(bounds.x + bounds.width) - Math.ceil(bounds.x),
          height: Math.floor(bounds.y + bounds.height) - Math.ceil(bounds.y) };
        const radii = await navigation.evaluate(node => {
          const style = getComputedStyle(node);
          return [style.borderTopLeftRadius, style.borderTopRightRadius,
            style.borderBottomRightRadius, style.borderBottomLeftRadius].map(value => parseFloat(value));
        });
        const before = await page.screenshot({ clip, animations: "disabled", caret: "hide" });
        await writeFile(join(outputDir, `${name}-${surface}.png`), before);
        const scroll = await page.evaluate(() => window.scrollY);
        assert.ok(scroll > 0, `${name}: must exercise a genuinely scrolled page`);
        await main.evaluate(node => { node.style.visibility = "hidden"; });
        const withoutContent = await page.screenshot({ clip, animations: "disabled", caret: "hide" });
        await writeFile(join(outputDir, `${name}-${surface}-content-hidden.png`), withoutContent);
        await main.evaluate(node => { node.style.removeProperty("visibility"); });
        // Decode with the browser's own PNG support; no image-processing
        // dependency and no generated/edited substitute screenshot.
        const { changedPixels, affectedRatio, outsidePixels } = await page.evaluate(async ({ first, second, bounds, clip, radii }) => {
          const [left, right] = await Promise.all([first, second].map(async encoded => {
            const image = new Image(); image.src = `data:image/png;base64,${encoded}`;
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
            const context = canvas.getContext("2d")!; context.drawImage(image, 0, 0);
            return context.getImageData(0, 0, canvas.width, canvas.height);
          }));
          if (left.width !== right.width || left.height !== right.height) throw new Error("Hiding content changed navigation geometry");
          let changedPixels = 0, comparedPixels = 0, outsidePixels = 0;
          for (let i = 0; i < left.data.length; i += 4) {
            // A rectangular screenshot includes the page outside rounded
            // corners. Compare the actual painted surface, not those external
            // pixels (or its one-pixel antialiased contour).
            const x = (i / 4) % left.width + clip.x - bounds.x + 0.5;
            const y = Math.floor(i / 4 / left.width) + clip.y - bounds.y + 0.5;
            const corners = [[x, y], [bounds.width - x, y],
              [bounds.width - x, bounds.height - y], [x, bounds.height - y]];
            const outside = corners.some(([cx, cy], index) => {
              const radius = Math.min(radii[index], bounds.width / 2, bounds.height / 2);
              return radius > 0 && cx < radius && cy < radius &&
                Math.hypot(radius - cx, radius - cy) > radius - 1;
            });
            if (outside) { outsidePixels++; continue; }
            comparedPixels++;
            if ([0, 1, 2].some(offset => Math.abs(left.data[i + offset] - right.data[i + offset]) > 2)) changedPixels++;
          }
          if (comparedPixels === 0) throw new Error("No navigation surface pixels compared");
          return { changedPixels, affectedRatio: changedPixels / comparedPixels, outsidePixels };
        }, { first: before.toString("base64"), second: withoutContent.toString("base64"), bounds, clip, radii });
        if (affectedRatio > 0.001) failures.push(`${name}/${surface}: content changes ${(affectedRatio * 100).toFixed(2)}% of navigation pixels`);
        results.push({ name, path, surface, scroll, changedPixels, affectedRatio, outsidePixels });
        if (surface === "menu") {
          await navigation.getByRole("link", { name: "Golden modules", exact: true }).focus();
          await page.keyboard.press("Escape");
          assert.equal(await more.getAttribute("aria-expanded"), "false");
          assert.equal(await more.evaluate(node => node === document.activeElement), true);
        }
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      if (overflow) failures.push(`${name}: horizontal overflow`);
      await switcher.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("listbox").waitFor();
      await page.getByRole("listbox").getByRole("option").first().focus();
      await page.keyboard.press("Escape");
      assert.equal(await switcher.evaluate(node => node === document.activeElement), true);
    } finally {
      await Promise.all(context.pages().map(page => page.unrouteAll({ behavior: "ignoreErrors" })));
      await context.close();
    }
  }
  const evidence = { base, outputDir, results, failures, errors, privateRequests };
  await writeFile(join(outputDir, "results.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
  assert.deepEqual(errors, []); assert.deepEqual(privateRequests, []); assert.deepEqual(failures, []);
} finally { await browser.close(); }
