/** Read-only live Studio navigation, responsive layout and actionable widgets. */
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const production = "https://youtube-studio-ai.vercel.app", base = process.env.UI_PROOF_BASE ?? production;
assert.ok([production,"http://127.0.0.1:3312"].includes(base));
const outputDir = await mkdtemp(join(tmpdir(),"ysa-overview-proof-"));
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const failures: string[] = [], errors: string[] = [], mutations: string[] = [], results: unknown[] = [];
try {
  for (const [name,width,fontSize] of [["desktop",1440,16],["phone",390,16],["small-phone",320,16],["desktop-large",1440,32],["phone-large",390,32]] as const) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    try {
      page.on("pageerror", error => errors.push(error.message));
      page.on("request", request => { const url = new URL(request.url());
        if (url.origin === base && url.pathname.startsWith("/api/") && request.method() !== "GET") mutations.push(url.pathname);
      });
      // Local development uses only production's public read-only session and
      // signed media resolver. Production verification never uses this proxy.
      if (base !== production) for (const endpoint of ["/api/auth/convex-token","/api/asset-url","/api/operations/elevation"]) {
        await page.route(`${base}${endpoint}*`, async route => {
          assert.equal(route.request().method(),"GET"); const url = new URL(route.request().url());
          await route.fulfill({ response: await context.request.get(production + url.pathname + url.search) });
        });
      }
      await page.goto(base,{ waitUntil: "domcontentloaded" });
      await page.getByRole("heading",{ name: "Studio", exact: true }).waitFor({ timeout: 45000 });
      await page.waitForFunction(() => { const el = document.querySelector('[aria-label="Studio control overview"]');
        return el && !el.textContent?.includes("Reading studio state") && !el.textContent?.includes("Syncing");
      }, undefined, { timeout: 45000 });
      await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; },fontSize);
      await page.evaluate(() => document.fonts.ready);
      const main = page.locator(".studio-main");
      const text = await main.innerText();
      if (/50-run spend|ON AIR|Master controls|Live route|\bPublished\b/.test(text)) failures.push(`${name}: misleading/redundant labels remain`);
      const rail = page.locator("[data-channel-rail]");
      const issues = page.locator('[data-overview-widget="issues"]');
      if (await issues.count() !== 1 || await rail.count() !== 1) {
        failures.push(`${name}: compact widgets/channel rail missing`);
        await page.screenshot({ path: join(outputDir,`${name}.png`), fullPage: true });
        continue;
      }
      const summary = issues.locator("summary");
      const issueCount = Number((await summary.locator("strong").innerText()).replace("Clear","0"));
      await summary.focus(); await page.keyboard.press("Enter");
      assert.notEqual(await issues.getAttribute("open"),null);
      assert.equal(await issues.locator("[data-issue-key]").count(),issueCount,"every counted issue has its own target");
      const issueTargets = await issues.locator("[data-issue-key]").evaluateAll(nodes => nodes.map(node => node.getAttribute("href")));
      assert.equal(new Set(issueTargets).size,issueTargets.length,"no duplicate issue targets");
      await summary.focus(); await page.keyboard.press("Enter");
      const analytics = page.locator('[data-overview-widget="analytics"]');
      await analytics.locator("summary").focus(); await page.keyboard.press("Enter");
      assert.match(await analytics.innerText(),/YouTube uploads/);
      await page.screenshot({ path: join(outputDir,`${name}-analytics.png`),fullPage: true });
      await analytics.locator("summary").focus(); await page.keyboard.press("Enter");
      const slugs = await rail.locator("[data-channel-slug]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-channel-slug")));
      assert.equal(new Set(slugs).size,slugs.length,"no inaccessible carousel clones");
      const next = page.getByRole("button",{ name: "Next channels",exact:true });
      let moved = false;
      if (await next.count()) {
        await next.focus(); const before = await rail.evaluate(node => node.scrollLeft);
        await page.keyboard.press("Enter");
        moved = await rail.evaluate((node, before) => node.scrollWidth <= node.clientWidth || node.scrollLeft > before,before);
        if (!moved) failures.push(`${name}: next-channel control does not move rail`);
        await page.getByRole("button",{name:"Previous channels",exact:true}).click();
      }
      await page.evaluate(() => window.scrollTo(0,0));
      await page.screenshot({ path: join(outputDir,`${name}.png`), fullPage: true });
      const geometry = await main.evaluate(root => ({ width: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight,
        controls: [...root.querySelectorAll<HTMLElement>('[data-overview-widget] summary,[data-overview-widget] header > a,[data-channel-rail] a,section[aria-labelledby="channel-relay-title"] header a,section[aria-labelledby="channel-relay-title"] header button,[aria-label="Current production and release queue"] header a')]
          .map(node => ({ text: node.textContent?.trim(), height: node.getBoundingClientRect().height })),
        clipped: [...root.querySelectorAll<HTMLElement>('[data-overview-widget] strong,[data-overview-widget] small')]
          .filter(node => node.clientWidth > 0 && node.scrollWidth > node.clientWidth+1).map(node=>node.textContent),
      }));
      if (geometry.scrollWidth > geometry.width+1) failures.push(`${name}: horizontal page overflow`);
      if (geometry.clipped.length) failures.push(`${name}: clipped text ${geometry.clipped.join(" | ")}`);
      if (geometry.controls.some(c=>c.height>0 && c.height<44)) failures.push(`${name}: undersized controls`);
      for (const [i,section] of (await main.locator('[data-overview-widget],[aria-label="Current production and release queue"]').all()).entries()) {
        await section.evaluate(node => { node.scrollIntoView({block:"start"}); window.scrollBy(0,-140); });
        await page.screenshot({path:join(outputDir,`${name}-section-${i}.png`)});
      }
      const plan = main.locator('a[href*="?tab=week-ahead&plan="]').first();
      if (await plan.count()) {
        const href = await plan.getAttribute("href"); await plan.click();
        await page.waitForURL(base+href);
        const planId = new URL(page.url()).searchParams.get("plan"); assert.ok(planId);
        await page.locator(`[id="plan-${planId}"]`).waitFor({state:"visible",timeout:45000});
        await page.goBack({waitUntil:"domcontentloaded"});
      }
      const calendar = page.locator('[data-overview-widget="plans"] a');
      await calendar.click(); await page.waitForURL(base+"/schedule");
      await page.locator('[aria-label="Calendar scope and summary"] h1').waitFor();
      results.push({name,issueCount,channels:slugs.length,moved,...geometry});
    } finally { await page.unrouteAll({behavior:"ignoreErrors"}); await context.close(); }
  }
  const result = {base,outputDir,results,failures,errors,mutations};
  await writeFile(join(outputDir,"results.json"),JSON.stringify(result,null,2)); console.log(JSON.stringify(result,null,2));
  assert.deepEqual(errors,[]); assert.deepEqual(mutations,[]); assert.deepEqual(failures,[]);
} finally { await browser.close(); }
