/** Actual channel-room header proof. Local mode runs real candidate markup with
 * read-only production data; it is not a deployment or a CSS/data fixture. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Locator } from "playwright";

const production = "https://youtube-studio-ai.vercel.app";
const base = process.env.CHANNEL_HEADER_BASE ?? production;
assert.ok([production, "http://127.0.0.1:3349"].includes(base));
const revision = process.env.EXPECTED_REVISION;
assert.match(revision ?? "", /^[a-f0-9]{40}$/);
const slug = "inked-histories-1783204937695";
const outputDir = await mkdtemp(join(tmpdir(), "ysa-channel-header-proof-"));
const sourcePaths = ["src/app/(app)/channels/[slug]/page.tsx", "src/app/(app)/channels/[slug]/channelHub.module.css", "scripts/channel-header-reflow-browser-proof.mts"];
const hashes = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, createHash("sha256").update(await readFile(path)).digest("hex")])));
const sourceHashes = await hashes();
const failures: string[] = [], results: unknown[] = [];
const check = (label: string, action: () => void) => { try { action(); } catch (error) { failures.push(`${label}: ${String(error)}`); } };

async function textFit(locator: Locator) {
  return locator.evaluate(root => {
    const box = root.getBoundingClientRect(), rows: unknown[] = [], failures: unknown[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode, parent = node.parentElement!;
      const p = parent.getBoundingClientRect(), style = getComputedStyle(parent);
      if (!p.width || !p.height || !node.textContent?.trim() || !parent.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })) continue;
      for (const match of node.textContent.matchAll(/\S+/g)) {
        const range = document.createRange(); range.setStart(node, match.index!); range.setEnd(node, match.index! + match[0].length);
        const rects = [...range.getClientRects()].filter(r => r.width && r.height).map(r => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom }));
        const split = new Set(rects.map(r => Math.round(r.top))).size > 1;
        // A font's em rectangle can extend above/below a visible, unclipped
        // heading line box. Check actual clipping ancestors for vertical ink;
        // horizontal containment and complete word checks remain strict.
        let clipped = false;
        for (let ancestor: Element | null = parent; ancestor; ancestor = ancestor.parentElement) {
          const computed = getComputedStyle(ancestor), bounds = ancestor.getBoundingClientRect();
          if (["hidden", "clip"].includes(computed.overflowY) && rects.some(r => r.top < bounds.top - 1 || r.bottom > bounds.bottom + 1)) clipped = true;
        }
        const outside = clipped || rects.some(r => r.left < box.left - 1 || r.right > box.right + 1 || r.left < p.left - 1 || r.right > p.right + 1 || r.left < -1 || r.right > innerWidth + 1);
        const row = { word: match[0], rects, split, outside, fontSize: style.fontSize, ellipsis: style.textOverflow === "ellipsis" };
        rows.push(row); if (split || outside || row.ellipsis) failures.push(row);
      }
    }
    return { fullText: root.textContent?.trim(), box: { left: box.left, right: box.right, width: box.width, height: box.height }, rows, failures };
  });
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
try {
  for (const [width, zoom] of [[320, 1], [320, 2], [390, 1], [390, 2], [1440, 1], [1440, 2]] as const) {
    const name = `${width}-${zoom}x`, context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce", locale: "en-US", timezoneId: "UTC" });
    const page = await context.newPage(), errors: string[] = [], writes: string[] = [], reads = new Set<string>();
    const evidence: Record<string, unknown> = { name, width, zoom };
    try {
      assert.equal((await (await context.request.get(`${production}/api/health`)).json()).revision, revision);
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) { writes.push(`http:${url.pathname}`); return route.abort(); }
        if (base !== production && url.origin === base && ["/api/auth/convex-token", "/api/asset-url"].includes(url.pathname)) {
          assert.equal(request.method(), "GET");
          return route.fulfill({ response: await context.request.get(production + url.pathname + url.search) });
        }
        return route.continue();
      });
      await page.routeWebSocket("**", socket => {
        const upstream = socket.connectToServer();
        socket.onMessage(message => {
          let parsed; try { parsed = JSON.parse(String(message)); } catch { writes.push("unparsed-client-websocket-frame"); return; }
          if (["Mutation", "Action"].includes(parsed.type)) { writes.push(`websocket:${parsed.type}:${parsed.udfPath}`); return; }
          // The local Next dev websocket is not a Convex transport. Its hot
          // reload frames carry no remote data writes; production has none.
          if (base !== production && socket.url().startsWith("ws://127.0.0.1:3349/")) { upstream.send(message); return; }
          assert.ok(["Connect", "ModifyQuerySet", "Authenticate", "Event"].includes(parsed.type), `Unexpected client frame ${parsed.type}`);
          for (const modification of parsed.modifications ?? []) if (modification.udfPath) reads.add(modification.udfPath);
          upstream.send(message);
        });
        upstream.onMessage(message => socket.send(message));
      });
      await page.goto(`${base}/channels/${slug}?tab=library`, { waitUntil: "domcontentloaded", timeout: 60000 });
      const h1 = page.locator('[class*="heroTitle"] h1');
      await h1.waitFor({ timeout: 60000 });
      assert.equal(await h1.innerText(), "Inked Histories");
      await page.locator('[class*="libraryWorkspace"] .video-card').first().waitFor({ timeout: 60000 });
      await page.addStyleTag({ content: `html{font-size:${zoom * 100}%!important}` });
      await page.evaluate(() => document.fonts.ready);
      const profile = page.getByRole("region", { name: "Channel operating profile" });
      const tabs = page.getByRole("tablist", { name: "Channel sections" });
      const banner = page.locator('[class*="heroContent"]');
      await page.waitForFunction(() => [...(document.querySelector('[class*="heroContent"]')?.parentElement?.parentElement?.querySelectorAll<HTMLImageElement>("img") ?? [])].every(image => image.complete), undefined, { timeout: 5000 }).catch(() => {});
      evidence.images = await banner.locator("..").locator("..").locator("img").evaluateAll(images => images.map(image => ({ alt: image.getAttribute("alt"), loaded: (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0 })));
      for (const [label, locator] of [["hero", banner], ["channelName", h1], ["summary", profile], ["tabs", tabs]] as const) {
        await locator.scrollIntoViewIfNeeded();
        const fit = await textFit(locator); evidence[label] = fit;
        check(`${name}: ${label} full words inside region`, () => assert.deepEqual(fit.failures, []));
        if (label !== "channelName") await locator.screenshot({ path: join(outputDir, `${name}-${label}.png`) });
      }
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: join(outputDir, `${name}-loaded.png`) });
      const labels = await tabs.getByRole("tab").allTextContents();
      check(`${name}: all four complete labels`, () => assert.deepEqual(labels.map(label => label.trim()), ["Overview", "Content", "Performance", "Setup"]));
      const tabFits = [];
      for (const tab of await tabs.getByRole("tab").all()) {
        await tab.scrollIntoViewIfNeeded();
        const fit = await textFit(tab); tabFits.push(fit);
        check(`${name}: ${fit.fullText} inside actual button`, () => { assert.deepEqual(fit.failures, []); assert.ok(fit.box.height >= 44); });
        assert.equal(await tab.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint((r.left+r.right)/2, (r.top+r.bottom)/2)); }), true);
      }
      evidence.tabFits = tabFits;
      const navigation: unknown[] = [];
      for (const [start, key, target, query] of [["Content", "Home", "Overview", "overview"], ["Overview", "End", "Setup", "identity"], ["Setup", "ArrowRight", "Overview", "overview"], ["Overview", "ArrowLeft", "Setup", "identity"], ["Setup", "ArrowLeft", "Performance", "analytics"]] as const) {
        const originalHeader = await banner.elementHandle();
        const origin = tabs.getByRole("tab", { name: start, exact: true }); await origin.focus(); await page.keyboard.press(key);
        await page.waitForURL(url => url.searchParams.get("tab") === query);
        await page.locator(`[data-view="${query}"]`).waitFor({ timeout: 60000 });
        await page.waitForFunction(view => document.querySelector(`[data-view="${view}"]`)?.getAttribute("aria-busy") !== "true", query);
        const dest = tabs.getByRole("tab", { name: target, exact: true });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const focused = await dest.evaluate(el => el === document.activeElement);
        const selected = await dest.getAttribute("aria-selected");
        const retainedHeader = await originalHeader!.evaluate(el => el.isConnected);
        navigation.push({ start, key, target, query, focused, selected, retainedHeader });
        check(`${name}: ${key} from ${start} preserves destination focus`, () => { assert.equal(focused, true); assert.equal(selected, "true"); assert.equal(retainedHeader, true); });
      }
      evidence.navigation = navigation;
      const actions = [];
      for (const [signal, query] of [["status", "settings"], ["next", "week-ahead"], ["setup", "settings"], ["pipeline", "pipeline"]] as const) {
        const link = profile.locator(`a[data-signal="${signal}"]`);
        if (!await link.count()) { failures.push(`${name}: ${signal} is not a real navigation link`); continue; }
        const href = await link.getAttribute("href"), url = new URL(href!, base);
        assert.equal(url.pathname, `/channels/${slug}`); assert.equal(url.searchParams.get("tab"), query);
        await link.click(); await page.waitForURL(current => current.searchParams.get("tab") === query);
        await page.locator(`[data-view="${query}"]`).waitFor({ timeout: 60000 });
        if (query === "settings") await page.getByRole("navigation", { name: "Settings areas" }).waitFor();
        if (query === "pipeline") await page.getByRole("region", { name: "Channel production pipeline" }).waitFor();
        const planId = url.searchParams.get("plan");
        if (planId) {
          const row = page.locator(`[id="plan-${planId}"]`); await row.waitFor({ timeout: 60000 });
          assert.equal(await row.locator("details").getAttribute("open") !== null, true);
          assert.equal(await row.evaluate(el => el === document.activeElement), true);
        }
        actions.push({ signal, href, actualUrl: page.url(), planOpened: Boolean(planId) });
      }
      evidence.actions = actions;
      const artLink = page.locator('[class*="artFreshnessLink"]');
      if (await artLink.count()) {
        await artLink.scrollIntoViewIfNeeded();
        const fit = await textFit(artLink);
        assert.deepEqual(fit.failures, []); assert.ok(fit.box.height >= 44);
        const fontSize = await artLink.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
        assert.ok(fontSize >= 10.4 * zoom);
        const href = await artLink.getAttribute("href");
        await artLink.click(); await page.waitForURL(url => url.searchParams.get("tab") === "identity");
        await page.locator('[data-view="identity"]').waitFor();
        evidence.artRefresh = { href, fontSize, fit, reachedIdentity: true };
      } else evidence.artRefresh = { present: false };
      assert.deepEqual(errors, []); assert.deepEqual(writes, []);
      assert.ok(reads.has("channels:getChannelBySlug")); assert.ok(reads.has("channels:getChannelCard"));
      assert.equal((await (await context.request.get(`${production}/api/health`)).json()).revision, revision);
      evidence.completed = true;
    } catch (error) { failures.push(`${name}: ${String(error)}`); await page.screenshot({ path: join(outputDir, `${name}-failure.png`) }).catch(() => {}); }
    finally { results.push({ ...evidence, errors, writes, readSubscriptions: [...reads] }); await page.unrouteAll({ behavior: "ignoreErrors" }); await context.close(); }
  }
} finally {
  await browser.close(); assert.deepEqual(await hashes(), sourceHashes, "Frozen source during proof");
  const report = { base, revision, sourceHashes, mode: base === production ? "EXACT-PRODUCTION-NO-OVERLAY" : "ACTUAL-LOCAL-CANDIDATE-REAL-READ-ONLY-DATA-NOT-DEPLOYED", outputDir,
    scope: "Header/operating summary/main tabs only; no subpanel redesign, owner actions, renders or publishing.", results, failures };
  await writeFile(join(outputDir, "results.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
}
assert.deepEqual(failures, []);
