/** Held local-only native visual proof. Synthetic clocks, no speech/provider/admission claim. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { bundle } from "@remotion/bundler";
import { workedRendererFixture } from "../src/lib/__tests__/sceneCompilerWorkedExample.test";
import { getSceneCompilerServeUrl, renderSceneManifest } from "../src/lib/sceneCompilerRender";
import type { WorkedExampleVisualPlan } from "../src/engine/workedExampleVisual";

const before = process.argv.includes("--before");
const negativeOnly = process.argv.includes("--negative-only");
const output = await mkdtemp(path.join(os.tmpdir(), "ysa-worked-native-proof-"));
console.log(`Evidence directory: ${output}`);
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const paths = ["src/remotion/sceneCompiler/SceneCompiler.tsx", "src/remotion/sceneCompiler/layoutProfile.ts", "src/remotion/sceneCompiler/WorkedExampleScene.tsx", "src/remotion/sceneCompiler/workedExampleLayout.ts", "src/engine/workedExampleVisual.ts", "src/engine/workedExampleVisualCompiler.ts", "src/engine/episodeGraph.ts", "src/lib/sceneCompilerRender.ts"];
const hashes = async () => Object.fromEntries(await Promise.all(paths.map(async (file) => [file, await readFile(file).then(hash).catch(() => "ABSENT")])));
const sourceHashes = await hashes();
const proofSourceHashes = Object.fromEntries(await Promise.all([new URL(import.meta.url), new URL("../src/lib/__tests__/sceneCompilerWorkedExample.test.ts", import.meta.url)].map(async (url) => [url.pathname, hash(await readFile(url))])));
const fixture = workedRendererFixture();
await writeFile(path.join(output, "input-source.json"), JSON.stringify({ sourceHashes, proofSourceHashes, contractOnlyClock: true, ...fixture }, null, 2));
type Rect = { x: number; y: number; width: number; height: number };
type Snapshot = {
  layout: string | null; slot: string | null;
  tokens: { role: string; node: string | null; text: string; region: string | null; fontSize: number; visible: boolean; rect: Rect; glyphs: Rect[] }[];
  regions: { name: string; rect: Rect }[];
  equations: { role: string; node: string; text: string }[];
};
// Observe the actual renderer page immediately before its screenshot CDP call.
// No mock hooks, copied component, synthetic native events, or hidden-control CSS.
const snapshotSource = `() => {
  const rect = (value) => ({x:value.x,y:value.y,width:value.width,height:value.height});
  return {
    layout: document.querySelector('[data-worked-example-layout]')?.getAttribute('data-worked-example-layout') ?? null,
    slot: document.querySelector('[data-worked-slot]')?.getAttribute('data-worked-slot') ?? null,
    regions: [...document.querySelectorAll('[data-math-region]')].map(el => ({name:el.getAttribute('data-math-region'),rect:rect(el.getBoundingClientRect())})),
    tokens: [...document.querySelectorAll('[data-math-role]')].map(el => {
      const range = document.createRange(); range.selectNodeContents(el);
      let visible=true; for(let ancestor=el;ancestor;ancestor=ancestor.parentElement){const style=getComputedStyle(ancestor);if(style.visibility==='hidden'||style.display==='none'||Number(style.opacity)===0)visible=false;}
      return {role:el.getAttribute('data-math-role'),node:el.getAttribute('data-node-id'),text:el.textContent,region:el.closest('[data-math-region]')?.getAttribute('data-math-region'),fontSize:parseFloat(getComputedStyle(el).fontSize),visible,rect:rect(el.getBoundingClientRect()),glyphs:[...range.getClientRects()].map(rect)};
    }),
    equations: [...document.querySelectorAll('[data-math-equation]')].map(el => ({role:el.getAttribute('data-math-equation'),node:el.getAttribute('data-step-node'),text:el.textContent})),
  };
}`;
const contains = (outer: Rect, inner: Rect) => inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 && inner.x + inner.width <= outer.x + outer.width + 0.5 && inner.y + inner.height <= outer.y + outer.height + 0.5;
function assertFrame(snapshot: Snapshot, plan: WorkedExampleVisualPlan, frame: number) {
  assert.equal(snapshot.layout, "worked-example/native-landscape-v1", "actual content-bound arithmetic branch must be mounted");
  const second = frame / 30;
  const slot = plan.slots.find((entry) => second >= entry.t0 && second < entry.t1)!;
  assert.ok(slot); assert.equal(snapshot.slot, slot.id);
  assert.deepEqual(snapshot.tokens.filter((token) => token.role === "label").map((token) => token.text), [slot.label]);
  assert.equal(snapshot.tokens.filter((token) => token.role === "problem").map((token) => token.text).join(" "), plan.problemDisplay);
  const completed = plan.steps.filter((step) => step.revealAtSec <= second);
  assert.deepEqual(snapshot.tokens.filter((token) => token.role === "result").map((token) => [token.node, token.text]), completed.map((step) => [step.nodeId, step.result]), "exact role-aware results must appear on first eligible frame, never earlier");
  assert.deepEqual(snapshot.equations.filter((equation) => equation.role === "history").map((equation) => [equation.node, equation.text]), completed.slice(0, -1).map((step) => [step.nodeId, step.display]));
  assert.deepEqual(snapshot.equations.filter((equation) => equation.role === "recent").map((equation) => [equation.node, equation.text]), completed.slice(-1).map((step) => [step.nodeId, step.display]));
  const current = slot.phase === "step" ? plan.steps[slot.stepIndex!] : undefined;
  assert.deepEqual(snapshot.equations.filter((equation) => equation.role === "working").map((equation) => [equation.node, equation.text]), current ? [[current.nodeId, current.display.split(" = ")[0]]] : []);
  assert.deepEqual(snapshot.tokens.filter((token) => token.role === "answer").map((token) => [token.node, token.text]), slot.phase === "answer" ? [[plan.steps.at(-1)!.nodeId, plan.answer]] : []);
  assert.equal(snapshot.regions.length, 5);
  for (const region of snapshot.regions) assert.ok(contains({ x: 96, y: 54, width: 1728, height: 972 }, region.rect), `region ${region.name} outside native safe frame`);
  for (const token of snapshot.tokens) {
    const region = snapshot.regions.find((entry) => entry.name === token.region)!;
    assert.ok(region && token.glyphs.length > 0 && token.rect.width > 0 && token.rect.height > 0);
    assert.ok(token.visible, `${token.role} must be visibly rendered, not an offscreen/transparent proof token`);
    assert.equal(token.fontSize, ({ problem: 40, working: 72, recent: 64, history: 30, label: 52 } as Record<string, number>)[token.region!], "native typography must not shrink to manufacture fit");
    assert.ok(contains(region.rect, token.rect), `${token.role} element escapes ${token.region}: ${token.text}`);
    for (const glyph of token.glyphs) assert.ok(contains(region.rect, glyph), `${token.role} glyph escapes ${token.region}: ${token.text}`);
  }
  for (let index = 0; index < snapshot.regions.length; index++) for (const next of snapshot.regions.slice(index + 1)) {
    const rect = snapshot.regions[index].rect;
    assert.ok(rect.x + rect.width <= next.rect.x || next.rect.x + next.rect.width <= rect.x || rect.y + rect.height <= next.rect.y || next.rect.y + next.rect.height <= rect.y, "math regions overlap");
  }
}
const browserExecutable = "/usr/bin/google-chrome";
const browser = await openBrowser("chrome", { browserExecutable, chromiumOptions: { gl: "angle" } });
const originalNewPage = browser.newPage.bind(browser);
let snapshot: Snapshot | undefined;
browser.newPage = async (options) => {
  const page = await originalNewPage(options);
  const client = page._client(), originalSend = client.send.bind(client) as (method: string, ...params: unknown[]) => Promise<unknown>;
  client.send = async function (method: string, ...params: unknown[]) {
    if (method === "Page.captureScreenshot") snapshot = await page.evaluate(`(${snapshotSource})()`) as Snapshot;
    return originalSend(method, ...params);
  } as typeof client.send;
  return page;
};
const samples: { name: string; frame: number; file: string; sha256: string; snapshot: Snapshot; encodedFile?: string; ocrFile?: string }[] = [];
async function sample(serveUrl: string, input: ReturnType<typeof workedRendererFixture>, frame: number, name: string, validate = true) {
  const inputProps = { manifest: input.manifest, width: 1920, height: 1080 };
  const composition = await selectComposition({ serveUrl, id: "SceneManifest", inputProps, browserExecutable, puppeteerInstance: browser });
  const file = path.join(output, `${name}-${frame}.png`);
  snapshot = undefined;
  await renderStill({ serveUrl, composition, inputProps, puppeteerInstance: browser, frame, output: file, imageFormat: "png", chromiumOptions: { gl: "angle" } });
  assert.ok(snapshot, "real renderer screenshot must carry observed DOM");
  const item = { name, frame, file, sha256: hash(await readFile(file)), snapshot: snapshot as Snapshot };
  samples.push(item);
  await writeFile(path.join(output, "samples.json"), JSON.stringify(samples, null, 2));
  if (validate) assertFrame(item.snapshot, input.plan, frame);
  return item;
}
try {
  const serveUrl = await getSceneCompilerServeUrl();
  if (process.argv.includes("--preview")) {
    for (const frame of [127, 128, 255]) await sample(serveUrl, fixture, frame, "preview-improved");
    const density = workedRendererFixture("seed-add-add-add-add-add-add-add-add", Array(8).fill("add"));
    await sample(serveUrl, density, Math.ceil(density.plan.steps.at(-1)!.revealAtSec * 30), "preview-eight-step-density");
    assert.deepEqual(await hashes(), sourceHashes);
    console.log(JSON.stringify({ output, samples: samples.length, previewOnly: true }));
  } else if (before) {
    const result = await sample(serveUrl, fixture, Math.ceil(fixture.plan.slots[1].t0 * 30) + 5, "before-generic", false);
    assertFrame(result.snapshot, fixture.plan, result.frame); // Deliberately fails baseline after retained real screenshot.
  } else {
    const video = path.join(output, "signed-lesson.mp4");
    if (!negativeOnly) {
    const frames = new Set([0, Math.ceil(fixture.plan.durationSec * 30) - 1]);
    for (const slot of fixture.plan.slots) frames.add(Math.ceil(slot.t0 * 30) + 5);
    for (const step of fixture.plan.steps) for (const offset of [-1, 0, 1]) frames.add(Math.ceil(step.revealAtSec * 30) + offset);
    for (const frame of [...frames].sort((a, b) => a - b)) await sample(serveUrl, fixture, frame, "signed-lesson");
    await renderSceneManifest({ manifest: fixture.manifest, outPath: video, browserExecutable, concurrency: 2, log: console.log });
    const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", video], { encoding: "utf8" }));
    const videoStream = probe.streams.find((stream: { codec_type: string }) => stream.codec_type === "video");
    assert.deepEqual([videoStream.width, videoStream.height], [1920, 1080]);
    assert.equal(Number(videoStream.nb_frames), Math.ceil(fixture.plan.durationSec * 30));
    assert.ok(Math.abs(Number(videoStream.duration) - Number(videoStream.nb_frames) / 30) < 0.00001);
    // Existing final SceneCompiler mux seam, not a newly invented acceptance margin.
    assert.ok(Number(probe.format.duration) >= Number(videoStream.duration) && Number(probe.format.duration) - Number(videoStream.duration) <= 0.12);
    await writeFile(path.join(output, "ffprobe.json"), JSON.stringify({ video, sha256: hash(await readFile(video)), ...probe }, null, 2));
    for (const item of samples) {
      item.encodedFile = path.join(output, `encoded-${item.frame}.png`);
      execFileSync("ffmpeg", ["-v", "error", "-i", video, "-vf", `select=eq(n\\,${item.frame})`, "-frames:v", "1", item.encodedFile]);
      item.ocrFile = path.join(output, `encoded-${item.frame}-ocr.txt`);
      const raw = execFileSync("tesseract", [item.encodedFile, "stdout", "--psm", "11"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      await writeFile(item.ocrFile, raw); // Unrestricted raw OCR is secondary; never manufacture a token pass.
    }
    for (const [name, seed, operations] of [
      ["subtract", "seed-subtract", ["subtract"]], ["divide", "seed-exact_divide", ["exact_divide"]],
      ["zero-collision", "role-aware-2", ["multiply"]], ["operand-collision", "role-aware-2", ["add"]],
      ["eight-step-density", "seed-add-add-add-add-add-add-add-add", Array(8).fill("add")],
      ["eight-multiplication", "density-signed-30", Array(8).fill("multiply")],
      ["eight-mixed", "density-signed-16", ["multiply", "multiply", "subtract", "multiply", "exact_divide", "multiply", "subtract", "multiply"]],
    ] as const) {
      const extra = workedRendererFixture(seed, [...operations] as Parameters<typeof workedRendererFixture>[1]);
      if (name.includes("collision")) assert.ok(extra.plan.steps[0].result === extra.plan.steps[0].left || extra.plan.steps[0].result === extra.plan.steps[0].right);
      await writeFile(path.join(output, `${name}-fixture.json`), JSON.stringify(extra, null, 2));
      const lastStep = extra.plan.steps.at(-1)!;
      const widestStep = extra.plan.steps.reduce((longest, step) => step.display.length > longest.display.length ? step : longest);
      const stressFrames = new Set([lastStep, widestStep].flatMap((step) => [-1, 0].map((offset) => Math.ceil(step.revealAtSec * 30) + offset)));
      for (const frame of [...stressFrames].sort((a, b) => a - b)) await sample(serveUrl, extra, frame, name);
    }
    }
    const componentFile = path.resolve("src/remotion/sceneCompiler/WorkedExampleScene.tsx");
    const componentSource = await readFile(componentFile, "utf8");
    const negativeControls: { name: string; file: string; rejected: boolean; error: string; mutationHash: string }[] = [];
    for (const [name, from, to, frame] of [
      ["premature-result", "plan.steps.filter((step) => second >= step.revealAtSec)", "plan.steps", Math.ceil(fixture.plan.slots[1].t0 * 30) + 5],
      ["wrong-result-sign", ">{step.result}</span>", ">{step.result.replace('-', '')}</span>", Math.ceil(fixture.plan.steps[0].revealAtSec * 30)],
      ["missing-result", ">{step.result}</span>", ">{null}</span>", Math.ceil(fixture.plan.steps[0].revealAtSec * 30)],
      ["clipped-equation", "...rect(layout.working),", '...rect(layout.working), transform: "translateX(1200px)",', Math.ceil(fixture.plan.slots[1].t0 * 30) + 5],
    ] as const) {
      assert.equal(componentSource.split(from).length, 2, "controlled mutation must alter exactly one actual renderer expression");
      const mutation = componentSource.replace(from, to).replace('"./workedExampleLayout"', JSON.stringify(path.resolve("src/remotion/sceneCompiler/workedExampleLayout")));
      const mutationPath = path.join(output, `${name}.tsx`);
      await writeFile(mutationPath, mutation); // Generated, explicitly defective local proof bundle, never runtime source.
      const negativeUrl = await bundle({ entryPoint: path.resolve("src/remotion/sceneCompiler/index.ts"), webpackOverride: (configuration) => ({ ...configuration, resolve: { ...configuration.resolve, alias: { ...configuration.resolve?.alias, "@": path.resolve("src"), "./WorkedExampleScene": mutationPath } } }) });
      const item = await sample(negativeUrl, fixture, frame, `negative-${name}`, false);
      let error = "";
      try { assertFrame(item.snapshot, fixture.plan, frame); } catch (caught) { error = String(caught); }
      assert.ok(error, `unchanged real-frame oracle must reject ${name}`);
      negativeControls.push({ name, file: item.file, rejected: true, error, mutationHash: hash(mutation) });
      await writeFile(path.join(output, "negative-controls.json"), JSON.stringify(negativeControls, null, 2));
    }
    assert.deepEqual(await hashes(), sourceHashes, "runtime source must stay frozen across actual render and negative bundles");
    assert.deepEqual(Object.fromEntries(await Promise.all(Object.keys(proofSourceHashes).map(async (file) => [file, hash(await readFile(file))]))), proofSourceHashes);
    await writeFile(path.join(output, "results.json"), JSON.stringify({ output, sourceHashes, proofSourceHashes, syntheticClockOnly: true, measuredSpeech: false, providerCalls: 0, samples, negativeControls, video: negativeOnly ? null : video }, null, 2));
    console.log(JSON.stringify({ output, samples: samples.length, negativeControls: negativeControls.length, nativeVideo: negativeOnly ? null : video, failures: [] }));
  }
} finally { await browser.close({ silent: true }); }
