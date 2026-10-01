import assert from "node:assert/strict";
import test from "node:test";
import { prepareStudioErnieImages, erniePreparedDependencies } from "../studioPreparedErnieImages";
import { stageStudioErnieBatch, readStudioErnieOutputs, STUDIO_ERNIE_CONTRACT, type ErnieRequest } from "../renderEngineErnieClient";
import { sha256Hex } from "../sha256";
const payload = { ownerId: "owner", channelId: "channel", channelSlug: "channel", batchId: "batch", itemId: "item", manifestKey: "key", manifestSha256: "a".repeat(64), shots: [{ id: "shot", prompt: "A dramatic natural landscape" }], maxCostUsd: 2 };
const config = { workflowId: "w".repeat(32), projectCapability: "a".repeat(64) };
const batch: ErnieRequest = { version: 2, idempotencyKey: "studio-ernie-immutable", sourceId: "studio-source", candidates: [{ id: "s0-c0", prompt: "A real scene", seed: 1, width: 1376, height: 768 }], output: { contentType: "image/png" }, maxCostUsd: 2, profileRevisionSha256: STUDIO_ERNIE_CONTRACT.modelManifestSha256, imageContract: STUDIO_ERNIE_CONTRACT, imageContractSha256: sha256Hex(JSON.stringify(STUDIO_ERNIE_CONTRACT)) };

test("approved pixel floor stays pending without issuing HTTP or fabricating outputs", async () => {
  const frozen: unknown[] = [];
  const result = await prepareStudioErnieImages(payload, { ...erniePreparedDependencies, persist: async (_key, bytes) => { frozen.push(JSON.parse(Buffer.from(bytes).toString())); }, provision: async () => { throw new Error("Must not provision before geometry choice"); } });
  assert.equal(result.kind, "pending"); assert.equal(result.state, "awaiting-image-geometry-approval");
  assert.deepEqual(result.requestedGeometry, { width: 1920, height: 1088 });
  assert.equal(frozen.length, 1);
});

test("lost staging response retries immutable request and held Final never materializes images", async () => {
  const saved = new Map<string, string>(); let attempts = 0; const requests: ErnieRequest[] = [];
  const deps = { ...erniePreparedDependencies, persist: async (key: string, bytes: Uint8Array) => {
    const value = Buffer.from(bytes).toString(); if (saved.has(key)) assert.equal(saved.get(key), value); saved.set(key, value);
  }, provision: async () => config, stage: async (_config: unknown, request: ErnieRequest) => {
    requests.push(request); if (++attempts === 1) throw new Error("lost response after commit");
    return { jobId: "j".repeat(32), state: "awaiting-final-qualification", manifestSha256: sha256Hex(JSON.stringify(request)) };
  }, readiness: async (_config: unknown, receipt: { jobId: string; manifestSha256: string }, request: ErnieRequest) => ({ ...receipt, state: "awaiting-final-qualification", sourceId: request.sourceId, candidateCount: request.candidates.length }), outputs: async () => { throw new Error("Held job cannot read outputs"); } };
  const oldToken = process.env.RENDER_ENGINE_PROJECT_TOKEN, oldBucket = process.env.R2_BUCKET;
  process.env.RENDER_ENGINE_PROJECT_TOKEN = config.projectCapability; process.env.R2_BUCKET = "studio-bucket";
  try {
    const approved = { ...payload, approvedErnieNativeGeometry: "1376x768" as const };
    await assert.rejects(prepareStudioErnieImages(approved, deps), /lost response/);
    const result = await prepareStudioErnieImages(approved, deps);
    assert.equal(result.kind, "pending"); assert.equal(result.state, "awaiting-final-qualification");
    assert.deepEqual(requests[0], requests[1]); assert.equal(requests[0].maxCostUsd, payload.maxCostUsd);
    assert.ok(![...saved.keys()].some(key => key.endsWith(".png")));
  } finally { if (oldToken === undefined) delete process.env.RENDER_ENGINE_PROJECT_TOKEN; else process.env.RENDER_ENGINE_PROJECT_TOKEN = oldToken; if (oldBucket === undefined) delete process.env.R2_BUCKET; else process.env.R2_BUCKET = oldBucket; }
});

test("HTTP staging checks authenticated exact manifest digest and hides remote error bodies", async () => {
  await assert.rejects(stageStudioErnieBatch({ ...config, fetchImpl: async () => new Response("private detail", { status: 401 }) }, batch), /HTTP 401/);
  await assert.rejects(stageStudioErnieBatch({ ...config, fetchImpl: async () => Response.json({ jobId: "j".repeat(32), state: "awaiting-final-qualification", manifestSha256: "0".repeat(64) }) }, batch), /differs/);
  const result = await stageStudioErnieBatch({ ...config, fetchImpl: async (_url, init) => {
    assert.equal((init?.headers as Record<string,string>).authorization, `Bearer ${config.projectCapability}`);
    assert.deepEqual(JSON.parse(String(init?.body)).request, batch);
    return Response.json({ jobId: "j".repeat(32), state: "awaiting-final-qualification", manifestSha256: sha256Hex(JSON.stringify(batch)) });
  } }, batch);
  assert.equal(result.state, "awaiting-final-qualification");
});

test("Engine candidate output from sibling bucket is rejected before local R2 access", async () => {
  const receipt = { jobId: "j".repeat(32), state: "completed", manifestSha256: sha256Hex(JSON.stringify(batch)) };
  await assert.rejects(readStudioErnieOutputs({ ...config, fetchImpl: async () => Response.json({ candidates: [{ candidateId: "s0-c0", bucket: "sibling-bucket", key: "irrelevant" }] }) }, receipt, batch, "studio-bucket"), /outside project R2/);
});

test("completed Engine status alone cannot materialize hash-invalid project bytes", async () => {
  const oldToken = process.env.RENDER_ENGINE_PROJECT_TOKEN, oldBucket = process.env.R2_BUCKET;
  process.env.RENDER_ENGINE_PROJECT_TOKEN = config.projectCapability; process.env.R2_BUCKET = "studio-bucket";
  const persisted: string[] = [];
  try {
    await assert.rejects(prepareStudioErnieImages({ ...payload, approvedErnieNativeGeometry: "1376x768" }, {
      ...erniePreparedDependencies, provision: async () => config,
      persist: async key => { persisted.push(key); },
      stage: async (_config, request) => ({ jobId: "j".repeat(32), state: "completed", manifestSha256: sha256Hex(JSON.stringify(request)) }),
      readiness: async (_config, receipt, request) => ({ ...receipt, state: "completed", sourceId: request.sourceId, candidateCount: request.candidates.length }),
      outputs: async () => [{ candidateId: "s0-c0", bucket: "studio-bucket", key: "project-source.png", bytes: 300, sha256: "f".repeat(64), contentType: "image/png", verifiedAt: 1 }],
      read: async (_key, bucket) => { assert.equal(bucket, "studio-bucket"); return new Uint8Array(300); },
    }), /byte receipt or native geometry changed/);
    assert.ok(!persisted.some(key => key.endsWith(".png")));
    assert.ok(!persisted.some(key => key.endsWith(".outputs.json")));
  } finally { if (oldToken === undefined) delete process.env.RENDER_ENGINE_PROJECT_TOKEN; else process.env.RENDER_ENGINE_PROJECT_TOKEN = oldToken; if (oldBucket === undefined) delete process.env.R2_BUCKET; else process.env.R2_BUCKET = oldBucket; }
});
