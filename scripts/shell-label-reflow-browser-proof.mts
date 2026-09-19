/**
 * Actual-app, read-only shell proof. Optional SHELL_REFLOW_CSS_SOURCE overlays
 * only CSSOM-derived changed rules against exact 98ca source; NOT deployment.
 * No data/auth/media fixtures. Channel selection is isolated browser state.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Locator } from "playwright";

const base = "https://youtube-studio-ai.vercel.app";
const sourceBase = "98ca6829bfebff84dcc8a2b95abe1bbfccbbe33e";
const revision = process.env.EXPECTED_REVISION;
assert.match(revision ?? "", /^[a-f0-9]{40}$/, "Require exact expected deployed revision");
const candidatePath = process.env.SHELL_REFLOW_CSS_SOURCE;
if (candidatePath) assert.ok(isAbsolute(candidatePath));
const sha = (input: string | Buffer) => createHash("sha256").update(input).digest("hex");
const proofPath = fileURLToPath(import.meta.url), proofHash = sha(await readFile(proofPath));
const baselineCss = execFileSync("git", ["show", `${sourceBase}:src/app/globals.css`], { encoding: "utf8" });
const candidateCss = candidatePath ? await readFile(candidatePath, "utf8") : null;
const componentHashes = Object.fromEntries(await Promise.all(["AppShell", "Sidebar", "ChannelSwitcher", "NavItem"].map(async name => {
  const path = `src/components/${name}.tsx`, source = await readFile(path);
  assert.equal(sha(source), sha(execFileSync("git", ["show", `${sourceBase}:${path}`])), `${name} must remain exact baseline source`);
  return [path, sha(source)];
})));
const outputDir = await mkdtemp(join(tmpdir(), "ysa-shell-label-proof-"));
const results: unknown[] = [], failures: string[] = [];
function check(name: string, run: () => void) { try { run(); } catch (error) { failures.push(`${name}: ${String(error)}`); } }

async function textFit(locator: Locator) {
  return locator.evaluate(root => {
    const box = root.getBoundingClientRect(), text: unknown[] = [], failures: unknown[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode, parent = node.parentElement!;
      const p = parent.getBoundingClientRect(), style = getComputedStyle(parent);
      if (!p.width || !p.height || !node.textContent?.trim()) continue;
      if (!parent.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })) continue;
      // Existing accessible owner label is deliberately visually hidden on phones.
      if (p.width <= 1.1 && p.height <= 1.1 && style.position === "absolute" && style.overflowX === "hidden" && style.clip.replace(/\s/g, "") === "rect(0px,0px,0px,0px)") continue;
      for (const match of node.textContent.matchAll(/\S+/g)) {
        const range = document.createRange(); range.setStart(node, match.index!); range.setEnd(node, match.index! + match[0].length);
        const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0).map(r => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom }));
        const split = new Set(rects.map(r => Math.round(r.top))).size > 1;
        const outside = rects.some(r => r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1 || r.left < p.left - 1 || r.right > p.right + 1 || r.left < -1 || r.right > innerWidth + 1);
        const row = { word: match[0], rects, split, outside, fontSize: style.fontSize, overflowWrap: style.overflowWrap };
        text.push(row); if (split || outside || style.textOverflow === "ellipsis") failures.push(row);
      }
    }
    return { fullText: root.textContent, box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height }, text, failures };
  });
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
let overlay = "", changedRules: Array<{ selector: string; context: string[]; css: string }> = [];
try {
  if (candidateCss) {
    const parser = await browser.newPage();
    // tsx keeps nested function names with this helper. Only the empty CSS
    // parser page needs it; no helper/DOM/data is injected into the actual app.
    await parser.evaluate("globalThis.__name = (fn) => fn");
    changedRules = await parser.evaluate(({ before, after }) => {
      function rules(source: string) {
        const sheet = new CSSStyleSheet(); sheet.replaceSync(source);
        const entries: Array<{ selector: string; context: string[]; css: string; key: string }> = [];
        const visit = (list: CSSRuleList, context: string[]) => {
          for (const rule of list) {
            if (rule instanceof CSSStyleRule) entries.push({ selector: rule.selectorText, context, css: rule.cssText, key: `${context.join("|")}::${rule.selectorText}` });
            else if ("cssRules" in rule) visit((rule as CSSGroupingRule).cssRules, [...context, rule.cssText.slice(0, rule.cssText.indexOf("{")).trim()]);
          }
        };
        visit(sheet.cssRules, []); return entries;
      }
      const original = rules(before), updated = rules(after);
      const counts = new Map<string, number>();
      const key = (entry: { key: string }) => { const n = counts.get(entry.key) ?? 0; counts.set(entry.key, n + 1); return `${entry.key}#${n}`; };
      const originalByKey = new Map(original.map(entry => [key(entry), entry])); counts.clear();
      return updated.filter(entry => originalByKey.get(key(entry))?.css !== entry.css).map(({ selector, context, css }) => ({ selector, context, css }));
    }, { before: baselineCss, after: candidateCss });
    await parser.close();
    assert.ok(changedRules.length > 0 && changedRules.length <= 7, "Small, exact source-derived rule delta required");
    const allow = [".studio-topbar", ".studio-topbar-actions", ".studio-mobile-brand", ".channel-switcher", ".channel-switcher-menu", ".studio-nav", ".studio-nav-item"];
    assert.ok(changedRules.every(rule => allow.includes(rule.selector) && rule.context.length > 0));
    overlay = changedRules.map(rule => rule.context.reduceRight((css, wrapper) => `${wrapper} { ${css} }`, rule.css)).join("\n");
  }
  for (const [width, zoom] of [[320, 1], [320, 2], [390, 1], [390, 2], [1440, 1], [1440, 2]] as const) {
    const name = `${width}-${zoom}x`, context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce", locale: "en-US", timezoneId: "UTC" });
    const page = await context.newPage(), errors: string[] = [], writes: string[] = [], readSubscriptions = new Set<string>();
    const evidence: Record<string, unknown> = { name, width, zoom };
    try {
      assert.equal((await (await context.request.get(`${base}/api/health`)).json()).revision, revision);
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => {
        if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method())) { writes.push(`http:${new URL(route.request().url()).pathname}`); return route.abort(); }
        return route.continue();
      });
      await page.routeWebSocket("**", socket => {
        const upstream = socket.connectToServer();
        socket.onMessage(message => {
          let parsed; try { parsed = JSON.parse(String(message)); } catch { writes.push("unparsed-client-websocket-frame"); return; }
          if (["Mutation", "Action"].includes(parsed.type)) { writes.push(`websocket:${parsed.type}:${parsed.udfPath}`); return; }
          assert.ok(["Connect", "ModifyQuerySet", "Authenticate", "Event"].includes(parsed.type), `Unknown outgoing websocket frame ${parsed.type}`);
          for (const modification of parsed.modifications ?? []) if (modification.udfPath) readSubscriptions.add(modification.udfPath);
          upstream.send(message);
        });
        upstream.onMessage(message => socket.send(message));
      });
      await page.goto(`${base}/channels/inked-histories-1783204937695?tab=library`, { waitUntil: "domcontentloaded", timeout: 45000 });
      const switcher = page.locator(".channel-switcher-button"), nav = page.locator(".studio-sidebar");
      await switcher.waitFor({ timeout: 45000 });
      await page.addStyleTag({ content: `html{font-size:${zoom * 100}%!important}` });
      if (overlay) await page.addStyleTag({ content: overlay });
      await page.evaluate(() => document.fonts.ready);
      await switcher.click(); const options = page.getByRole("listbox", { name: "Channel view" });
      await options.getByRole("option").nth(1).waitFor({ timeout: 45000 });
      await options.getByRole("option", { name: "All channels", exact: true }).click();
      await page.locator('[class*="__libraryWorkspace"] .video-card').first().waitFor({ timeout: 45000 });
      await switcher.locator(".channel-switcher-chevron").evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
      const allChannels = await textFit(switcher); evidence.allChannels = allChannels;
      check(`${name}: whole All channels words inside trigger`, () => { assert.deepEqual(allChannels.failures, []); });
      const dockLinks = nav.locator(".studio-nav > .studio-nav-group .studio-nav-item:visible, .studio-nav-more-trigger:visible");
      const controls = [];
      for (const control of await dockLinks.all()) {
        const measured = await textFit(control); controls.push(measured);
        check(`${name}: ${measured.fullText} fits navigation target`, () => assert.deepEqual(measured.failures, []));
        if (width <= 860) check(`${name}: dock target onscreen`, () => { assert.ok(measured.box.left >= -1 && measured.box.right <= width + 1 && measured.box.bottom <= 1001); assert.ok(measured.box.height >= 44); });
      }
      evidence.controls = controls;
      const owner = page.locator(".operations-access-trigger"); assert.equal(await owner.isVisible(), true);
      const header = await page.locator(".studio-topbar").boundingBox(); evidence.header = header;
      assert.ok(header && header.x >= -1 && header.x + header.width <= width + 1);
      await page.screenshot({ path: join(outputDir, `${name}-shell.png`) });

      const visited: string[] = [];
      if (width <= 860) {
        const more = nav.getByRole("button", { name: "More", exact: true });
        await more.focus(); await page.keyboard.press("Enter");
        const menu = page.locator("#studio-mobile-more-menu"); await menu.waitFor();
        const menuFit = await textFit(menu); evidence.moreMenu = menuFit;
        check(`${name}: More menu whole words`, () => assert.deepEqual(menuFit.failures, []));
        await page.screenshot({ path: join(outputDir, `${name}-more.png`) });
        await menu.getByRole("link", { name: "Library", exact: true }).focus(); await page.keyboard.press("Escape");
        await menu.waitFor({ state: "detached" }); assert.equal(await more.evaluate(el => el === document.activeElement), true);
        for (const [label, href] of [["Production", "/runs"], ["Schedule", "/schedule"], ["Library", "/library"]]) {
          await more.click();
          const moved = menu.getByRole("link", { name: label, exact: true });
          if (await moved.isVisible()) await moved.click();
          else { await page.keyboard.press("Escape"); await nav.getByRole("link", { name: label, exact: true }).filter({ visible: true }).click(); }
          await page.waitForURL(url => url.pathname === href); await menu.waitFor({ state: "detached" }); visited.push(href);
        }
      } else {
        const toolbox = nav.locator(".studio-toolbox");
        if (await toolbox.getAttribute("open") === null) await toolbox.locator("summary").click();
        for (const label of ["Studio", "Channels", "Production", "Schedule", "Library", "Golden modules", "Settings"]) {
          const link = nav.getByRole("link", { name: label, exact: true }); await link.focus();
          assert.equal(await link.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2)); }), true);
        }
        await nav.getByRole("link", { name: "Library", exact: true }).click(); await page.waitForURL(url => url.pathname === "/library"); visited.push("/library");
      }
      evidence.visited = visited;
      // The owner button is intentionally absent on Library; fit both real layouts.
      assert.equal(await owner.count(), 0);
      const librarySwitcher = await textFit(switcher); evidence.librarySwitcher = librarySwitcher;
      check(`${name}: Library switcher`, () => assert.deepEqual(librarySwitcher.failures, []));
      await nav.getByRole("link", { name: "Channels", exact: true }).click(); await page.waitForURL(url => url.pathname === "/channels");
      assert.equal(await owner.isVisible(), true);
      await switcher.click();
      await options.getByRole("option").first().focus(); await page.keyboard.press("Escape");
      await options.waitFor({ state: "detached" }); assert.equal(await switcher.evaluate(el => el === document.activeElement), true);
      await switcher.click();
      const channel = options.getByRole("option").nth(1), channelName = await channel.locator("strong").innerText(); await channel.click();
      assert.equal(await switcher.locator("strong").innerText(), channelName); assert.equal(await switcher.evaluate(el => el === document.activeElement), true);
      const selected = await textFit(switcher); evidence.selectedChannel = selected;
      check(`${name}: whole selected channel words`, () => assert.deepEqual(selected.failures, []));
      await page.locator(".channel-card").first().waitFor({ timeout: 45000 });
      await switcher.locator(".channel-switcher-chevron").evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
      await page.screenshot({ path: join(outputDir, `${name}-selected.png`) });
      await switcher.click(); assert.equal(await channel.getAttribute("aria-selected"), "true");
      await page.screenshot({ path: join(outputDir, `${name}-channels.png`) });
      const optionsBox = await options.boundingBox(); evidence.optionsBox = optionsBox;
      check(`${name}: channel menu viewport bounds`, () => assert.ok(optionsBox && optionsBox.x >= -1 && optionsBox.x + optionsBox.width <= width + 1));
      const optionMeasurements = [];
      for (const item of await options.getByRole("option").all()) {
        await item.scrollIntoViewIfNeeded();
        const fit = await textFit(item); optionMeasurements.push(fit);
        check(`${name}: ${fit.fullText} full option text`, () => assert.deepEqual(fit.failures, []));
        assert.equal(await item.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2)); }), true, "Native menu scroll reveals every option");
      }
      evidence.channelOptions = optionMeasurements;
      await page.screenshot({ path: join(outputDir, `${name}-channels-last.png`) });
      await options.getByRole("option", { name: "All channels", exact: true }).click();
      assert.equal(await switcher.locator("strong").innerText(), "All channels");
      assert.equal(await switcher.evaluate(el => el === document.activeElement), true);
      assert.deepEqual(errors, []); assert.deepEqual(writes, []);
      assert.ok(readSubscriptions.has("channels:listChannels"), "Use genuine subscribed channel records");
      assert.equal((await (await context.request.get(`${base}/api/health`)).json()).revision, revision);
      evidence.completed = true;
    } catch (error) { failures.push(`${name}: ${String(error)}`); await page.screenshot({ path: join(outputDir, `${name}-failure.png`) }).catch(() => {}); }
    finally { results.push({ ...evidence, errors, writes, readSubscriptions: [...readSubscriptions] }); await page.unrouteAll({ behavior: "ignoreErrors" }); await context.close(); }
  }
} finally {
  await browser.close();
  assert.equal(sha(await readFile(proofPath)), proofHash, "Proof frozen during run");
  if (candidatePath) assert.equal(sha(await readFile(candidatePath)), sha(candidateCss!), "Candidate frozen during run");
  const report = { base, revision, sourceBase, proofHash, baselineCssHash: sha(baselineCss), componentHashes, outputDir,
    mode: candidatePath ? "SOURCE-DERIVED-CANDIDATE-OVERLAY-NOT-DEPLOYED" : "EXACT-PRODUCTION-NO-OVERLAY",
    candidate: candidatePath ? { path: candidatePath, sha256: sha(candidateCss!), changedRules, overlay } : null,
    scope: "Shell word reflow, real navigation and isolated view selection; not whole-page accessibility or owner actions.", results, failures };
  await writeFile(join(outputDir, "results.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
}
assert.deepEqual(failures, []);
