/**
 * Real cast + production block, with external I/O controlled. No native media,
 * paid providers or downstream qa_visual run here. Process-output sentinels
 * prove control flow only; they must never be presented as rendered proof.
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const { build } = require(require.resolve("esbuild", { paths: [require.resolve("tsx")] }));
const stateKey = "__ysaComicCompletenessIo";
const previousState = globalThis[stateKey];
const previousFetch = globalThis.fetch;
const root = await mkdtemp(join(tmpdir(), "ysa-comic-completeness-"));
const artBytes = await readFile(join(process.cwd(), "src/assets/whiteboard/history_ref.png"));
const sourceOverride = process.env.MOTION_COMIC_COMPLETENESS_BASELINE_SOURCE
  ? await readFile(process.env.MOTION_COMIC_COMPLETENESS_BASELINE_SOURCE, "utf8") : undefined;
let current;
let cases = 0;
const validOnly = process.argv.includes("--valid-only");
const validProofs = [];
const caseEvidence = [];
const sha = value => createHash("sha256").update(value).digest("hex");
const indices = count => Array.from({ length: count }, (_, index) => index);

function storyFor(count, extraLinePanel) {
  const identity = { age: "adult", build: "average", face: "angular", hair: "dark_short", wardrobe: "workwear", palette: "blue_accent", accessory: "none" };
  const beats = [
    ["urgent_movement", "The river rose while Mara reached the damaged crossing."],
    ["examining", "Orin found a fractured joint beneath the swinging deck."],
    ["discovering", "A loosened bracket had pulled the support rope sideways."],
    ["protecting", "Mara secured the walkway before either worker went below."],
    ["carrying_gear", "Orin carried the replacement tools to the exposed joint."],
    ["repairing", "Together they seated the bracket against the intact beam."],
    ["operating_equipment", "Mara tightened the repair while Orin held the tension."],
    ["deliberate_work", "They checked the adjoining joints before removing their supports."],
    ["reaching", "Orin reached the far anchor and inspected its outer face."],
    ["building", "Mara fitted the final brace across the weakened section."],
    ["watchful_pause", "The repaired crossing remained steady beneath its first test."],
    ["purposeful_travel", "The final safety inspection allowed both workers to cross."],
  ];
  const selected = [...beats.slice(0, count - 2), ...beats.slice(-2)];
  return {
    title: "Repairing the River Crossing", logline: "Two workers restore the crossing after tracing its failed joint.",
    narratorVoiceId: "JBFqnCBsd6RMkjVDRZzb",
    characters: [
      { id: "mara", name: "Mara", visual: identity, voiceId: "EXAVITQu4vr4xnSDxMaL" },
      { id: "orin", name: "Orin", visual: { ...identity, face: "weathered", hair: "grey", palette: "red_accent" }, voiceId: "CwhRBWXzGAHq8TQ4Fs17" },
    ],
    panels: selected.map(([action, text], index) => ({
      visual: {
        environment: "waterfront", era: "modern", subjects: ["worker"], objects: ["rope", "bridge", "tool_kit"], action,
        relations: [action === "repairing" ? "subject_repairs_object" : "subject_observes_object"],
        mood: index < count - 2 ? "tense" : "hopeful", lighting: "daylight",
      },
      characters: ["mara", "orin"], shot: ["wide", "medium", "close"][index % 3],
      lines: [
        { speaker: "narrator", text },
        ...(index === extraLinePanel ? [{ speaker: "narrator", text: "Their written inspection preserved the repair history for the next flood." }] : []),
      ],
    })),
  };
}

async function materialize(path) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "CONTROLLED PROCESS OUTPUT — NOT MEDIA");
}

const io = {
  get root() { return current.runDir; },
  get checkpoint() {
    return { version: "motion-comic-storyboard/v3", outcome: {
      story: current.story,
      planner: { id: "local-approved-story-fixture", provenance: "Controlled story input; no live creative review" },
      critique: { accepted: true, score: 1, iterations: 1, issues: [] },
    } };
  },
  async generateImage(request) {
    current.imageRequests.push(request.id);
    const match = /^panel-(\d+)-(primary|recovery)$/.exec(request.id);
    assert.ok(match, "actual cast identifies panel and bounded attempt");
    if (Number(match[1]) === current.terminalArtPanel && match[2] === "recovery") throw current.artTerminalError;
    if (current.failedArt.includes(Number(match[1]))) throw new Error(`Controlled prebill rejection for ${request.id}`);
    return artBytes;
  },
  forbidden(kind) { current.forbiddenCalls.push(kind); throw new Error(`Unexpected ${kind} provider`); },
  async duration(path) { current.probes.push(path); return basename(path) === "final.mp4" ? 31.021995 : 1.7; },
  async normalize(input, output) { await copyFile(input, output); },
  async upload(key, path) { current.uploads.push({ key, path }); },
  async recordAsset(args) { current.assets.push(args); return "local-asset"; },
  async writeFile(path, data, ...options) {
    if (current.failedVoiceCache && basename(String(path)) === current.failedVoiceCache) {
      current.cacheWriteAttempts.push({ path, sha256: sha(data) });
      throw current.cacheWriteError;
    }
    return writeFile(path, data, ...options);
  },
  execFile(...args) {
    const luma = args[1].includes(join(current.runDir, `panel_${current.nearBlackArt}.png`)) ? 0 : 128;
    current.lumaReadings.push(luma);
    queueMicrotask(() => args.at(-1)(null, "", `lavfi.signalstats.YAVG=${luma}`));
  },
  spawn(command, args) {
    current.commands.push([command, ...args]);
    assert.ok(command === "ffmpeg" || command === "python3", `Unexpected native process ${command}`);
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
    queueMicrotask(async () => {
      try {
        if (command === "python3") {
          assert.equal(args[0], join("scripts", "mc_page_render.py"));
          current.rendererInputs.push(JSON.parse(await readFile(args[1], "utf8")));
          await materialize(args[3]);
          await writeFile(join(current.runDir, "motion_comic_review_timeline.json"), JSON.stringify({ version: "motion-comic-review/v1", bubbles: [] }));
        } else { await materialize(args.at(-1)); }
        child.emit("close", 0);
      } catch (error) { child.emit("error", error); }
    });
    return child;
  },
};

// Production normalization, art/cache gates, voice HTTP handling, timing,
// padding decisions, narration selection and block code remain real.
const seams = {
  "node:child_process": "export const spawn=(...a)=>io.spawn(...a); export const execFile=(...a)=>io.execFile(...a); execFile[Symbol.for('nodejs.util.promisify.custom')]=(...a)=>new Promise((resolve,reject)=>io.execFile(...a,(error,stdout,stderr)=>error?reject(error):resolve({stdout,stderr})));",
  "@/agents/mastra": "export const agentJson=()=>io.forbidden('planner');",
  "@/lib/anthropic": "export const hasAnthropicKey=()=>true; export const claudeJsonPro=()=>io.forbidden('critic');",
  "@/lib/vision": "export const VISION_GATE_MAX_TOKENS=1000; export const visionLocal=()=>io.forbidden('vision');",
  "@/lib/music": "export const generateMusic=()=>io.forbidden('music');",
  "@/lib/pydeps": "export const preflightPythonRenderer=async()=>{};",
  "@/lib/novitaRenderFarm": "export const hasNovitaRenderFarmConfig=()=>true;",
  "@/lib/novitaMedia": "export const createAttestedNovitaImageGenerator=()=>request=>io.generateImage(request);",
  "@/lib/ffmpeg": "export const ffprobeDuration=p=>io.duration(p); export const normalizeAudioOnly=(a,b)=>io.normalize(a,b); export const probe=async()=>({hasAudio:true,durationSec:11}); export const measureAudio=async()=>({integratedLufs:-14,windowMeanDb:-16});",
  "@/lib/files": "export const makeRunTempDir=async()=>io.root;",
  "@/lib/storage": "export const getObjectBytes=async()=>Buffer.from(JSON.stringify(io.checkpoint)); export const putObject=async()=>{}; export const putObjectFromFile=(key,path)=>io.upload(key,path);",
  "@/lib/studioConvexHttpClient": "export class StudioConvexHttpClient {mutation(_api,args){return io.recordAsset(args)}}",
};

try {
  globalThis[stateKey] = io;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.elevenlabs.io/v1/text-to-dialogue", "no network beyond the controlled speech transport");
    const body = JSON.parse(init.body);
    assert.equal(body.model_id, "eleven_v3", "the actual configured voice model stays unchanged");
    assert.equal(body.inputs.length, 1);
    const lineId = current.lineIdsByText.get(body.inputs[0].text);
    assert.ok(lineId, "every request must bind an accepted scripted line");
    current.voiceRequests.push(lineId);
    if (current.unknownVoiceOutcome === lineId) throw current.providerError;
    if (current.failedLines.includes(lineId)) return new Response("Controlled explicit voice rejection", { status: 400 });
    if (current.voiceResponseFailure && lineId === "panel-9-line-1") {
      if (current.voiceResponseFailure === "http500") return new Response("Controlled speech server failure", { status: 500 });
      if (current.voiceResponseFailure === "tiny200") return new Response(new Uint8Array(800), { status: 200 });
      assert.equal(current.voiceResponseFailure, "unreadable200");
      return Object.assign(new Response(new Uint8Array(1024), { status: 200 }), {
        arrayBuffer: async () => { throw current.providerError; },
      });
    }
    return new Response(new Uint8Array(1024).fill(17), { status: 200 });
  };
  const compiled = await build({
    absWorkingDir: process.cwd(), bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    define: { "process.env.ELEVENLABS_API_KEY": JSON.stringify("local-never-sent"), "process.env.NEXT_PUBLIC_CONVEX_URL": JSON.stringify("https://local.invalid") },
    stdin: { contents: 'export {castMotionComic} from "./src/lib/motionComic"; export {motionComicBlock,motionComicStoryboardDefects} from "./src/trigger/blocks/motionComicBlocks"; export {classifyExecutionError} from "./src/engine/executionErrors"; export {taskErrorForRetryPolicy} from "./src/trigger/taskRetryPolicy";', resolveDir: process.cwd(), loader: "ts" },
    plugins: [{ name: "comic-external-io-only", setup(builder) {
      if (sourceOverride !== undefined) builder.onLoad({ filter: /\/src\/lib\/motionComic\.ts$/ }, () => ({ loader: "ts", contents: sourceOverride }));
      builder.onResolve({ filter: /^node:fs\/promises$/ }, ({ path, importer }) => importer.endsWith("/src/lib/motionComic.ts") ? { path, namespace: "comic-controlled-fs" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "comic-controlled-fs" }, () => ({ loader: "js", contents: `export * from "node:fs/promises"; const io=globalThis.${stateKey}; export const writeFile=(...a)=>io.writeFile(...a);` }));
      builder.onResolve({ filter: /^(node:child_process|@\/)/ }, ({ path }) => seams[path] ? { path, namespace: "comic-completeness-io" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "comic-completeness-io" }, ({ path }) => ({ loader: "js", contents: `const io=globalThis.${stateKey};\n${seams[path]}` }));
    } }],
  });
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled.outputFiles[0].text)(require, loaded, loaded.exports);
  const { castMotionComic, motionComicBlock, motionComicStoryboardDefects, classifyExecutionError, taskErrorForRetryPolicy } = loaded.exports;

  async function runCase(name, { count = 10, failedArt = [], terminalArtPanel, nearBlackArt, failedLines = [], extraLinePanel, throughBlock = false, warmVoices = true, warmMusic = true, unknownVoiceOutcome, voiceResponseFailure, failedVoiceCache, runDir = join(root, name) } = {}) {
    const story = storyFor(count, extraLinePanel);
    assert.deepEqual(motionComicStoryboardDefects(story, count, 0), [], "actual storyboard preflight accepts the complete plan");
    current = {
      name, story, runDir, failedArt, terminalArtPanel, nearBlackArt, failedLines, throughBlock, unknownVoiceOutcome, voiceResponseFailure, failedVoiceCache,
      imageRequests: [], voiceRequests: [], probes: [], uploads: [], assets: [], commands: [], rendererInputs: [], forbiddenCalls: [], logs: [], cacheWriteAttempts: [], lumaReadings: [],
      artTerminalError: Object.assign(new Error("Controlled unknown paid outcome in art recovery"), { retryable: false, code: "CONTROLLED_UNKNOWN_PAID_ART" }),
      providerError: Object.assign(new Error("Controlled ECONNRESET after potentially accepted speech POST"), { code: "ECONNRESET" }),
      cacheWriteError: Object.assign(new Error("Controlled ENOSPC persisting paid speech bytes"), { code: "ENOSPC" }),
    };
    current.lineIdsByText = new Map(story.panels.flatMap((panel, p) => panel.lines.map((line, l) => [line.text, `panel-${p}-line-${l}`])));
    await mkdir(runDir, { recursive: true });
    if (warmVoices) {
      for (const [p, panel] of story.panels.entries()) for (const l of indices(panel.lines.length)) await materialize(join(runDir, `line_${p}_${l}.mp3`));
    }
    if (warmMusic) await materialize(join(runDir, "music.mp3"));
    let result, error;
    try {
      result = throughBlock ? await motionComicBlock.run({
        ownerId: "proof-owner", channelId: "proof-channel", runId: "proof-run", keyPrefix: "owners/proof-owner/channels/proof-channel/", stageBudgetUsd: 100,
        params: { panels: count }, store: { topic: story.title, channelName: "Controlled comic proof" }, log: message => current.logs.push(message),
      }) : await castMotionComic({
        brief: { topic: story.title, panels: count, music: true }, plan: story, runDir, outPath: join(runDir, "final.mp4"), generateImage: io.generateImage, log: message => current.logs.push(message),
      });
    } catch (caught) { error = caught; }
    const cache = {};
    for (const file of (await readdir(runDir)).filter(file => /^(?:panel_\d+\.(?:png|art\.json)|line_\d+_\d+\.mp3)$/.test(file))) cache[file] = sha(await readFile(join(runDir, file)));
    cases++;
    caseEvidence.push({
      name, panelCount: count, throughBlock,
      error: error ? {
        name: error.name, message: error.message, code: error.code, retryable: error.retryable, status: error.status,
        missingPanelIds: error.missingPanelIds, missingLineIds: error.missingLineIds,
        executionClassification: classifyExecutionError(error), taskRetryErrorName: taskErrorForRetryPolicy(error).error.name,
      } : null,
      imageRequests: [...current.imageRequests], voiceRequests: [...current.voiceRequests], lumaReadings: [...current.lumaReadings],
      nativeProcessCallsIntercepted: current.commands.length,
      rendererPanelIndices: current.rendererInputs[0]?.panels.map(panel => panel.panelIndex) ?? [],
      narrationCueCount: result?.sentenceTimings?.length ?? null,
      mediaUploadCallsIntercepted: current.uploads.length,
      assetKinds: current.assets.map(asset => asset.kind), cacheHashes: cache,
    });
    return { ...current, result, error, cache };
  }
  function accepted(entry) {
    assert.equal(entry.error, undefined, `${entry.name}: ${entry.error}`);
    assert.deepEqual(entry.rendererInputs[0].panels.map(panel => panel.panelIndex), indices(entry.story.panels.length));
    const lines = entry.story.panels.flatMap(panel => panel.lines.map(line => line.text));
    assert.deepEqual(entry.result.sentenceTimings.map(line => line.text), lines, "all accepted lines survive in order");
    assert.equal(entry.result.narrationText, lines.join(" "));
    assert.deepEqual(entry.forbiddenCalls, []);
    if (entry.throughBlock) {
      assert.equal(entry.assets.find(asset => asset.kind === "video").meta.panels, entry.story.panels.length);
      assert.equal(entry.result.narrationTranscriptText, entry.result.narrationText);
      assert.ok(entry.uploads.some(upload => upload.key.endsWith("/final.mp4")));
    } else { assert.equal(entry.result.panels, entry.story.panels.length); }
  }
  function noDerivedWork(entry) {
    assert.deepEqual(entry.commands, [], "missing content cannot reach padding, music mux or page rendering");
    assert.deepEqual(entry.rendererInputs, []);
    assert.deepEqual(entry.uploads, [], "no final/narration file upload");
    assert.deepEqual(entry.assets.filter(asset => ["video", "narration"].includes(asset.kind)), []);
    assert.deepEqual(entry.forbiddenCalls, [], "no planner, critic, vision or music provider after incompleteness");
  }
  function cachePreserved(before, after) {
    for (const [file, digest] of Object.entries(before.cache)) assert.equal(after.cache[file], digest, `${file} must retain its accepted bytes`);
  }
  function terminalRetryPolicy(entry) {
    assert.equal(classifyExecutionError(entry.error).retryable, false, "the actual engine classifier cannot retry accepted/unknown paid work");
    assert.equal(taskErrorForRetryPolicy(entry.error).error.name, "AbortTaskRunError", "the actual Trigger retry policy aborts the task rather than repurchasing paid work");
  }

  for (const count of [4, 8, 10, 12]) for (const throughBlock of [false, true]) {
    const complete = await runCase(`complete-${count}-${throughBlock}`, { count, throughBlock });
    accepted(complete);
    assert.equal(complete.imageRequests.length, count);
    assert.deepEqual(complete.voiceRequests, []);
    validProofs.push({
      count, throughBlock,
      timeline: complete.rendererInputs[0],
      sentenceTimings: complete.result.sentenceTimings,
      narrationText: complete.result.narrationText,
      controlledMeasuredDuration: complete.result.durationMs ?? complete.result.videoDurationSec * 1000,
      narrationList: await readFile(join(complete.runDir, "narr_list.txt"), "utf8"),
      panelConcatLists: await Promise.all(indices(count).map(index => readFile(join(complete.runDir, `alist_${index}.txt`), "utf8"))),
      paddingCommands: complete.commands.filter(command => command.includes("apad")).map(command => command.map(argument => argument.replaceAll(complete.runDir, "<run>"))),
    });
  }
  if (process.env.MOTION_COMIC_COMPLETENESS_VALID_OUTPUT) await writeFile(
    process.env.MOTION_COMIC_COMPLETENESS_VALID_OUTPUT,
    JSON.stringify({ scope: "Valid 4/8/10/12 actual cast/block handoff parity; external process/media/probe I/O controlled, not native media proof", validProofs }, null, 2),
    { flag: "wx" },
  );
  if (!validOnly) {
  for (const { count, missing } of [
    { count: 10, missing: [9] }, { count: 12, missing: [11] },
    { count: 4, missing: [3] }, { count: 8, missing: [7] }, { count: 10, missing: [5] }, { count: 12, missing: [5, 11] },
    { count: 10, missing: [0] },
  ]) for (const throughBlock of [false, true]) {
    const failure = await runCase(`missing-art-${count}-${missing.join("-")}-${throughBlock}`, { count, failedArt: missing, throughBlock, warmVoices: false, warmMusic: false });
    assert.ok(failure.error, `missing art must not return a shortened success: renderer got ${failure.rendererInputs[0]?.panels.length}/${count} panels`);
    assert.equal(failure.error?.code, "MOTION_COMIC_ART_INCOMPLETE", `must reject ALL missing art: ${failure.name} (${failure.error})`);
    assert.deepEqual(failure.error.missingPanelIds, missing.map(index => `panel-${index}`));
    assert.deepEqual(failure.voiceRequests, []);
    assert.deepEqual(failure.probes, [], "art gate is before all voice timing work");
    noDerivedWork(failure);
    if (count === 10 && missing[0] !== 0) {
      const resumed = await runCase(`resume-${failure.name}`, { count, throughBlock, runDir: failure.runDir, warmVoices: false });
      accepted(resumed);
      assert.deepEqual(resumed.imageRequests, missing.map(index => `panel-${index}-primary`));
      cachePreserved(failure, resumed);
    }
  }
  for (const panelIndex of [0, 5, 9]) for (const throughBlock of [false, true]) {
    const missingLine = `panel-${panelIndex}-line-1`;
    const failure = await runCase(`missing-line-${panelIndex}-${throughBlock}`, {
      extraLinePanel: panelIndex, failedLines: [missingLine], throughBlock, warmVoices: false, warmMusic: false,
    });
    assert.equal(failure.error?.name, "TerminalDialogueResponseError", `one good line cannot excuse a lost line or erase terminal provider identity (${failure.error})`);
    assert.equal(failure.error.status, 400);
    terminalRetryPolicy(failure);
    assert.deepEqual(failure.error.missingPanelIds, [`panel-${panelIndex}`]);
    assert.deepEqual(failure.error.missingLineIds, [missingLine]);
    assert.equal(failure.voiceRequests.filter(id => id === missingLine).length, 1, "explicit 400 does not widen provider retries");
    noDerivedWork(failure);
    const resumed = await runCase(`resume-${failure.name}`, { extraLinePanel: panelIndex, throughBlock, runDir: failure.runDir, warmVoices: false });
    accepted(resumed);
    assert.deepEqual(resumed.imageRequests, [], "voice repair never repurchases accepted art");
    const expectedRemaining = [missingLine, ...indices(9 - panelIndex).map(index => `panel-${panelIndex + index + 1}-line-0`)];
    assert.deepEqual(resumed.voiceRequests, expectedRemaining, "reuse every accepted line; synthesize only missing/unstarted speech");
    cachePreserved(failure, resumed);
    const replay = await runCase(`replay-${failure.name}`, { extraLinePanel: panelIndex, throughBlock, runDir: failure.runDir, warmVoices: false });
    accepted(replay);
    assert.deepEqual(replay.imageRequests, []);
    assert.deepEqual(replay.voiceRequests, []);
    cachePreserved(resumed, replay);
  }
  for (const throughBlock of [false, true]) {
    const missingLine = "panel-9-line-1";
    const unknown = await runCase(`unknown-paid-voice-${throughBlock}`, {
      throughBlock, extraLinePanel: 9, unknownVoiceOutcome: missingLine, warmVoices: false, warmMusic: false,
    });
    assert.equal(unknown.error?.name, "TerminalDialogueResponseError");
    assert.equal(unknown.error.cause, unknown.providerError, "preserve original transport error as the existing terminal error's cause");
    assert.deepEqual(unknown.error.missingLineIds, [missingLine]);
    assert.equal(unknown.voiceRequests.filter(id => id === missingLine).length, 1);
    assert.equal(Object.keys(unknown.cache).filter(file => /^line_/.test(file)).length, 10, "all ten completed lines remain cached");
    terminalRetryPolicy(unknown);
    noDerivedWork(unknown);

    const failedWrite = await runCase(`paid-voice-cache-failure-${throughBlock}`, {
      throughBlock, extraLinePanel: 9, failedVoiceCache: "line_9_1.mp3", warmVoices: false, warmMusic: false,
    });
    assert.equal(failedWrite.error, failedWrite.cacheWriteError, "preserve the exact original I/O error object and its code");
    assert.equal(failedWrite.error.code, "ENOSPC");
    assert.deepEqual(failedWrite.error.missingLineIds, [missingLine]);
    assert.equal(failedWrite.voiceRequests.filter(id => id === missingLine).length, 1, "local cache failure never regenerates original paid speech");
    assert.equal(failedWrite.cacheWriteAttempts.length, 2, "only the existing bounded local write retry is allowed");
    assert.equal(new Set(failedWrite.cacheWriteAttempts.map(attempt => attempt.sha256)).size, 1, "both writes use the same already-returned bytes");
    assert.equal(Object.keys(failedWrite.cache).filter(file => /^line_/.test(file)).length, 10);
    terminalRetryPolicy(failedWrite);
    noDerivedWork(failedWrite);
  }
  for (const throughBlock of [false, true]) for (const reason of ["prebill", "nearblack"]) {
    const failure = await runCase(`terminal-art-recovery-${reason}-${throughBlock}`, {
      count: 4, throughBlock, terminalArtPanel: 3, failedArt: reason === "prebill" ? [3] : [],
      nearBlackArt: reason === "nearblack" ? 3 : undefined, warmVoices: false, warmMusic: false,
    });
    assert.equal(failure.error, failure.artTerminalError, "both fallback catches must preserve the exact terminal provider error object");
    assert.equal(failure.error.code, "CONTROLLED_UNKNOWN_PAID_ART");
    assert.equal(failure.error.retryable, false);
    assert.deepEqual(failure.imageRequests.filter(id => id.startsWith("panel-3-")), ["panel-3-primary", "panel-3-recovery"]);
    assert.equal(failure.lumaReadings.includes(0), reason === "nearblack", "near-black recovery must actually be triggered by the measured primary image");
    assert.ok(failure.logs.some(line => line.includes(reason === "nearblack" ? "art failed (near-black)" : "Controlled prebill rejection for panel-3-primary")));
    assert.equal(Object.keys(failure.cache).filter(file => /^panel_\d+\.png$/.test(file)).length, 3, "retain all previously accepted art");
    assert.deepEqual(failure.voiceRequests, []);
    assert.deepEqual(failure.probes, []);
    terminalRetryPolicy(failure);
    noDerivedWork(failure);
  }
  for (const throughBlock of [false, true]) for (const voiceResponseFailure of ["http500", "tiny200", "unreadable200"]) {
    const failure = await runCase(`paid-voice-${voiceResponseFailure}-${throughBlock}`, {
      throughBlock, extraLinePanel: 9, voiceResponseFailure, warmVoices: false, warmMusic: false,
    });
    assert.equal(failure.error?.name, "TerminalDialogueResponseError");
    if (voiceResponseFailure === "http500") assert.equal(failure.error.status, 500);
    if (voiceResponseFailure === "unreadable200") assert.equal(failure.error.cause, failure.providerError);
    assert.deepEqual(failure.error.missingLineIds, ["panel-9-line-1"]);
    assert.equal(failure.voiceRequests.filter(id => id === "panel-9-line-1").length, 1, "ambiguous paid speech response never starts a second provider submission");
    assert.equal(Object.keys(failure.cache).filter(file => /^line_/.test(file)).length, 10);
    terminalRetryPolicy(failure);
    noDerivedWork(failure);
  }
  }
  if (process.env.MOTION_COMIC_COMPLETENESS_EVIDENCE_OUTPUT) await writeFile(
    process.env.MOTION_COMIC_COMPLETENESS_EVIDENCE_OUTPUT,
    JSON.stringify({
      scope: "Actual cast/block control flow; all external providers, storage, native-process I/O and media/probe measurements controlled. No paid/native-media/downstream visual-QA claim.",
      sourceSha256: sha(sourceOverride ?? await readFile(join(process.cwd(), "src/lib/motionComic.ts"))),
      casesPassed: cases, caseEvidence,
    }, null, 2), { flag: "wx" },
  );
  console.log(`Motion Comic ${validOnly ? "valid handoff parity" : "story completeness"}: ${cases} actual cast/block cases PASS; no paid calls or native media${validOnly ? "" : "; art + partial-line failures block, accepted caches survive recovery"}`);
} finally {
  globalThis.fetch = previousFetch;
  if (previousState === undefined) delete globalThis[stateKey]; else globalThis[stateKey] = previousState;
  await rm(root, { recursive: true, force: true });
}
