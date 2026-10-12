import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { StudioRenderEngineClient, STUDIO_ENGINE_BUCKET, STUDIO_ENGINE_PROJECT } from "../studioRenderEngineClient";
import { executeStudioEngineAudio, type StudioEngineAudioRecovery } from "../studioRenderEngineAudio";
import { STUDIO_ENGINE_AUDIO_WORKFLOWS } from "../studioRenderEngineWorkflows";

const jobId = "a".repeat(32), workflowId = STUDIO_ENGINE_AUDIO_WORKFLOWS["qwen3-tts"].workflowId, hash = "c".repeat(64);
const input = { model: "qwen3-tts", workflowId,
  request: { idempotencyKey: "studio:voice:immutable:001", profileRevisionSha256: STUDIO_ENGINE_AUDIO_WORKFLOWS["qwen3-tts"].profileRevisionSha256,
    text: "Accepted script", output: { contentType: "audio/wav" } } };
const bytes = Buffer.from("exact native fixture");
const output = { bucket: STUDIO_ENGINE_BUCKET, key: `projects/${STUDIO_ENGINE_PROJECT}/outputs/audio.wav`, bytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"), contentType: "audio/wav", verifiedAt: 123 };
const admission = { jobId, state: "queued", manifestSha256: hash };

function fixture(options: { retire?: boolean; wrongWorkflow?: boolean; waiting?: boolean } = {}) {
  let submits = 0, observations = 0;
  const client = new StudioRenderEngineClient("f".repeat(64), async (url, init) => {
    if (init?.method === "POST") { submits++; return Response.json(admission, { status: 202 }); }
    if (String(url).includes("/jobs/output?")) return Response.json({ ...output,
      url: "https://account.r2.cloudflarestorage.com/audio.wav?signature=fixture" });
    if (String(url).includes("/jobs?")) {
      observations++;
      return Response.json({ jobId, workflowId: options.wrongWorkflow ? jobId : workflowId, profileId: "qwen3-tts",
        requestSha256: hash, status: options.waiting || observations === 1 ? "waiting-for-capacity" : "completed",
        outputRetired: !!options.retire && observations >= 3, output });
    }
    return new Response(bytes);
  });
  return { client, counts: () => ({ submits, observations }) };
}

test("one admission and checkpointed waits reach a twice-verified project output", async () => {
  const f = fixture();
  let accepted: StudioEngineAudioRecovery | undefined;
  const waits: string[] = [];
  let checks = 0;
  const result = await executeStudioEngineAudio(input, { client: f.client, authorize: async () => { checks++; },
    wait: async (seconds, key) => { assert.equal(seconds, 30); waits.push(key); },
    onAccepted: async value => { accepted = value; }, maxObservations: 3 });
  assert.deepEqual(result.output, output);
  assert.deepEqual(Buffer.from(result.bytes), bytes);
  assert.ok(!("url" in result.output), "temporary signed capabilities are never persisted");
  assert.equal(f.counts().submits, 1);
  assert.equal(f.counts().observations, 3);
  assert.equal(waits.length, 1);
  assert.equal(checks, 3);
  assert.ok(accepted);
  const resumed = fixture();
  await executeStudioEngineAudio(input, { client: resumed.client, recovery: accepted, authorize: async () => undefined,
    wait: async () => undefined, onAccepted: async () => undefined, maxObservations: 3 });
  assert.equal(resumed.counts().submits, 0, "recovery observes the saved admission without submitting again");
  await assert.rejects(executeStudioEngineAudio({ ...input, request: { ...input.request, text: "Changed script" } },
    { client: resumed.client, recovery: accepted, authorize: async () => undefined, wait: async () => undefined,
      onAccepted: async () => undefined }), /input changed/);
});

test("expired authority prevents submission; mismatched or retired output cannot complete", async () => {
  const f = fixture();
  const common = { wait: async () => undefined, onAccepted: async () => undefined, maxObservations: 3 };
  await assert.rejects(executeStudioEngineAudio(input, { ...common, client: f.client,
    authorize: async () => { throw new Error("expired lease"); } }), /expired lease/);
  assert.equal(f.counts().submits, 0);
  await assert.rejects(executeStudioEngineAudio(input, { ...common, client: fixture({ wrongWorkflow: true }).client,
    authorize: async () => undefined }), /identity changed/);
  await assert.rejects(executeStudioEngineAudio(input, { ...common, client: fixture({ retire: true }).client,
    authorize: async () => undefined }), /retired or replaced/);
});

test("capacity waits exhaust a bound with the same recoverable job, without resubmission", async () => {
  const f = fixture({ waiting: true });
  await assert.rejects(executeStudioEngineAudio(input, { client: f.client, authorize: async () => undefined,
    wait: async () => undefined, onAccepted: async () => undefined, maxObservations: 2 }), error => {
      const failure = error as Error & { engineJobId: string; retryable: boolean; recovery: StudioEngineAudioRecovery };
      assert.match(failure.message, /remains pending/);
      assert.equal(failure.engineJobId, jobId);
      assert.equal(failure.retryable, false);
      assert.deepEqual(failure.recovery.admission, admission);
      return true;
    });
  assert.deepEqual(f.counts(), { submits: 1, observations: 2 });
});

test("an accepted job remains recoverable when saving its admission fails", async () => {
  const f = fixture();
  await assert.rejects(executeStudioEngineAudio(input, { client: f.client, authorize: async () => undefined,
    wait: async () => undefined, onAccepted: async () => { throw new Error("receipt store unavailable"); } }), error => {
      const failure = error as Error & { engineJobId: string; submissionMayExist: boolean; recovery: StudioEngineAudioRecovery };
      assert.match(failure.message, /receipt store unavailable/);
      assert.equal(failure.engineJobId, jobId);
      assert.equal(failure.submissionMayExist, true);
      assert.deepEqual(failure.recovery.admission, admission);
      return true;
    });
  assert.deepEqual(f.counts(), { submits: 1, observations: 0 });
});
