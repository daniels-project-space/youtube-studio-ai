import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { StudioEngineError, StudioRenderEngineClient, STUDIO_ENGINE_ERNIE_IMAGE_CONTRACT,
  STUDIO_ENGINE_PROJECT, STUDIO_ENGINE_BUCKET } from "../studioRenderEngineClient";
import { STUDIO_ENGINE_ERNIE_WORKFLOW } from "../studioRenderEngineWorkflows";

const token = "f".repeat(64), jobId = "b".repeat(32), hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const png = () => {
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(STUDIO_ENGINE_ERNIE_IMAGE_CONTRACT.width, 16);
  bytes.writeUInt32BE(STUDIO_ENGINE_ERNIE_IMAGE_CONTRACT.height, 20);
  return bytes;
};
const request = {
  version: 2 as const, idempotencyKey: "studio-ernie:immutable-candidate-01", sourceId: "studio:channel:item",
  candidates: [{ id: "s0-c0", prompt: "A detailed scene in the established channel visual identity", seed: 17,
    width: STUDIO_ENGINE_ERNIE_IMAGE_CONTRACT.width, height: STUDIO_ENGINE_ERNIE_IMAGE_CONTRACT.height }],
  output: { contentType: "image/png" as const }, maxCostUsd: 0.2,
  profileRevisionSha256: STUDIO_ENGINE_ERNIE_WORKFLOW.profileRevisionSha256,
  imageContract: STUDIO_ENGINE_ERNIE_IMAGE_CONTRACT,
  imageContractSha256: hash(STUDIO_ENGINE_ERNIE_IMAGE_CONTRACT),
};

test("Studio ERNIE pins the exact native workflow and only releases a matching qualified job", async () => {
  const calls: string[] = [];
  const client = new StudioRenderEngineClient(token, async (url, init) => {
    const path = String(url); calls.push(path);
    assert.ok(path.startsWith(`https://render-engine-sable.vercel.app/api/v1/projects/${STUDIO_ENGINE_PROJECT}/`));
    assert.equal(init?.redirect, "error");
    if (path.endsWith("/ernie-batches")) {
      assert.deepEqual(JSON.parse(String(init?.body)), { workflowId: STUDIO_ENGINE_ERNIE_WORKFLOW.workflowId, request });
      return Response.json({ jobId, state: "awaiting-final-qualification", manifestSha256: hash(request) });
    }
    if (path.endsWith("/jobs?jobId=" + jobId)) return Response.json({ jobId, workflowId: STUDIO_ENGINE_ERNIE_WORKFLOW.workflowId,
      profileId: "ernie-image", requestSha256: hash(request), status: "queued", outputRetired: false });
    if (path.endsWith("/ernie-batches/readiness?jobId=" + jobId)) return Response.json({ jobId, state: "awaiting-final-qualification",
      dispatchable: true, finalQualified: true, blockers: [] });
    if (path.endsWith("/ernie-batches/release")) {
      assert.deepEqual(JSON.parse(String(init?.body)), { jobId });
      return Response.json({ state: "queued", released: true }, { status: 202 });
    }
    throw new Error("unexpected Engine request");
  });
  const admission = await client.submitErnieBatch(request);
  assert.equal(admission.manifestSha256, hash(request));
  assert.equal((await client.observeErnieBatch(admission)).status, "queued");
  const readiness = await client.ernieBatchReadiness(admission.jobId);
  assert.equal(readiness.dispatchable, true);
  assert.equal((await client.releaseErnieBatch(admission.jobId, readiness)).released, true);
  assert.equal(calls.length, 4);
});

test("ambiguous ERNIE admission is surfaced for same-key reconciliation and never retried", async () => {
  let calls = 0;
  const client = new StudioRenderEngineClient(token, async () => { calls++; throw new Error("lost response"); });
  await assert.rejects(client.submitErnieBatch(request), (error) => error instanceof StudioEngineError && error.submissionMayExist);
  assert.equal(calls, 1);
});

test("ERNIE cannot release without matching, current qualification for the same job", async () => {
  let calls = 0;
  const client = new StudioRenderEngineClient(token, async () => { calls++; throw new Error("must not call"); });
  await assert.rejects(client.releaseErnieBatch(jobId, { jobId, dispatchable: false, finalQualified: false }), /requires the same job/);
  await assert.rejects(client.releaseErnieBatch(jobId, { jobId: "c".repeat(32), dispatchable: true }), /requires the same job/);
  assert.equal(calls, 0);
});

test("ERNIE output is copied only from a signed Studio-project receipt with exact bytes, hash, and native canvas", async () => {
  const image = png(), sha256 = createHash("sha256").update(image).digest("hex");
  let signedReads = 0;
  const client = new StudioRenderEngineClient(token, async (url, init) => {
    if (String(url).endsWith(`/ernie-batches/output?jobId=${jobId}`)) return Response.json({ bucket: STUDIO_ENGINE_BUCKET,
      imageContract: STUDIO_ENGINE_ERNIE_IMAGE_CONTRACT, imageContractSha256: hash(STUDIO_ENGINE_ERNIE_IMAGE_CONTRACT),
      candidates: [{ candidateId: "s0-c0", bucket: STUDIO_ENGINE_BUCKET,
        key: `projects/${STUDIO_ENGINE_PROJECT}/workflows/${STUDIO_ENGINE_ERNIE_WORKFLOW.workflowId}/jobs/${jobId}/outputs/candidates/s0-c0.png`,
        bytes: image.length, sha256, contentType: "image/png", verifiedAt: 123,
        url: "https://account.r2.cloudflarestorage.com/image.png?signature=fixture",
        requiredHeaders: { "If-Match": '"etag"' }, expiresInSeconds: 300 }] });
    signedReads++;
    assert.equal(init?.headers && (init.headers as Record<string, string>)["If-Match"], '"etag"');
    assert.equal(init?.headers && (init.headers as Record<string, string>).authorization, undefined);
    assert.equal(init?.redirect, "error");
    return new Response(image);
  });
  const output = await client.verifiedErnieBatchOutput({ jobId, state: "completed", manifestSha256: hash(request) }, "s0-c0");
  assert.equal(output.sha256, sha256);
  assert.deepEqual(Buffer.from(output.contentBytes), image);
  assert.equal(signedReads, 1);
  await assert.rejects(client.verifiedErnieBatchOutput({ jobId, state: "completed", manifestSha256: hash(request) }, "other"), /candidate receipt/);
});

test("ERNIE refuses a mismatched native image revision before network access", async () => {
  let calls = 0;
  const client = new StudioRenderEngineClient(token, async () => { calls++; throw new Error("must not call"); });
  await assert.rejects(client.submitErnieBatch({ ...request, imageContractSha256: "0".repeat(64) }));
  assert.equal(calls, 0);
});
