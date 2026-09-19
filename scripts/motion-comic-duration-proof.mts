/** Local final-byte transport proof. No provider requests, production writes or new renders. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { ffprobeDuration } from "../src/lib/ffmpeg";
import { loadMotionComicDurationHarness } from "../src/lib/__tests__/helpers/motionComicDurationHarness";

const sourceInput = process.env.DURATION_PROOF_VIDEO;
assert.ok(sourceInput, "Set DURATION_PROOF_VIDEO to an existing local MP4 longer than 15 seconds; this proof never downloads or generates footage.");
const source = resolve(sourceInput);
const outputDir = await mkdtemp(join(tmpdir(), "ysa-motion-duration-proof-"));
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const originalHash = hash(await readFile(source));
const measured = await ffprobeDuration(source);
assert.ok(Number.isFinite(measured) && measured > 15);
const harness = await loadMotionComicDurationHarness();
try {
  const { result, evidence } = await harness.run(join(outputDir, "block"), { mediaFile: source, nativeProbe: ffprobeDuration }, true);
  const videoAsset = evidence.assets.find(asset => asset.kind === "video")!;
  const uploaded = evidence.uploads.find(upload => upload.key === videoAsset.r2Key)!;
  assert.equal(result.videoDurationSec, measured);
  assert.equal(videoAsset.meta?.durationSec, measured);
  assert.equal(uploaded.sha256, originalHash, "receipt and recorded metadata refer to the unchanged retained bytes");
  assert.equal(hash(await readFile(source)), originalHash, "retained source stays intact");
  await assert.rejects(() => harness.run(join(outputDir, "corrupt-master"), { nativeProbe: ffprobeDuration }, true), /final master duration/i);
  assert.deepEqual(harness.evidence.uploads, [], "real ffprobe failure cannot reach upload");
  assert.deepEqual(harness.evidence.assets.filter(asset => ["video", "narration"].includes(asset.kind)), [], "real ffprobe failure cannot persist invented duration");
  const bytes = await readFile(uploaded.path);
  const requests: Array<{ range?: string; status: number }> = [];
  const server = createServer((request, response) => {
    if (request.url !== "/master.mp4") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end('<!doctype html><title>Local duration transport proof</title><style>body{margin:24px;background:#10131b;color:#eee;font:18px sans-serif}video{width:min(100%,960px)}</style><h1>Retained master · native duration check</h1><video controls preload="metadata" src="/master.mp4"></video>');
      return;
    }
    const range = request.headers.range;
    const match = range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = match ? Number(match[1]) : 0;
    const end = Math.min(match?.[2] ? Number(match[2]) : bytes.length - 1, bytes.length - 1);
    const status = match ? 206 : 200;
    requests.push({ range, status });
    response.writeHead(status, { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Length": end - start + 1, ...(match ? { "Content-Range": `bytes ${start}-${end}/${bytes.length}` } : {}) });
    response.end(bytes.subarray(start, end + 1));
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
  const errors: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 760 } });
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.waitForFunction(() => document.querySelector("video")!.readyState >= 2);
    const samples = [];
    for (const time of [0, 15, measured - 1]) {
      await page.locator("video").evaluate((element, position) => { const video = element as HTMLVideoElement; video.pause(); video.currentTime = position; }, time);
      await page.waitForFunction(position => { const video = document.querySelector("video")!; return video.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - position) < .05; }, time);
      await page.waitForTimeout(250); // let native controls settle after decoded seek
      const native = await page.locator("video").evaluate(element => { const video = element as HTMLVideoElement; return { duration: video.duration, time: video.currentTime, readyState: video.readyState, paused: video.paused, error: video.error?.code ?? null }; });
      assert.ok(Math.abs(native.duration - measured) <= .001, "native container time agrees within millisecond browser precision");
      assert.equal(native.error, null);
      const screenshot = join(outputDir, `native-${time.toFixed(2)}.png`);
      await page.screenshot({ path: screenshot });
      samples.push({ ...native, screenshot });
    }
    assert.deepEqual(errors, []);
    assert.ok(requests.some(request => request.status === 206));
    const report = { scope: "Actual cast + block; process/provider/storage transport fixtures; actual shared ffprobe and native MP4 decode. Not a motion-comic render or quality approval.", source, sourceSha256: originalHash, outputDir, measuredSeconds: measured, persistedDurationSec: videoAsset.meta?.durationSec, selectedKey: videoAsset.r2Key, uploaded, events: evidence.events, corruptMasterRejectedBeforeUpload: true, samples, requests, errors };
    await writeFile(join(outputDir, "results.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); await new Promise<void>(done => server.close(() => done())); }
} finally { harness.dispose(); }
