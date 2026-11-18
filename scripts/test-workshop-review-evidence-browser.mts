/** Standalone component proof. Local synthetic GET responses only. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const esbuild = require(require.resolve("esbuild", { paths: [require.resolve("tsx")] }));
const output = await mkdtemp(join(tmpdir(), "workshop-evidence-browser-"));
const bundle = await esbuild.build({ absWorkingDir: process.cwd(), bundle: true, write: false, outfile: "fixture.js", format: "iife", platform: "browser", jsx: "automatic", alias: { "@": resolve("src") }, define: { "process.env": "{}" }, stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
  import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
  import {WorkshopReviewEvidenceComparison} from './src/components/WorkshopReviewEvidenceComparison';
  function App(){const [channel,setChannel]=useState('loading');const [design,setDesign]=useState('e'.repeat(64));window.setChannel=setChannel;window.setDesign=setDesign;return <WorkshopReviewEvidenceComparison channelId={channel} designFingerprint={design}/>}
  createRoot(document.getElementById('root')).render(<App/>);
` } });
const js = bundle.outputFiles.find((file: any) => file.path.endsWith(".js")).contents;
const css = bundle.outputFiles.find((file: any) => file.path.endsWith(".css")).contents;
const h = (character: string) => character.repeat(64);
const reviews = [{ fingerprint: h("a"), name: "Design A", createdAt: 1 }, { fingerprint: h("b"), name: "Design B", createdAt: 2 }];
const benchmarks = [{ fingerprint: h("c"), runId: "run-a", workerVersion: "worker-1", receiptFingerprint: h("d"), createdAt: 3 }];
const comparisons = [{ reviewFingerprint: h("a"), benchmarkFingerprint: h("c"), differences: [] }, { reviewFingerprint: h("b"), benchmarkFingerprint: h("c"), differences: [{ block: "script_gen", occurrence: 1, changes: ["Settings changed"] }] }];
const evidence = { reviews, benchmarks, comparisons, reviewsTruncated: false, benchmarksTruncated: false };
let writes = 0, retries = 0;
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://fixture.invalid");
  if (req.method !== "GET") { writes++; res.writeHead(405).end(); return; }
  if (url.pathname === "/") { res.setHeader("content-type", "text/html"); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;padding:16px;background:#10151b;color:#f4f5f7;font:16px Arial;--color-border:#53616d;--color-muted:#b4c0c8;--color-surface:#202b31}*{box-sizing:border-box}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'); return; }
  if (url.pathname === "/fixture.js") { res.setHeader("content-type", "text/javascript"); res.end(js); return; }
  if (url.pathname === "/fixture.css") { res.setHeader("content-type", "text/css"); res.end(css); return; }
  if (url.pathname !== "/api/workshop-review-evidence") { res.writeHead(404).end(); return; }
  const channel = url.searchParams.get("channelId");
  const respond = (body: unknown, status = 200) => { if (res.destroyed) return; res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (url.searchParams.get("designFingerprint") === h("f")) { respond({ ...evidence, reviews: [], comparisons: [] }); return; }
  if (channel === "loading" || channel === "slow") { setTimeout(() => respond(evidence), 700); return; }
  if (channel === "error" && retries++ === 0) { respond({}, 503); return; }
  if (channel === "empty") { respond({ ...evidence, reviews: [], comparisons: [] }); return; }
  if (channel === "no-benchmark") { respond({ ...evidence, benchmarks: [], comparisons: [] }); return; }
  if (channel === "malformed") { respond({ ...evidence, comparisons: [] }); return; }
  respond(evidence);
});
await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
const address = server.address(); assert(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
  const results: unknown[] = [];
  for (const width of [1440, 390]) {
    retries = 0;
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors: string[] = [], unexpected: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => { if (new URL(route.request().url()).origin === origin && route.request().method() === "GET") return route.continue(); unexpected.push("blocked request"); return route.abort(); });
    const change = (channel: string) => page.evaluate(value => (window as any).setChannel(value), channel);
    await page.goto(origin); await page.getByRole("status").getByText("Loading review evidence...").waitFor();
    await page.getByText("Module entries match the retained benchmark.").waitFor();
    assert.match(await page.locator("body").innerText(), /do not approve, activate, or qualify/);
    await page.getByLabel("Saved review").selectOption(h("b"));
    await page.getByText("Settings changed").waitFor();
    const screenshot = join(output, `differences-${width}.png`); await page.screenshot({ path: screenshot, fullPage: true });
    await page.evaluate(value => (window as any).setDesign(value), h("f"));
    await page.getByText("No saved reviews for this channel.").waitFor();
    assert.equal(await page.getByText("Settings changed").count(), 0);
    await page.evaluate(value => (window as any).setDesign(value), h("e"));
    await page.getByLabel("Saved review").waitFor();
    await change("empty"); await page.getByText("No saved reviews for this channel.").waitFor();
    await change("no-benchmark"); await page.getByText(/No retained qualified benchmarks/).waitFor();
    await change("malformed"); await page.getByRole("alert").getByText(/unavailable or could not be verified/).waitFor();
    await change("error"); await page.getByRole("alert").getByText(/unavailable or could not be verified/).waitFor();
    await page.getByRole("button", { name: "Retry" }).click(); await page.getByText("Module entries match the retained benchmark.").waitFor();
    await change("slow"); await page.getByText("Loading review evidence...").waitFor();
    await change("empty"); await page.getByText("No saved reviews for this channel.").waitFor();
    await page.waitForTimeout(800); assert.equal(await page.getByText("Module entries match the retained benchmark.").count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []); results.push({ width, screenshot }); await page.close();
  }
  assert.equal(writes, 0); console.log(JSON.stringify({ results, writes }));
} finally { try { await browser?.close(); } finally { await new Promise<void>(done => server.close(() => done())); } }
