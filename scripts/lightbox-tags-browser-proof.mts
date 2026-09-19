/** Actual Lightbox/native-video tag reflow; only local data/signing/media transport is replaced. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const fixture = process.env.PREVIEW_TEST_VIDEO;
assert.ok(fixture, "PREVIEW_TEST_VIDEO must name an existing retained H.264 MP4; never generate or download one");
const bytes = await readFile(fixture);
const outputDir = await mkdtemp(join(tmpdir(), "ysa-lightbox-tags-proof-"));
const sourcePath = process.env.LIGHTBOX_TAG_SOURCE ?? resolve("src/components/Lightbox.tsx");
const source = await readFile(sourcePath, "utf8");
const sourceHash = createHash("sha256").update(source).digest("hex");
// Exact saved strings observed in the read-only 9acde production dialog.
const tags = ["burnt year altar of plagues", "what is burnt offering", "clive barker's the plague explained",
  "burnt offering burnt offering", "battlefield relic preservation", "historical artifact conservation",
  "military history preservation", "antique preservation", "archaeological preservation", "relic restoration",
  "historical artifacts", "battlefield finds", "metal detecting finds preservation", "battlefield archaeology",
  "artifact decay prevention", "preservation techniques"];
const title = "7 Secrets of Battlefield Relic Preservation Revealed";
const scriptText = "Retained local transport proof. The saved SEO tags stay selectable and the native player stays mounted.";
const require = createRequire(import.meta.url);
type FixtureBuild = {
  onResolve(options: { filter: RegExp }, callback: (args: { path: string }) => { path: string; namespace?: string }): void;
  onLoad(options: { filter: RegExp; namespace: string }, callback: () => { contents: string; loader: string; resolveDir: string }): void;
};
const { build } = require(require.resolve("esbuild", { paths: [require.resolve("tsx")] })) as {
  build(options: Record<string, unknown>): Promise<{ outputFiles: Array<{ path: string; contents: Uint8Array }> }>;
};
const bundle = await build({ absWorkingDir: process.cwd(), bundle: true, write: false, outfile: "fixture.js", format: "iife",
  platform: "browser", jsx: "automatic", define: { "process.env": "{}" },
  stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {Lightbox} from './src/components/Lightbox';
    const rows=[${JSON.stringify(title)},'Independent retained sibling'].map((title,index)=>({_id:'run_'+index,title,status:'completed',channelId:'channel_proof',channelName:'Inked Histories',channelSlug:'proof',createdAt:1783204937695,videoKey:'owner/proof/'+index+'.mp4',thumbnailKey:'owner/proof/thumbnail.svg',youtubeVideoId:'proofVideo01'}));
    function App(){const[index,setIndex]=useState(0),[open,setOpen]=useState(false);return <main><button id="opener" onClick={()=>setOpen(true)}>Open saved master</button><output id="index">{index}</output>{open&&<Lightbox videos={rows} index={index} onIndex={setIndex} onClose={()=>setOpen(false)}/>}</main>}
    createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);` },
  plugins: [{ name: "read-only-source-and-data-transport", setup(builder: FixtureBuild) {
    builder.onResolve({ filter: /(?:^|\/)Lightbox$/ }, () => ({ path: "reviewed-lightbox", namespace: "source" }));
    builder.onLoad({ filter: /.*/, namespace: "source" }, () => ({ contents: source, loader: "tsx", resolveDir: resolve("src/components") }));
    builder.onResolve({ filter: /^convex\/react$/ }, () => ({ path: "data-transport", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "js", resolveDir: process.cwd(), contents: `
      import {useEffect,useState} from 'react';export function useQuery(_reference,args){const[detail,setDetail]=useState();useEffect(()=>{let stale=false;setDetail(undefined);if(args==='skip')return;fetch('/fixture/detail').then(r=>r.json()).then(value=>{if(!stale)setDetail(value)});return()=>{stale=true}},[args==='skip'?'skip':args.runId]);return detail}` }));
    builder.onResolve({ filter: /^@\// }, args => ({ path: resolve("src", args.path.slice(2) + ".ts") }));
  } }],
});
const js = bundle.outputFiles.find(file => file.path.endsWith(".js"))!.contents;
const css = bundle.outputFiles.find(file => file.path.endsWith(".css"))?.contents ?? "";
const requests: Array<{ path: string; status: number; key?: string }> = [];
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://fixture.invalid");
  if (req.method !== "GET") { res.writeHead(405); res.end(); return; }
  if (url.pathname === "/") { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>:root{--color-bg:#0b1019;--color-fg:#f7f9fc;--color-muted:#c0c9d7;--color-faint:#8191a8;--color-border:#334155;--color-border-strong:#627591;--color-surface:#162033;--color-surface-solid:#162033;--color-accent:#72dfff;--radius-card:18px;--shadow-lift:0 20px 80px #0009}*{box-sizing:border-box}body{margin:0;background:#0b1019;color:#f7f9fc;font-family:Arial;overflow:scroll}button{font:inherit;min-height:44px}#opener{margin:20px}.glass{background:#111b2b}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'); return; }
  if (url.pathname === "/fixture.js") { res.setHeader("Content-Type", "application/javascript"); res.end(js); return; }
  if (url.pathname === "/fixture.css") { res.setHeader("Content-Type", "text/css"); res.end(css); return; }
  if (url.pathname === "/fixture/detail") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ description: "Local retained media and actual saved tag strings. No production or whole-artifact quality claim.", tags, script: scriptText })); return; }
  if (url.pathname === "/api/asset-url") { const key = url.searchParams.get("key")!; requests.push({ path: url.pathname, status: 200, key });
    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ url: `/media/${encodeURIComponent(key)}` })); return; }
  if (!url.pathname.startsWith("/media/")) { res.writeHead(404); res.end(); return; }
  if (decodeURIComponent(url.pathname).endsWith("thumbnail.svg")) { res.setHeader("Content-Type", "image/svg+xml"); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#243852"/><text x="24" y="94" fill="white" font-size="22">Retained fixture</text></svg>'); return; }
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
  const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(bytes.length - 1, Number(range[2])) : bytes.length - 1;
  if (start > end) { res.writeHead(416); res.end(); return; }
  const status = range ? 206 : 200; requests.push({ path: url.pathname, status });
  res.writeHead(status, { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Length": end - start + 1,
    ...(range ? { "Content-Range": `bytes ${start}-${end}/${bytes.length}` } : {}) }); res.end(bytes.subarray(start, end + 1));
});
await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
const address = server.address(); assert.ok(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const results: unknown[] = [], failures: string[] = [];
try {
  for (const width of [1440, 390, 320]) for (const zoom of [1, 2]) {
    const name = `${width}-${zoom * 100}pct`, errors: string[] = [], external: string[] = [];
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
    const page = await context.newPage(); let evidence: unknown;
    try {
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => { if (new URL(route.request().url()).origin !== base) { external.push(route.request().url()); return route.abort(); } return route.continue(); });
      await page.goto(base); await page.addStyleTag({ content: `html{font-size:${zoom * 100}%}` });
      await page.locator("#opener").click(); const dialog = page.getByRole("dialog"), video = dialog.locator("video");
      await page.getByText(tags.at(-1)!, { exact: true }).waitFor(); await video.waitFor();
      await page.waitForFunction(() => { const v = document.querySelector<HTMLVideoElement>('[role="dialog"] video'); return v && v.readyState >= 2; });
      await video.evaluate(async element => { const v = element as HTMLVideoElement; await v.play(); v.pause(); v.currentTime = 15; });
      await page.waitForFunction(() => { const v = document.querySelector<HTMLVideoElement>('[role="dialog"] video')!; return v.readyState >= 2 && !v.seeking && v.paused && Math.abs(v.currentTime - 15) < .1; });
      await page.waitForTimeout(1000);
      const playback = await video.evaluate(element => { const v = element as HTMLVideoElement; (window as unknown as { savedVideo: HTMLVideoElement }).savedVideo = v;
        return { time: v.currentTime, paused: v.paused, seeking: v.seeking, readyState: v.readyState, duration: v.duration, error: v.error?.code ?? null, source: new URL(v.currentSrc).pathname }; });
      const geometry = await dialog.evaluate((element, expectedTags) => {
        const d = element.getBoundingClientRect();
        const chips = [...element.querySelectorAll("span")].filter(span => expectedTags.includes(span.textContent ?? ""));
        return { clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, left: d.left, right: d.right,
          chips: chips.map(chip => { const b = chip.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(chip); const style = getComputedStyle(chip);
            return { text: chip.textContent, left: b.left, right: b.right, width: b.width, height: b.height, whiteSpace: style.whiteSpace,
              fontSize: style.fontSize, maxWidth: style.maxWidth, overflowWrap: style.overflowWrap,
              textFits: [...range.getClientRects()].every(r => r.left >= b.left - 1 && r.right <= b.right + 1) }; }) };
      }, tags);
      await page.screenshot({ path: join(outputDir, `${name}-player.png`) });
      await dialog.evaluate((element, tag) => { const chip = [...element.querySelectorAll("span")].find(span => span.textContent === tag)!;
        element.scrollTop += chip.getBoundingClientRect().top - element.getBoundingClientRect().top - 120; element.scrollLeft = 0; }, tags[2]);
      await page.screenshot({ path: join(outputDir, `${name}-tags.png`) });
      evidence = { playback, geometry };
      assert.equal(playback.error, null); assert.equal(playback.paused, true); assert.equal(playback.seeking, false);
      assert.equal(geometry.chips.length, tags.length); assert.deepEqual(geometry.chips.map(chip => chip.text), tags, "no tag text truncation or replacement");
      assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1, "dialog must have no horizontal tag overflow");
      for (const chip of geometry.chips) { assert.ok(chip.left >= geometry.left - 1 && chip.right <= geometry.right + 1, `${chip.text}: chip exceeds dialog`); assert.ok(chip.textFits, `${chip.text}: actual rendered text exceeds chip`); }
      const selected = await page.getByText(tags[2], { exact: true }).evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range); return selection.toString(); });
      assert.equal(selected, tags[2], "saved tag copy/selection retains exact text");
      await page.getByRole("button", { name: "Script", exact: true }).click();
      await page.getByText(scriptText, { exact: true }).waitFor();
      assert.equal(await video.evaluate(element => element === (window as unknown as { savedVideo: HTMLVideoElement }).savedVideo), true);
      assert.equal(await video.evaluate(element => (element as HTMLVideoElement).currentTime), 15);
      assert.equal(await dialog.locator('a[href="https://www.youtube.com/watch?v=proofVideo01"]').count(), 1, "published source link is not changed by tag layout");
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await page.waitForFunction(() => document.getElementById("index")?.textContent === "1");
      await page.waitForFunction(() => { const v = document.querySelector<HTMLVideoElement>('[role="dialog"] video'); return v && v.readyState >= 2 && new URL(v.currentSrc).pathname.endsWith("1.mp4"); });
      await page.keyboard.press("Escape"); await dialog.waitFor({ state: "detached" });
      assert.equal(await page.locator("#opener").evaluate(element => element === document.activeElement), true);
      assert.equal(await page.evaluate(() => document.body.style.overflow), "");
      assert.deepEqual(errors, []); assert.deepEqual(external, []);
      results.push({ name, width, zoom, evidence, errors, external });
    } catch (error) { failures.push(`${name}: ${String(error)}`); results.push({ name, width, zoom, evidence, errors, external }); }
    finally { await page.unrouteAll({ behavior: "ignoreErrors" }); await context.close(); }
  }
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()));
  assert.equal(createHash("sha256").update(await readFile(sourcePath)).digest("hex"), sourceHash, "reviewed source changed while bundling/running");
  const report = { outputDir, sourcePath, sourceHash, fixture, fixtureSha256: createHash("sha256").update(bytes).digest("hex"), tags, results, requests, failures };
  await writeFile(join(outputDir, "results.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
}
assert.deepEqual(failures, []);
