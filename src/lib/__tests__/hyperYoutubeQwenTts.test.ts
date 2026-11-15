import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createModelUsageScope } from "@/lib/modelUsage";
import { assertAnyQwenNarrationSourceBinding, createHrsQwenNarrationSourceEvidence } from "@/lib/hyperYoutubeQwenNarrationEvidence";
import { prepareHrsQwenTtsEnvironment, synthesizeHrsQwenTts } from "@/lib/hyperYoutubeQwenTts";
import { configuredHyperYoutubeStageClient, type HyperYoutubeJob } from "@/lib/hyperYoutubeStageClient";
import { getObjectBytes, putObject } from "@/lib/storage";

async function main() {
  const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const jobId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const environmentId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const environmentSha256 = "c".repeat(64);
  const audio = Buffer.from("verified HRS wav bytes");
  const audioSha256 = createHash("sha256").update(audio).digest("hex");
  const env = { id: environmentId, modelId: "qwen3-tts" as const, sha256: environmentSha256 };
  const outputs = new Map<string, Uint8Array>();
  const storage: { get: typeof getObjectBytes; put: typeof putObject } = {
    get: async (key, _bucket, _options) => {
      const bytes = outputs.get(key);
      if (!bytes) throw Object.assign(new Error("missing"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
      return bytes;
    },
    put: async (key, body, _options) => {
      if (outputs.has(key)) throw new Error("precondition failed");
      outputs.set(key, Buffer.from(body as Uint8Array));
      return key;
    },
  };
  let environmentCreates = 0, environmentLookups = 0, submissions = 0, wrongProject = false, wrongObject = false;
  let lastKey = "";
  const makeJob = (state = "completed"): HyperYoutubeJob => ({
    id: jobId, projectId: wrongProject ? "dddddddd-dddd-4ddd-8ddd-dddddddddddd" : projectId,
    modelId: "qwen3-tts", state, generation: 1, idempotencyKey: lastKey,
    environmentId, environmentSha256, outputDestination: { bucket: "youtube", projectPrefix: "projects/youtube/" },
    output: { projectId: wrongProject ? "dddddddd-dddd-4ddd-8ddd-dddddddddddd" : projectId,
      jobId, generation: 1, bucket: "youtube",
      key: wrongObject ? `projects/youtube/jobs/${jobId}/1/other.wav` : `projects/youtube/jobs/${jobId}/1/output.wav`,
      sha256: audioSha256, bytes: audio.byteLength, contentType: "audio/wav", available: true,
      downloadUrl: "https://r2.example/output" },
  });
  const client: ReturnType<typeof configuredHyperYoutubeStageClient> = {
    binding: async () => ({ baseUrl: "https://hrs.example", projectToken: "token", projectId,
      outputBucket: "youtube", outputPrefix: "projects/youtube/" }),
    createEnvironment: async () => { environmentCreates++; return env; },
    getEnvironment: async () => { environmentLookups++; return env; },
    submit: async (_stage, key) => { submissions++; lastKey = key; return makeJob(); },
    get: async (_id, _stage, key) => { lastKey = key; return makeJob(); },
    download: async () => audio,
  };
  const authorize = async () => undefined;
  const envScope = { ownerId: "owner", channelId: "channel", runId: "run", block: "narration_tts" };
  const usage = createModelUsageScope();
  await usage.run(async () => {
    const runEnvironment = await prepareHrsQwenTtsEnvironment({ scope: envScope, authorize, client, storage });
    assert.deepEqual(runEnvironment, env);
    const request = { scope: { ...envScope, mode: "sentence", ordinal: 0 }, text: "Hello there.", speaker: "Ryan" as const,
      language: "English" as const, instruct: "Warm, clear narration.", seed: 4242, environment: runEnvironment,
      authorize, client, storage, sleep: async () => undefined };
    const first = await synthesizeHrsQwenTts(request);
    const retried = await synthesizeHrsQwenTts(request);
    assert.deepEqual(first.bytes, audio);
    assert.equal(retried.receipt.jobId, first.receipt.jobId);
    assert.equal(retried.receipt.idempotencyKey, first.receipt.idempotencyKey);
    assert.equal(first.receipt.costStatus, "unreported");
    assert.equal(submissions, 1, "replay resumes the persisted HRS job instead of submitting another generation");
    assert.equal(environmentCreates, 1, "one pinned environment is reused for the whole narration run");
    assert.equal(environmentLookups, 1, "polling checks job identity against the cached environment pin without refetching it");

    const finalAudio = Buffer.alloc(2_048, 7);
    const evidence = createHrsQwenNarrationSourceEvidence({ speaker: "Ryan", language: "English",
      source: { narrationKey: "owner/run/narration.mp3",
        sha256: createHash("sha256").update(finalAudio).digest("hex"), byteLength: finalAudio.byteLength,
        durationSec: 3, transcriptSha256: createHash("sha256").update("Hello there.").digest("hex"),
        assembly: "concat_audio_with_gaps/v1", gapPlanSha256: "d".repeat(64), mode: "sentence", voiceFx: null },
      sourceChunks: [{ ordinal: 0, textSha256: first.receipt.textSha256, audioSha256: first.receipt.audioSha256,
        byteLength: first.receipt.byteLength, receipt: first.receipt }], preflightReceipts: [] });
    const bound = assertAnyQwenNarrationSourceBinding({ evidence, narrationKey: evidence.source.narrationKey,
      sourceAudio: finalAudio, transcript: "Hello there.", durationSec: 3 });
    assert.equal("costStatus" in bound ? bound.costStatus : "reported", "unreported");
    assert.throws(() => assertAnyQwenNarrationSourceBinding({ evidence, narrationKey: evidence.source.narrationKey,
      sourceAudio: finalAudio, transcript: "Changed transcript.", durationSec: 3 }), /does not bind/);
    assert.equal(usage.snapshot().unpricedCalls, 1, "the unique HRS dispatch is explicitly unpriced without double counting its replay");

    wrongProject = true;
    await assert.rejects(synthesizeHrsQwenTts({ ...request, scope: { ...envScope, mode: "sentence", ordinal: 1 },
      text: "Wrong project." }), /durable project checkpoint/);
    wrongProject = false; wrongObject = true;
    await assert.rejects(synthesizeHrsQwenTts({ ...request, scope: { ...envScope, mode: "sentence", ordinal: 2 },
      text: "Wrong object." }), /exact output object/);
  });

  const caller = await import("node:fs/promises").then(({ readFile }) => readFile("src/trigger/blocks/narratedBlocks.ts", "utf8"));
  assert.match(caller, /synthesizeHrsQwenTts\(/);
  assert.match(caller, /if \(ttsProvider === "qwen3"\)[\s\S]*?synthesizeHrsQwenTts/);
  const qwenRoute = caller.slice(caller.indexOf("const synthSelectedNarration"), caller.indexOf("const bindQwenProviderEvidence"));
  assert.match(qwenRoute, /assertInlinePaidExecutionLease/);
  assert.doesNotMatch(qwenRoute, /stageBudgetUsd|hasQualifiedQwenTts\(|hasQwenTtsConfig\(|COST_PATCH_KEY/);
  console.log("HRS Qwen3 narration adapter and evidence: ok");
}

void main();
