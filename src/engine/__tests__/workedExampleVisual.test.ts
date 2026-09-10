import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, resolve } from "node:path";
import ts from "typescript";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import { prepareWorkedExample, type WorkedExampleRequest } from "@/engine/workedExample";
import { draftWorkedExampleNarration, workedExampleEditorialApprovalFor } from "@/engine/workedExampleNarration";
import { createWorkedExampleAudioBinding, WorkedExampleAudioBindingSchema } from "@/engine/workedExampleAudioBinding";
import { narrationClockBindingFingerprint, narrationSegmentClockFingerprint, type NarrationSegmentClockObservations } from "@/lib/narrationSegmentClock";
import { planStorySpine } from "@/engine/storySpine";
import * as currentGraph from "@/engine/episodeGraph";
import { buildEpisodeGraphFromStorySpine } from "@/trigger/blocks/episodeGraphBlocks";
import { compileWorkedExampleVisualPlan, assertWorkedExampleVisualPlanCurrent, hasWorkedExampleVisualMarkers, type WorkedExampleVisualCompilerInput } from "@/engine/workedExampleVisualCompiler";
import { WorkedExampleVisualPlanSchema, workedExampleVisualSentences, workedExampleVisibleResults, type WorkedExampleVisualPlan } from "@/engine/workedExampleVisual";

// CONTRACT-ONLY clock/audio metadata, NOT measured speech, actual media, or renderer evidence.
// The preparation/script and Story Spine are real generators; no supplied solutions/graph math.
const fakeBytes = new TextEncoder().encode("explicit synthetic audio-identity fixture; this is not speech or an audio file");
type MutableInput = { -readonly [Key in keyof WorkedExampleVisualCompilerInput]: WorkedExampleVisualCompilerInput[Key] };
const request: WorkedExampleRequest = { policy: "worked-example/integer-v1", ownerId: "owner-visual", channelId: "channel-visual", runId: "run-visual", requestId: "request-visual", seed: "renderer-audit-v1", operations: ["add", "multiply", "exact_divide"] };
let networkCalls = 0, passed = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { networkCalls++; throw new Error("network forbidden in pure arithmetic visual tests"); };
function loadActualTtsSentenceSplitter(): (text: string) => string[] {
  const source = readFileSync(resolve("src/trigger/blocks/narratedBlocks.ts"), "utf8");
  const parsed = ts.createSourceFile("narratedBlocks.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const splitter = parsed.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "splitSentences");
  assert.ok(splitter, "actual TTS producer must retain an inspectable sentence-unit function");
  const code = ts.transpileModule(`${splitter.getText(parsed)}\nmodule.exports = splitSentences;`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: undefined as unknown };
  // Controlled repository function only. No copied regex, solution, model response, or provider call.
  new Function("module", code)(loaded);
  return loaded.exports as (text: string) => string[];
}
const actualTtsSentences = loadActualTtsSentenceSplitter();
function fixture(seed = request.seed, operations = request.operations) {
  const current = { ...request, seed, operations };
  const preparation = prepareWorkedExample(current);
  const draft = draftWorkedExampleNarration(preparation, current);
  const sentences = actualTtsSentences(draft.narrationText);
  let cursor = 0;
  const sentenceTimings = sentences.map((text, index) => {
    const start = cursor, end = start + 4 + index * 0.125;
    cursor = end + (index < sentences.length - 1 ? 0.25 : 0);
    return { text, start, end };
  });
  const wordCount = draft.narrationText.split(/\s+/).length;
  const input: MutableInput = {
    ownerId: current.ownerId, channelId: current.channelId, runId: current.runId, keyPrefix: "owners/owner-visual/", params: { chapterCards: false, ttsProvider: "fish", voiceId: "contract-only" },
    store: { workedExampleRequest: current, workedExamplePreparation: preparation, ...draft, scriptApproved: true, workedExampleEditorialApproval: workedExampleEditorialApprovalFor(draft.script) },
    outputs: { narrationKey: "owners/owner-visual/runs/run-visual/narration.mp3", narrationDurationSec: cursor, narrationTranscriptText: draft.narrationText,
      narrationPerformanceEvidence: { version: "narration-performance-evidence/v1", source: "local_ffmpeg", durationSec: cursor, wordCount, wordsPerSec: wordCount / cursor, integratedLufs: -18, windowMeanDb: -20 },
      sentenceTimings, chapterPlan: [] },
    storySpine: planStorySpine({ topic: "Verified integer operations", narrationDurationSec: cursor, sentenceTimings }), aspectRatio: "16:9",
  };
  // Explicitly synthetic observations exercise the contract; actual ffprobe producer tests live in workedExampleAudioSource.test.ts.
  const observations: NarrationSegmentClockObservations = {
    mode: "sentence", segments: sentenceTimings.map((cue, index) => ({
      textSha256: sha256Hex(cue.text), audio: { sha256: sha256Hex(`synthetic-part-${index}`), byteLength: 123 }, cueIndex: index,
      gapAfterSec: index < sentences.length - 1 ? 0.25 : 0,
      measurement: { source: "ffprobe_format_duration", durationSec: cue.end - cue.start, wordCount: cue.text.split(/\s+/).length,
        attempts: [{ outcome: "measured", durationSec: cue.end - cue.start, hasAudio: true }],
        decoded: { source: "ffprobe_decoded_samples", sampleRate: 44100, sampleCount: Math.round((cue.end - cue.start) * 44100), durationSec: Math.round((cue.end - cue.start) * 44100) / 44100 } },
    })),
    finalDuration: { source: "ffprobe_format_duration", usedSec: cursor, performanceProbeSec: cursor },
    reconciliation: { inputCursorSec: cursor, measuredDurationSec: cursor, scale: 1 },
    decodedFinal: { source: "ffprobe_decoded_samples", sampleRate: 44100,
      sampleCount: sentenceTimings.reduce((sum, cue, index) => sum + Math.round((cue.end - cue.start) * 44100) + (index < sentences.length - 1 ? Math.round(0.25 * 44100) : 0), 0),
      durationSec: sentenceTimings.reduce((sum, cue, index) => sum + Math.round((cue.end - cue.start) * 44100) + (index < sentences.length - 1 ? Math.round(0.25 * 44100) : 0), 0) / 44100 },
  };
  input.outputs = { ...input.outputs, workedExampleAudioBinding: createWorkedExampleAudioBinding(input, input.outputs, sentences, fakeBytes, observations) };
  return input;
}
const clone = <T,>(value: T): T => structuredClone(value);
function test(name: string, run: () => void) { run(); passed++; console.log(`PASS ${name}`); }
function reject(name: string, change: (input: MutableInput) => void, pattern?: RegExp) {
  test(name, () => {
    const input = clone(base); change(input);
    if (pattern) assert.throws(() => compileWorkedExampleVisualPlan(input), pattern);
    else assert.throws(() => compileWorkedExampleVisualPlan(input));
  });
}
function rehashPlan(plan: WorkedExampleVisualPlan) {
  const body = Object.fromEntries(Object.entries(plan).filter(([key]) => key !== "fingerprint"));
  plan.fingerprint = sha256Hex(canonicalJson(body));
  return plan;
}
function mark(input: WorkedExampleVisualCompilerInput, plan: WorkedExampleVisualPlan) {
  const spine = input.storySpine as ReturnType<typeof planStorySpine>;
  const unmarked = buildEpisodeGraphFromStorySpine({ storySpine: spine, topic: "Verified integer operations", seriesId: "series-visual", episodeId: "episode-visual" });
  return { unmarked, graph: currentGraph.bindWorkedExampleVisualPlan(unmarked.episodeGraph, plan, spine) };
}
function baselineGraph(sourcePath: string): typeof currentGraph {
  const require = createRequire(resolve("package.json"));
  const { buildSync } = require(require.resolve("esbuild", { paths: [require.resolve("tsx")] })) as {
    buildSync(options: Record<string, unknown>): { outputFiles: Array<{ text: string }> };
  };
  assert.ok(isAbsolute(sourcePath), "WORKED_EXAMPLE_VISUAL_PARITY_SOURCE must name an absolute frozen source file");
  const source = readFileSync(sourcePath, "utf8");
  assert.equal(sha256Hex(source), "fa24307f20ad513a736ca5fb5ef1df599413224626884b835fb84e36c7fc6b0e", "parity source must be the exact retained 4a1fda2 EpisodeGraph, not an approximate duplicate");
  const built = buildSync({ stdin: { contents: source, resolveDir: resolve("src/engine"), sourcefile: "checkpoint-episodeGraph.ts", loader: "ts" }, bundle: true, platform: "node", format: "cjs", packages: "external", alias: { "@": resolve("src") }, write: false });
  const loaded = { exports: {} };
  // Controlled repository module, never generated arithmetic, user prose, or provider output.
  new Function("require", "module", "exports", built.outputFiles[0].text)(require, loaded, loaded.exports);
  return loaded.exports as typeof currentGraph;
}
const base = fixture();
const plan = compileWorkedExampleVisualPlan(base);
const { graph, unmarked } = mark(base, plan);
const paritySource = process.env.WORKED_EXAMPLE_VISUAL_PARITY_SOURCE;
const baseline = paritySource ? baselineGraph(paritySource) : undefined;

try {
  if (process.argv.includes("--baseline")) {
    assert.ok(baseline, "--baseline requires explicit WORKED_EXAMPLE_VISUAL_PARITY_SOURCE");
    const oldGraph = baseline.assertEpisodeGraph(graph), oldManifest = baseline.compileSceneManifest(oldGraph);
    console.log(JSON.stringify({ contractFixtureOnly: true, oldPlanPreserved: Boolean(oldGraph.workedExampleVisualPlan), oldCalculationLabel: oldManifest.scenes[1].label, expectedSafeLabel: plan.slots[1].label, actualGeneratedCalculation: plan.sentences[1].text, networkCalls }));
    assert.deepEqual(oldGraph.workedExampleVisualPlan, plan, "before oracle: arithmetic marker must not be silently stripped");
    assert.equal(oldManifest.scenes[1].label, plan.slots[1].label, "before oracle: generic label must not reveal the answer early");
  }

  test("actual preparation/script and Story Spine produce exact generated arithmetic, no supplied solution", () => {
    assert.equal(plan.problemDisplay, "((((-60) + (-6)) × 3) ÷ 6)");
    assert.deepEqual(plan.steps.map((step) => [step.left, step.operation, step.right, step.result]), [["-60", "add", "-6", "-66"], ["-66", "multiply", "3", "-198"], ["-198", "exact_divide", "6", "-33"]]);
    assert.equal(plan.answer, "-33"); assert.deepEqual(assertWorkedExampleVisualPlanCurrent(plan, base), plan);
    assert.equal(hasWorkedExampleVisualMarkers(base), true);
  });
  test("real TTS splitter defines whole-step utterances independently of the visual helper", () => {
    const actual = actualTtsSentences(String(base.store.narrationText));
    assert.equal(actual.length, 5);
    assert.deepEqual(workedExampleVisualSentences(plan.preparation), actual);
    assert.deepEqual(plan.sentences.map((sentence) => sentence.text), actual);
    assert.deepEqual(plan.slots.map((slot) => slot.phase), ["problem", "step", "step", "step", "answer"]);
    assert.deepEqual(plan.slots.map((slot) => slot.label), ["The problem", "Step 1", "Step 2", "Step 3", "Review the answer"]);
    assert.equal(plan.steps[0].revealAtSec, plan.sentences[1].end, "reveal uses the decoder-derived sentence endpoint");
  });
  test("safe scene compilation preserves exact complete plan; ordinary prose is not display math", () => {
    const manifest = currentGraph.compileSceneManifest(graph, base.storySpine as ReturnType<typeof planStorySpine>);
    assert.deepEqual(manifest.workedExampleVisualPlan, plan);
    assert.deepEqual(manifest.scenes.map(({ label, text }) => [label, text]), plan.slots.map(({ label }) => [label, label]));
    assert.equal(manifest.externalProviderCalls, 0);
    currentGraph.assertSceneManifestMatchesEpisodeGraph(manifest, graph);
  });
  test("all generated step results remain absent before the bound calculation sentence ends", () => {
    for (const step of plan.steps) {
      assert.equal(workedExampleVisibleResults(plan, step.revealAtSec - 1e-9).some((value) => value.nodeId === step.nodeId), false);
      assert.deepEqual(workedExampleVisibleResults(plan, step.revealAtSec).find((value) => value.nodeId === step.nodeId), { nodeId: step.nodeId, result: step.result });
      assert.equal(plan.sentences.find((sentence) => sentence.id === step.sentenceId)?.end, step.revealAtSec);
    }
    assert.deepEqual(workedExampleVisibleResults(plan, 0), []);
    assert.equal(workedExampleVisibleResults(plan, plan.slots.at(-1)!.t0).at(-1)?.result, plan.answer);
    for (const value of [-1, NaN, Infinity, plan.durationSec + 1]) assert.throws(() => workedExampleVisibleResults(plan, value));
  });
  for (const operation of ["multiply", "add"] as const) test(`role-aware reveal when generated ${operation} result equals an existing operand`, () => {
    let candidate: WorkedExampleVisualPlan | undefined;
    for (let index = 0; index < 256; index++) {
      const input = fixture(`role-aware-${index}`, [operation]);
      const generated = compileWorkedExampleVisualPlan(input), step = generated.steps[0];
      const target = operation === "multiply" ? step.result === "0" : step.result !== "0";
      if (target && (step.result === step.left || step.result === step.right)) { candidate = generated; break; }
    }
    assert.ok(candidate, "bounded real generator search must find the operand/result collision");
    const step = candidate.steps[0];
    assert.ok(candidate.problemDisplay.includes(step.result), "the same numeric text legitimately appears in the problem operands");
    assert.equal(workedExampleVisibleResults(candidate, step.revealAtSec - 1e-9).some((value) => value.nodeId === step.nodeId), false);
    assert.deepEqual(workedExampleVisibleResults(candidate, step.revealAtSec), [{ nodeId: step.nodeId, result: step.result }]);
    console.log(JSON.stringify({ generatedRoleCollision: candidate.preparation.request.seed, operation, left: step.left, right: step.right, result: step.result }));
  });
  test("unmarked graph/schema/compiler remain deterministic without optional arithmetic fields", () => {
    for (const seed of ["unchanged-a", "unchanged-b", "unchanged-c"]) {
      const input = fixture(seed), ordinary = mark(input, compileWorkedExampleVisualPlan(input)).unmarked.episodeGraph;
      assert.equal(Object.hasOwn(ordinary, "workedExampleVisualPlan"), false);
      assert.equal(Object.hasOwn(currentGraph.compileSceneManifest(ordinary), "workedExampleVisualPlan"), false);
      assert.equal(JSON.stringify(currentGraph.compileSceneManifest(ordinary)), JSON.stringify(currentGraph.compileSceneManifest(clone(ordinary))));
      if (baseline) {
        assert.equal(JSON.stringify(currentGraph.assertEpisodeGraph(ordinary)), JSON.stringify(baseline.assertEpisodeGraph(ordinary)));
        assert.equal(JSON.stringify(currentGraph.compileSceneManifest(ordinary)), JSON.stringify(baseline.compileSceneManifest(ordinary)));
        assert.equal(currentGraph.episodeGraphFingerprint(ordinary), baseline.episodeGraphFingerprint(ordinary));
      }
    }
  });
  for (const operations of [["subtract"], ["exact_divide"], ["multiply", "subtract", "exact_divide"], Array(8).fill("add")] as WorkedExampleRequest["operations"][]) {
    test(`generated operation/order contract ${operations.join("-")}`, () => {
      const input = fixture(`seed-${operations.join("-").slice(0, 45)}`, operations);
      const candidate = compileWorkedExampleVisualPlan(input);
      assert.deepEqual(candidate.steps.map((step) => step.operation), operations);
      const marked = mark(input, candidate).graph;
      assert.equal(currentGraph.compileSceneManifest(marked).scenes.length, operations.length + 2);
    });
  }
  for (const key of ["workedExampleRequest", "workedExamplePreparation", "script", "narrationText", "scriptApproved", "workedExampleEditorialApproval"]) reject(`missing current ${key}`, (input) => { input.store = { ...input.store }; delete (input.store as Record<string, unknown>)[key]; });
  for (const key of ["workedExampleAudioBinding", "narrationKey", "narrationDurationSec", "narrationTranscriptText", "narrationPerformanceEvidence", "sentenceTimings", "chapterPlan"]) reject(`missing audio ${key}`, (input) => { input.outputs = { ...input.outputs }; delete (input.outputs as Record<string, unknown>)[key]; });
  for (const key of ["ownerId", "channelId", "runId", "keyPrefix"] as const) reject(`foreign active ${key}`, (input) => { Object.assign(input, { [key]: "foreign" }); });
  reject("stale deterministic request", (input) => { input.store = { ...input.store, workedExampleRequest: { ...request, seed: "foreign-seed" } }; });
  reject("stale script despite current preparation", (input) => { input.store = { ...input.store, script: { ...(input.store.script as object), narrationText: "forged" } }; });
  reject("no independent editorial approval", (input) => { input.store = { ...input.store, scriptApproved: false }; });
  reject("changed actual TTS controls", (input) => { input.params = { ...input.params, voiceId: "foreign" }; });
  reject("changed audio object identity", (input) => { input.outputs = { ...input.outputs, narrationKey: "foreign.mp3" }; });
  reject("stale timing binding", (input) => { (input.outputs.sentenceTimings as Array<{ end: number }>)[0].end += 0.1; });
  reject("legacy final-only binding restores audio but cannot qualify arithmetic visuals", (input) => {
    const binding = WorkedExampleAudioBindingSchema.parse(input.outputs.workedExampleAudioBinding);
    delete binding.segmentClock;
    assert.doesNotThrow(() => WorkedExampleAudioBindingSchema.parse(binding));
    input.outputs = { ...input.outputs, workedExampleAudioBinding: binding };
  }, /measured segment clock is unavailable/);
  reject("foreign clock from a different current source bundle", (input) => {
    const foreign = fixture("foreign-current-bundle");
    const binding = WorkedExampleAudioBindingSchema.parse(input.outputs.workedExampleAudioBinding);
    binding.segmentClock = WorkedExampleAudioBindingSchema.parse(foreign.outputs.workedExampleAudioBinding).segmentClock;
    input.outputs = { ...input.outputs, workedExampleAudioBinding: binding };
  }, /different audio/);
  reject("recomputed core hash cannot disguise a foreign ordered segment clock", (input) => {
    const foreign = fixture("foreign-current-bundle");
    const binding = WorkedExampleAudioBindingSchema.parse(input.outputs.workedExampleAudioBinding);
    binding.segmentClock = WorkedExampleAudioBindingSchema.parse(foreign.outputs.workedExampleAudioBinding).segmentClock;
    binding.segmentClock!.bindingFingerprint = narrationClockBindingFingerprint(binding);
    input.outputs = { ...input.outputs, workedExampleAudioBinding: binding };
  }, /ordered submitted text/);
  reject("wrong transcript binding", (input) => { input.outputs = { ...input.outputs, narrationTranscriptText: "forged" }; });
  reject("unsupported portrait", (input) => { Object.assign(input, { aspectRatio: "9:16" }); }, /landscape/);
  reject("missing landscape choice", (input) => { Object.assign(input, { aspectRatio: undefined }); }, /landscape/);
  reject("chapter mode", (input) => { input.params = { ...input.params, chapterCards: true }; }, /chapters/);
  reject("implicit sentence mode refused", (input) => { input.params = { ...input.params }; delete (input.params as Record<string, unknown>).chapterCards; }, /sentence mode/);
  for (const key of ["syntheticScenario", "scenarioVisualTreatment", "evidenceVisualManifests", "editorialEvidencePacket"]) reject(`mixed ${key}`, (input) => { input.store = { ...input.store, [key]: undefined }; }, /cannot mix/);
  reject("Story Spine changed sentence text", (input) => { (input.storySpine as ReturnType<typeof planStorySpine>).timedScript.sentences[2].text = "wrong equation"; });
  reject("Story Spine changed clock", (input) => { (input.storySpine as ReturnType<typeof planStorySpine>).timedScript.sentences[2].t0 += 0.001; });
  reject("Story Spine reordered sentences", (input) => { (input.storySpine as ReturnType<typeof planStorySpine>).timedScript.sentences.reverse(); });
  reject("Story Spine merged beat references", (input) => { const spine = input.storySpine as ReturnType<typeof planStorySpine>; spine.narrativeBeats[0].sourceSentenceIds.push(spine.timedScript.sentences[1].id); });
  reject("rehashed audio with overlapping ordered clock is still rejected", (input) => {
    const timings = input.outputs.sentenceTimings as Array<{ text: string; start: number; end: number }>;
    timings[1].start = timings[0].end - 0.01;
    (input.storySpine as ReturnType<typeof planStorySpine>).timedScript.sentences[1].t0 = timings[1].start;
    input.outputs = { ...input.outputs, workedExampleAudioBinding: createWorkedExampleAudioBinding(input, input.outputs, actualTtsSentences(String(input.store.narrationText)), fakeBytes) };
  });
  for (const [name, change] of [
    ["wrong arithmetic result", (value: WorkedExampleVisualPlan) => { value.steps[0].result = "123"; }],
    ["wrong operation", (value: WorkedExampleVisualPlan) => { value.steps[0].operation = "subtract"; }],
    ["swapped operands", (value: WorkedExampleVisualPlan) => { [value.steps[0].left, value.steps[0].right] = [value.steps[0].right, value.steps[0].left]; }],
    ["premature reveal", (value: WorkedExampleVisualPlan) => { value.steps[0].revealAtSec -= 0.001; }],
    ["missing result", (value: WorkedExampleVisualPlan) => { value.steps.pop(); }],
    ["unsafe label", (value: WorkedExampleVisualPlan) => { value.slots[2].label = value.steps[0].display; }],
    ["changed DAG result", (value: WorkedExampleVisualPlan) => { value.preparation.derivation.steps[0].result = "0"; }],
  ] as const) test(`recomputed public plan hash cannot admit ${name}`, () => { const value = clone(plan); change(value); assert.throws(() => WorkedExampleVisualPlanSchema.parse(rehashPlan(value))); });
  test("self-contained identity hashes cannot admit a foreign current audio source", () => {
    const edited = clone(plan); edited.source.artifact.sha256 = "a".repeat(64); rehashPlan(edited);
    assert.doesNotThrow(() => WorkedExampleVisualPlanSchema.parse(edited), "self-contained schema is not external source authority");
    assert.throws(() => assertWorkedExampleVisualPlanCurrent(edited, base), /complete source bundle/);
  });
  test("recomputed plan hash cannot substitute a different segment-clock receipt", () => {
    const edited = clone(plan); edited.source.segmentClockFingerprint = "b".repeat(64); rehashPlan(edited);
    assert.doesNotThrow(() => WorkedExampleVisualPlanSchema.parse(edited));
    assert.throws(() => assertWorkedExampleVisualPlanCurrent(edited, base), /complete source bundle/);
    const binding = WorkedExampleAudioBindingSchema.parse(base.outputs.workedExampleAudioBinding);
    assert.equal(plan.source.segmentClockFingerprint, narrationSegmentClockFingerprint(binding.segmentClock!));
  });
  test("full-marker detection includes explicitly undefined partial bundles", () => {
    const ordinary = { ...base, store: {}, outputs: {} };
    assert.equal(hasWorkedExampleVisualMarkers(ordinary), false);
    for (const key of ["workedExampleRequest", "workedExamplePreparation", "workedExampleEditorialApproval", "workedExampleAudioBinding", "workedExampleVisualPlan"]) {
      const partial = { ...ordinary, store: { [key]: undefined } };
      assert.equal(hasWorkedExampleVisualMarkers(partial), true); assert.throws(() => compileWorkedExampleVisualPlan(partial));
    }
    for (const location of ["store", "outputs"] as const) for (const key of ["workedExamplePreparationFingerprint", "workedExampleNarrationVersion"]) for (const value of [undefined, null, "stale"]) {
      const partial = { ...ordinary, [location]: { script: { [key]: value } } };
      assert.equal(hasWorkedExampleVisualMarkers(partial), true, `${location}.script.${key}=${value}`);
      assert.throws(() => compileWorkedExampleVisualPlan(partial));
    }
    for (const location of ["store", "outputs"] as const) {
      assert.equal(hasWorkedExampleVisualMarkers({ ...ordinary, [location]: { script: null } }), false, "null script alone is not an arithmetic marker");
    }
  });
  for (const [name, change] of [
    ["missing root plan", (value: currentGraph.EpisodeGraph) => { delete value.workedExampleVisualPlan; }],
    ["undefined root marker", (value: currentGraph.EpisodeGraph) => { value.workedExampleVisualPlan = undefined; }],
    ["missing scene marker", (value: currentGraph.EpisodeGraph) => { delete value.beats[1].visualState.workedExampleVisual; }],
    ["reordered scenes", (value: currentGraph.EpisodeGraph) => { value.beats.reverse(); }],
    ["foreign slot", (value: currentGraph.EpisodeGraph) => { value.beats[1].visualState.workedExampleVisual!.slotId = "slot-foreign"; }],
    ["changed sentence reference", (value: currentGraph.EpisodeGraph) => { value.beats[1].storySpineSentenceIds = value.beats[0].storySpineSentenceIds; }],
    ["free-form answer prop", (value: currentGraph.EpisodeGraph) => { value.beats[1].visualState.props = [plan.answer]; }],
    ["mixed scenario receipt", (value: currentGraph.EpisodeGraph) => { value.beats[1].visualState.scenarioVisualTreatmentFingerprint = "a".repeat(64); }],
  ] as const) test(`graph schema refuses ${name}`, () => { const value = clone(graph); change(value); assert.throws(() => currentGraph.EpisodeGraphSchema.parse(value)); });
  test("adapter refuses replacing a declared scenario with arithmetic", () => {
    const value = clone(unmarked.episodeGraph); value.beats[0].visualState.scenarioVisualTreatmentFingerprint = "a".repeat(64);
    assert.throws(() => currentGraph.bindWorkedExampleVisualPlan(value, plan, base.storySpine as ReturnType<typeof planStorySpine>), /cannot replace/);
  });
  test("manifest text and missing root plan cannot bypass schema or exact graph comparison", () => {
    const manifest = currentGraph.compileSceneManifest(graph); manifest.scenes[2].text = plan.steps[0].display;
    assert.throws(() => currentGraph.SceneManifestSchema.parse(manifest));
    const missing = currentGraph.compileSceneManifest(graph); delete missing.workedExampleVisualPlan;
    assert.throws(() => currentGraph.assertSceneManifestMatchesEpisodeGraph(missing, graph));
  });
  test("unmarked explicit undefined arithmetic marker is not silently accepted", () => {
    assert.throws(() => currentGraph.EpisodeGraphSchema.parse({ ...unmarked.episodeGraph, workedExampleVisualPlan: undefined }));
  });
  assert.equal(networkCalls, 0);
  console.log(JSON.stringify({ passed, networkCalls, historicalByteParityChecked: Boolean(baseline), contractOnlySyntheticTiming: true, actualSpeechVideoEvidence: false, base: "4a1fda2ef8f4737effc55d59f00392dead369daa", planFingerprint: plan.fingerprint, sourceFingerprint: plan.source.storySpineFingerprint }));
} finally { globalThis.fetch = originalFetch; }
