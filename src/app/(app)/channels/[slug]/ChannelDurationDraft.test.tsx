import assert from "node:assert/strict";
import { createServer } from "node:http";
import Module, { createRequire } from "node:module";
import { chromium } from "playwright";

const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown };
const original = loader._load;
const fixture = { ownerId: "owner-a", family: "music_loop", pipeline: [{ block: "assemble", params: { durationSec: 7200 } }], identity: { programRoute: { frozen: true } } };
class AuthError extends Error { constructor(message: string, public status: number) { super(message); } }
class Client { async query() { return fixture; } }
loader._load = function(name, ...args) {
  if (name === "@/lib/operatorSession") return { StudioAuthError: AuthError, requireStudioActor: async () => ({ ownerId: "owner-a", role: "owner", authKind: "session" }) };
  if (name === "@/lib/studioConvexHttpClient") return { StudioConvexHttpClient: Client };
  return original.call(this, name, ...args);
};

async function main() {
  process.env.YOUTUBE_AUTOMATION_PRIVATE = "1";
  process.env.NEXT_PUBLIC_CONVEX_URL = "http://127.0.0.1:1";
  const { POST } = await import("../../../api/channel-duration-draft/route");
  const require = createRequire(import.meta.url);
  const esbuild = require("../../../../../node_modules/.pnpm/esbuild@0.27.0/node_modules/esbuild");
  const bundle = await esbuild.build({ entryPoints: ["src/app/(app)/channels/[slug]/ChannelDurationDraft.fixture.tsx"], bundle: true, write: false, platform: "browser", format: "iife", tsconfig: "tsconfig.json", jsx: "automatic" });
  const before = structuredClone(fixture);
  let calls = 0;
  const requestedSeconds: number[] = [];
  const server = createServer(async (req, res) => {
    if (req.url === "/") { res.writeHead(200, { "content-type": "text/html" }); res.end('<!doctype html><div id="root"></div><script src="/bundle.js"></script>'); return; }
    if (req.url === "/bundle.js") { res.writeHead(200, { "content-type": "application/javascript" }); res.end(bundle.outputFiles[0].contents); return; }
    if (req.url?.startsWith("/api/channel-duration-draft?") && req.method === "GET") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ candidates: [{ _id: "fixture", requestedSeconds: 7200, baselineCurrent: true, createdAt: 0, fingerprint: "f", baselineFingerprint: "b", baselinePipeline: [], pipeline: [], effectivePipeline: [{block:"assemble",params:{}}] }], evidence: [], evidenceAvailable: true, evidenceUnavailableCount: 0 })); return; }
    if (req.url === "/api/channel-duration-candidate-preflight" && req.method === "POST") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ blockers: [], ready: false, dispatchAuthorized: false, receiptIssued: false, bindingFingerprint: "old-preflight", binding: { maximumCostUsd: 1, channelBudgetUsd: 1, historicalWorker: null } })); return; }
    if (req.url === "/api/channel-duration-draft" && req.method === "POST") {
      calls++;
      let body = ""; for await (const part of req) body += part;
      requestedSeconds.push(JSON.parse(body).requestedSeconds);
      const response = await POST(new Request("http://127.0.0.1/api/channel-duration-draft", { method: "POST", body }));
      res.writeHead(response.status, { "content-type": "application/json" }); res.end(await response.text()); return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Test server unavailable");
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 700 } });
    const origin = `http://127.0.0.1:${address.port}`;
    await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(origin);
    await page.getByText(/Untested duration candidate: 7200 sec/).waitFor();
    await page.getByRole("button", { name: "Toggle owner access" }).click();
    assert.equal(await page.getByText(/Untested duration candidate: 7200 sec/).count(), 0, "cached owner-only candidates disappear when access is lost");
    await page.getByRole("button", { name: "Toggle owner access" }).click();
    await page.getByLabel("Requested duration (minutes)").fill("180");
    await page.getByRole("button", { name: "Calculate draft" }).click();
    await page.getByText(/Unsaved preview: 10800 sec/).waitFor();
    await page.getByText(/Untested and not applied/).waitFor();
    await page.getByRole("button", { name: "Save untested candidate" }).waitFor();
    await page.getByRole("button", { name: "Refresh unrelated data" }).click();
    assert.equal(await page.getByLabel("Requested duration (minutes)").inputValue(), "180");
    await page.getByText(/Unsaved preview: 10800 sec/).waitFor();
    await page.getByRole("button", { name: "Change baseline" }).click();
    await page.getByRole("alert").getByText(/channel settings changed/i).waitFor();
    assert.equal(await page.getByLabel("Requested duration (minutes)").inputValue(), "180");
    assert.equal(await page.getByText(/Unsaved preview: 10800 sec/).count(), 0);
    let releaseResponse!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    const released = new Promise<void>(resolve => { releaseResponse = resolve; });
    await page.route("**/api/channel-duration-draft", async route => {
      const response = await route.fetch();
      markStarted();
      await released;
      await route.fulfill({ response });
    }, { times: 1 });
    await page.getByRole("button", { name: "Calculate draft" }).click();
    await started;
    await page.getByRole("button", { name: "Change baseline" }).click();
    releaseResponse();
    await page.getByRole("alert").getByText(/channel settings changed/i).waitFor();
    await page.getByRole("button", { name: "Calculate draft" }).waitFor();
    assert.equal(await page.getByText(/Unsaved preview: 10800 sec/).count(), 0, "an old response must not restore a stale preview");
    await page.getByText(/Untested duration candidate: 7200 sec/).click();
    await page.getByLabel("Maximum benchmark cost (USD)").fill("1");
    let releasePreflight!: () => void;
    let markPreflightStarted!: () => void;
    const preflightStarted = new Promise<void>(resolve => { markPreflightStarted = resolve; });
    const preflightReleased = new Promise<void>(resolve => { releasePreflight = resolve; });
    await page.route("**/api/channel-duration-candidate-preflight", async route => { const response = await route.fetch(); markPreflightStarted(); await preflightReleased; await route.fulfill({ response }); }, { times: 1 });
    await page.getByRole("button", { name: "Check preflight" }).click();
    await preflightStarted;
    await page.getByRole("button", { name: "Change baseline" }).click();
    releasePreflight();
    await page.getByText(/Untested duration candidate: 7200 sec/).waitFor();
    await page.getByText(/Untested duration candidate: 7200 sec/).click();
    await page.getByText(/Channel settings changed\. Check the candidate again/).waitFor();
    assert.equal(await page.getByText(/old-preflight/).count(), 0, "an old preflight must not reappear after a baseline change");
    let failResponse!: () => void;
    let markFailureStarted!: () => void;
    const failureStarted = new Promise<void>(resolve => { markFailureStarted = resolve; });
    const failureReleased = new Promise<void>(resolve => { failResponse = resolve; });
    await page.route("**/api/channel-duration-draft", async route => { markFailureStarted(); await failureReleased; await route.abort(); }, { times: 1 });
    await page.getByRole("button", { name: "Calculate draft" }).click();
    await failureStarted;
    await page.getByRole("button", { name: "Change baseline" }).click();
    failResponse();
    await page.getByRole("button", { name: "Calculate draft" }).waitFor();
    await page.getByRole("alert").getByText(/Channel settings changed\. Calculate the draft again/).waitFor();
    await page.getByLabel("Requested duration (minutes)").fill("1.01");
    assert.equal(await page.getByText(/Unsaved preview: 10800 sec/).count(), 0);
    await page.getByRole("button", { name: "Calculate draft" }).click();
    await page.getByRole("alert").getByText(/whole number of seconds/).waitFor();
    assert.equal(calls, 2);
    await page.getByLabel("Requested duration (minutes)").fill("1");
    await page.getByRole("button", { name: "Calculate draft" }).click();
    await page.getByRole("alert").getByText(/supports/).waitFor();
    assert.equal(calls, 3);
    assert.deepEqual(requestedSeconds, [10800, 10800, 60]);
    assert.deepEqual(fixture, before);
    await page.getByLabel("Requested duration (minutes)").fill("42");
    await page.getByRole("button", { name: "Switch channel" }).click();
    assert.equal(await page.getByLabel("Requested duration (minutes)").inputValue(), "", "a different channel must not inherit this draft");
    console.log("Duration draft browser compares disposable baseline, rejects invalid values, and leaves channel unchanged");
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
main().finally(() => { loader._load = original; }).catch(error => { console.error(error); process.exitCode = 1; });
