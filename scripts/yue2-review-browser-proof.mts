/** Real review component and native playback, synthetic API/audio only. No paid or production I/O. */
import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { createMusicReviewContext } from "../src/engine/acceptedMusicArrangement";
import { measureNativeAudioSignal } from "../src/lib/nativeAudioSignal";
import type { YuE2CandidateReview } from "../src/lib/yue2ReviewTypes";
import type { YuE2AuditionRecord } from "../src/engine/yue2Audition";

const root = process.cwd();
const outputDir = await mkdtemp(join(tmpdir(), "yue-review-browser-"));
const frames = 12 * 48000;
const wav = Buffer.alloc(44 + frames * 8);
wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(3, 20); wav.writeUInt16LE(2, 22);
wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(384000, 28); wav.writeUInt16LE(8, 32);
wav.writeUInt16LE(32, 34); wav.write("data", 36); wav.writeUInt32LE(frames * 8, 40);
for (let frame = 0; frame < frames; frame++) {
  const sample = 0.05 * Math.sin(2 * Math.PI * 440 * frame / 48000);
  wav.writeFloatLE(sample, 44 + frame * 8); wav.writeFloatLE(sample, 48 + frame * 8);
}
const audioPath = join(outputDir, "synthetic-tone.wav");
await writeFile(audioPath, wav);
const signal = await measureNativeAudioSignal({ path: audioPath, sampleRateHz: 48000, channels: 2, expectedFrames: frames, measureTruePeak: true });
assert.equal(signal.truePeak?.status, "measured");
const topic = "A quiet horizon: nocturnal focus";
const review: YuE2CandidateReview = {
  candidateSha256: "a".repeat(64), jobId: "synthetic-review", nativeWavUrl: "/native.wav",
  nativeOutput: { sampleRateHz: 48000, channels: 2, codec: "pcm_f32le", frames, durationSec: 12 },
  arrangement: {
    role: "meditation_bed", direction: "Steady, understated texture with no dramatic build or startling changes.",
    requestedDurationSec: 12, form: "continuous", ending: "natural_cadence", playback: "once",
    sections: Array.from({ length: 4 }, (_, i) => ({ id: `section-${i}`, label: `Interval ${i + 1}`,
      startFraction: i / 4, endFraction: (i + 1) / 4, energy: 0.2, instruction: "Keep the same restrained texture; no new motif." })),
  },
  brief: { topic, sourceBriefFingerprint: "b".repeat(64), contextRetained: true, channelPersonalityVerified: false,
    reviewContext: createMusicReviewContext({ topic, family: "music_loop", channelName: "Quiet Horizon",
      promptContext: "Channel persona: intimate, observant, never theatrical.\nStyle grammar: patient understatement.\nAvoid: sentimental uplift, abrupt changes, generic dramatic arcs.\nComposer doctrine: preserve a continuous, unmetered form." }) },
  allocation: { allocatedCostUsdMicros: 1201, providerBilledCostUsdMicros: null },
  quality: { status: "needs_audition", requestedDurationSec: 12, actualDurationSec: 12, durationMatches: true,
    nativeFormatVerified: true, signal, productionApproved: false,
    unresolved: ["perceptual_artifacts", "instrumental_only", "channel_personality_fit", "arrangement_fidelity", "repetition", "ending", "listening_quality"] },
};
const require = createRequire(import.meta.url);
const esbuild = require(require.resolve("esbuild", { paths: [require.resolve("tsx")] })) as {
  build(options: Record<string, unknown>): Promise<{ outputFiles: { path: string; contents: Uint8Array }[] }>;
};
const built = await esbuild.build({ absWorkingDir: root, bundle: true, write: false, outfile: "fixture.js",
  platform: "browser", format: "iife", jsx: "automatic", stdin: { resolveDir: root, loader: "tsx", contents: `
    import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
    import {YuE2EvaluationPanel} from './src/components/YuE2EvaluationPanel';
    function App(){const [run,setRun]=useState('first-run');window.changeRun=setRun;
      return <YuE2EvaluationPanel key={run} runId={run}/>;}
    createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
  ` } });
const js = built.outputFiles.find((file) => file.path.endsWith(".js"))!.contents;
const css = built.outputFiles.find((file) => file.path.endsWith(".css"))!.contents;
let mode: "ready" | "absent" | "blocked" | "missing-context" | "unnamed" | "unauthorized" | "unavailable" | "held" = "ready";
let brokenAudio = false, requests = 0, held: ServerResponse | undefined;
const methods: string[] = [];
let savedAudition: YuE2AuditionRecord | null = null;
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://fixture.invalid");
  methods.push(req.method ?? "");
  if (url.pathname === "/") {
    res.setHeader("Content-Type", "text/html");
    res.end('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>body{margin:24px auto;padding:0 16px;max-width:960px;font-family:Arial;background:#fafafa;color:#202327}*{box-sizing:border-box}</style></head><body><h1>Run evaluation fixture</h1><div id="root"></div><script src="/fixture.js"></script></body></html>'); return;
  }
  if (url.pathname === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); res.end(js); return; }
  if (url.pathname === "/fixture.css") { res.setHeader("Content-Type", "text/css"); res.end(css); return; }
  if (url.pathname === "/api/yue2-evaluations/review") {
    requests++;
    if (req.method === "POST") {
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", () => {
        const parsed = JSON.parse(body);
        assert.equal(parsed.runId, "first-run");
        assert.equal(parsed.audition.candidateSha256, review.candidateSha256);
        savedAudition = { ...parsed.audition, reviewedAt: 123456789, reviewerId: "fixture-owner", productionApproved: false };
        res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ ok: true, audition: savedAudition }));
      }); return;
    }
    assert.equal(req.method, "GET");
    res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "private, no-store");
    if (mode === "held") { held = res; return; }
    if (mode === "unauthorized" || mode === "unavailable") { res.statusCode = mode === "unauthorized" ? 401 : 503; res.end('{"ok":false}'); return; }
    const current = structuredClone(review);
    current.audition = savedAudition;
    current.nativeWavUrl = `/native.wav?receipt=${requests}`;
    if (url.searchParams.get("runId") === "second-run") current.brief.topic = "Second run only";
    if (mode === "missing-context") { current.brief.reviewContext = null; current.brief.contextRetained = false; }
    if (mode === "unnamed") current.brief.reviewContext!.channelName = null;
    if (mode === "blocked") { current.quality.status = "blocked"; current.quality.durationMatches = false;
      current.quality.actualDurationSec = 0.1; current.quality.signal.reviewReasons = ["digital_silence"]; }
    res.end(JSON.stringify({ ok: true, review: mode === "absent" ? null : current })); return;
  }
  if (url.pathname === "/native.wav") {
    if (brokenAudio) { res.writeHead(403); res.end(); return; }
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1;
    res.writeHead(range ? 206 : 200, { "Content-Type": "audio/wav", "Accept-Ranges": "bytes", "Cache-Control": "no-store",
      "Content-Length": end - start + 1, ...(range ? { "Content-Range": `bytes ${start}-${end}/${wav.length}` } : {}) });
    res.end(wav.subarray(start, end + 1)); return;
  }
  res.writeHead(404); res.end();
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address(); assert.ok(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const errors: string[] = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  for (const [name, width, font] of [["desktop", 1440, 16], ["mobile", 390, 16], ["large-text", 320, 24]] as const) {
    mode = "ready";
    await page.setViewportSize({ width, height: 1000 });
    const before = requests;
    await page.goto(base);
    await page.getByText("YuE music evaluation", { exact: true }).waitFor();
    await page.waitForTimeout(150);
    assert.equal(requests, before, "closed review does not probe storage or sign audio");
    await page.getByText("YuE music evaluation", { exact: true }).click();
    await page.getByRole("heading", { name: topic }).waitFor();
    await page.waitForFunction(() => (document.querySelector("audio")?.readyState ?? 0) >= 2);
    await page.getByRole("button", { name: "Seek to Interval 3", exact: true }).click();
    await page.waitForFunction(() => Math.abs((document.querySelector("audio")?.currentTime ?? 0) - 6) < 0.1);
    const played = await page.locator("audio").evaluate(async (audio: HTMLAudioElement) => {
      audio.muted = true; await audio.play(); await new Promise((resolve) => setTimeout(resolve, 350));
      audio.pause(); return audio.currentTime > 6.1;
    });
    assert.ok(played, "native WAV decodes, seeks and plays");
    await page.evaluate((size) => { document.documentElement.style.fontSize = `${size}px`; }, font);
    await page.getByText("Signal measurements", { exact: true }).click();
    assert.ok(await page.getByText(`${signal.truePeak!.dbtp!.toFixed(1)} dBTP`, { exact: true }).isVisible());
    await page.getByText("Unresolved checks and provenance", { exact: true }).click();
    await page.getByText("Record audition", { exact: true }).click();
    const form = page.getByRole("form", { name: "YuE audition record" });
    await form.getByLabel("Audition notes", { exact: true }).fill("Restrained tone, but the ending needs a longer audition.");
    assert.equal(await form.getByRole("option", { name: "Promising, not production-approved" }).evaluate((option: HTMLOptionElement) => option.disabled), true);
    await form.getByRole("button", { name: "Save audition" }).click();
    await form.getByRole("status").filter({ hasText: "Audition saved" }).waitFor();
    assert.ok(await page.getByText("Not approved for production.", { exact: false }).isVisible());
    assert.equal(await page.getByRole("button", { name: /approve|generate|publish/i }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(outputDir, `${name}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 900, height: 1000 });
  await page.getByRole("button", { name: "Reload review" }).click();
  await page.getByText("Record audition", { exact: true }).click();
  const auditionForm = page.getByRole("form", { name: "YuE audition record" });
  assert.equal(await auditionForm.getByLabel("Audition notes", { exact: true }).inputValue(), "Restrained tone, but the ending needs a longer audition.");
  await auditionForm.getByRole("checkbox").check();
  const judgments = auditionForm.locator("select").filter({ has: page.locator('option[value="unreviewed"]') });
  for (const select of await judgments.all()) await select.selectOption("pass");
  for (const textarea of await auditionForm.getByRole("textbox", { name: /Interval .* observations/ }).all()) {
    await textarea.fill("The restrained texture follows this section's intent.");
  }
  await auditionForm.getByLabel("Verdict", { exact: true }).selectOption("promising");
  await auditionForm.getByRole("button", { name: "Save audition" }).click();
  await auditionForm.getByRole("status").filter({ hasText: "Audition saved" }).waitFor();
  const recorded = savedAudition as YuE2AuditionRecord | null;
  assert.ok(recorded);
  assert.equal(recorded.verdict, "promising");
  assert.equal(recorded.productionApproved, false);
  for (const [state, expected] of [["absent", "No retained YuE candidate"], ["unauthorized", "Owner sign-in required"],
    ["unavailable", "Review evidence unavailable or invalid"], ["missing-context", "Original channel context is missing"],
    ["unnamed", "Channel name not retained"], ["blocked", "Measured duration does not match"]] as const) {
    mode = state; await page.goto(base); await page.getByText("YuE music evaluation", { exact: true }).click();
    await page.getByText(expected, { exact: false }).waitFor();
    if (state === "unnamed") assert.equal(await page.getByText("Channel context not retained", { exact: true }).count(), 0);
    if (state === "blocked") assert.equal(await page.getByRole("button", { name: "Seek to Interval 2", exact: true }).isDisabled(), true);
    if (state === "unauthorized" || state === "unavailable") {
      mode = "ready"; await page.getByRole("button", { name: "Retry review" }).click();
      await page.getByRole("heading", { name: topic }).waitFor();
    }
  }
  mode = "ready"; brokenAudio = true;
  await page.goto(base); await page.getByText("YuE music evaluation", { exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Audio link expired" }).waitFor();
  brokenAudio = false;
  await page.getByRole("button", { name: "Reload review" }).click();
  await page.waitForFunction(() => (document.querySelector("audio")?.readyState ?? 0) >= 2);
  mode = "held";
  await page.goto(base); await page.getByText("YuE music evaluation", { exact: true }).click();
  await page.getByText("Verifying retained audio...").waitFor();
  await page.waitForTimeout(100);
  const stale = held;
  mode = "ready";
  await page.evaluate(() => (window as unknown as { changeRun: (id: string) => void }).changeRun("second-run"));
  await page.getByText("YuE music evaluation", { exact: true }).click();
  await page.getByRole("heading", { name: "Second run only" }).waitFor();
  stale?.end(JSON.stringify({ ok: true, review }));
  await page.waitForTimeout(100);
  assert.equal(await page.getByRole("heading", { name: topic }).count(), 0, "late first-run data cannot replace second-run context");
  const pageSource = await readFile(join(root, "src/app/(app)/runs/[runId]/page.tsx"), "utf8");
  assert.match(pageSource, /stage\.block === "music_arrangement_plan".*<YuE2EvaluationPanel/);
  assert.deepEqual(errors, []);
  assert.ok(methods.every((method) => method === "GET" || method === "POST"));
  assert.ok(savedAudition);
  await writeFile(join(outputDir, "results.json"), JSON.stringify({ synthetic: true, nativePlayback: true,
    viewports: ["desktop", "mobile", "large-text"], requests, errors, methods: [...new Set(methods)] }, null, 2));
  console.log(`YuE review browser PASS: playback, seeking, responsive layouts, absent/error/retry, missing context, blocking, stale-run refusal; synthetic API only. Evidence: ${outputDir}`);
} catch (error) {
  for (const page of browser.contexts().flatMap(context => context.pages())) {
    await page.screenshot({ path: join(outputDir, "failure.png"), fullPage: true });
    await writeFile(join(outputDir, "failure.html"), await page.content());
  }
  console.error({ outputDir, errors });
  throw error;
} finally {
  await browser.close(); server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
