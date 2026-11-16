import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { STUDIO_ENGINE_AUDIO_WORKFLOWS, STUDIO_ENGINE_PROJECT, STUDIO_ENGINE_BUCKET } from "../../studioRenderEngineWorkflows";

export function qwenEngineFixture() {
  const rate = 24000, frames = rate * 2;
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++) wav.writeInt16LE(Math.round(3000 * Math.sin(frame * 2 * Math.PI * 233 / rate)), 44 + frame * 2);
  const workflow = STUDIO_ENGINE_AUDIO_WORKFLOWS["qwen3-tts"];
  let jobId = "a".repeat(32), manifestSha256 = "c".repeat(64);
  const output = { bucket: STUDIO_ENGINE_BUCKET, key: `projects/${STUDIO_ENGINE_PROJECT}/jobs/${jobId}/audio.wav`,
    bytes: wav.length, sha256: createHash("sha256").update(wav).digest("hex"), contentType: "audio/wav", verifiedAt: 123 };
  let submissions = 0, observations = 0;
  let completeUsage = true, costUsd = 0.04, failSubmission = false;
  let request: Record<string, unknown> | undefined;
  const fetchImpl: typeof fetch = async (url, init) => {
    const address = String(url);
    if (init?.method === "POST") {
      submissions++;
      assert.equal(address, `https://render-engine-sable.vercel.app/api/v1/projects/${STUDIO_ENGINE_PROJECT}/qwen3-tts-jobs`);
      assert.equal(new Headers(init.headers).get("x-worker-authorization"), null);
      assert.equal(new Headers(init.headers).get("x-api-key"), null);
      const body = JSON.parse(String(init.body));
      assert.equal(body.workflowId, workflow.workflowId);
      assert.equal(body.request.profileRevisionSha256, workflow.profileRevisionSha256);
      request = body.request;
      jobId = createHash("sha256").update(body.request.idempotencyKey).digest("hex").slice(0, 32);
      manifestSha256 = createHash("sha256").update(JSON.stringify(body.request)).digest("hex");
      output.key = `projects/${STUDIO_ENGINE_PROJECT}/jobs/${jobId}/audio.wav`;
      if (failSubmission) throw new Error("private credential transport error");
      return Response.json({ jobId, state: "completed", manifestSha256 }, { status: 202 });
    }
    if (address.includes("/jobs/output?")) return Response.json({ ...output,
      url: "https://account.r2.cloudflarestorage.com/native.wav?signature=fixture" });
    if (address.includes("/jobs?")) {
      observations++;
      return Response.json({ jobId, workflowId: workflow.workflowId, profileId: "qwen3-tts", requestSha256: manifestSha256,
        status: "completed", outputRetired: false, output, usage: { complete: completeUsage, costUsd, gpuSeconds: 40 } });
    }
    assert.equal(new Headers(init?.headers).get("authorization"), null);
    return new Response(wav);
  };
  return { wav, output, fetchImpl, request: () => request, counts: () => ({ submissions, observations }),
    setUsage: (complete: boolean, cost: number) => { completeUsage = complete; costUsd = cost; },
    failSubmission: () => { failSubmission = true; } };
}
