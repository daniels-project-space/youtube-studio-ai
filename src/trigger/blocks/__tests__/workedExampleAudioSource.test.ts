import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import vm from "node:vm";
import ts from "typescript";
import { COST_PATCH_KEY, type Block, type StageContext, type RunStageSink } from "@/engine/types";
import { registerAllBlocks } from "@/engine/blocks";
import { runPipeline } from "@/engine/runner";
import { validatePipeline } from "@/engine/validate";
import { rehydrateOutputsWithStorage } from "@/lib/rehydrate";
import { prepareWorkedExample, type WorkedExampleRequest } from "@/engine/workedExample";
import { draftWorkedExampleNarration, workedExampleEditorialApprovalFor } from "@/engine/workedExampleNarration";
import { assertWorkedExampleAudioBytes, WorkedExampleAudioBindingSchema } from "@/engine/workedExampleAudioBinding";
import { artifactContract, validateArtifact } from "@/engine/artifactSchemas";
import { probe } from "@/lib/ffmpeg";

const repo = process.cwd(), requireLocal = createRequire(join(repo, "src/trigger/blocks/narratedBlocks.ts"));
const root = mkdtempSync(join(tmpdir(), "ysa-arithmetic-audio-source-"));
const sourcePath = join(repo, "src/trigger/blocks/narratedBlocks.ts");
const originalEnv = { ...process.env }, originalFetch = globalThis.fetch;
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const audioFor = new Map<string, { bytes: Buffer; duration: number }>();
let requests: Array<{ url: string; body: string }> = [], uploads: Array<{ key: string; bytes: Buffer }> = [], records = 0, afterUpload = false;
let uploadFailure = false;

/** Real local MP3 tone transport fixture, explicitly not speech or a pronunciation pass. */
function takeFor(text: string) {
  const cached = audioFor.get(text); if (cached) return cached;
  const file = join(root, `take-${digest(text)}.mp3`), duration = Math.max(0.8, text.split(/\s+/).length / 2.8);
  const frequency = 320 + [...text].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 400;
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `sine=frequency=${frequency}:duration=${duration}`, "-c:a", "libmp3lame", "-b:a", "128k", file]);
  const take = { bytes: readFileSync(file), duration }; audioFor.set(text, take); return take;
}

function actualBlock(path: string): Block {
  const source = readFileSync(path, "utf8"), compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const mod = { exports: {} as { narrationTts: Block } };
  const guardedRequire = (name: string) => {
    if (name === "@/lib/storage") return { ...requireLocal(name), putObject: async (key: string, bytes: Uint8Array, options: unknown) => {
      assert.deepEqual(options, { contentType: "audio/mpeg" });
      assert.ok(requests.length > 0, "uploaded audio comes after actual guarded provider completion");
      if (uploadFailure) throw new Error("guarded upload failure after accepted TTS");
      uploads.push({ key, bytes: Buffer.from(bytes) }); afterUpload = true;
    } };
    if (name === "@/lib/studioConvexHttpClient") return { StudioConvexHttpClient: class {
      async mutation() { assert.equal(afterUpload, true); records++; }
    } };
    return requireLocal(name);
  };
  // Execute the actual module source, not a reconstructed TTS function; replace only external storage/DB transport.
  const load = new vm.Script(`(function(require,module,exports){${compiled}\n})`, { filename: path }).runInThisContext();
  load(guardedRequire, mod, mod.exports); return mod.exports.narrationTts;
}
const request: WorkedExampleRequest = { policy: "worked-example/integer-v1", ownerId: "owner-a", channelId: "channel-a", runId: "run-a", requestId: "request-current", seed: "seed-current", operations: ["multiply", "add"] };
const preparation = prepareWorkedExample(request), draft = draftWorkedExampleNarration(preparation, request);
const base = { ownerId: request.ownerId, channelId: request.channelId, runId: request.runId, keyPrefix: "owners/owner-a/", budgetUsd: 10, stageBudgetUsd: 10, log: () => {} };

async function run(block: Block, provider: string, chapterCards: boolean, ordinary = false) {
  requests = []; uploads = []; records = 0; afterUpload = false;
  const params = { ttsProvider: provider, qualityProfile: "draft", voiceGate: false, voiceId: "explicit-fixture-voice", elevenVoiceId: "explicit-fixture-voice", qwenSpeaker: "Ryan", language: "English", ttsSpeed: 1, chapterCards, chapterPreSec: 0.4, chapterPostSec: 0.4 };
  const script = ordinary ? { hook: draft.script.hook, sections: draft.script.sections, narrationText: draft.narrationText, estDurationSec: draft.script.estDurationSec } : draft.script;
  const store = { script, narrationText: draft.narrationText, scriptApproved: true,
    ...ordinary ? {} : { workedExampleRequest: request, workedExamplePreparation: preparation, workedExampleEditorialApproval: workedExampleEditorialApprovalFor(draft.script) } };
  const ctx: StageContext = { ...base, params, store };
  const outputs = await block.run(ctx);
  assert.equal(uploads.length, 1); assert.equal(records, 1);
  const uploaded = uploads[0]!;
  assert.deepEqual(readFileSync(String(outputs.narrationLocalPath)), uploaded.bytes, "exact uploaded bytes are the returned local source, after final assembly/FX");
  const measured = await probe(String(outputs.narrationLocalPath));
  assert.equal(measured.hasAudio, true); assert.equal(outputs.narrationDurationSec, measured.durationSec);
  const evidence = outputs.narrationPerformanceEvidence as { source: string; durationSec: number };
  assert.equal(evidence.source, "local_ffmpeg"); assert.equal(evidence.durationSec, measured.durationSec);
  if (ordinary) assert.equal(outputs.workedExampleAudioBinding, undefined, "ordinary output payload stays unchanged");
  else {
    const binding = WorkedExampleAudioBindingSchema.parse(outputs.workedExampleAudioBinding);
    assert.equal(binding.artifact.sha256, digest(uploaded.bytes)); assert.equal(binding.artifact.byteLength, uploaded.bytes.length);
    assert.equal(binding.artifact.key, uploaded.key);
    const actualTexts = requests.map((item) => JSON.parse(item.body).text);
    assert.deepEqual(binding.spokenSequence, actualTexts, "binding sequence is exactly what all actual provider branches received");
    assert.equal(binding.spokenSequence.some((text) => text.startsWith("Chapter ")), chapterCards);
    if (chapterCards) assert.ok(binding.spokenSequence.includes("Chapter 1: Step 2."));
    assert.doesNotThrow(() => validateArtifact(artifactContract("workedExampleAudioBinding"), binding));
    await assertWorkedExampleAudioBytes({ ...ctx, outputs }, binding.spokenSequence);
    const changed = { ...ctx, params: { ...params, ttsSpeed: 0.9 }, outputs };
    await assert.rejects(() => assertWorkedExampleAudioBytes(changed, binding.spokenSequence), /synthesis inputs/);
    const bad = join(root, `corrupt-${provider}-${chapterCards}.mp3`); writeFileSync(bad, Buffer.alloc(uploaded.bytes.length, 11));
    await assert.rejects(() => assertWorkedExampleAudioBytes({ ...ctx, outputs: { ...outputs, narrationLocalPath: bad } }, binding.spokenSequence), /bytes differ/);
    const originalCalls = requests.length, writes: Parameters<RunStageSink["upsert"]>[0][] = [];
    const resumed = await runPipeline(validatePipeline([{ block: "narration_tts", params }], Object.keys(store)), {
      ...base, seedStore: store,
      sink: { async upsert(row) { writes.push(row); }, async getCompleted() { return [{ block: "narration_tts", outputs, cost: Number(outputs[COST_PATCH_KEY]) }]; } },
      rehydrate: (id, patch, demand) => rehydrateOutputsWithStorage(id, patch, request.runId, demand, {
        async getObjectToFile() { throw new Error("present fresh local bytes must not download"); },
        async headObjectMetadata() { throw new Error("present fresh local bytes must not HEAD"); },
      }),
    });
    assert.equal(resumed.ok, true, resumed.error); assert.equal(resumed.costTotal, outputs[COST_PATCH_KEY]);
    assert.deepEqual(resumed.store.workedExampleAudioBinding, outputs.workedExampleAudioBinding);
    assert.equal(requests.length, originalCalls, "actual fresh completion resumes through the registered runner without buying another take");
    assert.equal(writes.length, 1); assert.equal(writes[0]!.status, "ok"); assert.equal(writes[0]!.cost, undefined);
    writeFileSync(join(root, `${provider}-${chapterCards ? "chapter" : "sentence"}-fresh.json`), JSON.stringify({
      scope: { ownerId: ctx.ownerId, channelId: ctx.channelId, runId: ctx.runId, keyPrefix: ctx.keyPrefix }, params, store, outputs,
      note: "Actual caller completion with synthetic tone transport, not speech/pronunciation/editorial evidence.",
    }, null, 2));
  }
  const portable = { ...outputs }; delete portable.narrationLocalPath;
  return { requests: structuredClone(requests), outputs: portable, uploadedSha256: digest(uploaded.bytes), durationSec: measured.durationSec };
}

async function main() {
  registerAllBlocks();
  Object.assign(process.env, { FISH_AUDIO_API_KEY: "synthetic-not-a-real-key", ELEVENLABS_API_KEY: "synthetic-not-a-real-key", NEXT_PUBLIC_CONVEX_URL: "https://guarded.invalid", TTS_CONCURRENCY: "1", QWEN3_TTS_WORKER_URL: "https://guarded.invalid/synthesize", QWEN3_TTS_WORKER_TOKEN: "synthetic-not-a-real-worker-token-0000000000" });
  globalThis.fetch = async (url, init) => {
    const target = String(url), raw = String(init?.body);
    assert.ok(target === "https://api.fish.audio/v1/tts" || target.startsWith("https://api.elevenlabs.io/v1/text-to-speech/") || target === "https://guarded.invalid/synthesize", `unapproved network boundary ${target}`);
    requests.push({ url: target, body: raw });
    const payload = JSON.parse(raw), take = takeFor(payload.text);
    if (target === "https://guarded.invalid/synthesize") {
      assert.equal(new Headers(init?.headers).get("Idempotency-Key"), payload.requestKey);
      const response = execFileSync("python3", [join(repo, "workers/qwen3-tts/contract.py"), "--fixture"], {
        input: JSON.stringify({ payload, idempotencyKey: payload.requestKey, audioBase64: take.bytes.toString("base64"), durationSec: take.duration, requestGpuSeconds: 10, gpuRateUsdPerSecond: 0.00005 }), encoding: "utf8" });
      return Response.json(JSON.parse(response));
    }
    return new Response(new Uint8Array(take.bytes), { headers: { "content-type": "audio/mpeg", "request-id": `fixture-${requests.length}` } });
  };
  const block = actualBlock(sourcePath);
  const baseline = process.env.ARITHMETIC_AUDIO_BASELINE_SOURCE ? actualBlock(process.env.ARITHMETIC_AUDIO_BASELINE_SOURCE) : undefined;
  const results: unknown[] = [];
  for (const provider of ["fish", "elevenlabs", "qwen3"]) for (const chapter of [false, true]) {
    const fresh = await run(block, provider, chapter);
    const ordinary = await run(block, provider, chapter, true);
    assert.deepEqual(fresh.requests, ordinary.requests, "arithmetic byte binding does not change provider request bytes");
    if (baseline) {
      const before = await run(baseline, provider, chapter, true);
      assert.deepEqual(ordinary.requests, before.requests, "raw HTTP URL/body bytes identical to frozen pre-edit actual caller");
      assert.deepEqual(ordinary.outputs, before.outputs, "ordinary output metadata/cost payload unchanged");
      assert.equal(ordinary.uploadedSha256, before.uploadedSha256);
    }
    results.push({ provider, chapter, requests: fresh.requests.length, finalSha256: fresh.uploadedSha256, actualFfprobeDuration: fresh.durationSec, exactBeforeTransportParity: Boolean(baseline) });
  }
  uploadFailure = true;
  await assert.rejects(() => run(block, "fish", false), /guarded upload failure/);
  assert.equal(uploads.length, 0); assert.equal(records, 0);
  // A malformed input is refused before the first provider request, not after paying to discover it.
  requests = [];
  await assert.rejects(() => block.run({ ...base, params: { apiKey: "must-not-be-bound" }, store: { workedExampleRequest: request, workedExamplePreparation: preparation, ...draft, scriptApproved: true, workedExampleEditorialApproval: workedExampleEditorialApprovalFor(draft.script) } }), /credential-like/);
  assert.equal(requests.length, 0);
  console.log(JSON.stringify({ evidence: root, sourceSha256: digest(readFileSync(sourcePath)), results, freshUploadFailureEmitsNoBinding: true, liveProviderCalls: 0 }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});
