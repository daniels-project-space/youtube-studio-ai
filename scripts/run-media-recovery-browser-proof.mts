/** Actual RunMediaWorkbench + production CSS/cache/native-video integration.
 * Only ordinary props and local signing/media HTTP transport are fixtures.
 * Explicit retained MP4 input; never renders, downloads, or mutates production.
 * An unfixed component deliberately fails the real retry/recovery assertions.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";

const fixture = process.env.PREVIEW_TEST_VIDEO;
assert.ok(fixture, "PREVIEW_TEST_VIDEO must explicitly name an existing >=30-second H.264 MP4");
const bytes = await readFile(fixture);
const outputDir = await mkdtemp(join(tmpdir(), "ysa-run-media-proof-"));
const paths = ["src/components/RunMediaWorkbench.tsx", "src/components/RunMediaWorkbench.module.css", "src/lib/runMediaWorkbench.ts", "src/lib/asset-url.ts", "src/components/SignedVideoPlayer.tsx", "src/components/SignedVideoPlayer.module.css", "src/components/MediaPreview.tsx", "src/components/MediaPreview.module.css"];
const sourceHashes = Object.fromEntries(await Promise.all(paths.map(async path => [path, createHash("sha256").update(await readFile(path)).digest("hex")])));
const require = createRequire(import.meta.url);
const esbuild = require(require.resolve("esbuild", { paths: [require.resolve("tsx")] })) as {
  build(options: Record<string, unknown>): Promise<{ outputFiles: { path: string; contents: Uint8Array }[] }>;
};
const bundle = await esbuild.build({
  absWorkingDir: process.cwd(), bundle: true, write: false, outfile: "fixture.js", format: "iife", platform: "browser", jsx: "automatic", define: { "process.env": "{}" },
  stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React,{useEffect,useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {RunMediaWorkbench} from './src/components/RunMediaWorkbench';
    window.signFetches=[];
    const transport=window.fetch.bind(window);
    window.fetch=(url,options)=>{if(String(url).startsWith('/api/asset-url'))window.signFetches.push({url:String(url),cache:options?.cache??null});return transport(url,options)};
    function App(){
      const [assets,setAssets]=useState();
      useEffect(()=>{let live=true;fetch('/fixture/assets'+location.search).then(r=>r.json()).then(data=>{if(live)setAssets(data)});return()=>{live=false}},[]);
      function replace(file){setAssets(rows=>rows.map(row=>row._id==='main'?{...row,r2Key:row.r2Key.replace(/[^/]+$/,file)}:row))}
      return <main><h1>Retained Run Media review</h1><nav aria-label="Fixture asset updates"><button id="set-a" onClick={()=>replace('a.mp4')}>Use original key</button><button id="set-b" onClick={()=>replace('b.mp4')}>Same ID, key B</button><button id="set-c" onClick={()=>replace('c.mp4')}>Same ID, key C</button></nav><div id="workbench"><RunMediaWorkbench assets={assets} stages={[{block:'cast',status:'ok'}]} runStatus="completed" selectedVideoAssetId="main" currentThumbnail={null}/></div><button id="after">Outside after</button></main>
    }
    createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
  ` },
});
const js = bundle.outputFiles.find(file => file.path.endsWith(".js"))!.contents;
const css = bundle.outputFiles.find(file => file.path.endsWith(".css"))!.contents;
type Scenario = { initialFailure?: boolean; mediaFailure?: boolean; holdC?: boolean; initialDelay?: number };
const scenarios = new Map<string, Scenario>(), signs = new Map<string, number>(), held = new Map<string, () => void>();
const requests: { key: string; kind: "sign" | "media" | "source-receipt"; status: number; range?: string; generation: number }[] = [];
let now = Date.now();
const keyFor = (name: string, file: string) => `owner/owner_proof/${name}/${file}`;
const stamp = (time: number) => new Date(time).toISOString().replace(/[-:]|\.\d{3}/g, "");
const signed = (key: string, generation: number) => `/media/${encodeURIComponent(key)}?generation=${generation}&X-Amz-Date=${stamp(now)}&X-Amz-Expires=3600`;
const subtitleText = "1\n00:00:00,000 --> 00:00:01,000\nRetained local subtitle proof.\n";
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://fixture.invalid");
  if (req.method !== "GET") { res.writeHead(405); res.end(); return; }
  if (url.pathname === "/") {
    res.setHeader("Content-Type", "text/html");
    res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>:root{--color-bg:#0b1019;--color-text:#f7f9fc;--color-fg:#f7f9fc;--color-muted:#c0c9d7;--color-faint:#9baabc;--color-border:#334155;--color-border-strong:#627591;--color-surface:#162033;--color-surface-solid:#162033;--color-accent:#72dfff;--color-secondary:#a1bfff;--color-ok:#91dfaa;--font-mono:monospace;--font-display:Arial}*{box-sizing:border-box}body{margin:0;background:#0b1019;color:#f7f9fc;font:16px Arial}main{max-width:1100px;margin:auto;padding:12px}h1{font-size:1.2rem}nav{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}button{font:inherit;min-height:44px;max-width:100%;white-space:normal}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'); return;
  }
  if (url.pathname === "/fixture.js") { res.setHeader("Content-Type", "application/javascript"); res.end(js); return; }
  if (url.pathname === "/fixture.css") { res.setHeader("Content-Type", "text/css"); res.end(css); return; }
  if (url.pathname === "/fixture/assets") {
    const name = url.searchParams.get("scenario") ?? ""; assert.ok(scenarios.has(name));
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(name.endsWith("file-sign-retry")
      ? [{ _id: "main", _creationTime: 100, kind: "subtitles", r2Key: keyFor(name, "captions.srt") }]
      : ["main", "sibling-same", "sibling-other"].map((_id, i) => ({ _id, _creationTime: 100 - i, kind: "video", r2Key: keyFor(name, i === 2 ? "b.mp4" : "a.mp4"), meta: { durationSec: 31.021995 } })))); return;
  }
  if (url.pathname === "/api/asset-url") {
    const key = url.searchParams.get("key") ?? "", config = scenarios.get(key.split("/")[2]);
    if (!config) { res.writeHead(403); res.end(); return; }
    const generation = (signs.get(key) ?? 0) + 1; signs.set(key, generation);
    const primary = key.endsWith("/a.mp4") || key.endsWith("/captions.srt");
    const failure = primary && config.initialFailure && generation === 1;
    requests.push({ key, kind: "sign", status: failure ? 503 : 200, generation });
    const finish = () => {
      if (res.destroyed) return;
      if (failure) { res.writeHead(503); res.end("Signing unavailable"); return; }
      res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "private, max-age=600"); res.end(JSON.stringify({ url: signed(key, generation) }));
    };
    if (key.endsWith("/c.mp4") && config.holdC) held.set(key, finish);
    else if (primary && generation === 1 && config.initialDelay) setTimeout(finish, config.initialDelay);
    else if (generation > 1) setTimeout(finish, 120);
    else finish(); return;
  }
  if (!url.pathname.startsWith("/media/")) { res.writeHead(404); res.end(); return; }
  const key = decodeURIComponent(url.pathname.slice(7)), config = scenarios.get(key.split("/")[2]);
  const issued = Date.parse((url.searchParams.get("X-Amz-Date") ?? "").replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z"));
  const generation = Number(url.searchParams.get("generation"));
  const status = !config || now >= issued + 3_600_000 || (key.endsWith("/a.mp4") && config.mediaFailure) ? 403 : 206;
  requests.push({ key, kind: req.headers["x-proof-receipt"] ? "source-receipt" : "media", status, range: req.headers.range ?? "", generation });
  res.setHeader("Cache-Control", "no-store");
  if (status === 403) { res.writeHead(403); res.end("ExpiredRequest"); return; }
  if (key.endsWith("/captions.srt")) {
    requests[requests.length - 1].status = 200;
    res.setHeader("Content-Type", "application/x-subrip; charset=utf-8"); res.end(subtitleText); return;
  }
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
  const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(bytes.length - 1, Number(range[2])) : bytes.length - 1;
  if (start > end) { res.writeHead(416); res.end(); return; }
  res.writeHead(range ? 206 : 200, { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Length": end - start + 1, ...(range ? { "Content-Range": `bytes ${start}-${end}/${bytes.length}` } : {}) });
  if (generation > 1) { res.end(bytes.subarray(start, end + 1)); return; }
  stream(res, start, end);
});
function stream(res: ServerResponse, start: number, end: number) {
  let cursor = start, timer: ReturnType<typeof setTimeout>;
  const send = () => { if (res.destroyed) return; const next = Math.min(end + 1, cursor + 65_536); res.write(bytes.subarray(cursor, next)); cursor = next; if (cursor > end) res.end(); else timer = setTimeout(send, 20); };
  res.on("close", () => clearTimeout(timer)); send();
}
await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
const address = server.address(); assert.ok(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const results: Record<string, unknown>[] = [], failures: string[] = [], errors: string[] = [];
const master = (page: Page) => page.locator('#workbench article[data-media-type="video"],#workbench article[data-media-type="file"]').first();
const player = (page: Page) => master(page).locator("video");
async function ready(page: Page, time?: number) {
  await page.waitForFunction(time => { const v = document.querySelector<HTMLVideoElement>('#workbench article[data-media-type="video"] video'); return v && v.readyState >= 2 && !v.error && !v.seeking && (time === undefined || Math.abs(v.currentTime - time) < .6); }, time, { timeout: 12000 });
}
async function state(page: Page) {
  return master(page).evaluate(article => {
    const v = article.querySelector("video"), original = (window as unknown as { originalVideo?: HTMLVideoElement }).originalVideo;
    return { hasVideo: !!v, text: article.textContent, href: article.querySelector("a")?.href, sameNode: !!v && v === original, originalConnected: original?.isConnected,
      ...(v ? { src: v.currentSrc, phase: v.parentElement?.dataset.signedVideoState, time: v.currentTime, duration: v.duration, readyState: v.readyState, networkState: v.networkState, seeking: v.seeking, paused: v.paused, volume: v.volume, muted: v.muted, rate: v.playbackRate, error: v.error?.code ?? null, buffered: Array.from({ length: v.buffered.length }, (_, i) => [v.buffered.start(i), v.buffered.end(i)]) } : {}) };
  });
}
async function siblingState(page: Page) {
  return page.locator('#workbench article[data-media-type="video"]').evaluateAll(cards => cards.slice(1).map(card => { const v = card.querySelector("video"); return { src: v?.currentSrc, time: v?.currentTime, paused: v?.paused, error: v?.error?.code ?? null }; }));
}
async function errorOrRecovered(page: Page) {
  await page.waitForFunction(() => {
    const card = document.querySelector('#workbench article[data-media-type="video"]')!, v = card.querySelector("video");
    return (!v && card.textContent?.includes("This browser could not play")) || (v?.currentSrc.includes("generation=2") && v.readyState >= 2 && !v.seeking) || !!card.querySelector('[data-signed-video-state="error"]');
  }, undefined, { timeout: 12000 });
}
async function bounds(page: Page) {
  return master(page).evaluate(article => {
    const frame = article.firstElementChild!, b = frame.getBoundingClientRect();
    const nodes = [...frame.querySelectorAll('[role="status"],button')];
    if (!nodes.length && !frame.querySelector("video")) nodes.push(...frame.children);
    const elements = nodes.map(node => { const r = node.getBoundingClientRect(); return { text: node.textContent, x: r.x, y: r.y, width: r.width, height: r.height, fits: r.left >= b.left - 1 && r.right <= b.right + 1 && r.top >= b.top - 1 && r.bottom <= b.bottom + 1 }; });
    const range = document.createRange(); const status = frame.querySelector('[role="status"]') ?? (!frame.querySelector("video") ? frame.firstElementChild : null);
    if (status) range.selectNodeContents(status);
    const lines = status ? [...range.getClientRects()].map(r => ({ x: r.x, y: r.y, width: r.width, height: r.height, fits: r.left >= b.left - 1 && r.right <= b.right + 1 && r.top >= b.top - 1 && r.bottom <= b.bottom + 1 })) : [];
    return { rootFontSize: getComputedStyle(document.documentElement).fontSize, frame: { x: b.x, y: b.y, width: b.width, height: b.height }, elements, lines, allFit: elements.length > 0 && elements.every(r => r.fits) && lines.every(r => r.fits), documentOverflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
}
async function sourceReceipt(page: Page) {
  const anchor = master(page).locator('a[target="_blank"]');
  const href = await anchor.getAttribute("href"); assert.ok(href);
  const transport = await page.request.get(new URL(href, base).href, { headers: { Range: "bytes=0-1023", "X-Proof-Receipt": "1" } });
  return { href: new URL(href, base).href, key: decodeURIComponent(new URL(href, base).pathname.slice(7)), status: transport.status(), rel: await anchor.getAttribute("rel"), label: await anchor.getAttribute("aria-label") };
}
const cases = ["healthy", "expired-paused", "expired-playing", "initial-sign-retry", "native-error-retry", "same-id-key-change", "key-race", "source-link", "large-text-initial", "large-text-native", "file-sign-retry"];
const chosen = process.env.PROOF_CASE ? cases.filter(name => name === process.env.PROOF_CASE) : cases;
assert.ok(chosen.length, "unknown PROOF_CASE");
try {
  for (const profile of ["desktop", "phone", "phone-small"] as const) for (const kind of chosen) {
    const enlarged = kind.startsWith("large-text");
    if ((enlarged && profile === "desktop") || (!enlarged && profile === "phone-small")) continue;
    const name = `${profile}-${kind}`, config: Scenario = {};
    if (kind === "initial-sign-retry" || kind === "large-text-initial" || kind === "file-sign-retry") { config.initialFailure = true; config.initialDelay = 650; }
    if (kind === "native-error-retry" || kind === "large-text-native" || kind === "same-id-key-change") config.mediaFailure = true;
    if (kind === "key-race") config.holdC = true;
    scenarios.set(name, config);
    const context = await browser.newContext({ viewport: { width: profile === "desktop" ? 1280 : profile === "phone" ? 390 : 320, height: profile === "desktop" ? 900 : 844 }, ...(profile === "desktop" ? {} : { isMobile: true, hasTouch: true }), deviceScaleFactor: 1, reducedMotion: "reduce" });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(`${name}: ${error.message}`));
    const result: Record<string, unknown> = { name, kind, profile }, a = keyFor(name, "a.mp4"), b = keyFor(name, "b.mp4"), c = keyFor(name, "c.mp4");
    const check = (ok: unknown, message: string) => { if (!ok) failures.push(`${name}: ${message}`); };
    try {
      await page.route("**/*", route => { if (new URL(route.request().url()).origin === base) return route.continue(); errors.push(`${name}: unexpected external transport`); return route.abort(); });
      await page.goto(`${base}?scenario=${name}`);
      if (enlarged) await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
      await master(page).waitFor();
      if (kind === "file-sign-retry") {
        const key = keyFor(name, "captions.srt"), card = master(page);
        await card.getByText("Preparing file link…", { exact: true }).waitFor();
        await card.getByText("File link unavailable", { exact: false }).waitFor();
        assert.equal(signs.get(key), 1); assert.equal(await card.locator("a").count(), 0);
        assert.equal(await card.locator("video,audio").count(), 0);
        await card.evaluate(node => { (window as unknown as { originalCard: Element }).originalCard = node; });
        const retry = card.getByRole("button", { name: "Retry link", exact: true });
        await retry.scrollIntoViewIfNeeded(); await retry.focus();
        await page.screenshot({ path: join(outputDir, name + "-error.png") });
        await retry.click();
        result.focusAfterRetry = await card.evaluate(node => ({ inside: node.contains(document.activeElement), tag: document.activeElement?.tagName, sameCard: node === (window as unknown as { originalCard: Element }).originalCard }));
        const focus = result.focusAfterRetry as { inside: boolean; sameCard: boolean };
        check(focus.inside && focus.sameCard, "file Retry must preserve the article and keyboard focus inside it");
        const link = card.getByRole("link", { name: "Open subtitles source: captions.srt", exact: true }); await link.waitFor();
        const href = new URL((await link.getAttribute("href"))!, base).href;
        check(signs.get(key) === 2, "file Retry must issue exactly one additional signing request");
        check(decodeURIComponent(new URL(href).pathname.slice(7)) === key && new URL(href).searchParams.get("generation") === "2", "file link must identify the exact newly signed SRT object");
        const response = await page.request.get(href, { headers: { "X-Proof-Receipt": "1" } }), body = await response.text();
        result.source = { href, key, status: response.status(), contentType: response.headers()["content-type"], text: body, rel: await link.getAttribute("rel") };
        check(response.status() === 200 && body === subtitleText, "file link must read back the exact actual SRT text with HTTP200");
        check((await link.getAttribute("rel")) === "noopener noreferrer", "file source retains safe new-tab relation");
      } else if (config.initialFailure || config.mediaFailure) {
        if (config.initialFailure) {
          await master(page).getByText(/Loading (retained preview|video)/).waitFor(); result.loadingWasExplicit = true;
          if (enlarged) { result.loadingBounds = await bounds(page); check((result.loadingBounds as Awaited<ReturnType<typeof bounds>>).allFit, "loading status must fit the actual preview frame at 200% root font"); }
          await master(page).getByText(/(Preview URL unavailable|Video URL unavailable|Video link unavailable|Could not load video)/).waitFor({ timeout: 5000 });
        } else await errorOrRecovered(page);
        result.error = await state(page);
        if (config.mediaFailure) check(requests.some(r => r.key === a && r.kind === "media" && r.status === 403 && r.range?.startsWith("bytes=")), "native error must come from a real HTTP403 Range response");
        if (enlarged) { result.errorBounds = await bounds(page); check((result.errorBounds as Awaited<ReturnType<typeof bounds>>).allFit, "error text and Retry must fit the actual preview frame at 200% root font"); }
        await master(page).scrollIntoViewIfNeeded(); await page.screenshot({ path: join(outputDir, name + "-error.png") });
        if (kind === "same-id-key-change") {
          config.mediaFailure = false; await page.locator("#set-b").click();
          await master(page).getByRole("heading", { name: "b.mp4", exact: true }).waitFor(); await page.waitForTimeout(650);
          result.afterKeyChange = await state(page); result.source = await sourceReceipt(page);
          check((result.afterKeyChange as Awaited<ReturnType<typeof state>>).hasVideo, "same asset _id with new r2Key must clear the old key's native failure");
          check((result.source as Awaited<ReturnType<typeof sourceReceipt>>).key === b, "source link must identify new key B");
          if (await player(page).count()) { await ready(page); check((await state(page)).src?.includes(encodeURIComponent(b)), "new native source must be key B"); }
        } else {
          const retry = master(page).getByRole("button", { name: /retry/i }); const count = await retry.count();
          result.retryCount = count; check(count === 1, "failed video needs one actionable manual Retry");
          if (count === 1) {
            config.mediaFailure = false; const beforeSigns = signs.get(a) ?? 0;
            await retry.scrollIntoViewIfNeeded(); await retry.focus();
            result.retryHit = await retry.evaluate(button => { const r = button.getBoundingClientRect(); return { visible: r.top >= 0 && r.bottom <= innerHeight, pointer: button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) }; });
            check((result.retryHit as { pointer: boolean }).pointer, "Retry must receive an ordinary pointer click");
            await retry.click(); result.focusAfterRetry = await master(page).evaluate(card => ({ inside: card.contains(document.activeElement), tag: document.activeElement?.tagName }));
            check((result.focusAfterRetry as { inside: boolean }).inside, "removing Retry must not lose keyboard focus outside the card");
            await ready(page); result.retried = await state(page); check(signs.get(a) === beforeSigns + 1, "manual Retry must make exactly one fresh signing request");
          }
        }
      } else {
        await ready(page); await player(page).evaluate(node => { const v = node as HTMLVideoElement; v.pause(); v.currentTime = 8; v.volume = .4; v.muted = true; v.playbackRate = 1.25; }); await ready(page, 8);
        await player(page).evaluate(node => {
          const v = node as HTMLVideoElement; (window as unknown as { originalVideo: HTMLVideoElement }).originalVideo = v;
          const events: unknown[] = []; (window as unknown as { nativeEvents: unknown[] }).nativeEvents = events;
          for (const event of ["error", "seeking", "seeked", "pause", "playing", "waiting", "loadeddata", "canplay"]) v.addEventListener(event, () => events.push({ event, phase: v.parentElement?.dataset.signedVideoState, time: v.currentTime, readyState: v.readyState, seeking: v.seeking, paused: v.paused, error: v.error?.code ?? null }));
        });
        result.before = await state(page); const siblingBefore = await siblingState(page);
        if (kind.startsWith("expired-") || kind === "source-link") {
          if (kind === "source-link") result.freshSource = await sourceReceipt(page);
          if (kind === "expired-playing") await player(page).evaluate(node => (node as HTMLVideoElement).play());
          now += 3_601_000; await page.clock.setFixedTime(new Date(now));
          await player(page).evaluate(node => { (node as HTMLVideoElement).currentTime = 25; }); await errorOrRecovered(page); await page.waitForTimeout(250);
          result.after = await state(page); result.siblings = await siblingState(page); result.source = await sourceReceipt(page);
          const after = result.after as Awaited<ReturnType<typeof state>>;
          check(requests.some(r => r.key === a && r.kind === "media" && r.status === 403 && r.range?.startsWith("bytes=")), "expiry must reject an actual native Range with HTTP403");
          check(after.sameNode, "expired seek must preserve the same native video DOM node");
          check(after.readyState !== undefined && after.readyState >= 2 && after.error === null && after.seeking === false, "expired seek must restore decoded, error-free media");
          check(after.time !== undefined && Math.abs(after.time - 25) < .7 && after.paused === (kind !== "expired-playing"), "expired seek must preserve 25-second position and paused/playing intent");
          check(after.volume === .4 && after.muted === true && after.rate === 1.25, "expiry must preserve volume/mute/rate");
          check(JSON.stringify(result.siblings) === JSON.stringify(siblingBefore), "same-key and other-key siblings must be unaffected");
          check(signs.get(a) === 2 && signs.get(b) === 1, "expiry must sign only the failed key once");
          const receipt = result.source as Awaited<ReturnType<typeof sourceReceipt>>;
          check(receipt.key === a, "source link must retain exact asset identity");
          check(receipt.href === after.src, "source link must match the actual recovered native currentSrc");
          check(receipt.status === 206, "source link after expiry/recovery must actually return retained media, not expired403");
          result.signFetches = await page.evaluate(() => (window as unknown as { signFetches: unknown[] }).signFetches);
        } else if (kind === "key-race") {
          await page.locator("#set-c").click();
          const until = Date.now() + 3000; while (!held.has(c) && Date.now() < until) await new Promise(done => setTimeout(done, 20));
          assert.ok(held.has(c), "actual C signing response held"); await page.locator("#set-b").click(); await ready(page);
          const current = (await state(page)).src; held.get(c)!(); held.delete(c); await page.waitForTimeout(350);
          result.after = await state(page); result.source = await sourceReceipt(page);
          check((await state(page)).src === current && current?.includes(encodeURIComponent(b)), "late key C response cannot replace selected key B");
          await page.locator("#set-c").click(); await ready(page); check(signs.get(c) === 1, "late C receipt is reusable only when key C is selected");
          check((await sourceReceipt(page)).key === c, "source link must follow selected key C");
        } else {
          await player(page).evaluate(node => { (node as HTMLVideoElement).currentTime = 15; }); await ready(page, 15);
          result.native = await state(page); result.source = await sourceReceipt(page);
          check((result.source as Awaited<ReturnType<typeof sourceReceipt>>).key === a, "healthy source link exact identity");
          check(signs.get(a) === 1 && signs.get(b) === 1, "same-key siblings coalesce initial signing");
        }
        result.nativeEvents = await page.evaluate(() => (window as unknown as { nativeEvents: unknown[] }).nativeEvents);
      }
      await master(page).scrollIntoViewIfNeeded(); await page.waitForTimeout(500);
      await page.screenshot({ path: join(outputDir, name + ".png") });
      if (kind === "expired-paused" && await player(page).count()) {
        // Observe Chromium's native affordance settling without changing user
        // intent or hiding controls to manufacture the paused screenshot.
        await page.waitForTimeout(2500); result.settledRecovery = await state(page);
        check((result.settledRecovery as Awaited<ReturnType<typeof state>>).seeking === false, "paused recovery must finish its real native seek");
        await page.screenshot({ path: join(outputDir, name + "-settled.png") });
      }
      if (kind === "expired-paused" && await player(page).count()) {
        await player(page).evaluate(node => (node as HTMLVideoElement).play()); await page.waitForTimeout(250); await player(page).evaluate(node => (node as HTMLVideoElement).pause());
        result.explicitPlayPause = await state(page);
        check((result.explicitPlayPause as Awaited<ReturnType<typeof state>>).sameNode && ((result.explicitPlayPause as Awaited<ReturnType<typeof state>>).time ?? 0) > 25, "recovered native player must remain usable on the same node");
        await page.screenshot({ path: join(outputDir, name + "-after-explicit-play-pause.png") });
      }
    } catch (error) { result.error = String(error); failures.push(`${name}: ${String(error)}`); await page.screenshot({ path: join(outputDir, name + "-failure.png") }).catch(() => {}); }
    finally { results.push(result); await context.close(); }
    console.log(JSON.stringify({ name, failures: failures.filter(failure => failure.startsWith(name)) }));
  }
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()));
  for (const [path, hash] of Object.entries(sourceHashes)) if (createHash("sha256").update(await readFile(path)).digest("hex") !== hash) failures.push(`source changed during proof: ${path}`);
  await writeFile(join(outputDir, "results.json"), JSON.stringify({ outputDir, fixture, fixtureSha256: createHash("sha256").update(bytes).digest("hex"), sourceHashes, results, failures, errors, requests }, null, 2));
}
console.log(JSON.stringify({ outputDir, cases: results.length, failures, errors }, null, 2));
if (failures.length || errors.length) process.exitCode = 1;
