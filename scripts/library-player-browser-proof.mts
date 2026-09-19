/** Actual Lightbox -> VideoPlayer -> SignedVideoPlayer -> asset URL cache proof.
 * Only data/signing/media transport is substituted. The retained MP4 is decoded
 * by Chromium with real HTTP Range responses; no render or production writes.
 * VIDEO_PLAYER_SOURCE_REF optionally bundles that Git revision's real player
 * in memory for the saved-master precedence regression oracle.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright";

const fixture = process.env.PREVIEW_TEST_VIDEO;
assert.ok(fixture, "PREVIEW_TEST_VIDEO must explicitly name an existing >=30-second H.264 MP4");
const bytes = await readFile(fixture);
const outputDir = await mkdtemp(join(tmpdir(), "ysa-library-player-proof-"));
const sourceRef = process.env.VIDEO_PLAYER_SOURCE_REF;
assert.ok(!sourceRef || /^[a-f0-9]{7,40}$/.test(sourceRef), "source oracle must be a commit SHA");
const historicalPlayer = sourceRef
  ? execFileSync("git", ["show", `${sourceRef}:src/components/VideoPlayer.tsx`], { encoding: "utf8" })
  : undefined;
const sourceHashes = Object.fromEntries(await Promise.all(["src/components/Lightbox.tsx", "src/components/VideoPlayer.tsx", "src/components/VideoPlayer.module.css", "src/components/SignedVideoPlayer.tsx", "src/components/SignedVideoPlayer.module.css", "src/lib/asset-url.ts"].map(async path => [path, createHash("sha256").update(path.endsWith("/VideoPlayer.tsx") && historicalPlayer ? historicalPlayer : await readFile(path)).digest("hex")])));
const require = createRequire(import.meta.url);
type FixtureBuild = {
  onResolve(options: { filter: RegExp }, callback: (args: { path: string }) => { path: string; namespace?: string }): void;
  onLoad(options: { filter: RegExp; namespace: string }, callback: () => { contents: string; loader: string; resolveDir: string }): void;
};
const esbuild = require(require.resolve("esbuild", { paths: [require.resolve("tsx")] })) as {
  build(options: Record<string, unknown>): Promise<{ outputFiles: { path: string; contents: Uint8Array }[] }>;
};
const bundle = await esbuild.build({
  absWorkingDir: process.cwd(), bundle: true, write: false, outfile: "fixture.js", format: "iife", platform: "browser", jsx: "automatic", define: { "process.env": "{}" },
  stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React, {useEffect, useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {Lightbox} from './src/components/Lightbox';
    import {VideoPlayer} from './src/components/VideoPlayer';
    window.signFetches=[];
    const originalFetch=window.fetch.bind(window);
    window.fetch=(url,options)=>{if(String(url).startsWith('/api/asset-url'))window.signFetches.push({url:String(url),cache:options?.cache??null});return originalFetch(url,options)};
    function App(){
      const [rows,setRows]=useState(),[index,setIndex]=useState(Number(new URLSearchParams(location.search).get('start')||0)),[open,setOpen]=useState(false);
      useEffect(()=>{let stale=false;fetch('/fixture/rows'+location.search).then(r=>r.json()).then(r=>{if(!stale)setRows(r)});return()=>{stale=true}},[]);
      return rows&&<main><h1>Retained Library master review</h1><button id="opener" onClick={()=>setOpen(true)}>Open saved master</button>
        <output id="selection" data-index={index}>{rows[index].title}</output>
        {new URLSearchParams(location.search).has('siblings')&&<section id="siblings"><div data-sibling="same"><VideoPlayer video={rows[0]}/></div><div data-sibling="other"><VideoPlayer video={rows[1]}/></div></section>}
        {open&&<Lightbox videos={rows} index={index} onIndex={setIndex} onClose={()=>setOpen(false)}/>}
        <button id="after">Outside after</button></main>;
    }
    createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
  ` },
  plugins: [{ name: "fixture-transport-and-optional-old-source", setup(build: FixtureBuild) {
    if (historicalPlayer) {
      build.onResolve({ filter: /(?:^|\/)VideoPlayer$/ }, () => ({ path: "historical-player", namespace: "historical" }));
      build.onLoad({ filter: /.*/, namespace: "historical" }, () => ({ loader: "tsx", resolveDir: resolve("src/components"), contents: historicalPlayer }));
    }
    build.onResolve({ filter: /^convex\/react$/ }, () => ({ path: "convex-data-fixture", namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "js", resolveDir: process.cwd(), contents: `
      import {useEffect,useState} from 'react';
      export function useQuery(_reference,args){
        const [detail,setDetail]=useState();
        useEffect(()=>{let stale=false;setDetail(undefined);if(args==='skip')return;
          fetch('/fixture/detail?runId='+encodeURIComponent(args.runId)).then(r=>r.json()).then(r=>{if(!stale)setDetail(r)});
          return()=>{stale=true};
        },[args==='skip'?'skip':args.runId]);return detail;
      }
    ` }));
    build.onResolve({ filter: /^@\// }, args => ({ path: resolve("src", args.path.slice(2) + ".ts") }));
  } }],
});
const script = bundle.outputFiles.find(file => file.path.endsWith(".js"))!.contents;
const css = bundle.outputFiles.find(file => file.path.endsWith(".css"))?.contents ?? "";
type Scenario = { initialFailure?: boolean; initialDelay?: number; mediaFailure?: boolean; holdInitialC?: boolean; holdRecoveryA?: boolean };
const scenarios = new Map<string, Scenario>(), signs = new Map<string, number>();
const held = new Map<string, () => void>();
const requests: { key: string; kind: "sign" | "media"; status: number; range?: string; generation?: number }[] = [];
let now = Date.now();
const keyFor = (name: string, file: string) => `owner/owner_proof/${name}/${file}`;
const stamp = (time: number) => new Date(time).toISOString().replace(/[-:]|\.\d{3}/g, "");
const signedUrl = (key: string, generation: number) => `/media/${encodeURIComponent(key)}?generation=${generation}&X-Amz-Date=${stamp(now)}&X-Amz-Expires=3600`;
const titles = ["Retained saved master with YouTube ID", "Independent retained master", "Delayed retained master", "No saved or published source", "Legacy YouTube-only record"];
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://fixture.invalid");
  if (req.method !== "GET") { res.writeHead(405); res.end(); return; }
  if (url.pathname === "/") {
    res.setHeader("Content-Type", "text/html");
    res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>:root{--color-bg:#0b1019;--color-fg:#f7f9fc;--color-muted:#c0c9d7;--color-faint:#8191a8;--color-border:#334155;--color-border-strong:#627591;--color-surface:#162033;--color-surface-solid:#162033;--color-accent:#72dfff;--radius-card:18px;--shadow-lift:0 20px 80px #0009}*{box-sizing:border-box}body{margin:0;padding:20px;background:#0b1019;color:#f7f9fc;font:16px Arial;overflow:scroll}main{max-width:1100px;margin:auto}button{font:inherit}#opener,#after{min-height:44px;margin:12px}#selection{display:block}#siblings{display:flex;gap:20px}#siblings>div{width:240px}.glass{background:#111b2b}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'); return;
  }
  if (url.pathname === "/fixture.js") { res.setHeader("Content-Type", "application/javascript"); res.end(script); return; }
  if (url.pathname === "/fixture.css") { res.setHeader("Content-Type", "text/css"); res.end(css); return; }
  if (url.pathname === "/fixture/detail") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ description: "Local retained-media transport fixture. This is the real Library Lightbox and player, not a production render or publication claim.", tags: ["retained", "native-preview"], script: "Read-only native playback review." })); return; }
  if (url.pathname === "/fixture/rows") {
    const name = url.searchParams.get("scenario") ?? ""; assert.ok(scenarios.has(name));
    const rows = titles.map((title, index) => ({ _id: `run_${index}`, title, status: "completed", releaseEvidenceStatus: "legacy_unverified", channelId: "channel_proof", channelName: "Retained proof channel", channelSlug: "proof", createdAt: 1_788_800_000_000, thumbnailKey: keyFor(name, "thumbnail.svg"), videoKey: index < 3 ? keyFor(name, ["a.mp4", "b.mp4", "c.mp4"][index]) : null, ...([0, 4].includes(index) ? { youtubeVideoId: "proofVideo01" } : {}) }));
    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(rows)); return;
  }
  if (url.pathname === "/api/asset-url") {
    const key = url.searchParams.get("key") ?? "", config = scenarios.get(key.split("/")[2]);
    if (!config) { res.writeHead(403); res.end(); return; }
    const generation = (signs.get(key) ?? 0) + 1; signs.set(key, generation);
    const failure = key.endsWith("/a.mp4") && config.initialFailure && generation === 1;
    requests.push({ key, kind: "sign", status: failure ? 503 : 200, generation });
    const finish = () => {
      if (res.destroyed) return;
      if (failure) { res.writeHead(503); res.end("Signing unavailable"); return; }
      res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "private, max-age=600");
      res.end(JSON.stringify({ url: signedUrl(key, generation) }));
    };
    if ((key.endsWith("/c.mp4") && config.holdInitialC) || (key.endsWith("/a.mp4") && generation > 1 && config.holdRecoveryA)) held.set(key, finish);
    else if (key.endsWith("/a.mp4") && generation === 1 && config.initialDelay) setTimeout(finish, config.initialDelay);
    // A realistic signing round trip lets the native expired Range reach the
    // server before the fresh src replaces it; never synthesize a media event.
    else if (key.endsWith("/a.mp4") && generation > 1) setTimeout(finish, 120);
    else finish();
    return;
  }
  if (!url.pathname.startsWith("/media/")) { res.writeHead(404); res.end(); return; }
  const key = decodeURIComponent(url.pathname.slice(7)), config = scenarios.get(key.split("/")[2]);
  if (key.endsWith(".svg")) { res.setHeader("Content-Type", "image/svg+xml"); res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect width="640" height="360" fill="#17344a"/><text x="36" y="195" fill="#d5efff" font-family="Arial" font-size="32">Retained native master</text></svg>'); return; }
  const issued = Date.parse((url.searchParams.get("X-Amz-Date") ?? "").replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z"));
  const generation = Number(url.searchParams.get("generation"));
  const status = !config || now >= issued + 3_600_000 || (key.endsWith("/a.mp4") && config.mediaFailure) ? 403 : 206;
  requests.push({ key, kind: "media", status, range: req.headers.range ?? "", generation });
  res.setHeader("Cache-Control", "no-store");
  if (status === 403) { res.writeHead(403); res.end("ExpiredRequest"); return; }
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
  const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(bytes.length - 1, Number(range[2])) : bytes.length - 1;
  if (start > end) { res.writeHead(416); res.end(); return; }
  res.writeHead(range ? 206 : 200, { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Length": end - start + 1, ...(range ? { "Content-Range": `bytes ${start}-${end}/${bytes.length}` } : {}) });
  if (generation > 1) { res.end(bytes.subarray(start, end + 1)); return; }
  streamSlowly(res, start, end);
});
function streamSlowly(res: ServerResponse, start: number, end: number) {
  let cursor = start, timer: ReturnType<typeof setTimeout>;
  const send = () => { if (res.destroyed) return; const next = Math.min(end + 1, cursor + 65_536); res.write(bytes.subarray(cursor, next)); cursor = next; if (cursor > end) res.end(); else timer = setTimeout(send, 20); };
  res.on("close", () => clearTimeout(timer)); send();
}
await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
const address = server.address(); assert.ok(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const results: Record<string, unknown>[] = [], failures: string[] = [], errors: string[] = [], external: string[] = [];
const player = (page: Page) => page.locator('[role="dialog"] video');
async function selection(page: Page) { return Number(await page.locator("#selection").getAttribute("data-index")); }
async function focusState(page: Page) { return page.evaluate(() => ({ tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute("aria-label"), inside: !!document.querySelector('[role="dialog"]')?.contains(document.activeElement), overflow: document.body.style.overflow })); }
async function ready(page: Page, time?: number) {
  await page.waitForFunction(time => { const v = document.querySelector<HTMLVideoElement>('[role="dialog"] video'); return v && v.readyState >= 2 && !v.error && v.parentElement?.dataset.signedVideoState === "ready" && (time === undefined || Math.abs(v.currentTime - time) < .6); }, time, { timeout: 25000 });
}
async function mediaState(page: Page) { return player(page).evaluate(node => { const v = node as HTMLVideoElement; return { src: v.currentSrc, time: v.currentTime, duration: v.duration, readyState: v.readyState, networkState: v.networkState, seeking: v.seeking, paused: v.paused, muted: v.muted, volume: v.volume, rate: v.playbackRate, error: v.error?.code ?? null, sameNode: v === (window as unknown as { originalVideo?: HTMLVideoElement }).originalVideo }; }); }
async function remember(page: Page) { await player(page).evaluate(node => { (window as unknown as { originalVideo: HTMLVideoElement }).originalVideo = node as HTMLVideoElement; }); }
async function open(page: Page) { await page.evaluate(() => { document.body.style.overflow = "scroll"; }); await page.locator("#opener").click(); await page.getByRole("dialog").waitFor(); await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Close"); }
async function modalCheck(page: Page) {
  const close = page.getByRole("button", { name: "Close", exact: true });
  await close.focus(); await page.keyboard.press("Shift+Tab"); assert.equal((await focusState(page)).inside, true);
  await page.keyboard.press("Tab"); assert.equal(await close.evaluate(node => node === document.activeElement), true);
  assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden");
  await page.keyboard.press("Escape"); await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.waitForFunction(() => document.activeElement?.id === "opener");
  assert.equal(await page.evaluate(() => document.body.style.overflow), "scroll", "the original nonempty body style is restored exactly");
}
async function expire(page: Page) { now += 3_601_000; await page.clock.setFixedTime(new Date(now)); }
async function waitForHeld(key: string) {
  const until = Date.now() + 3000;
  while (!held.has(key) && Date.now() < until) await new Promise(done => setTimeout(done, 20));
  assert.ok(held.has(key), "the real signing request must have reached the held HTTP response");
}
async function largeTextBounds(page: Page) {
  return page.evaluate(() => {
    const saved = document.querySelector('[role="dialog"] div[aria-label="Retained saved master with YouTube ID"]');
    const frame = saved?.parentElement; if (!frame) throw new Error("real saved-master frame missing");
    const bounds = frame.getBoundingClientRect();
    const dialog = saved.closest('[role="dialog"]')!, header = dialog.firstElementChild!;
    const badge = header.querySelector("span")!.getBoundingClientRect(), close = header.querySelector('button[aria-label="Close"]')!.getBoundingClientRect();
    const headerBounds = { badge: { x: badge.x, y: badge.y, width: badge.width, height: badge.height }, close: { x: close.x, y: close.y, width: close.width, height: close.height }, badgeCloseOverlap: Math.max(0, Math.min(badge.right, close.right) - Math.max(badge.left, close.left)) * Math.max(0, Math.min(badge.bottom, close.bottom) - Math.max(badge.top, close.top)) };
    const status = saved.querySelector('[role="status"]');
    const statusText = status?.tagName === "SPAN" ? status : status?.querySelector("span");
    const textRange = document.createRange(); if (statusText) textRange.selectNodeContents(statusText);
    const navigationTextOverlaps = statusText ? [...textRange.getClientRects()].flatMap(text => [...dialog.querySelectorAll('button[aria-label="Previous"], button[aria-label="Next"]')].map(button => {
      const b = button.getBoundingClientRect();
      return { navigation: button.getAttribute("aria-label"), area: Math.max(0, Math.min(text.right, b.right) - Math.max(text.left, b.left)) * Math.max(0, Math.min(text.bottom, b.bottom) - Math.max(text.top, b.top)) };
    })).filter(overlap => overlap.area > 0) : [];
    const candidates = [status, ...saved.querySelectorAll('[role="status"] > span, button')].filter((node): node is HTMLElement => node instanceof HTMLElement);
    const elements = candidates.map(node => { const b = node.getBoundingClientRect(); return { text: node.textContent, tag: node.tagName, fontSize: getComputedStyle(node).fontSize, x: b.x, y: b.y, width: b.width, height: b.height, fits: b.left >= bounds.left - 1 && b.right <= bounds.right + 1 && b.top >= bounds.top - 1 && b.bottom <= bounds.bottom + 1 }; });
    return { rootFontSize: getComputedStyle(document.documentElement).fontSize, headerBounds, navigationTextOverlaps, frame: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, elements, allFit: elements.every(node => node.fits) };
  });
}
const cases = ["precedence", "native-arrow", "initial-sign-retry", "native-error-retry", "expired-paused", "expired-playing", "initial-sign-race", "recovery-sign-race", "missing-source", "youtube-only", "large-text-initial-retry", "large-text-native-retry"];
const chosen = process.env.PROOF_CASE ? cases.filter(name => name === process.env.PROOF_CASE) : cases;
assert.ok(chosen.length, "unknown PROOF_CASE");
try {
  for (const profile of ["desktop", "phone", "phone-small"] as const) for (const kind of chosen) {
    const largeText = kind.startsWith("large-text");
    if ((largeText && profile === "desktop") || (!largeText && profile === "phone-small")) continue;
    const name = `${profile}-${kind}`, config: Scenario = {};
    if (kind === "initial-sign-retry" || kind === "large-text-initial-retry") { config.initialFailure = true; config.initialDelay = 650; }
    if (kind === "native-error-retry" || kind === "large-text-native-retry") config.mediaFailure = true;
    if (kind === "initial-sign-race") config.holdInitialC = true;
    if (kind === "recovery-sign-race") config.holdRecoveryA = true;
    scenarios.set(name, config);
    const context = await browser.newContext(profile === "desktop" ? { viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" } : { viewport: { width: profile === "phone-small" ? 320 : 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
    const page = await context.newPage(); page.on("pageerror", error => errors.push(`${name}: ${error.message}`));
    const a = keyFor(name, "a.mp4"), b = keyFor(name, "b.mp4"), c = keyFor(name, "c.mp4");
    const result: Record<string, unknown> = { name, profile, kind };
    try {
      await page.route("**/*", route => {
        const requestUrl = new URL(route.request().url());
        if (requestUrl.origin === base) return route.continue();
        external.push(requestUrl.origin + requestUrl.pathname);
        // Never contact YouTube: only its selected iframe URL/tab contract is in scope.
        return route.fulfill({ status: 200, contentType: "text/html", body: "<p>External YouTube transport intentionally blocked by local proof.</p>" });
      });
      const siblings = kind.startsWith("expired-");
      const start = kind === "missing-source" ? 3 : kind === "youtube-only" ? 4 : 0;
      await page.goto(`${base}?scenario=${name}&start=${start}${siblings ? "&siblings=1" : ""}`);
      if (largeText) await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
      if (siblings) await page.waitForFunction(() => [...document.querySelectorAll<HTMLVideoElement>("#siblings video")].length === 2 && [...document.querySelectorAll<HTMLVideoElement>("#siblings video")].every(v => v.readyState >= 2 && !v.error));
      await open(page);
      if (kind === "precedence") {
        await page.waitForFunction(() => !!document.querySelector('[role="dialog"] video, [role="dialog"] iframe'));
        result.selection = { videos: await player(page).count(), iframes: await page.locator('[role="dialog"] iframe').count(), signs: signs.get(a) ?? 0 };
        assert.equal(await player(page).count(), 1, "saved master must win even with a YouTube ID");
        assert.equal(await page.locator('[role="dialog"] iframe').count(), 0); await ready(page);
        await player(page).evaluate(node => { const v = node as HTMLVideoElement; v.pause(); v.currentTime = 15; }); await ready(page, 15);
        result.media = await mediaState(page);
      } else if (kind === "native-arrow") {
        await ready(page); await player(page).evaluate(node => { const v = node as HTMLVideoElement; v.pause(); v.currentTime = 8; v.focus(); }); await ready(page, 8); await remember(page);
        result.before = { index: await selection(page), ...await mediaState(page), focus: await focusState(page) };
        await page.keyboard.press("ArrowRight"); await page.waitForTimeout(250);
        result.after = { index: await selection(page), ...(await player(page).count() ? await mediaState(page) : {}), focus: await focusState(page) };
        assert.equal(await selection(page), 0, "native video ArrowRight must seek, not navigate the gallery");
        assert.equal((await mediaState(page)).sameNode, true);
        if (profile === "desktop") assert.ok((await mediaState(page)).time > 8, "desktop Chromium native ArrowRight must actually advance playback position");
        await ready(page); result.afterSeekSettled = await mediaState(page);
        await page.getByRole("button", { name: "Close", exact: true }).focus(); await page.keyboard.press("ArrowRight");
        await page.waitForFunction(() => document.querySelector("#selection")?.getAttribute("data-index") === "1"); await ready(page);
        await page.keyboard.press("ArrowLeft"); await page.waitForFunction(() => document.querySelector("#selection")?.getAttribute("data-index") === "0"); await ready(page);
        result.galleryNavigation = "right to 1, left to 0";
      } else if (kind === "initial-sign-retry" || kind === "native-error-retry" || largeText) {
        if (config.initialFailure) {
          await page.getByText("Loading video…", { exact: true }).waitFor(); assert.equal(await page.getByText("No playable source", { exact: true }).count(), 0); result.loadingWasExplicit = true;
          if (largeText) { result.loadingBounds = await largeTextBounds(page); if (!(result.loadingBounds as { allFit: boolean }).allFit) failures.push(`${name}: loading message clips the actual frame at200% root font`); }
        }
        const retry = page.getByRole("button", { name: "Retry video", exact: true }); await retry.waitFor();
        assert.equal(signs.get(a), 1); assert.equal(await page.locator('[role="dialog"] iframe').count(), 0);
        await page.screenshot({ path: join(outputDir, name + "-error.png") });
        if (largeText) { result.errorBounds = await largeTextBounds(page); if (!(result.errorBounds as { allFit: boolean }).allFit) failures.push(`${name}: error message/retry clips the actual frame at200% root font`); }
        if (largeText && (result.errorBounds as Awaited<ReturnType<typeof largeTextBounds>>).headerBounds.badgeCloseOverlap > 0) failures.push(`${name}: status badge overlaps Close at200% root font`);
        if (largeText && (result.errorBounds as Awaited<ReturnType<typeof largeTextBounds>>).navigationTextOverlaps.length) failures.push(`${name}: gallery navigation overlaps rendered error text at200% root font`);
        if (largeText) {
          // The modal is allowed to scroll at enlarged text. Prove its real
          // Retry remains visibly reachable and receives an ordinary click.
          await retry.scrollIntoViewIfNeeded();
          result.visibleRetry = await retry.evaluate(node => {
            const b = node.getBoundingClientRect(), d = node.closest('[role="dialog"]')!.getBoundingClientRect();
            const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
            return { x: b.x, y: b.y, width: b.width, height: b.height, insideVisibleDialog: b.top >= d.top && b.bottom <= d.bottom && b.left >= d.left && b.right <= d.right, receivesPointer: node === hit || node.contains(hit) };
          });
          assert.equal((result.visibleRetry as { insideVisibleDialog: boolean }).insideVisibleDialog, true);
          assert.equal((result.visibleRetry as { receivesPointer: boolean }).receivesPointer, true);
          await page.screenshot({ path: join(outputDir, name + "-error-scrolled.png") });
        }
        await page.evaluate(() => { (window as unknown as { originalDialog: Element | null }).originalDialog = document.querySelector('[role="dialog"]'); });
        config.mediaFailure = false;
        if (largeText) await retry.click();
        else { await retry.focus(); await page.keyboard.press("Enter"); }
        result.focusImmediatelyAfterRetry = await focusState(page); assert.equal((result.focusImmediatelyAfterRetry as { inside: boolean }).inside, true);
        await ready(page); assert.equal(signs.get(a), 2);
        result.focusAfterReady = await focusState(page); assert.equal((result.focusAfterReady as { inside: boolean }).inside, true);
        await page.keyboard.press("Tab"); assert.equal((await focusState(page)).inside, true);
        result.dialogStayedMounted = await page.evaluate(() => document.querySelector('[role="dialog"]') === (window as unknown as { originalDialog: Element | null }).originalDialog); assert.equal(result.dialogStayedMounted, true);
        result.media = await mediaState(page);
      } else if (kind.startsWith("expired-") || kind === "recovery-sign-race") {
        await ready(page); await player(page).evaluate(node => { const v = node as HTMLVideoElement; v.pause(); v.currentTime = 8; v.volume = .4; v.muted = true; v.playbackRate = 1.25; }); await ready(page, 8); await remember(page);
        await player(page).evaluate(node => {
          const v = node as HTMLVideoElement, events: unknown[] = [];
          (window as unknown as { recoveryEvents: unknown[] }).recoveryEvents = events;
          for (const event of ["loadstart", "loadedmetadata", "loadeddata", "canplay", "seeking", "seeked", "waiting", "pause", "playing", "error"]) v.addEventListener(event, () => events.push({ event, phase: v.parentElement?.dataset.signedVideoState, time: v.currentTime, readyState: v.readyState, seeking: v.seeking, paused: v.paused, error: v.error?.code ?? null }));
          const observer = new MutationObserver(() => events.push({ event: "phase-changed", phase: v.parentElement?.dataset.signedVideoState, time: v.currentTime, readyState: v.readyState, seeking: v.seeking, paused: v.paused, error: v.error?.code ?? null })); observer.observe(v.parentElement!, { attributes: true, attributeFilter: ["data-signed-video-state"] });
        });
        const siblingBefore = siblings ? await page.locator("#siblings video").evaluateAll(nodes => nodes.map(node => { const v = node as HTMLVideoElement; return { src: v.currentSrc, time: v.currentTime, paused: v.paused }; })) : [];
        if (kind === "expired-playing") await player(page).evaluate(node => (node as HTMLVideoElement).play());
        await expire(page); await player(page).evaluate(node => { (node as HTMLVideoElement).currentTime = 25; });
        if (kind === "recovery-sign-race") {
          await page.waitForFunction(() => (window as unknown as { signFetches: { cache?: string }[] }).signFetches.some(x => x.cache === "no-store"));
          await waitForHeld(a); await page.getByRole("button", { name: "Next", exact: true }).click(); await ready(page);
          const nextSrc = (await mediaState(page)).src; held.get(a)!(); held.delete(a); await page.waitForTimeout(350);
          assert.equal(await selection(page), 1); assert.equal((await mediaState(page)).src, nextSrc); result.staleRecoveryIgnored = true;
        } else {
          await page.waitForFunction(() => document.querySelector<HTMLVideoElement>('[role="dialog"] video')?.currentSrc.includes("generation=2")); await ready(page, 25);
          result.media = await mediaState(page); const state = result.media as Awaited<ReturnType<typeof mediaState>>;
          assert.equal(state.sameNode, true); assert.equal(state.paused, kind !== "expired-playing"); assert.equal(state.volume, .4); assert.equal(state.muted, true); assert.equal(state.rate, 1.25); assert.equal(state.error, null);
          assert.equal(signs.get(a), 2); assert.equal(signs.get(b), 1);
          assert.deepEqual(await page.locator("#siblings video").evaluateAll(nodes => nodes.map(node => { const v = node as HTMLVideoElement; return { src: v.currentSrc, time: v.currentTime, paused: v.paused }; })), siblingBefore);
          result.siblingsUnchanged = true;
          const signCalls = await page.evaluate(() => (window as unknown as { signFetches: { cache: string | null }[] }).signFetches);
          assert.equal(signCalls.filter(x => x.cache === "no-store").length, 1); result.noStoreRecoveries = 1;
        }
        assert.ok(requests.some(r => r.key === a && r.kind === "media" && r.status === 403 && r.range?.startsWith("bytes=")), "native expired range request must actually receive HTTP 403");
      } else if (kind === "initial-sign-race") {
        await ready(page); await page.getByRole("button", { name: `Go to ${titles[2]}`, exact: true }).click();
        await page.getByText("Loading video…", { exact: true }).waitFor(); await waitForHeld(c);
        await page.getByRole("button", { name: "Previous", exact: true }).click(); await ready(page); const current = (await mediaState(page)).src;
        held.get(c)!(); held.delete(c); await page.waitForTimeout(350);
        assert.equal(await selection(page), 1); assert.equal((await mediaState(page)).src, current); result.staleInitialSigningIgnored = true;
        await page.getByRole("button", { name: "Next", exact: true }).click(); await ready(page); assert.equal(signs.get(c), 1, "late response is reusable only when its own key is selected");
        assert.ok((await mediaState(page)).src.includes(encodeURIComponent(c)));
      } else if (kind === "missing-source") {
        await page.getByText("No playable source", { exact: true }).waitFor(); assert.equal(await player(page).count(), 0); assert.equal(await page.locator('[role="dialog"] iframe').count(), 0); assert.equal(signs.get(a) ?? 0, 0); result.missingSource = true;
      } else if (kind === "youtube-only") {
        const embed = page.locator('[role="dialog"] iframe'); await embed.waitFor();
        assert.equal(await embed.getAttribute("src"), "https://www.youtube.com/embed/proofVideo01"); assert.equal(await embed.getAttribute("tabindex"), "-1"); assert.equal(await player(page).count(), 0); assert.equal(signs.get(a) ?? 0, 0); result.youtubeOnlyFallback = "URL selection and modal tab contract only; remote transport blocked";
      }
      // Native controls briefly retain their loading animation after decoded
      // media is ready; let the actual browser UI settle before visual review.
      await page.waitForTimeout(500);
      if (kind === "expired-paused") {
        await page.waitForTimeout(2500); result.settledRecovery = await mediaState(page);
        assert.equal((result.settledRecovery as Awaited<ReturnType<typeof mediaState>>).seeking, false);
        assert.equal((result.settledRecovery as Awaited<ReturnType<typeof mediaState>>).paused, true);
      }
      await page.screenshot({ path: join(outputDir, name + ".png") });
      if (kind === "expired-paused") {
        result.recoveryEvents = await page.evaluate(() => (window as unknown as { recoveryEvents: unknown[] }).recoveryEvents);
        await player(page).evaluate(node => (node as HTMLVideoElement).play()); await page.waitForTimeout(300);
        await player(page).evaluate(node => (node as HTMLVideoElement).pause()); result.explicitPlayPauseUsable = await mediaState(page);
        assert.ok((result.explicitPlayPauseUsable as Awaited<ReturnType<typeof mediaState>>).time > 25);
        await page.screenshot({ path: join(outputDir, name + "-after-explicit-play-pause.png") });
      }
      const bounds = await page.getByRole("dialog").boundingBox(); assert.ok(bounds); const viewport = page.viewportSize()!;
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width + 1 && bounds.y + bounds.height <= viewport.height + 1, "actual dialog stays within viewport");
      result.dialogBounds = bounds; await modalCheck(page); result.escapeFocusBodyRestored = true;
      if (kind.startsWith("expired-")) {
        await open(page); await ready(page); assert.equal(signs.get(a), 3, "reopening refreshes the expired shared cache, independently of player-local renewal");
        result.cacheRefreshOnlyOnReopen = 3; await modalCheck(page);
      }
      if (kind === "precedence") {
        const before = signs.get(a);
        for (let repeat = 0; repeat < 4; repeat++) { await open(page); await ready(page); await modalCheck(page); }
        assert.equal(signs.get(a), before, "four repeated modal opens reuse the valid shared receipt"); result.repeatedCycles = 4;
      }
      results.push(result); console.log(JSON.stringify(result));
    } catch (error) { failures.push(`${name}: ${String(error)}`); result.failure = String(error); results.push(result); console.log(JSON.stringify(result)); await page.screenshot({ path: join(outputDir, name + "-failure.png") }); }
    finally { await page.unrouteAll({ behavior: "ignoreErrors" }); await context.close(); }
  }
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()));
  for (const [path, hash] of Object.entries(sourceHashes)) {
    const current = createHash("sha256").update(path.endsWith("/VideoPlayer.tsx") && historicalPlayer ? historicalPlayer : await readFile(path)).digest("hex");
    if (current !== hash) failures.push(`source changed while its browser bundle was running: ${path}`);
  }
  await writeFile(join(outputDir, "results.json"), JSON.stringify({ outputDir, fixture, fixtureSha256: createHash("sha256").update(bytes).digest("hex"), sourceRef: sourceRef ?? "working-tree", sourceHashes, results, failures, errors, requests, externalTransportBlocked: external }, null, 2));
  console.log(JSON.stringify({ outputDir, cases: results.length, failures, errors }));
}
assert.deepEqual(errors, []); assert.deepEqual(failures, []); assert.equal(results.length, chosen.length * 2);
