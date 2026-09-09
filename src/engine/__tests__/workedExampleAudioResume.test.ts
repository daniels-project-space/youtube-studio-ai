import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerAllBlocks } from "@/engine/blocks";
import { getManifest, registerManifest } from "@/engine/registry";
import { manifestFromBlock } from "@/engine/moduleManifest";
import { runPipeline } from "@/engine/runner";
import { validatePipeline } from "@/engine/validate";
import { artifactContract, validateArtifact } from "@/engine/artifactSchemas";
import { classifyExecutionError } from "@/engine/executionErrors";
import { taskErrorForRetryPolicy } from "@/trigger/taskRetryPolicy";
import { prepareWorkedExample, type WorkedExampleRequest } from "@/engine/workedExample";
import { draftWorkedExampleNarration, workedExampleEditorialApprovalFor } from "@/engine/workedExampleNarration";
import { createWorkedExampleAudioBinding, WORKED_EXAMPLE_TTS_INPUT_KEYS } from "@/engine/workedExampleAudioBinding";
import { rehydrateOutputsWithStorage, type RehydrationStorage } from "@/lib/rehydrate";
import { elevenLabsV3StitchEnabled, synthNarration } from "@/lib/tts";
import type { Block, BlockPatch, RunStageSink } from "@/engine/types";

const root = mkdtempSync(join(tmpdir(), "ysa-arithmetic-audio-resume-"));
const path = join(root, "local-tone-not-speech.mp3");
execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-c:a", "libmp3lame", "-b:a", "128k", path]);
const audio = readFileSync(path);
const request: WorkedExampleRequest = { policy: "worked-example/integer-v1", ownerId: "owner-a", channelId: "channel-a", runId: "run-a", requestId: "request-current", seed: "seed-current", operations: ["multiply", "add"] };
const staleRequest = { ...request, requestId: "request-stale", seed: "seed-stale" };
const params = { ttsProvider: "fish", voiceId: "explicit-voice", ttsSpeed: 1, qualityProfile: "draft", voiceGate: false };
const base = { ownerId: request.ownerId, channelId: request.channelId, runId: request.runId, keyPrefix: "owners/owner-a/", budgetUsd: 10, defaultRetries: 3 };
function fixture(current: WorkedExampleRequest) {
  const preparation = prepareWorkedExample(current), draft = draftWorkedExampleNarration(preparation, current);
  const approval = { scriptApproved: true, workedExampleEditorialApproval: workedExampleEditorialApprovalFor(draft.script) };
  const store = { workedExampleRequest: current, workedExamplePreparation: preparation, ...draft, ...approval };
  const outputs: BlockPatch = { narrationKey: `${base.keyPrefix}runs/${base.runId}/narration.mp3`, narrationLocalPath: path,
    narrationDurationSec: 4, narrationTranscriptText: draft.narrationText,
    narrationPerformanceEvidence: { version: "narration-performance-evidence/v1", source: "local_ffmpeg", durationSec: 4, wordCount: 8, wordsPerSec: 2, integratedLufs: -18, windowMeanDb: -20 },
    sentenceTimings: [{ text: draft.narrationText, start: 0, end: 4 }], chapterPlan: [] };
  // Explicit synthetic integrity fixture, NOT a claim that this tone speaks math.
  // The separate actual-TTS-caller test proves fresh emission after final local evidence/upload.
  const sequence = draft.narrationText.replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z"'“‘])/).map((s) => s.trim()).filter(Boolean);
  outputs.workedExampleAudioBinding = createWorkedExampleAudioBinding({ ...base, params, store }, outputs, sequence, audio);
  return { preparation, draft, approval, store, outputs };
}
const current = fixture(request), stale = fixture(staleRequest);
const entries = [{ block: "worked_example_prepare" }, { block: "worked_example_script" }, { block: "qa_script" }, { block: "narration_tts", params }];
let providerCalls = 0, storageCalls = 0;
const savedFetch = globalThis.fetch;
globalThis.fetch = async () => { providerCalls++; throw new Error("provider/network transport forbidden in resume tests"); };

async function attempt(name: string, options: {
  qa?: BlockPatch; speech?: BlockPatch; seed?: unknown; params?: Record<string, unknown>;
  materialize?: "good" | "bad" | "missing" | "outage"; ordinary?: boolean; noRehydrator?: boolean;
  extraStore?: Record<string, unknown>; ttsOnly?: boolean; scope?: Partial<typeof base>;
} = {}, success = false) {
  const writes: Parameters<RunStageSink["upsert"]>[0][] = [], persisted: Array<{ producer: string; payload: unknown }> = [], demands: Array<{ block: string; keys: string[] }> = [];
  const speech = structuredClone(options.speech ?? current.outputs);
  if (options.materialize) speech.narrationLocalPath = join(root, `${name}-missing.mp3`);
  const qa = structuredClone(options.qa ?? current.approval);
  if (options.ordinary) { delete speech.workedExampleAudioBinding; delete qa.workedExampleEditorialApproval; }
  const completed = [
    ...options.ordinary ? [] : [{ block: "worked_example_prepare", outputs: { workedExamplePreparation: stale.preparation }, cost: 0 }, { block: "worked_example_script", outputs: stale.draft, cost: 0 }],
    { block: "qa_script", outputs: qa, cost: 0.003 }, { block: "narration_tts", outputs: speech, cost: 0.42 },
  ];
  const before = structuredClone(completed), beforeBytes = readFileSync(path);
  const storage: RehydrationStorage = {
    async getObjectToFile(key, local) { storageCalls++; assert.equal(key, speech.narrationKey);
      if (options.materialize === "outage") throw new Error("network timeout fixture");
      if (options.materialize === "missing") throw Object.assign(new Error("not found"), { status: 404 });
      writeFileSync(local, options.materialize === "bad" ? Buffer.alloc(audio.length, 7) : audio); return local; },
    async headObjectMetadata() { storageCalls++; return { contentLength: audio.length, metadata: {} }; },
  };
  let result: Awaited<ReturnType<typeof runPipeline>> | undefined, caught: unknown;
  const selected = options.ttsOnly ? entries.slice(3) : options.ordinary ? entries.slice(2) : entries;
  const selectedEntries = selected.map((entry) => entry.block === "narration_tts" ? { ...entry, params: options.params ?? params } : entry);
  try {
    const seedStore = { ...options.ttsOnly ? current.store : options.ordinary ? { narrationText: "Ordinary narration.", script: { hook: "Ordinary" } } : { workedExampleRequest: options.seed ?? request }, ...options.extraStore };
    result = await runPipeline(validatePipeline(selectedEntries, Object.keys(seedStore)), {
      ...base, ...options.scope, seedStore,
      sink: { async upsert(row) { writes.push(row); }, async getCompleted() { return completed; },
        async upsertArtifacts(row) { persisted.push(...row.artifacts.map((artifact) => ({ producer: artifact.artifact.producerModule, payload: artifact.payload }))); } },
      ...options.noRehydrator ? {} : { rehydrate: async (block: string, outputs: Record<string, unknown>, demand?: Parameters<typeof rehydrateOutputsWithStorage>[3]) => {
        demands.push({ block, keys: [...(demand?.neededOutputKeys ?? [])].sort() });
        return rehydrateOutputsWithStorage(block, outputs, request.runId, demand, storage);
      } }, log: () => {},
    });
  } catch (error) { caught = error; }
  if (success) {
    assert.equal(caught, undefined, `${name}: ${String(caught)}`); assert.equal(result?.ok, true, result?.error);
    assert.equal(result.costTotal, 0.423); assert.deepEqual(result.store.narrationTranscriptText, speech.narrationTranscriptText);
    assert.equal(writes.filter((row) => row.block === "narration_tts").length, 1);
    assert.equal(writes.find((row) => row.block === "narration_tts")?.cost, undefined);
    assert.ok(persisted.some((artifact) => artifact.producer === "narration_tts"), "positive control proves the artifact-persistence spy observes the real producer");
    if (options.ordinary) {
      assert.deepEqual(demands, [{ block: "qa_script", keys: [] }, { block: "narration_tts", keys: [] }], "ordinary restore has no extra input or audio hydration");
      assert.deepEqual(result.store.narrationLocalPath, speech.narrationLocalPath);
      assert.equal(result.store.workedExampleAudioBinding, undefined);
    } else assert.ok(demands.find((demand) => demand.block === "narration_tts")?.keys.includes("narrationLocalPath"));
  } else {
    assert.ok(caught, `${name}: unsafe completed output was accepted`);
    assert.match(String(caught), /CACHED_OUTPUT_BINDING_REFUSED/);
    assert.equal(classifyExecutionError(caught).retryable, false);
    assert.equal(taskErrorForRetryPolicy(caught).error instanceof Error && (taskErrorForRetryPolicy(caught).error as Error).name, "AbortTaskRunError");
    assert.equal(writes.some((row) => row.block === "narration_tts"), false, "no paid-stage running/ok/failed overwrite");
    assert.equal(persisted.some((artifact) => artifact.producer === "narration_tts"), false);
    if (options.qa) { assert.equal(writes.some((row) => row.block === "qa_script"), false); assert.equal(persisted.some((artifact) => artifact.producer === "qa_script"), false); }
  }
  assert.deepEqual(completed, before, "prior completed outputs and paid cost receipts survive unchanged");
  assert.deepEqual(readFileSync(path), beforeBytes); assert.equal(providerCalls, 0);
  console.log(JSON.stringify({ case: name, accepted: success, providerCalls, demands, retainedOriginalCost: 0.423 }));
}

async function hookIsolation() {
  for (const paid of [false, true]) {
    let runs = 0;
    const block: Block = { id: `restore_hook_${paid}`, consumes: ["input"], produces: ["value"], paid, run: async () => { runs++; return { value: "new" }; },
      cachedOutputValidator: { prepare: (ctx) => {
        assert.deepEqual(Object.keys(ctx).sort(), ["channelId", "keyPrefix", "outputs", "ownerId", "params", "runId", "store"].sort());
        assert.throws(() => { (ctx.store.input as { nested: number }).nested = 99; });
        assert.throws(() => { (ctx.outputs.value as { nested: number }).nested = 99; });
        assert.throws(() => ctx.store.undeclared, /undeclared artifact read/);
        return [];
      }, validate: async () => { throw new Error("network timeout must still be terminal binding refusal"); } } };
    registerManifest(manifestFromBlock(block));
    let writes = 0;
    await assert.rejects(() => runPipeline(validatePipeline([{ block: block.id }], ["input"]), { ...base, seedStore: { input: { nested: 1 } },
      sink: { async upsert() { writes++; }, async getCompleted() { return [{ block: block.id, outputs: { value: { nested: 1 } }, cost: paid ? 0.2 : 0.003 }]; } },
      rehydrate: async (_id, outputs) => ({ ok: true, outputs }), log: () => {},
    }), /CACHED_OUTPUT_BINDING_REFUSED/);
    assert.equal(runs, 0); assert.equal(writes, 0);
  }
}
async function main() {
  if (process.argv.includes("--stitch-mode-control")) {
    const captured = elevenLabsV3StitchEnabled();
    const initialFingerprint = (current.outputs.workedExampleAudioBinding as { inputFingerprint: string }).inputFingerprint;
    process.env.ELEVENLABS_V3_STITCH = captured ? "0" : "1";
    assert.equal(elevenLabsV3StitchEnabled(), captured, "accessor reads the actual captured provider mode, not changed process.env");
    const laterFingerprint = (fixture(request).outputs.workedExampleAudioBinding as { inputFingerprint: string }).inputFingerprint;
    assert.equal(initialFingerprint, laterFingerprint);
    process.env.ELEVENLABS_API_KEY = "synthetic-captured-mode-control";
    let body: Record<string, unknown> | undefined;
    globalThis.fetch = async (url, init) => {
      assert.match(String(url), /^https:\/\/api.elevenlabs.io\/v1\/text-to-speech\//);
      body = JSON.parse(String(init?.body)); return new Response(new Uint8Array(audio));
    };
    await synthNarration({ text: "This is a captured synthesis mode control.", provider: "elevenlabs", elevenVoiceId: "explicit-control", stitch: { previousText: "Previous take.", nextText: "Next take." } });
    assert.equal(Object.hasOwn(body!, "previous_text"), captured);
    assert.equal(Object.hasOwn(body!, "next_text"), captured);
    console.log(JSON.stringify({ captured, initialFingerprint })); return;
  }
  registerAllBlocks();
  assert.equal(stale.preparation.derivation.answer, "401"); assert.equal(current.preparation.derivation.answer, "-175");
  const manifest = getManifest("narration_tts")!;
  assert.deepEqual([...Object.keys(manifest.consumes), ...Object.keys(manifest.optionalConsumes)].sort(), [...WORKED_EXAMPLE_TTS_INPUT_KEYS].sort());
  assert.doesNotThrow(() => validateArtifact(artifactContract("workedExampleAudioBinding"), current.outputs.workedExampleAudioBinding));
  assert.throws(() => validateArtifact(artifactContract("workedExampleAudioBinding"), { ...current.outputs.workedExampleAudioBinding as object, unrecognized: true }));
  await attempt("stale-qa-and-speech-401", { qa: stale.approval, speech: stale.outputs });
  await attempt("current-qa-stale-speech-401", { speech: stale.outputs });
  const legacy = structuredClone(current.outputs); delete legacy.workedExampleAudioBinding;
  await attempt("legacy-no-audio-binding", { speech: legacy });
  await attempt("legacy-boolean-qa", { qa: { scriptApproved: true } });
  await attempt("no-rehydrator", { noRehydrator: true });
  for (const changed of [{ voiceId: "changed" }, { ttsProvider: "elevenlabs" }, { language: "fr" }, { ttsSpeed: 0.8 }, { chapterCards: true }, { voiceFx: "radio" }, { qwenInstruction: "different delivery" }, { sentenceGapSec: 0.5 }]) {
    await attempt(`changed-${Object.keys(changed)[0]}`, { params: { ...params, ...changed } });
  }
  for (const extraStore of [{ voiceId: "changed-store-voice" }, { niche: "meditation" }, { styleDNA: { narrative: { pacing: "slow", delivery: "gentle" } } }, { musicBrief: { audio: { voiceFx: "radio" } } }]) {
    await attempt(`changed-input-${Object.keys(extraStore)[0]}`, { extraStore });
  }
  for (const scope of [{ ownerId: "foreign-owner" }, { channelId: "foreign-channel" }, { runId: "foreign-run" }, { keyPrefix: "owners/foreign/" }]) {
    await attempt(`foreign-active-${Object.keys(scope)[0]}`, { ttsOnly: true, scope });
  }
  for (const key of ["narrationKey", "narrationDurationSec", "narrationTranscriptText", "sentenceTimings", "chapterPlan"]) {
    const speech = structuredClone(current.outputs); speech[key] = key === "narrationDurationSec" ? 5 : key === "sentenceTimings" ? [] : key === "chapterPlan" ? [{ kind: "card", durSec: 1, heading: "Changed" }] : "different";
    await attempt(`changed-${key}`, { speech });
  }
  await attempt("current-metadata-old-bytes", { materialize: "bad" });
  await attempt("missing-audio", { materialize: "missing" });
  await attempt("storage-outage", { materialize: "outage" });
  const corrupted = join(root, "corrupted.mp3"); writeFileSync(corrupted, Buffer.alloc(audio.length, 9));
  await attempt("existing-byte-corruption", { speech: { ...current.outputs, narrationLocalPath: corrupted } });
  await attempt("unchanged-local", {}, true);
  await attempt("unchanged-download", { materialize: "good" }, true);
  await attempt("ordinary-qa-and-paid-tts", { ordinary: true }, true);
  await hookIsolation();
  const modes = ["0", "1"].map((mode) => JSON.parse(execFileSync(join(process.cwd(), "node_modules/.bin/tsx"), ["--tsconfig", "tsconfig.json", "src/engine/__tests__/workedExampleAudioResume.test.ts", "--stitch-mode-control"], {
    cwd: process.cwd(), env: { ...process.env, ELEVENLABS_V3_STITCH: mode }, encoding: "utf8",
  })) as { captured: boolean; initialFingerprint: string });
  assert.deepEqual(modes.map((mode) => mode.captured), [false, true]);
  assert.notEqual(modes[0]!.initialFingerprint, modes[1]!.initialFingerprint, "changed actual stitching mode invalidates the arithmetic synthesis binding");
  console.log(JSON.stringify({ evidence: root, actualRunnerAndRehydrator: "PASS", liveProviderCalls: providerCalls, guardedStorageCalls: storageCalls }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => { globalThis.fetch = savedFetch; });
