import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { synthNarration, hasFishKey } from "../tts";
import { EngineFishReceiptSchema, engineFishRequest, type EngineFishReceipt } from "../fishEngine";
import { STUDIO_ENGINE_AUDIO_WORKFLOWS, STUDIO_ENGINE_PROJECT, STUDIO_ENGINE_BUCKET } from "../studioRenderEngineWorkflows";
import { narrationTtsCost } from "../../engine/pricing";

const referenceSha = "c".repeat(64), reference = { sha256: referenceSha,
  objectKey: `projects/${STUDIO_ENGINE_PROJECT}/assets/voices/sha256/${referenceSha}.wav`, text: "The owned reference transcript." };
const audio = Buffer.alloc(44 + 2 * 44100 * 2);
audio.write("RIFF", 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write("WAVE", 8);
audio.write("fmt ", 12); audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(44100, 24); audio.writeUInt32LE(88200, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
audio.write("data", 36); audio.writeUInt32LE(audio.length - 44, 40);
for (let frame = 0; frame < 88200; frame++) audio.writeInt16LE(Math.round(Math.sin(frame / 17) * 8000), 44 + frame * 2);
const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const input = { text: "The episode's exact approved sentence.", provider: "fish", fishEngineReference: reference,
  fishMaxCostUsd: 0.1, engineRequestScope: "owner:channel:run:narration" };

test("real narration seam uses one owned Fish Engine job, encodes actual WAV and preserves reference, scope and settled usage", async () => {
  const env = { ...process.env }, originalFetch = globalThis.fetch;
  try {
    delete process.env.RENDER_MANAGEMENT_API_KEY; process.env.FISH_AUDIO_API_KEY = "retired-provider-key";
    assert.equal(hasFishKey(), false);
    process.env.RENDER_MANAGEMENT_API_KEY = "f".repeat(64);
    const workflow = STUDIO_ENGINE_AUDIO_WORKFLOWS["fish-audio-s2-pro"], jobId = "d".repeat(32);
    const output = { bucket: STUDIO_ENGINE_BUCKET, key: `projects/${STUDIO_ENGINE_PROJECT}/jobs/${jobId}/output.wav`,
      bytes: audio.length, sha256: hash(audio), contentType: "audio/wav", verifiedAt: 123 };
    let posts = 0, authority = 0, manifestSha256 = "", complete = true, costUsd = 0.02;
    globalThis.fetch = async (url, init) => {
      assert.equal(init?.redirect, "error");
      if (String(url).endsWith("/fish-s2-pro-jobs")) {
        posts++;
        const value = JSON.parse(String(init?.body));
        assert.equal(value.workflowId, workflow.workflowId);
        assert.deepEqual(value.request.reference, reference);
        assert.equal(value.request.text, input.text);
        assert.equal(value.request.maxCostUsd, 0, "legacy field is not a fictitious spend cap");
        assert.equal(value.request.output.sampleRateHz, 44100);
        manifestSha256 = hash(JSON.stringify(value.request));
        return Response.json({ jobId, state: "queued", manifestSha256 });
      }
      if (String(url).includes("/jobs/output?")) return Response.json({ ...output,
        url: "https://account.r2.cloudflarestorage.com/fish.wav?signature=fixture" });
      if (String(url).includes("/jobs?")) return Response.json({ jobId, workflowId: workflow.workflowId, profileId: "fish-audio-s2-pro",
        requestSha256: manifestSha256, status: "completed", outputRetired: false, output, usage: { gpuSeconds: 3, costUsd, complete } });
      assert.equal(String(url), "https://account.r2.cloudflarestorage.com/fish.wav?signature=fixture");
      return new Response(audio);
    };
    let receipt: EngineFishReceipt | undefined;
    const bytes = await synthNarration({ ...input, engineAuthorize: async () => { authority++; }, onFishReceipt: value => { receipt = value; } });
    assert.ok(bytes.length > 1000); assert.equal(posts, 1); assert.ok(authority >= 3);
    assert.ok(receipt); assert.equal(receipt.audioSha256, hash(bytes)); assert.equal(receipt.referenceSha256, referenceSha);
    assert.equal(receipt.voiceId, `engine-fish:${referenceSha}`); assert.equal(receipt.durationSec, 2);
    assert.equal(EngineFishReceiptSchema.safeParse(receipt).success, true);
    assert.equal(EngineFishReceiptSchema.safeParse({ ...receipt, referenceTextSha256: "0".repeat(64) }).success, false);
    assert.equal(narrationTtsCost("fish", 10000, 0, 0, receipt.runtime.costUsd), 0.02);
    assert.throws(() => narrationTtsCost("fish", 10, 0, 0, NaN));
    await assert.rejects(synthNarration({ ...input, speed: 0.9 }), /speaking-rate/);
    await assert.rejects(synthNarration({ ...input, voiceId: "sleepless_historian" }), /Hosted Fish/);
    await assert.rejects(synthNarration({ text: "No implicit voice", provider: "fish" }));
    assert.equal(posts, 1, "unsupported or missing voice settings fail before paid submission");
    complete = false;
    await assert.rejects(synthNarration(input), error => (error as { engineJobId?: string }).engineJobId === jobId);
    complete = true; costUsd = 0.2;
    await assert.rejects(synthNarration(input), error => (error as { additionalObservedCostUsd?: number }).additionalObservedCostUsd === 0.2);
    posts = 0;
    globalThis.fetch = async () => { posts++; throw new TypeError("lost response"); };
    await assert.rejects(synthNarration(input), error => !!(error as { requestKey?: string }).requestKey &&
      (error as { code?: string }).code === "PAID_STAGE_RECONCILIATION_REQUIRED");
    assert.equal(posts, 1, "unknown submission never purchases another take");
  } finally { globalThis.fetch = originalFetch; process.env = env; }
});

test("foreign reference bindings are refused before a native request is prepared", () => {
  assert.throws(() => engineFishRequest({ text: "Speech", reference: { ...reference,
    objectKey: `projects/sibling/assets/voices/sha256/${referenceSha}.wav` } }), /immutable voice import/);
});
