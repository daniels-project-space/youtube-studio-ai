import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { prepareWorkedExample, type WorkedExampleRequest } from "@/engine/workedExample";
import { draftWorkedExampleNarration, workedExampleEditorialApprovalFor } from "@/engine/workedExampleNarration";
import { createWorkedExampleAudioBinding } from "@/engine/workedExampleAudioBinding";
import { sha256Hex } from "@/lib/sha256";
import type { NarrationSegmentClockObservations } from "@/lib/narrationSegmentClock";
import { compileWorkedExampleVisualPlan, type WorkedExampleVisualCompilerInput } from "@/engine/workedExampleVisualCompiler";
import { bindWorkedExampleVisualPlan, compileSceneManifest, type SceneManifest } from "@/engine/episodeGraph";
import { planStorySpine } from "@/engine/storySpine";
import { buildEpisodeGraphFromStorySpine } from "@/trigger/blocks/episodeGraphBlocks";
import { preflightSceneLayout, resolveSceneLayout, SCENE_PORTRAIT_PROFILE } from "@/remotion/sceneCompiler/layoutProfile";
import { displayWorkedInteger, WORKED_OPERATORS, workedProblemLines } from "@/remotion/sceneCompiler/workedExampleLayout";

/** Real producer unit strings; synthetic clocks/identity bytes, NOT measured speech. */
export function workedRendererFixture(seed = "renderer-audit-v1", operations: WorkedExampleRequest["operations"] = ["add", "multiply", "exact_divide"], unitDuration: number | readonly number[] = 2.125) {
  const request: WorkedExampleRequest = { policy: "worked-example/integer-v1", ownerId: "owner-visual", channelId: "channel-visual", runId: "run-visual", requestId: "request-visual", seed, operations };
  const preparation = prepareWorkedExample(request), draft = draftWorkedExampleNarration(preparation, request);
  const source = readFileSync(resolve("src/trigger/blocks/narratedBlocks.ts"), "utf8");
  const parsed = ts.createSourceFile("narratedBlocks.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const splitter = parsed.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "splitSentences");
  assert.ok(splitter);
  const code = ts.transpileModule(`${splitter.getText(parsed)}\nmodule.exports = splitSentences;`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: undefined as unknown };
  new Function("module", code)(loaded); // Controlled actual producer function, not supplied solutions.
  const sentences = (loaded.exports as (text: string) => string[])(draft.narrationText);
  let cursor = 0;
  const sentenceTimings = sentences.map((text, index) => { const start = cursor; cursor += typeof unitDuration === "number" ? unitDuration : unitDuration[index]; return { text, start, end: cursor }; });
  const wordCount = draft.narrationText.split(/\s+/).length;
  const input: WorkedExampleVisualCompilerInput = {
    ownerId: request.ownerId, channelId: request.channelId, runId: request.runId, keyPrefix: "owners/owner-visual/",
    params: { chapterCards: false, ttsProvider: "fish", voiceId: "contract-only" },
    store: { workedExampleRequest: request, workedExamplePreparation: preparation, ...draft, scriptApproved: true, workedExampleEditorialApproval: workedExampleEditorialApprovalFor(draft.script) },
    outputs: { narrationKey: "owners/owner-visual/runs/run-visual/narration.mp3", narrationDurationSec: cursor, narrationTranscriptText: draft.narrationText,
      narrationPerformanceEvidence: { version: "narration-performance-evidence/v1", source: "local_ffmpeg", durationSec: cursor, wordCount, wordsPerSec: wordCount / cursor, integratedLufs: -18, windowMeanDb: -20 }, sentenceTimings, chapterPlan: [] },
    storySpine: planStorySpine({ topic: "Verified integer operations", narrationDurationSec: cursor, sentenceTimings }), aspectRatio: "16:9",
  };
  // Synthetic observations only: the measured-only schema is exercised, but no
  // actual FFprobe measurement, audio part bytes, or natural speech is claimed.
  const observations: NarrationSegmentClockObservations = {
    mode: "sentence", segments: sentenceTimings.map((cue, index) => ({
      textSha256: sha256Hex(cue.text), audio: { sha256: sha256Hex(`synthetic-renderer-part-${index}`), byteLength: 123 }, cueIndex: index, gapAfterSec: 0,
      measurement: { source: "ffprobe_format_duration", durationSec: cue.end - cue.start, wordCount: cue.text.split(/\s+/).length,
        attempts: [{ outcome: "measured", durationSec: cue.end - cue.start, hasAudio: true }],
        decoded: { source: "ffprobe_decoded_samples", sampleRate: 44100, sampleCount: Math.round((cue.end - cue.start) * 44100), durationSec: Math.round((cue.end - cue.start) * 44100) / 44100 } },
    })),
    finalDuration: { source: "ffprobe_format_duration", usedSec: cursor, performanceProbeSec: cursor },
    reconciliation: { inputCursorSec: cursor, measuredDurationSec: cursor, scale: 1 },
    decodedFinal: { source: "ffprobe_decoded_samples", sampleRate: 44100,
      sampleCount: sentenceTimings.reduce((sum, cue) => sum + Math.round((cue.end - cue.start) * 44100), 0),
      durationSec: sentenceTimings.reduce((sum, cue) => sum + Math.round((cue.end - cue.start) * 44100), 0) / 44100 },
  };
  const binding = createWorkedExampleAudioBinding(input, input.outputs, sentences, new TextEncoder().encode("synthetic identity only; not speech or an audio file"), observations);
  const plan = compileWorkedExampleVisualPlan({ ...input, outputs: { ...input.outputs, workedExampleAudioBinding: binding } });
  const spine = input.storySpine as ReturnType<typeof planStorySpine>;
  const { episodeGraph } = buildEpisodeGraphFromStorySpine({ storySpine: spine, topic: "Verified integer operations", seriesId: "series-visual", episodeId: "episode-visual" });
  const graph = bindWorkedExampleVisualPlan(episodeGraph, plan, spine);
  return { plan, manifest: compileSceneManifest(graph, spine), sentences };
}

async function main() {
  let passed = 0, calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("network forbidden in worked renderer unit qualification"); };
  const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`PASS ${name}`); };
  try {
    const { manifest, plan, sentences } = workedRendererFixture();
    test("actual producer emits five whole units and native preflight preserves exact plan", () => {
      assert.equal(sentences.length, 5); assert.deepEqual(preflightSceneLayout(manifest, resolveSceneLayout()), plan);
      assert.deepEqual(manifest.scenes.map((scene) => scene.transition), ["cut", "match_cut", "match_cut", "match_cut", "match_cut"]);
    });
    test("closed tokens equal canonical independently verified display", () => {
      for (const step of plan.steps) assert.equal(`${displayWorkedInteger(step.left)} ${WORKED_OPERATORS[step.operation]} ${displayWorkedInteger(step.right)} = ${step.result}`, step.display);
    });
    test("ordinary landscape preflight remains permissive and returns no arithmetic branch", () => {
      assert.equal(preflightSceneLayout({ audience: "general", scenes: [], durationSec: 0 } as unknown as SceneManifest, resolveSceneLayout()), undefined);
    });
    const invalid: Array<{ name: string; manifest: SceneManifest; dimensions?: { width?: number; height?: number; layoutProfile?: typeof SCENE_PORTRAIT_PROFILE } }> = [];
    for (const value of [undefined, null, {}, { ...plan, version: "stale" }]) {
      invalid.push({ name: `invalid root ${JSON.stringify(value)}`, manifest: { ...manifest, workedExampleVisualPlan: value } as SceneManifest });
    }
    const modify = (name: string, change: (value: SceneManifest) => void) => { const value = structuredClone(manifest); change(value); invalid.push({ name, manifest: value }); };
    modify("missing root with live per-scene markers", (value) => { delete value.workedExampleVisualPlan; });
    modify("missing scene reference", (value) => { delete value.scenes[1].visualState.workedExampleVisual; });
    modify("changed scene text", (value) => { value.scenes[1].text = plan.steps[0].display; });
    modify("wrong arithmetic result", (value) => { value.workedExampleVisualPlan!.steps[0].result = "0"; });
    modify("mixed factual input", (value) => { Object.assign(value.scenes[0].visualState, { evidenceVisualIntent: "factual_chart" }); });
    modify("children audience", (value) => { value.audience = "children"; });
    for (const transition of ["dissolve", "wipe"] as const) modify(transition, (value) => { value.scenes[1].transition = transition; });
    invalid.push({ name: "portrait", manifest, dimensions: { layoutProfile: SCENE_PORTRAIT_PROFILE } });
    invalid.push({ name: "unqualified half size", manifest, dimensions: { width: 960, height: 540 } });
    invalid.push({ name: "whole step with no actual frame", manifest: workedRendererFixture("short-step", ["add"], [2.125, 0.001, 2.125]).manifest });
    invalid.push({ name: "final answer with no actual frame", manifest: workedRendererFixture("short-answer", ["add"], [2.125, 2.125, 0.001]).manifest });
    for (const item of invalid) test(`preflight refuses ${item.name}`, () => assert.throws(() => preflightSceneLayout(item.manifest, resolveSceneLayout(item.dimensions))));
    test("overlong math refuses without font shrinking", () => { assert.throws(() => workedProblemLines("(9 + ".repeat(50) + "1)")); assert.throws(() => workedProblemLines("9".repeat(100))); });
    test("fractional reveal cannot be rounded backwards", () => {
      for (const step of plan.steps) { const first = Math.ceil(step.revealAtSec * 30); assert.ok((first - 1) / 30 < step.revealAtSec); assert.ok(first / 30 >= step.revealAtSec); }
    });
    for (const operations of [["subtract"], ["exact_divide"], Array(8).fill("add")] as WorkedExampleRequest["operations"][]) test(`generated native density ${operations.join("-")}`, () => {
      const fixture = workedRendererFixture(`seed-${operations.join("-").slice(0, 45)}`, operations); preflightSceneLayout(fixture.manifest, resolveSceneLayout());
    });
    for (const [seed, operations] of [["density-signed-30", Array(8).fill("multiply")], ["density-signed-16", ["multiply", "multiply", "subtract", "multiply", "exact_divide", "multiply", "subtract", "multiply"]]] as const) test(`generated long signed density ${seed}`, () => {
      const fixture = workedRendererFixture(seed, [...operations] as WorkedExampleRequest["operations"]); preflightSceneLayout(fixture.manifest, resolveSceneLayout());
      assert.ok(fixture.plan.steps.some((step) => step.display.length >= 27), "stress must contain long real generated equations, not only small sums");
    });
    const require = createRequire(resolve("package.json"));
    type Builder = { onResolve(options: { filter: RegExp }, callback: (args: { path: string }) => { path: string; namespace: string }): void; onLoad(options: { filter: RegExp; namespace: string }, callback: () => { contents: string; loader: string }): void };
    const { build } = require(require.resolve("esbuild", { paths: [require.resolve("tsx")] })) as { build(options: { [key: string]: unknown; plugins: { name: string; setup(builder: Builder): void }[] }): Promise<{ outputFiles: { text: string }[] }> };
    const built = await build({ entryPoints: [resolve("src/lib/sceneCompilerRender.ts")], bundle: true, platform: "node", format: "cjs", packages: "external", write: false, plugins: [{ name: "only-external-render-work", setup(builder) {
      builder.onResolve({ filter: /^@remotion\/(renderer|bundler)$/ }, (args) => ({ path: args.path, namespace: "transport" }));
      builder.onLoad({ filter: /.*/, namespace: "transport" }, () => ({ contents: "export const ensureBrowser = () => globalThis.__workedRenderTransport(); export const bundle = ensureBrowser; export const selectComposition = ensureBrowser; export const renderMedia = ensureBrowser;", loader: "js" }));
    } }] });
    const globals = globalThis as typeof globalThis & { __workedRenderTransport?: () => never };
    globals.__workedRenderTransport = () => { calls++; throw new Error("external render work reached"); };
    try {
      const compiled = { exports: {} as typeof import("../sceneCompilerRender") };
      new Function("require", "module", "exports", built.outputFiles[0].text)(require, compiled, compiled.exports);
      for (const item of invalid) await assert.rejects(compiled.exports.renderSceneManifest({ manifest: item.manifest, ...item.dimensions, outPath: "/tmp/never-written-worked-example.mp4" }));
      assert.equal(calls, 0); passed++; console.log("PASS real renderer refuses every malformed/unsupported case before bundling or browser work");
      await assert.rejects(compiled.exports.renderSceneManifest({ manifest, outPath: "/tmp/never-written-worked-example.mp4" }), /external render work/);
      assert.equal(calls, 1); passed++; console.log("PASS supported manifest reaches existing real renderer work");
    } finally { delete globals.__workedRenderTransport; }
    console.log(JSON.stringify({ passed, contractOnlyClocks: true, providerCalls: 0 }));
  } finally { globalThis.fetch = originalFetch; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error); process.exitCode = 1; });
