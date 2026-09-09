/** Real Studio carousel, metadata and saved-video interaction; no data writes. */
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const production = "https://youtube-studio-ai.vercel.app";
const base = process.env.UI_PROOF_BASE ?? production;
assert.ok([production, "http://127.0.0.1:3312"].includes(base));
const outputDir = await mkdtemp(join(tmpdir(), "ysa-recent-renders-proof-"));
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const failures: string[] = [], errors: string[] = [], mutations: string[] = [], results: unknown[] = [];
try {
  for (const [name, width, fontSize] of [["desktop",1440,16], ["phone",390,16], ["small-phone",320,16],
    ["desktop-large",1440,32], ["phone-large",390,32]] as const) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.route(`${base}/api/**`, async route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() !== "GET") { mutations.push(url.pathname); await route.abort(); return; }
      // Only local development borrows public production session/media reads.
      // Exact production validation leaves every response untouched.
      if (base !== production && ["/api/auth/convex-token", "/api/asset-url", "/api/operations/elevation"].includes(url.pathname)) {
        await route.fulfill({ response: await context.request.get(production + url.pathname + url.search) });
      } else await route.continue();
    });
    try {
      await page.goto(base, { waitUntil: "domcontentloaded" });
      const section = page.locator('section[aria-labelledby="recent-renders-title"]');
      await section.getByRole("button", { name: /^Open (R2 render|saved video):/ }).first().waitFor({ timeout: 45000 });
      await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; }, fontSize);
      await page.evaluate(() => document.fonts.ready);
      await section.evaluate(node => { node.scrollIntoView({block:"start"}); window.scrollBy(0,-140); });
      const geometry = await section.evaluate(root => {
        const cards = [...root.querySelectorAll<HTMLButtonElement>('button[aria-label^="Open "]')];
        return {
          pageWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
          backgroundRepeat: getComputedStyle(document.body).backgroundRepeat,
          backgroundAttachment: getComputedStyle(document.body).backgroundAttachment,
          cards: cards.map(card => {
            const title = card.querySelector("strong")!, metadata = card.querySelector("small")!;
            const bounds = card.getBoundingClientRect(), copy = metadata.getBoundingClientRect();
            return { title: title.textContent, titleSize: parseFloat(getComputedStyle(title).fontSize),
              metadataSize: parseFloat(getComputedStyle(metadata).fontSize), width: bounds.width,
              fullTitleAvailable: title.getAttribute("title") === title.textContent && card.getAttribute("aria-label")?.endsWith(title.textContent ?? ""),
              titleClamped: title.scrollHeight > title.clientHeight + 1,
              clippedMetadata: metadata.scrollWidth > metadata.clientWidth + 1 || copy.bottom > bounds.bottom - 4 };
          }),
          controls: [...root.querySelectorAll<HTMLButtonElement>('header button')].map(button => ({
            label: button.getAttribute("aria-label"), width: button.getBoundingClientRect().width,
            height: button.getBoundingClientRect().height })),
        };
      });
      if (geometry.scrollWidth > geometry.pageWidth + 1) failures.push(`${name}: page overflow`);
      if (!geometry.backgroundRepeat.split(",").every(value => value.trim() === "no-repeat") ||
          !geometry.backgroundAttachment.split(",").every(value => value.trim() === "fixed")) failures.push(`${name}: viewport background tiles through long pages`);
      if (geometry.cards.some(card => card.titleSize < fontSize * .9375 || card.metadataSize < fontSize * .8125)) failures.push(`${name}: undersized title/metadata`);
      if (geometry.cards.some(card => !card.fullTitleAvailable || card.clippedMetadata)) failures.push(`${name}: lost title or clipped metadata`);
      if (geometry.controls.some(button => button.width < 44 || button.height < 44)) failures.push(`${name}: undersized controls`);
      if ((await section.innerText()).includes("R2 masters")) failures.push(`${name}: implementation prose`);
      const next = section.getByRole("button", { name: "Next renders", exact: true });
      const previous = section.getByRole("button", { name: "Previous renders", exact: true });
      const track = section.locator('div[class*="__track"]').first();
      // Font reflow may preserve a previous snap offset. Establish the actual
      // start, then allow the scroll/resize observers to report that position.
      await track.evaluate(node => node.scrollTo({left:0,behavior:"instant"}));
      await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
      await page.waitForFunction(() => Boolean(document.querySelector('button[aria-label="Next renders"]:not(:disabled)')));
      if (!(await previous.isDisabled())) failures.push(`${name}: previous remains active at start`);
      await next.focus(); await page.keyboard.press("Enter");
      const moved = await track.evaluate(node => node.scrollLeft > 0);
      if (!moved) failures.push(`${name}: keyboard next doesn't move immediately with reduced motion`);
      for (let step = 0; step < geometry.cards.length + 3 && !(await next.isDisabled()); step++) {
        await next.click();
        await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
      }
      assert.ok(await next.isDisabled(), "Next disables at the real final card");
      assert.ok(!(await previous.isDisabled()), "Previous is available at the final card");
      const endOffset = await track.evaluate(node => node.scrollLeft);
      for (let step = 0; step < geometry.cards.length + 3 && !(await previous.isDisabled()); step++) {
        await previous.click();
        await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
      }
      assert.ok(await previous.isDisabled(), "Previous disables after returning to the first card");
      // Lazy thumbnails must be decoded before a screenshot is visual evidence.
      await page.waitForFunction(() => {
        const section = document.querySelector('section[aria-labelledby="recent-renders-title"]')!;
        const visible = [...section.querySelectorAll<HTMLElement>('[data-preview-state]')].filter(node => {
          const r = node.getBoundingClientRect(); return r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight;
        });
        return visible.length > 0 && visible.every(node => {
          const image = node.querySelector("img"), video = node.querySelector("video");
          return node.dataset.previewState === "ready" && (image ? image.complete && image.naturalWidth > 0 : video && video.readyState >= 2);
        });
      }, undefined, {timeout:30000});
      const visibleMedia = await section.evaluate(async node => {
        const media = [...node.querySelectorAll<HTMLImageElement | HTMLVideoElement>("img,video")].filter(element => {
          const r = element.getBoundingClientRect(); return r.width > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight;
        });
        await Promise.all(media.filter((element): element is HTMLImageElement => element.tagName === "IMG").map(image => image.decode()));
        return media.map(element => ({tag:element.tagName, opacity:getComputedStyle(element).opacity,
          width:element.getBoundingClientRect().width, height:element.getBoundingClientRect().height}));
      });
      assert.ok(visibleMedia.length > 0 && visibleMedia.every(media => media.width > 0 && media.height > 0 && media.opacity === "1"));
      await page.screenshot({ path: join(outputDir, `${name}.png`) });

      const card = section.getByRole("button", { name: /^Open (R2 render|saved video):/ }).first();
      await card.focus(); await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      assert.equal(await dialog.getByRole("heading").innerText(), geometry.cards[0].title, "expanded video exposes the complete title");
      const video = dialog.locator("video");
      await video.waitFor({timeout:30000});
      await video.evaluate(async node => {
        const media = node as HTMLVideoElement;
        await media.play();
      });
      await page.waitForFunction(() => { const media = document.querySelector('div[role="dialog"] video') as HTMLVideoElement | null;
        return media && media.readyState >= 2 && media.currentTime > .1 && !media.paused;
      }, undefined, {timeout:30000});
      const playback = await video.evaluate(node => {
        const media = node as HTMLVideoElement; media.pause();
        return {time:media.currentTime, readyState:media.readyState, error:media.error?.code ?? null};
      });
      const dialogGeometry = await dialog.evaluate(node => ({scrollWidth:node.scrollWidth, width:node.clientWidth}));
      if (dialogGeometry.scrollWidth > dialogGeometry.width + 1) failures.push(`${name}: dialog overflow`);
      await page.screenshot({path:join(outputDir, `${name}-player.png`)});
      await page.keyboard.press("Escape");
      await dialog.waitFor({state:"detached"});
      // The application intentionally restores focus on the next frame after
      // unmount; an immediate DOM assertion races that documented transition.
      const opener = await card.getAttribute("aria-label");
      await page.waitForFunction(label => document.activeElement?.getAttribute("aria-label") === label, opener, {timeout:3000});
      assert.equal(await card.evaluate(node => node === document.activeElement), true, "dialog returns keyboard focus to opener");
      results.push({name, ...geometry, moved, endOffset, visibleMedia, playback, dialogGeometry});
    } catch(error) { failures.push(`${name}: ${String(error)}`); }
    finally { await page.unrouteAll({behavior:"ignoreErrors"}); await context.close(); }
  }
  const report = {base,outputDir,results,failures,errors,mutations};
  await writeFile(join(outputDir,"results.json"),JSON.stringify(report,null,2)); console.log(JSON.stringify(report,null,2));
  assert.deepEqual(errors,[]); assert.deepEqual(mutations,[]); assert.deepEqual(failures,[]);
} finally { await browser.close(); }
