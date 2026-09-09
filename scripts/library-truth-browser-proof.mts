/** Real Library page + three artifact consumers; local read-only data/native media transport only. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";

const sourceRoot = resolve(process.env.LIBRARY_PROOF_SOURCE_ROOT ?? process.cwd());
const staticRoot = process.env.LIBRARY_PROOF_STATIC_ROOT;
const fixture = process.env.PREVIEW_TEST_VIDEO;
assert.ok(staticRoot && fixture, "Supply an existing Next build LIBRARY_PROOF_STATIC_ROOT and retained PREVIEW_TEST_VIDEO; never generate/download media");
const outputDir = await mkdtemp(join(tmpdir(), "ysa-library-truth-proof-"));
const proofPath = fileURLToPath(import.meta.url);
const proofSha256 = createHash("sha256").update(await readFile(proofPath)).digest("hex");
const sourceFiles = ["src/app/(app)/library/page.tsx", "src/components/VideoCard.tsx", "src/components/Lightbox.tsx",
  "src/components/ArtifactWorkRail.tsx", "src/components/LibraryFilters.tsx", "src/lib/libraryOrder.ts",
  "src/app/(app)/library/library.module.css", "src/app/globals.css", "src/components/ReleaseEvidenceBadge.tsx",
  "src/components/ArtifactWorkRail.module.css"].filter(path => existsSync(join(sourceRoot, path)));
const hashes: Record<string, string> = {};
for (const path of sourceFiles) hashes[path] = createHash("sha256").update(await readFile(join(sourceRoot, path))).digest("hex");
const videoBytes = await readFile(fixture);
const tags = ["burnt year altar of plagues", "what is burnt offering", "clive barker's the plague explained", "burnt offering burnt offering",
  "battlefield relic preservation", "historical artifact conservation", "military history preservation", "antique preservation",
  "archaeological preservation", "relic restoration", "historical artifacts", "battlefield finds", "ancient artifact care",
  "historical preservation", "artifact handling", "combat archaeology", "war relic care", "metal detecting finds preservation",
  "historical conservation", "militaria preservation", "battlefield archaeology", "relic cleaning", "artifact decay prevention",
  "history channel", "documentary", "inked histories", "preservation techniques", "artifact care", "history", "shorts"];
// Dates deliberately disagree with both record-ID order and competitor estimates.
const chronologicalIndices = [3, 11, 0, 16, 7, 12, 1, 15, 5, 13, 2, 17, 4, 9, 6, 14, 8, 10];
const evidenceStatuses = ["legacy_unverified", "evidence_incomplete", "release_evidence_recorded"];
const evidenceLabels = ["Legacy output — unverified", "Release evidence incomplete", "Release evidence recorded"];
const rows = Array.from({ length: 21 }, (_, index) => ({ _id: `run_${String(index).padStart(2, "0")}`,
  title: `Saved master ${String(index).padStart(2, "0")}`, channelId: index % 2 ? "channel_b" : "channel_a",
  channelSlug: index % 2 ? "proof-b" : "proof-a", channelName: index % 2 ? "Second channel" : "First channel",
  createdAt: Date.UTC(2026, 7, (index < 18 ? chronologicalIndices.indexOf(index) : index) + 1), status: index % 3 ? "ok" : "failed", libraryState: index < 18 ? "active" : "archived",
  videoKey: `owner/proof/run_${String(index).padStart(2, "0")}/final.mp4`, thumbnailKey: "owner/proof/thumbnail.svg",
  youtubeVideoId: "proofVideo01", releaseEvidenceStatus: evidenceStatuses[index % 3], estimatedViews: index === 1 || index === 10 ? 28_000_000 : (((index * 7) % 19) + 1) * 1_000_000,
  estimatedViewsSource: "tag_overlap" }));
// Deliberately non-chronological query order; estimates remain on every loaded record.
const queryRows = [...rows.filter((_, index) => index % 2), ...rows.filter((_, index) => !(index % 2))];
const channels = [{ _id: "channel_a", slug: "proof-a", name: "First channel" }, { _id: "channel_b", slug: "proof-b", name: "Second channel" }];
const staticChunks = join(staticRoot, "chunks");
let globalCss = "", globalCssPath = "";
for (const name of await readdir(staticChunks)) if (name.endsWith(".css")) {
  const contents = await readFile(join(staticChunks, name), "utf8");
  if (contents.includes(".video-card-body")) { assert.equal(globalCss, "", "only one compiled global stylesheet is expected"); globalCss = contents; globalCssPath = join(staticChunks, name); }
}
assert.ok(globalCss, "Use the actual built application global CSS, not replacement card/typography styles");
const fontClasses = [...globalCss.matchAll(/\.([a-zA-Z0-9_-]+)\{--font-(?:instrument|fraunces|jetbrains):/g)].map(match => match[1]);
const require = createRequire(import.meta.url);
type Builder = {
  onResolve(options: { filter: RegExp }, callback: (args: { path: string }) => { path: string; namespace?: string }): void;
  onLoad(options: { filter: RegExp; namespace: string }, callback: () => { contents: string; loader: string; resolveDir: string }): void;
};
const { build } = require(require.resolve("esbuild", { paths: [require.resolve("tsx")] })) as {
  build(options: Record<string, unknown>): Promise<{ outputFiles: Array<{ path: string; contents: Uint8Array }> }>;
};
const bundle = await build({ absWorkingDir: sourceRoot, bundle: true, write: false, outfile: "fixture.js", format: "iife", platform: "browser",
  jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  stdin: { resolveDir: sourceRoot, loader: "tsx", contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import LibraryPage from './src/app/(app)/library/page';import {ArtifactWorkRail} from './src/components/ArtifactWorkRail';
    import {Lightbox} from './src/components/Lightbox';import {OwnerProvider} from './src/lib/owner-context';
    import {ChannelProvider} from './src/lib/channel-context';import {OperationsAccessProvider} from './src/components/OperationsAccess';
    import {useQuery} from 'convex/react';import {api} from './convex/_generated/api';
    function Rail(){const videos=useQuery(api.videos.listVideos,{ownerId:'owner_proof',limit:500,includeArchived:true}),[index,setIndex]=useState(null);return <div id="rail"><ArtifactWorkRail videos={videos} maxItems={3} onOpen={video=>setIndex(videos.findIndex(row=>row._id===video._id))}/>{index!==null&&<Lightbox videos={videos} index={index} onIndex={setIndex} onClose={()=>setIndex(null)}/>}</div>}
    createRoot(document.getElementById('root')).render(<OwnerProvider ownerId="owner_proof"><ChannelProvider><OperationsAccessProvider><main className="proof-shell"><div id="page"><LibraryPage/></div><Rail/></main></OperationsAccessProvider></ChannelProvider></OwnerProvider>);` },
  plugins: [{ name: "local-read-only-convex-transport", setup(builder: Builder) {
    builder.onResolve({ filter: /^convex\/react$/ }, () => ({ path: "convex-transport", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "js", resolveDir: sourceRoot, contents: `
      import {useEffect,useState} from 'react';import {getFunctionName} from 'convex/server';
      export function useQuery(reference,args){const name=getFunctionName(reference),key=JSON.stringify([name,args]),[data,setData]=useState();useEffect(()=>{let stale=false;setData(undefined);if(args==='skip')return;fetch('/fixture/query?name='+encodeURIComponent(name)+'&args='+encodeURIComponent(JSON.stringify(args))).then(r=>{if(!r.ok)throw Error('fixture query refused '+name);return r.json()}).then(value=>{if(!stale){if(name==='videos:listVideos')window.loadedQueryRows=value;setData(value)}});return()=>{stale=true}},[key]);return data}
      export function useMutation(){return async()=>{throw Error('Mutation is forbidden in this read-only fixture')}}` }));
    builder.onResolve({ filter: /^@\// }, args => { const stem = resolve(sourceRoot, "src", args.path.slice(2));
      const path = [stem, ...[".ts", ".tsx", ".js", ".jsx"].map(extension => stem + extension)].find(candidate => existsSync(candidate));
      assert.ok(path, `Missing actual source import ${args.path}`); return { path }; });
  } }],
});
const js = bundle.outputFiles.find(file => file.path.endsWith(".js"))!.contents;
const css = bundle.outputFiles.find(file => file.path.endsWith(".css"))?.contents ?? "";
const requests: Array<{ method: string; path: string; status: number; query?: string; key?: string }> = [];
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://fixture.invalid"), method = req.method ?? "GET";
    if (method !== "GET") { requests.push({ method, path: url.pathname, status: 405 }); res.writeHead(405); res.end(); return; }
    if (url.pathname === "/") { res.setHeader("Content-Type", "text/html"); res.end(`<!doctype html><html class="${fontClasses.join(" ")}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/global.css"><link rel="stylesheet" href="/fixture.css"><style>.proof-shell{padding:24px;max-width:1440px;margin:auto}#rail{margin-top:48px}@media(max-width:600px){.proof-shell{padding:12px}}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`); return; }
    if (url.pathname === "/fixture.js") { res.setHeader("Content-Type", "application/javascript"); res.end(js); return; }
    if (url.pathname === "/fixture.css") { res.setHeader("Content-Type", "text/css"); res.end(css); return; }
    if (url.pathname === "/assets/global.css") { res.setHeader("Content-Type", "text/css"); res.end(globalCss); return; }
    if (url.pathname.startsWith("/media/")) { const path = join(staticRoot, "media", basename(url.pathname));
      if (existsSync(path)) { res.setHeader("Content-Type", "font/woff2"); res.end(await readFile(path)); } else { res.writeHead(404); res.end(); } return; }
    if (url.pathname === "/api/operations/elevation") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ ok: true, elevated: false, role: "viewer" })); return; }
    if (url.pathname === "/api/thumbnail-refresh") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ ok: true, inventory: [] })); return; }
    if (url.pathname === "/fixture/query") {
      const name = url.searchParams.get("name")!;
      const value = name === "videos:listVideos" ? queryRows : name === "videos:librarySummary" ? { activeCount: 18, archivedCount: 3, totalCount: 21 }
        : name === "channels:listChannels" ? channels : name === "videos:getVideoDetail" ? { description: "Retained fixture source. Estimated metadata is present in the stored row, not actual analytics.", tags, script: "Actual saved narration remains readable without remounting the native video." } : undefined;
      requests.push({ method, path: url.pathname, status: value ? 200 : 404, query: name }); res.writeHead(value ? 200 : 404, { "Content-Type": "application/json" }); res.end(JSON.stringify(value ?? { error: "Unknown query" })); return;
    }
    if (url.pathname === "/api/asset-url") { const key = url.searchParams.get("key")!; requests.push({ method, path: url.pathname, status: 200, key }); res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ url: `/native/${encodeURIComponent(key)}` })); return; }
    if (url.pathname.startsWith("/native/")) {
      if (decodeURIComponent(url.pathname).endsWith("thumbnail.svg")) { res.setHeader("Content-Type", "image/svg+xml"); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#283541"/><text x="24" y="94" fill="white" font-size="22">Retained master</text></svg>'); return; }
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? ""), start = range ? Number(range[1]) : 0;
      const end = range?.[2] ? Math.min(videoBytes.length - 1, Number(range[2])) : videoBytes.length - 1;
      if (start > end) { res.writeHead(416); res.end(); return; }
      const status = range ? 206 : 200; requests.push({ method, path: url.pathname, status });
      res.writeHead(status, { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Length": end - start + 1,
        ...(range ? { "Content-Range": `bytes ${start}-${end}/${videoBytes.length}` } : {}) }); res.end(videoBytes.subarray(start, end + 1)); return;
    }
    if (url.pathname === "/favicon.ico") { res.writeHead(204); res.end(); return; }
    requests.push({ method, path: url.pathname, status: 404 }); res.writeHead(404); res.end();
  } catch (error) { res.writeHead(500); res.end(String(error)); }
});
await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
const address = server.address(); assert.ok(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const results: unknown[] = [], failures: string[] = [];
function check(name: string, run: () => void) { try { run(); } catch (error) { failures.push(`${name}: ${String(error)}`); } }
async function visibleIds(page: Page) { const titles = await page.locator("#page .video-grid .video-card h3").allTextContents(); return titles.map(title => rows.find(row => row.title === title)!._id); }
async function waitIds(page: Page, expected: string[]) { await page.waitForFunction(titles => JSON.stringify([...document.querySelectorAll("#page .video-grid .video-card h3")].map(element => element.textContent)) === JSON.stringify(titles), expected.map(id => rows.find(row => row._id === id)!.title)); }
async function pageLayout(page: Page) {
  return page.locator("#page").evaluate(root => {
    const bounds = root.getBoundingClientRect(), elements: unknown[] = [], text: unknown[] = [], violations: unknown[] = [], excludedClosedDetails: string[] = [];
    const selector = 'h1,h2,h3,p,label,input,select,button,dl,dt,dd,.video-card,.video-card-body,.video-card-evidence,[class*="collection"],[class*="libraryDashboard"],[class*="vault"],[class*="toolbar"]';
    for (const element of root.querySelectorAll<HTMLElement>(selector)) {
      const r = element.getBoundingClientRect(); if (!r.width || !r.height) continue;
      const entry = { tag: element.tagName, className: element.className, text: element.textContent?.trim().slice(0, 80), left: r.left, right: r.right, client: element.clientWidth, scroll: element.scrollWidth };
      elements.push(entry); if (r.left < bounds.left - 1 || r.right > bounds.right + 1) violations.push({ kind: "element-outside-page", ...entry });
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode, parent = node.parentElement!; if (!node.textContent?.trim() || parent.closest("option,script,style")) continue;
      // Chromium Range can return layout boxes for unrendered closed-details content.
      const closed = parent.closest("details:not([open])");
      if (closed && !closed.querySelector(":scope > summary")?.contains(parent)) { excludedClosedDetails.push(node.textContent.trim()); continue; }
      const range = document.createRange(); range.selectNodeContents(node); const parentBounds = parent.getBoundingClientRect();
      for (const r of range.getClientRects()) {
        if (!r.width || !r.height) continue;
        const entry = { text: node.textContent.trim(), parent: parent.className, left: r.left, right: r.right, parentLeft: parentBounds.left, parentRight: parentBounds.right };
        text.push(entry);
        if (r.left < bounds.left - 1 || r.right > bounds.right + 1 || r.left < parentBounds.left - 1 || r.right > parentBounds.right + 1) violations.push({ kind: "rendered-text-outside-bound", ...entry });
      }
    }
    return { bounds: { left: bounds.left, right: bounds.right }, elements, text, excludedClosedDetails, violations };
  });
}
async function nativeState(page: Page) {
  const video = page.getByRole("dialog").locator("video"); await video.waitFor();
  await page.waitForFunction(() => { const v = document.querySelector<HTMLVideoElement>('[role="dialog"] video'); return v && v.readyState >= 2; });
  await video.evaluate(async element => { const v = element as HTMLVideoElement; await v.play(); v.pause(); v.currentTime = 15; });
  await page.waitForFunction(() => { const v = document.querySelector<HTMLVideoElement>('[role="dialog"] video')!; return v.readyState >= 2 && !v.seeking && v.paused && Math.abs(v.currentTime - 15) < .1; });
  return await video.evaluate(element => { const v = element as HTMLVideoElement; return { currentTime: v.currentTime, paused: v.paused, seeking: v.seeking, readyState: v.readyState, duration: v.duration, error: v.error?.code ?? null, source: decodeURIComponent(new URL(v.currentSrc).pathname) }; });
}
try {
  const profiles = [{ name: "desktop", width: 1440, zoom: 1 }, { name: "phone", width: 390, zoom: 1 },
    { name: "phone-320-large", width: 320, zoom: 2 }, { name: "phone-390-large", width: 390, zoom: 2 }, { name: "desktop-large", width: 1440, zoom: 2 }];
  for (const profile of profiles.filter(item => !process.env.LIBRARY_PROOF_PROFILE || item.name === process.env.LIBRARY_PROOF_PROFILE)) {
    const context = await browser.newContext({ viewport: { width: profile.width, height: 1000 }, reducedMotion: "reduce" });
    const page = await context.newPage(), errors: string[] = [], external: string[] = [];
    const evidence: Record<string, unknown> = { profile };
    try {
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => { if (new URL(route.request().url()).origin !== base) { external.push(route.request().url()); return route.abort(); } return route.continue(); });
      await page.goto(base); await page.addStyleTag({ content: `html{font-size:${profile.zoom * 100}% !important}` });
      await page.getByLabel("Sort", { exact: true }).waitFor(); await page.locator("#rail h3").first().waitFor(); await page.evaluate(() => document.fonts.ready);
      const injected = await page.evaluate(() => (window as unknown as { loadedQueryRows: typeof rows }).loadedQueryRows);
      assert.deepEqual(injected, queryRows); assert.equal(injected.find(row => row._id === "run_10")!.estimatedViews, 28_000_000); assert.equal(injected.find(row => row._id === "run_01")!.estimatedViews, 28_000_000);
      evidence.injectedRowsSha256 = createHash("sha256").update(JSON.stringify(injected)).digest("hex");
      const newest = [...chronologicalIndices].reverse().map(index => rows[index]._id); await waitIds(page, newest.slice(0, 8));
      evidence.initialIds = await visibleIds(page);
      const pageGeometry = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      evidence.pageGeometry = pageGeometry;
      check(`${profile.name}: page horizontal bounds`, () => assert.ok(pageGeometry.scroll <= pageGeometry.client + 1));
      const layout = await pageLayout(page); evidence.pageLayout = layout;
      check(`${profile.name}: actual page element and rendered text bounds`, () => assert.deepEqual(layout.violations, []));
      await page.screenshot({ path: join(outputDir, `${profile.name}-page-top.png`) });
      const cardText = await page.locator("#page .video-grid").innerText(); evidence.cardText = cardText;
      for (const label of evidenceLabels) assert.ok(cardText.includes(label), `actual cards must exercise ${label}`);
      await page.locator("#page .video-grid").screenshot({ path: join(outputDir, `${profile.name}-cards.png`) });
      await page.locator("#page .video-card").first().screenshot({ path: join(outputDir, `${profile.name}-card-detail.png`) });
      if (profile.zoom === 2 && profile.width < 600) for (const [index, name] of [[0, "legacy"], [2, "recorded"]] as const) {
        await page.locator("#page .video-card").filter({ hasText: evidenceLabels[index] }).first().screenshot({ path: join(outputDir, `${profile.name}-${name}-card.png`) });
      }
      check(`${profile.name}: VideoCard must not display stored competitor estimate`, () => assert.doesNotMatch(cardText, /28M|est\.?\s*views|tag_overlap/i));
      const opener = page.locator("#page .video-card-open").first(); await opener.click();
      const playback = await nativeState(page); evidence.playback = playback;
      assert.ok(playback.source.endsWith("/run_10/final.mp4")); assert.equal(playback.error, null);
      await page.getByRole("dialog").getByText("shorts", { exact: true }).waitFor();
      const dialogText = await page.getByRole("dialog").innerText(); evidence.dialogText = dialogText;
      await page.screenshot({ path: join(outputDir, `${profile.name}-player.png`) });
      const tagGeometry = await page.getByRole("dialog").evaluate((element, expected) => {
        const first = [...element.querySelectorAll("span")].find(span => span.textContent === expected[0])!;
        const bounds = element.getBoundingClientRect();
        return { client: element.clientWidth, scroll: element.scrollWidth, tags: [...first.parentElement!.children].map(chip => { const b = chip.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(chip);
          return { text: chip.textContent, contained: b.left >= bounds.left - 1 && b.right <= bounds.right + 1,
            textFits: [...range.getClientRects()].every(r => r.left >= b.left - 1 && r.right <= b.right + 1) }; }) };
      }, tags);
      evidence.tagGeometry = tagGeometry;
      assert.deepEqual(tagGeometry.tags.map(tag => tag.text), tags); assert.ok(tagGeometry.tags.every(tag => tag.contained && tag.textFits)); assert.ok(tagGeometry.scroll <= tagGeometry.client + 1);
      check(`${profile.name}: Lightbox must not display stored competitor estimate`, () => assert.doesNotMatch(dialogText, /28M|est\.?\s*views|tag_overlap/i));
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await page.waitForFunction(() => document.querySelector('[role="dialog"] h2')?.textContent === "Saved master 08");
      const nextState = await nativeState(page); assert.ok(nextState.source.endsWith("/run_08/final.mp4"));
      await page.getByRole("button", { name: "Previous", exact: true }).click();
      await page.waitForFunction(() => document.querySelector('[role="dialog"] h2')?.textContent === "Saved master 10");
      await nativeState(page); await page.getByRole("dialog").locator("video").focus(); await page.keyboard.press("ArrowRight");
      assert.equal(await page.getByRole("dialog").locator("h2").textContent(), "Saved master 10");
      await page.keyboard.press("Escape"); await page.getByRole("dialog").waitFor({ state: "detached" }); assert.equal(await opener.evaluate(el => el === document.activeElement), true);
      const railCards = page.locator('#rail button[aria-label^="Open "]');
      for (const card of await railCards.all()) {
        await card.scrollIntoViewIfNeeded(); await card.locator('[data-preview-source="r2"][data-preview-state="ready"]').waitFor();
        await card.getByText(/^(?:R2 preview|Saved)$/).waitFor();
      }
      await railCards.first().scrollIntoViewIfNeeded();
      const railText = await page.locator("#rail").innerText(); evidence.railText = railText;
      for (const label of evidenceLabels) assert.ok(railText.includes(label), `actual rail must exercise ${label}`);
      const railEvidence = await page.locator('#rail button[aria-label^="Open "]').evaluateAll(cards => cards.map(card => {
        const badge = [...card.querySelectorAll<HTMLElement>('span[title]')].find(element => element.textContent?.includes("evidence") || element.textContent?.includes("unverified"))!;
        const cardBounds = card.getBoundingClientRect(), badgeBounds = badge.getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(badge);
        return { text: badge.textContent, card: { left: cardBounds.left, right: cardBounds.right }, badge: { left: badgeBounds.left, right: badgeBounds.right },
          contained: badgeBounds.left >= cardBounds.left - 1 && badgeBounds.right <= cardBounds.right + 1,
          textFits: [...range.getClientRects()].every(rect => rect.left >= badgeBounds.left - 1 && rect.right <= badgeBounds.right + 1 && rect.top >= badgeBounds.top - 1 && rect.bottom <= badgeBounds.bottom + 1) };
      }));
      evidence.railEvidence = railEvidence;
      check(`${profile.name}: actual rail evidence label bounds`, () => assert.ok(railEvidence.every(badge => badge.contained && badge.textFits)));
      const railMediaBadges = await page.locator('#rail button[aria-label^="Open "]').evaluateAll(cards => cards.map(card => {
        const frame = card.firstElementChild!.getBoundingClientRect(), group = card.querySelector('[class*="mediaBadges"]')!;
        const media = card.querySelector<HTMLElement>('[data-preview-source]')!, image = media.querySelector('img')!;
        const badges = [...group.children].map(badge => {
          const box = badge.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(badge);
          return { text: badge.textContent, left: box.left, right: box.right, top: box.top, bottom: box.bottom,
            contained: box.left >= frame.left - 1 && box.right <= frame.right + 1 && box.top >= frame.top - 1 && box.bottom <= frame.bottom + 1,
            textFits: [...range.getClientRects()].every(rect => rect.left >= box.left - 1 && rect.right <= box.right + 1 && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1) };
        });
        return { source: media.dataset.previewSource, state: media.dataset.previewState, imageSrc: decodeURIComponent(new URL(image.currentSrc).pathname), badges,
          overlap: badges.length > 1 && Math.min(badges[0].right, badges[1].right) - Math.max(badges[0].left, badges[1].left) > 1 && Math.min(badges[0].bottom, badges[1].bottom) - Math.max(badges[0].top, badges[1].top) > 1 };
      }));
      evidence.railMediaBadges = railMediaBadges;
      check(`${profile.name}: actual rail source/status badge bounds`, () => assert.ok(railMediaBadges.every(card => card.source === "r2" && card.state === "ready" && card.imageSrc === "/native/owner/proof/thumbnail.svg" && card.badges.length === 2 && card.badges.some(badge => badge.text === "R2 preview" || badge.text === "Saved") && !card.overlap && card.badges.every(badge => badge.contained && badge.textFits))));
      await page.locator("#rail").screenshot({ path: join(outputDir, `${profile.name}-rail.png`) });
      check(`${profile.name}: ArtifactWorkRail must not display stored competitor estimate`, () => assert.doesNotMatch(railText, /28M|est\.?\s*views|tag_overlap/i));
      const railOpener = page.locator('#rail button[aria-label^="Open "]').first(); await railOpener.click();
      const railState = await nativeState(page); evidence.railPlayback = railState; assert.ok(railState.source.endsWith(`/${queryRows[0]._id}/final.mp4`));
      await page.keyboard.press("Escape"); await page.getByRole("dialog").waitFor({ state: "detached" }); assert.equal(await railOpener.evaluate(el => el === document.activeElement), true);
      const listRequestsBefore = requests.filter(request => request.query === "videos:listVideos").length;
      const sort = page.getByLabel("Sort", { exact: true }); const options = await sort.locator("option").allTextContents(); evidence.sortOptions = options;
      check(`${profile.name}: truthful sort choices`, () => assert.deepEqual(options, ["Newest", "Oldest"]));
      if (options.includes("Oldest")) {
        await sort.selectOption("oldest"); const oldest = chronologicalIndices.map(index => rows[index]._id); await waitIds(page, oldest.slice(0, 8));
        await page.getByRole("button", { name: "Show next 8", exact: true }).click(); await waitIds(page, oldest.slice(0, 16));
        const pagingButtons = await page.locator("#page button").allTextContents(); evidence.oldestExpandedIds = await visibleIds(page); evidence.oldestPagingButtons = pagingButtons;
        const expandedLayout = await pageLayout(page); evidence.oldestExpandedLayout = expandedLayout;
        check(`${profile.name}: expanded-page element and rendered text bounds`, () => assert.deepEqual(expandedLayout.violations, []));
        const remainingButton = page.getByRole("button", { name: "Show next 2", exact: true });
        await remainingButton.scrollIntoViewIfNeeded(); await page.screenshot({ path: join(outputDir, `${profile.name}-oldest-expanded.png`) });
        check(`${profile.name}: oldest pagination must not promise latest records`, () => assert.ok(!pagingButtons.some(label => /^Latest\s+8$/.test(label))));
        await remainingButton.locator("xpath=preceding-sibling::button[1]").click(); await waitIds(page, oldest.slice(0, 8));
        await sort.selectOption("date"); await waitIds(page, newest.slice(0, 8));
        await page.getByRole("button", { name: "Show next 8", exact: true }).click(); await waitIds(page, newest.slice(0, 16));
        evidence.newestExpandedIds = await visibleIds(page);
        await page.getByRole("button", { name: "Show next 2", exact: true }).locator("xpath=preceding-sibling::button[1]").click(); await waitIds(page, newest.slice(0, 8));
        evidence.newestCollapsedIds = await visibleIds(page);
        await page.getByRole("button", { name: "Show next 8", exact: true }).click(); await waitIds(page, newest.slice(0, 16));
        await page.getByLabel("Channel", { exact: true }).selectOption("proof-a"); await waitIds(page, newest.filter(id => Number(id.slice(4)) % 2 === 0));
        await page.getByLabel("Status", { exact: true }).selectOption("ok"); await waitIds(page, newest.filter(id => Number(id.slice(4)) % 2 === 0 && Number(id.slice(4)) % 3 !== 0));
        await page.getByLabel("Search title", { exact: true }).fill("Saved master 14"); await waitIds(page, ["run_14"]);
        await page.getByLabel("Search title", { exact: true }).fill(""); await page.getByLabel("Channel", { exact: true }).selectOption(""); await page.getByLabel("Status", { exact: true }).selectOption("all");
        await page.getByLabel("From", { exact: true }).fill("2026-08-04"); await page.getByLabel("To", { exact: true }).fill("2026-08-06"); await waitIds(page, ["run_12", "run_07", "run_16"]);
        await page.getByLabel("From", { exact: true }).fill(""); await page.getByLabel("To", { exact: true }).fill("");
        await page.getByRole("tab", { name: /^Archive/ }).click(); await waitIds(page, ["run_20", "run_19", "run_18"]);
        await page.getByRole("tab", { name: /^Active masters/ }).click(); await waitIds(page, newest.slice(0, 8));
        assert.equal(requests.filter(request => request.query === "videos:listVideos").length, listRequestsBefore, "sorting/filtering/paging must use the same already loaded rows");
        assert.deepEqual(await page.evaluate(() => (window as unknown as { loadedQueryRows: typeof rows }).loadedQueryRows), injected, "historical estimates/query records must remain untouched");
      }
      assert.equal(await page.evaluate(() => document.body.style.overflow), "");
      assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.ok(requests.every(request => request.method === "GET"));
      assert.ok(requests.some(request => request.path.endsWith("final.mp4") && request.status === 206));
      evidence.errors = errors; evidence.external = external; results.push(evidence);
    } catch (error) { failures.push(`${profile.name}: ${String(error)}`); evidence.errors = errors; evidence.external = external; results.push(evidence); await page.screenshot({ path: join(outputDir, `${profile.name}-failure.png`) }).catch(() => {}); }
    finally { await page.unrouteAll({ behavior: "ignoreErrors" }); await context.close(); }
  }
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()));
  assert.equal(createHash("sha256").update(await readFile(proofPath)).digest("hex"), proofSha256, "proof script changed during run");
  for (const path of sourceFiles) assert.equal(createHash("sha256").update(await readFile(join(sourceRoot, path))).digest("hex"), hashes[path], `${path} changed during proof`);
  const report = { outputDir, sourceRoot, hashes, proofSha256, globalCssPath, globalCssSha256: createHash("sha256").update(globalCss).digest("hex"),
    fixture, fixtureSha256: createHash("sha256").update(videoBytes).digest("hex"), injectedRows: queryRows, tags, results, requests, failures };
  await writeFile(join(outputDir, "results.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
}
assert.deepEqual(failures, []);
