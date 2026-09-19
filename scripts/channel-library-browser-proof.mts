/**
 * Read-only actual channel Library proof. Default: exact deployed SHA, no CSS overlay.
 * CHANNEL_LIBRARY_CSS_SOURCE=/absolute/channelHub.module.css overlays only the source's
 * explicit .libraryWorkspace rules onto the real CSS-module classes. That mode is a
 * candidate comparison, never deployed-source evidence. No data/media/auth fixtures.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Locator } from 'playwright';

const base = 'https://youtube-studio-ai.vercel.app';
const expectedRevision = process.env.EXPECTED_REVISION;
assert.match(expectedRevision ?? '', /^[a-f0-9]{40}$/, 'Require exact deployed EXPECTED_REVISION');
const cssPath = process.env.CHANNEL_LIBRARY_CSS_SOURCE;
if (cssPath) assert.ok(isAbsolute(cssPath), 'Candidate CSS source must be an absolute path');
const sha = (input: string | Buffer) => createHash('sha256').update(input).digest('hex');
const proofPath = fileURLToPath(import.meta.url), proofHash = sha(await readFile(proofPath));
const cssSource = cssPath ? await readFile(cssPath, 'utf8') : null;
const sourceRules = cssSource === null ? [] : [...cssSource.matchAll(/^(\.libraryWorkspace[^{}\n]*)\{([^{}]*)\}/gm)].map(match => ({ selector: match[1].trim(), declarations: match[2] }));
if (cssPath) {
  assert.ok(sourceRules.length >= 4, 'Extract actual explicit workspace rules, not an empty overlay');
  assert.ok(sourceRules.some(rule => rule.selector === '.libraryWorkspace'));
  assert.ok(sourceRules.every(rule => !rule.selector.includes(',')), 'No unrelated selector may enter the overlay');
}
const title = '7 Secrets of Battlefield Relic Preservation Revealed';
const channelName = 'Inked Histories', channelSlug = 'inked-histories-1783204937695';
const masterPath = `/owner/owner_daniel/channel/${channelSlug}/runs/js76ghf4s44b4w5d97cs2f49bd89znxa/final.mp4`;
const thumbnailPath = `/owner/owner_daniel/channel/${channelSlug}/runs/js7cvnsea1neyn5nxxbf2f5ca58e01v0/thumbnail.png`;
const outputDir = await mkdtemp(join(tmpdir(), 'ysa-channel-library-proof-'));
const results: unknown[] = [], failures: string[] = [];
function check(name: string, run: () => void) { try { run(); } catch (error) { failures.push(`${name}: ${String(error)}`); } }

async function bounds(locator: Locator) {
  return locator.evaluate(root => {
    const box = root.getBoundingClientRect(), elements: unknown[] = [], texts: unknown[] = [], excluded: unknown[] = [], violations: unknown[] = [];
    for (const element of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
      const r = element.getBoundingClientRect(); if (!r.width || !r.height) continue;
      const entry = { tag: element.tagName, className: element.getAttribute('class'), left: r.left, right: r.right, width: r.width };
      elements.push(entry);
      if (r.left < box.left - 1 || r.right > box.right + 1 || r.left < -1 || r.right > innerWidth + 1) violations.push({ kind: 'element', ...entry });
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode, parent = node.parentElement!; if (!node.textContent?.trim()) continue;
      const p = parent.getBoundingClientRect(), s = getComputedStyle(parent);
      if (!p.width || !p.height) { excluded.push({ reason: 'not-rendered-zero-box', text: node.textContent.trim(), display: s.display }); continue; }
      const computed = { position: s.position, display: s.display, overflowX: s.overflowX, overflowY: s.overflowY, clip: s.clip, whiteSpace: s.whiteSpace, textOverflow: s.textOverflow };
      if (['absolute', 'fixed'].includes(s.position) && p.width <= 1.1 && p.height <= 1.1 && s.overflowX === 'hidden' && s.overflowY === 'hidden' && s.clip.replace(/\s/g, '') === 'rect(0px,0px,0px,0px)') {
        excluded.push({ reason: 'computed-zero-area-clip', text: node.textContent.trim(), computed }); continue;
      }
      if (s.display !== 'inline' && s.overflowX === 'hidden' && s.whiteSpace === 'nowrap' && s.textOverflow === 'ellipsis' && p.left >= box.left - 1 && p.right <= box.right + 1 && p.left >= -1 && p.right <= innerWidth + 1) {
        excluded.push({ reason: 'computed-intentional-ellipsis-not-full-text-visible', text: node.textContent.trim(), client: parent.clientWidth, scroll: parent.scrollWidth, computed }); continue;
      }
      const range = document.createRange(); range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        if (!r.width || !r.height) continue;
        const entry = { text: node.textContent.trim(), left: r.left, right: r.right, parentLeft: p.left, parentRight: p.right };
        texts.push(entry);
        if (r.left < box.left - 1 || r.right > box.right + 1 || r.left < p.left - 1 || r.right > p.right + 1 || r.left < -1 || r.right > innerWidth + 1) violations.push({ kind: 'text', ...entry });
      }
    }
    const s = getComputedStyle(root);
    return { left: box.left, right: box.right, width: box.width, client: root.clientWidth, scroll: root.scrollWidth, gridTemplateColumns: s.gridTemplateColumns, elements, texts, excluded, violations, fullDomText: root.textContent };
  });
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox'] });
try {
  for (const [width, zoom] of [[1440, 1], [1440, 2], [390, 1], [390, 2], [320, 2]] as const) {
    const name = `${width}-${zoom}x`, context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC' });
    const page = await context.newPage(), errors: string[] = [], writes: string[] = [], mediaResponses: Array<{ path: string; status: number; range: string | null }> = [];
    const evidence: Record<string, unknown> = { width, zoom, name };
    try {
      assert.equal((await (await context.request.get(`${base}/api/health`)).json()).revision, expectedRevision);
      page.on('pageerror', error => errors.push(error.message));
      page.on('websocket', socket => socket.on('framesent', ({ payload }) => {
        let message; try { message = JSON.parse(String(payload)); } catch { return; }
        if (message.type === 'Mutation' || message.type === 'Action') writes.push(`websocket:${message.type}:${message.udfPath}`);
      }));
      await page.route(`${base}/api/**`, route => {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) { writes.push(new URL(route.request().url()).pathname); return route.abort(); }
        return route.continue();
      });
      page.on('response', response => {
        const url = new URL(response.url());
        if (url.pathname === masterPath) mediaResponses.push({ path: url.pathname, status: response.status(), range: response.request().headers().range ?? null });
      });
      await page.goto(`${base}/channels/${channelSlug}?tab=library`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      const workspace = page.locator('[class*="__libraryWorkspace"]'); await workspace.locator('.video-card').first().waitFor({ timeout: 45000 });
      await page.addStyleTag({ content: `html{font-size:${zoom * 100}%!important}` }); await page.evaluate(() => document.fonts.ready);
      if (cssPath) {
        const tokens = [...new Set(sourceRules.flatMap(rule => [...rule.selector.matchAll(/\.([A-Za-z][A-Za-z0-9_]*)/g)].map(match => match[1])))];
        const classes = await workspace.evaluate((root, names) => Object.fromEntries(names.map(token => {
          const found = [root, ...root.querySelectorAll('*')].flatMap(element => [...element.classList]).filter(value => value.startsWith('channelHub-') && value.endsWith(`__${token}`));
          const unique = [...new Set(found)]; if (unique.length !== 1) throw new Error(`Ambiguous/missing actual module class ${token}`);
          return [token, unique[0]];
        })), tokens);
        const overlay = sourceRules.map(rule => `${rule.selector.replace(/\.([A-Za-z][A-Za-z0-9_]*)/g, (_, token: string) => `.${classes[token]}`)} {${rule.declarations}}`).join('\n');
        await page.addStyleTag({ content: overlay }); evidence.overlay = { classes, css: overlay, sha256: sha(overlay) };
      }
      const header = workspace.locator('[class*="__workspaceIntro"]').first(), rail = workspace.locator('[class*="__sectionRail"]');
      await header.scrollIntoViewIfNeeded();
      await header.evaluate(element => {
        const stickyBottom = document.querySelector('.studio-topbar')?.getBoundingClientRect().bottom ?? 0;
        window.scrollBy(0, element.getBoundingClientRect().top - stickyBottom - 12);
      });
      await page.screenshot({ path: join(outputDir, `${name}-header.png`) });
      const layout = await bounds(workspace); evidence.layout = layout;
      check(`${name}: workspace/header/link/rail/card element and visible text bounds`, () => { assert.deepEqual(layout.violations, []); assert.ok(layout.scroll <= layout.client + 1); });
      assert.ok(layout.fullDomText?.includes('Active masters / newest first')); assert.ok(layout.fullDomText?.includes('Evidence recorded'));
      assert.equal(await rail.textContent(), 'Active masters / newest first');
      assert.equal(await rail.innerText(), 'ACTIVE MASTERS / NEWEST FIRST');
      const fullLibrary = header.getByRole('link', { name: 'Open full Library', exact: true });
      assert.equal(new URL((await fullLibrary.getAttribute('href'))!, base).pathname, '/library');
      assert.doesNotMatch(await workspace.innerText(), /est\.?\s*views|tag_overlap|~\s*\d+(?:\.\d+)?[KMB]\b/i);
      const cards = workspace.locator('.video-card'); assert.ok(await cards.count() > 0 && await cards.count() <= 12);
      const opener = workspace.getByRole('button', { name: `Open ${title}`, exact: true });
      await opener.scrollIntoViewIfNeeded(); await opener.locator('[data-preview-state="ready"]').waitFor({ timeout: 30000 });
      const image = await opener.evaluate(element => {
        const frame = element.querySelector<HTMLElement>('[data-preview-source]')!, img = frame.querySelector('img')!, r = frame.getBoundingClientRect();
        const box = element.getBoundingClientRect(), hit = document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2);
        return { path: decodeURIComponent(new URL(img.currentSrc).pathname), complete: img.complete, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, width: r.width, height: r.height, source: frame.dataset.previewSource, state: frame.dataset.previewState, objectFit: getComputedStyle(img).objectFit, hit: hit !== null && element.contains(hit) };
      });
      evidence.image = image; assert.equal(image.path, thumbnailPath); assert.ok(image.complete && image.naturalWidth > 0); assert.equal(image.state, 'ready');
      assert.ok(Math.abs(image.width / image.height - 16 / 9) < .01); assert.equal(image.hit, true);
      await opener.screenshot({ path: join(outputDir, `${name}-card.png`) }); await page.screenshot({ path: join(outputDir, `${name}-card-context.png`) });
      const bodyOverflow = await page.evaluate(() => document.body.style.overflow); await opener.click();
      const dialog = page.getByRole('dialog'); await dialog.waitFor(); assert.equal(await dialog.locator('iframe').count(), 0);
      const video = dialog.locator('video'); await video.waitFor({ timeout: 30000 });
      await page.waitForFunction(() => document.querySelector<HTMLVideoElement>('[role="dialog"] video')!.readyState >= 2);
      await video.evaluate(async element => { const v = element as HTMLVideoElement; await v.play(); v.pause(); v.currentTime = 15; });
      await page.waitForFunction(() => { const v = document.querySelector<HTMLVideoElement>('[role="dialog"] video')!; return v.readyState >= 2 && !v.seeking && v.paused && Math.abs(v.currentTime - 15) < .1; });
      const playback = await video.evaluate(element => { const v = element as HTMLVideoElement; return { path: new URL(v.currentSrc).pathname, duration: v.duration, time: v.currentTime, readyState: v.readyState, seeking: v.seeking, paused: v.paused, error: v.error?.code ?? null, phase: v.parentElement?.dataset.signedVideoState }; });
      evidence.playback = playback; assert.equal(playback.path, masterPath); assert.ok(Math.abs(playback.duration - 200.551) < .02); assert.equal(playback.error, null); assert.equal(playback.phase, 'ready');
      const fullName = await dialog.evaluate((element, name) => {
        const box = element.getBoundingClientRect(), walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) { const at = walker.currentNode.textContent?.indexOf(name) ?? -1; if (at < 0) continue;
          const range = document.createRange(); range.setStart(walker.currentNode, at); range.setEnd(walker.currentNode, at + name.length);
          const rects = [...range.getClientRects()].map(r => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom }));
          return { text: range.toString(), rects, visible: rects.length > 0 && rects.every(r => r.left >= box.left && r.right <= box.right && r.top >= box.top && r.bottom <= box.bottom) };
        } return null;
      }, channelName);
      evidence.fullName = fullName; assert.equal(fullName?.text, channelName); assert.equal(fullName?.visible, true);
      assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
      await page.screenshot({ path: join(outputDir, `${name}-player.png`) });
      await video.focus(); await page.keyboard.press('ArrowRight'); assert.equal(await dialog.locator('h2').textContent(), title);
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' }); assert.equal(await opener.evaluate(element => element === document.activeElement), true);
      assert.equal(await page.evaluate(() => document.body.style.overflow), bodyOverflow);
      assert.ok(mediaResponses.some(response => response.status === 206 && response.range?.startsWith('bytes=')));
      await fullLibrary.click(); await page.waitForURL(url => url.pathname === '/library'); await page.getByLabel('Sort', { exact: true }).waitFor({ timeout: 30000 }); evidence.fullLibraryLinkNavigated = true;
      assert.deepEqual(errors, []); assert.deepEqual(writes, []);
      assert.equal((await (await context.request.get(`${base}/api/health`)).json()).revision, expectedRevision); evidence.completed = true;
    } catch (error) { failures.push(`${name}: ${String(error)}`); await page.screenshot({ path: join(outputDir, `${name}-failure.png`) }).catch(() => {}); }
    finally { results.push({ ...evidence, errors, writes, mediaResponses }); await page.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
  }
} finally {
  await browser.close(); assert.equal(sha(await readFile(proofPath)), proofHash, 'Proof source must stay frozen during run');
  if (cssPath) assert.equal(sha(await readFile(cssPath)), sha(cssSource!), 'Candidate source must stay frozen during run');
  const report = { base, expectedRevision, mode: cssPath ? 'candidate-source-css-overlay-NOT-DEPLOYED' : 'exact-production-no-overlay', proofHash,
    css: cssPath ? { path: cssPath, sha256: sha(cssSource!), sourceRules } : null, outputDir,
    scope: 'Actual existing channel Library workspace and retained native playback. Not entire channel-page accessibility or rendered-artifact quality approval.', results, failures };
  await writeFile(join(outputDir, 'results.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
}
assert.deepEqual(failures, []);
