/** Actual public reference page, image bytes, disclosure and navigation. No renders or owner mutation. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { goldenProofMediaPresentation } from "../src/engine/goldenProofMedia";

const production = "https://youtube-studio-ai.vercel.app", base = process.env.UI_PROOF_BASE ?? production;
assert.ok([production, "http://127.0.0.1:3312"].includes(base));
const lore = process.env.REFERENCE_PAGE === "lore";
assert.ok(!process.env.REFERENCE_PAGE || ["lore", "lofi"].includes(process.env.REFERENCE_PAGE));
const profile = lore
  ? { route: "/loreshort", media: "loreshort-smith4k-image", module: "loreshort", link: "Open lore references" }
  : { route: "/lofi", media: "lofi-beachcafe-image", module: "lofi", link: "Open Lo-fi references" };
const reference = goldenProofMediaPresentation(profile.media, "reference", "image");
const outputDir = await mkdtemp(join(tmpdir(), `ysa-reference-${lore ? "lore" : "lofi"}-`));
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const results: unknown[] = [], failures: string[] = [], errors: string[] = [], mutations: string[] = [];
try {
  for (const [name, width, fontSize] of [["desktop",1440,16],["phone",390,16],["small-phone",320,16],["desktop-large",1440,32],["phone-large",390,32]] as const) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
    try {
      const page = await context.newPage();
      page.on("pageerror", error => errors.push(error.message));
      page.on("request", request => {
        const url = new URL(request.url());
        if (url.origin === base && url.pathname.startsWith("/api/") && request.method() !== "GET") mutations.push(url.pathname);
      });
      if (base !== production) for (const endpoint of ["/api/auth/convex-token", "/api/asset-url", "/api/operations/elevation"]) {
        await page.route(`${base}${endpoint}*`, async route => {
          assert.equal(route.request().method(), "GET");
          const url = new URL(route.request().url());
          await route.fulfill({ response: await context.request.get(production + url.pathname + url.search) });
        });
      }
      const imageResponse = page.waitForResponse(response => new URL(response.url()).pathname === reference.url);
      await page.goto(base + profile.route, { waitUntil: "domcontentloaded" });
      const title = page.locator(".studio-main h1"); await title.waitFor({ timeout: 45000 });
      const content = title.locator("xpath=ancestor::*[contains(@class,'page')][1]");
      const picture = content.locator(`img[src='${reference.url}']`);
      await picture.evaluate(async node => { await (node as HTMLImageElement).decode(); });
      await page.locator(".operations-access-label").filter({ hasText: /^Verify owner$/ }).waitFor({ state: "attached" });
      const response = await imageResponse;
      assert.equal(response.status(), 200);
      assert.equal(createHash("sha256").update(await response.body()).digest("hex"), reference.sha256,
        "the browser receives the exact current reference, not a substitute image");
      await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; }, fontSize);
      await page.evaluate(() => document.fonts.ready);
      const frame = picture.locator("xpath=..");
      if (await frame.getAttribute("data-proof-media-sha256") !== reference.sha256 ||
          await frame.getAttribute("data-proof-media-status") !== "reference") failures.push(`${name}: missing manifest-bound presentation`);
      const imageGeometry = await picture.evaluate(node => {
        const image = node as HTMLImageElement, box = image.getBoundingClientRect();
        return { width: box.width, height: box.height, top: box.top, bottom: box.bottom,
          naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, objectFit: getComputedStyle(image).objectFit };
      });
      const ratioError = Math.abs(imageGeometry.width / imageGeometry.height - imageGeometry.naturalWidth / imageGeometry.naturalHeight);
      if (ratioError > 0.01) failures.push(`${name}: reference composition is cropped or stretched (${ratioError.toFixed(3)})`);
      const caption = (await content.locator("figcaption").boundingBox())!;
      if (caption.y < imageGeometry.bottom - 1) failures.push(`${name}: caption covers the reference image`);
      if (fontSize === 16 && imageGeometry.top > 260) failures.push(`${name}: image starts after ${imageGeometry.top}px of chrome and title`);
      const visibleWords = (await content.innerText()).trim().split(/\s+/).length;
      if (visibleWords > 155) failures.push(`${name}: ${visibleWords} words before opening details`);
      if (await page.locator("main main").count()) failures.push(`${name}: nested main landmarks`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      if (overflow) failures.push(`${name}: horizontal overflow`);
      await page.screenshot({ path: join(outputDir, `${name}.png`) });
      await page.screenshot({ path: join(outputDir, `${name}-full.png`), fullPage: true });
      const details = content.locator("details");
      if (await details.count() !== 1) failures.push(`${name}: one native usage/release disclosure is required`);
      else {
        assert.equal(await details.getAttribute("open"), null);
        const summary = details.locator("summary"); await summary.focus();
        const summaryTarget = await summary.evaluate(node => {
          const b = node.getBoundingClientRect();
          return b.height >= 44 && [[b.x+b.width/2,b.top+2],[b.x+b.width/2,b.bottom-2]]
            .every(([x,y]) => node.contains(document.elementFromPoint(x,y)));
        });
        if (!summaryTarget) failures.push(`${name}: disclosure target is small or covered`);
        await page.keyboard.press("Enter");
        assert.notEqual(await details.getAttribute("open"), null);
        assert.match(await details.innerText(), /Historical samples remain retained for audit/);
        if (lore) {
          assert.match(await details.innerText(), /opening references cannot be recycled across later narration/);
          assert.match(await details.innerText(), /Runtime not qualified/);
          assert.match(await details.innerText(), /exact final master/);
        } else {
          assert.match(await details.innerText(), /exact released bytes/);
          assert.match(await details.innerText(), /before any spend/);
        }
        const minimumFont = await content.evaluate(root => Math.min(...[...root.querySelectorAll("p, li > strong, summary, a, figcaption strong")]
          .map(node => parseFloat(getComputedStyle(node).fontSize))));
        if (minimumFont < 14 * fontSize / 16) failures.push(`${name}: reading text is too small (${minimumFont}px)`);
        const clippedText = await content.evaluate(root => [...root.querySelectorAll<HTMLElement>("p, li > strong, h1, h2, a, summary")]
          .filter(node => { const b = node.getBoundingClientRect(); return b.width > 0 && node.scrollWidth > node.clientWidth + 1; })
          .map(node => node.textContent?.trim()));
        if (clippedText.length) failures.push(`${name}: clipped text: ${clippedText.join(" | ")}`);
        await page.screenshot({ path: join(outputDir, `${name}-details.png`), fullPage: true });
        // Full-page enlarged-text captures are too tall to inspect at native
        // scale. Capture each actual section at viewport size as well.
        for (const [index, section] of (await details.locator("section").all()).entries()) {
          await section.evaluate(node => { node.scrollIntoView({ block: "start" }); window.scrollBy(0, -150); });
          await page.screenshot({ path: join(outputDir, `${name}-details-section-${index + 1}.png`) });
        }
        await summary.focus(); await page.keyboard.press("Enter"); assert.equal(await details.getAttribute("open"), null);
      }
      const original = content.getByRole("link", { name: "Open full image", exact: true });
      let imageAction: unknown;
      if (await original.count() !== 1) failures.push(`${name}: exact image action is missing`);
      else {
        assert.equal(await original.getAttribute("href"), reference.url);
        await original.focus();
        const target = await original.evaluate(node => {
          const b = node.getBoundingClientRect();
          return { height: b.height, top: b.top, bottom: b.bottom, visible: [[b.x+b.width/2,b.y+2],[b.x+b.width/2,b.bottom-2]].every(([x,y]) => node.contains(document.elementFromPoint(x,y))) };
        });
        imageAction = target;
        await page.screenshot({ path: join(outputDir, `${name}-focused.png`) });
        if (target.height < 44 || !target.visible) failures.push(`${name}: image link is small or covered`);
        await original.click(); await page.waitForURL(base + reference.url);
        assert.ok(await page.locator("img").evaluate(node => (node as HTMLImageElement).naturalWidth > 0));
        await page.goBack({ waitUntil: "domcontentloaded" }); await title.waitFor();
      }
      const catalog = content.getByRole("link", { name: "Golden modules", exact: true });
      if (await catalog.count() !== 1) failures.push(`${name}: catalog return link is missing`);
      else {
        await catalog.click(); await page.waitForURL(base + "/golden");
        await page.getByRole("heading", { name: "Golden modules", exact: true }).waitFor();
        const card = page.locator(`details[data-module-key="${profile.module}"]`);
        const category = card.locator("xpath=ancestor::details[@aria-label][1]");
        if (await category.getAttribute("open") === null) await category.locator(":scope > summary").click();
        if (await card.getAttribute("open") === null) await card.locator(":scope > summary").click();
        await card.getByRole("link", { name: profile.link, exact: true }).click();
        await page.waitForURL(base + profile.route); await title.waitFor();
      }
      results.push({ name, visibleWords, imageGeometry, imageAction, ratioError, overflow });
    } finally { await Promise.all(context.pages().map(page => page.unrouteAll({ behavior: "ignoreErrors" }))); await context.close(); }
  }
  const result = { base, profile, outputDir, results, failures, errors, mutations };
  await writeFile(join(outputDir,"results.json"), JSON.stringify(result,null,2)); console.log(JSON.stringify(result,null,2));
  assert.deepEqual(errors, []); assert.deepEqual(mutations, []); assert.deepEqual(failures, []);
} finally { await browser.close(); }
