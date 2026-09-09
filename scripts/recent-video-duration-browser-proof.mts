/** Actual producer -> metadata transport -> RecentVideos -> native player.
 * A cheap synthetic MP4 exposes fractional rounding; this is not production footage.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { ffprobeDuration } from "../src/lib/ffmpeg";
import { loadMotionComicDurationHarness } from "../src/lib/__tests__/helpers/motionComicDurationHarness";

const outputDir = await mkdtemp(join(tmpdir(), "ysa-recent-duration-proof-"));
const fixture = join(outputDir, "controlled-fractional.mp4");
await promisify(execFile)(process.env.FFMPEG_BIN ?? "ffmpeg", [
  "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x394b71:s=320x180:r=30",
  "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "31.75",
  "-c:v", "libx264", "-preset", "ultrafast", "-crf", "32", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-movflags", "+faststart", fixture,
]);
const measured = await ffprobeDuration(fixture);
assert.ok(measured % 1 >= .5 && measured % 1 < 1, "fixture must expose whole-second rounding");
const harness = await loadMotionComicDurationHarness();
try {
  const { result, evidence } = await harness.run(join(outputDir, "producer"), { mediaFile: fixture, nativeProbe: ffprobeDuration }, true);
  const asset = evidence.assets.find(value => value.kind === "video")!;
  assert.equal(asset.meta?.durationSec, measured);
  assert.equal(result.videoDurationSec, measured);
  const bytes = await readFile(join(outputDir, "producer", "final.mp4"));
  const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
  assert.equal(sourceSha256, createHash("sha256").update(await readFile(fixture)).digest("hex"));
  const rows = [{ _id: "duration-run", title: "Controlled fractional-duration fixture", channelName: "Local metadata proof", videoKey: asset.r2Key, thumbnailKey: null, durationSec: asset.meta?.durationSec, createdAt: 1 }];
  const require = createRequire(import.meta.url);
  const esbuild = require(require.resolve("esbuild", { paths: [require.resolve("tsx")] })) as {
    build(options: Record<string, unknown>): Promise<{ outputFiles: Array<{ path: string; contents: Uint8Array }> }>;
  };
  type Builder = {
    onResolve(options: { filter: RegExp }, callback: (args: { path: string }) => { path: string; namespace?: string }): void;
    onLoad(options: { filter: RegExp; namespace: string }, callback: () => { contents: string; loader: string; resolveDir: string }): void;
  };
  const compiled = await esbuild.build({
    absWorkingDir: process.cwd(), bundle: true, write: false, outfile: "fixture.js", format: "iife", platform: "browser", jsx: "automatic",
    stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {RecentVideos} from './src/components/RecentVideos'; createRoot(document.getElementById('root')).render(<RecentVideos ownerId="duration-owner"/>);` },
    plugins: [{ name: "metadata-transport-only", setup(builder: Builder) {
      builder.onResolve({ filter: /^convex\/react$/ }, () => ({ path: "fixture-query", namespace: "metadata" }));
      builder.onLoad({ filter: /.*/, namespace: "metadata" }, () => ({ loader: "js", resolveDir: process.cwd(), contents: `import {useEffect,useState} from 'react'; export function useQuery(){const [rows,setRows]=useState();useEffect(()=>{let live=true;fetch('/rows').then(r=>r.json()).then(r=>{if(live)setRows(r)});return()=>{live=false}},[]);return rows}` }));
      builder.onResolve({ filter: /^@\// }, ({ path }) => ({ path: resolve("src", path.slice(2) + ".ts") }));
    } }],
  });
  const script = compiled.outputFiles.find(file => file.path.endsWith(".js"))!.contents;
  const css = compiled.outputFiles.find(file => file.path.endsWith(".css"))!.contents;
  const requests: Array<{ path: string; status: number; range?: string }> = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url!, "http://127.0.0.1");
    if (request.method !== "GET") { response.writeHead(405); response.end(); return; }
    if (url.pathname === "/master.mp4") {
      const range = request.headers.range, match = range?.match(/^bytes=(\d+)-(\d*)$/);
      const start = match ? Number(match[1]) : 0, end = Math.min(match?.[2] ? Number(match[2]) : bytes.length - 1, bytes.length - 1);
      const status = match ? 206 : 200;
      requests.push({ path: url.pathname, status, range });
      response.writeHead(status, { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Length": end - start + 1, ...(match ? { "Content-Range": `bytes ${start}-${end}/${bytes.length}` } : {}) });
      response.end(bytes.subarray(start, end + 1)); return;
    }
    requests.push({ path: url.pathname, status: 200 });
    if (url.pathname === "/rows") { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(rows)); return; }
    if (url.pathname === "/api/asset-url") {
      assert.equal(url.searchParams.get("key"), asset.r2Key);
      response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ url: "/master.mp4" })); return;
    }
    if (url.pathname === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(script); return; }
    if (url.pathname === "/fixture.css") { response.setHeader("Content-Type", "text/css"); response.end(css); return; }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end('<!doctype html><title>Actual RecentVideos duration proof</title><link rel="stylesheet" href="/fixture.css"><style>body{margin:24px;background:#10131b;color:#eee;font:16px sans-serif}button{font:inherit}</style><h1>Controlled local clip · actual RecentVideos</h1><div id="root"></div><script src="/fixture.js"></script>');
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
  const errors: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}`);
    const card = page.getByRole("button", { name: "Open saved video: Controlled fractional-duration fixture" });
    await card.waitFor();
    await page.waitForFunction(() => document.querySelector('[data-preview-state]')?.getAttribute('data-preview-state') === 'ready');
    const label = await card.locator('span[class*="duration"]').innerText();
    await page.screenshot({ path: join(outputDir, "actual-recent-card.png") });
    await card.click();
    await page.waitForFunction(() => { const video = document.querySelector<HTMLVideoElement>('[role="dialog"] video'); return video && video.readyState >= 2; });
    const native = await page.locator('[role="dialog"] video').evaluate(element => {
      const video = element as HTMLVideoElement; video.pause();
      return { duration: video.duration, readyState: video.readyState, paused: video.paused, error: video.error?.code ?? null };
    });
    const whole = Math.floor(native.duration), expectedLabel = `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
    assert.equal(label, expectedLabel, "actual RecentVideos label matches native duration, not a rounded-up second");
    assert.ok(Math.abs(native.duration - measured) <= .001);
    assert.equal(native.error, null); assert.deepEqual(errors, []);
    assert.ok(requests.some(request => request.status === 206));
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(outputDir, "actual-recent-player.png") });
    const report = { scope: "Synthetic local 31.75s requested clip; real FFprobe, cast/block metadata, actual RecentVideos and native video. Transport seams only; not production footage or new creative approval.", outputDir, fixture, sourceSha256, measuredSeconds: measured, persistedSeconds: asset.meta?.durationSec, cardLabel: label, native, requests, errors };
    await writeFile(join(outputDir, "results.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); await new Promise<void>(done => server.close(() => done())); }
} finally { harness.dispose(); }
