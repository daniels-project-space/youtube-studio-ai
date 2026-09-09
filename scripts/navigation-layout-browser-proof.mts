/** Read-only navigation reflow and keyboard checks on the actual app. */
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const production = "https://youtube-studio-ai.vercel.app";
const base = process.env.UI_PROOF_BASE ?? production;
assert.ok([production, "http://127.0.0.1:3312"].includes(base));
const outputDir = await mkdtemp(join(tmpdir(), "ysa-navigation-reflow-"));
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const results: unknown[] = [], errors: string[] = [];
try {
  for (const [name, width, fontSize, path] of [
    ["large-text", 390, 32, "/channels"], ["phone", 390, 16, "/golden"],
    ["small-phone", 320, 16, "/library"], ["tablet", 768, 16, "/runs"],
    ["desktop", 1440, 16, "/channels"], ["desktop-large-text", 1440, 32, "/golden"],
  ] as const) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    try {
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      if (base !== production) for (const endpoint of ["/api/auth/convex-token", "/api/asset-url"]) {
        await page.route(`${base}${endpoint}*`, async (route) => {
          assert.equal(route.request().method(), "GET");
          const url = new URL(route.request().url());
          await route.fulfill({ response: await context.request.get(production + url.pathname + url.search) });
        });
      }
      await page.goto(base + path, { waitUntil: "domcontentloaded" });
      const nav = page.getByRole("complementary", { name: "Studio navigation" });
      await nav.waitFor({ timeout: 45000 });
      await page.evaluate((size) => { document.documentElement.style.fontSize = `${size}px`; }, fontSize);
      // Wait for real channel data before capturing the shell; skeleton-only images are not visual proof.
      const switcher = page.locator(".channel-switcher-button");
      await switcher.click();
      await page.getByRole("listbox").getByRole("option").nth(1).waitFor({ timeout: 45000 });
      await switcher.click();
      const geometry = await nav.evaluate((root) => ({
        viewport: innerWidth, height: root.getBoundingClientRect().height,
        controls: [...root.querySelectorAll<HTMLElement>(".studio-nav-item")].filter((node) =>
          node.getBoundingClientRect().width > 0 && !node.closest(".studio-nav-more-menu"),
        ).map((node) => {
          const range = document.createRange(); range.selectNodeContents(node.querySelector(".studio-nav-copy")!);
          const text = range.getBoundingClientRect(), box = node.getBoundingClientRect();
          return { label: node.textContent?.trim(), width: box.width, height: box.height,
            textWidth: text.width, textLeft: text.left, textRight: text.right, left: box.left, right: box.right,
            top: box.top, bottom: box.bottom, viewportHeight: innerHeight };
        }),
      }));
      await page.screenshot({ path: join(outputDir, `${name}.png`) });
      console.log(JSON.stringify({ name, outputDir, geometry }));
      assert.ok(geometry.controls.every((control) => control.textLeft >= control.left - 1 &&
        control.textRight <= control.right + 1 && control.bottom <= control.viewportHeight + 1 &&
        control.top >= -1 && control.height >= 44), `${name}: navigation text/controls must fit their actual targets`);
      if (width > 860) {
        // A scrolled rail may clip offscreen links. Focusing each must reveal an unobscured target.
        const toolbox = nav.locator(".studio-toolbox");
        if (await toolbox.getAttribute("open") === null) await toolbox.locator("summary").click();
        for (const label of ["Studio", "Channels", "Production", "Schedule", "Library", "Golden modules", "Settings"]) {
          const link = nav.getByRole("link", { name: label, exact: true });
          await link.focus();
          assert.equal(await link.evaluate((node) => {
            const box = node.getBoundingClientRect();
            return node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
          }), true, `${label}: keyboard focus reveals the actual clickable target`);
        }
      }
      if (width <= 860) {
        const more = nav.getByRole("button", { name: "More", exact: true });
        await more.focus(); await page.keyboard.press("Enter");
        const menu = page.locator("#studio-mobile-more-menu"); await menu.waitFor();
        await page.screenshot({ path: join(outputDir, `${name}-more.png`) });
        const direct = geometry.controls.map((control) => control.label);
        for (const label of ["Studio", "Channels", "Production", "Schedule", "Library"]) {
          assert.equal(await nav.getByRole("link", { name: label, exact: true }).count() >= 1, true);
          if (!direct.includes(label)) await menu.getByRole("link", { name: label, exact: true }).waitFor();
        }
        const library = menu.getByRole("link", { name: "Library", exact: true });
        await library.focus(); await page.keyboard.press("Escape");
        await menu.waitFor({ state: "detached" });
        assert.equal(await more.evaluate((node) => node === document.activeElement), true,
          "closing the menu from a focused link returns focus to More");
        await more.click(); await library.click();
        await page.waitForURL(base + "/library");
        assert.equal(await page.locator("#studio-mobile-more-menu").count(), 0);
      }
      await switcher.click();
      const options = page.getByRole("listbox"); await options.waitFor();
      await page.screenshot({ path: join(outputDir, `${name}-channels.png`) });
      const option = options.getByRole("option").first();
      await option.focus(); await page.keyboard.press("Escape");
      await options.waitFor({ state: "detached" });
      assert.equal(await switcher.evaluate((node) => node === document.activeElement), true);
      await switcher.click();
      const channel = options.getByRole("option").nth(1);
      const channelName = await channel.locator("strong").innerText();
      await channel.click();
      assert.equal(await switcher.locator("strong").innerText(), channelName);
      assert.equal(await switcher.evaluate((node) => node === document.activeElement), true);
      await switcher.click();
      assert.equal(await options.getByRole("option").nth(1).getAttribute("aria-selected"), "true");
      await options.getByRole("option", { name: "All channels", exact: true }).click();
      assert.equal(await switcher.locator("strong").innerText(), "All channels");
      results.push({ name, path, ...geometry });
    } catch (error) {
      console.error("navigation-case-failed", name, error);
      throw error;
    } finally {
      await Promise.all(context.pages().map((page) => page.unrouteAll({ behavior: "ignoreErrors" })));
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(join(outputDir, "results.json"), JSON.stringify({ base, results, errors }, null, 2));
  console.log(JSON.stringify({ outputDir, cases: results.length, errors }));
} finally { await browser.close(); }
