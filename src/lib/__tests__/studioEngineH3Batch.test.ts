import assert from "node:assert/strict";
import { test } from "node:test";
import { admitModuleH3RunInRenderEngine, stageH3SceneBatchInRenderEngine, getH3SceneOutputInRenderEngine } from "../renderEngineH3SceneBatchClient";
import { STUDIO_ENGINE_API_BASE, STUDIO_ENGINE_PROJECT, STUDIO_ENGINE_BUCKET, STUDIO_ENGINE_H3_WORKFLOW } from "../studioRenderEngineWorkflows";
import { sha256Hex } from "../sha256";
import { StudioEngineError } from "../studioRenderEngineClient";

test("real shared H3 transport keeps registered model/request identity and never uses a private or provider fallback", async () => {
  const request = { version: 2 as const, idempotencyKey: "studio:managed:h3:scene:001", prompt: "A continuous subject action with the exact approved channel identity.",
    firstFrame: { r2Key: `projects/${STUDIO_ENGINE_PROJECT}/inputs/sha256/${"c".repeat(64)}.png`, sha256: "c".repeat(64) },
    seed: 4242, durationSeconds: 5 as const, output: { width: 1280 as const, height: 736 as const, fps: 24 as const, container: "mp4" as const, videoCodec: "h264" as const },
    maxCostUsd: 1.25, profileRevisionSha256: STUDIO_ENGINE_H3_WORKFLOW.profileRevisionSha256 };
  const args = { workflowId: STUDIO_ENGINE_H3_WORKFLOW.workflowId, ownerId: "owner", batchId: "batch", itemId: "item",
    request: { version: 1 as const, idempotencyKey: "studio:managed:h3:batch:001", sceneManifestSha256: "d".repeat(64), maxCostUsd: 1.25, familyMaxCostUsd: 1.25,
      scenes: [{ ordinal: 0, sceneId: "scene-1", request, requestManifestSha256: sha256Hex(JSON.stringify(request)) }] } };
  let calls = 0;
  const connection = { baseUrl: STUDIO_ENGINE_API_BASE, projectName: STUDIO_ENGINE_PROJECT, apiKey: "f".repeat(64),
    fetchImpl: async (url: RequestInfo | URL, init?: RequestInit) => {
      calls++; assert.equal(String(url), `${STUDIO_ENGINE_API_BASE}/h3-scene-batches`);
      assert.equal(init?.redirect, "error"); assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${"f".repeat(64)}`);
      assert.deepEqual(JSON.parse(String(init?.body)), { projectName: STUDIO_ENGINE_PROJECT, ...args });
      return Response.json({ jobId: "e".repeat(32), state: "awaiting-final-qualification", manifestSha256: "a".repeat(64) }, { status: 202 });
    } };
  assert.equal((await stageH3SceneBatchInRenderEngine(connection, args)).state, "awaiting-final-qualification");
  await assert.rejects(stageH3SceneBatchInRenderEngine({ ...connection, baseUrl: "https://jovial-camel-68.convex.site" }, args), /owned public managed API/);
  await assert.rejects(stageH3SceneBatchInRenderEngine(connection, { ...args, workflowId: "a".repeat(32) }), /registered Studio workflow/);
  assert.equal(calls, 1);
  await assert.rejects(stageH3SceneBatchInRenderEngine({ ...connection, fetchImpl: async () => { throw Error("private provider detail"); } }, args),
    error => error instanceof StudioEngineError && error.submissionMayExist && !error.message.includes("private provider detail"));
  const output = { bucket: STUDIO_ENGINE_BUCKET, key: `projects/${STUDIO_ENGINE_PROJECT}/jobs/${"e".repeat(32)}/output.mp4`,
    bytes: 2000, sha256: "c".repeat(64), contentType: "video/mp4", verifiedAt: 123, url: "https://account.r2.cloudflarestorage.com/output.mp4", expiresInSeconds: 600 };
  assert.equal((await getH3SceneOutputInRenderEngine({ ...connection, fetchImpl: async () => Response.json(output) }, "e".repeat(32), "scene-1")).bucket, STUDIO_ENGINE_BUCKET);
  await assert.rejects(getH3SceneOutputInRenderEngine({ ...connection, fetchImpl: async () => Response.json({ ...output, bucket: "foreign-project" }) }, "e".repeat(32), "scene-1"));
});

test("module-run H3 admission binds the exact run, channel, and ordered scene digests", async () => {
  const source = {
    ownerId: "owner", channelId: "channel-1", channelSlug: "lofi-study", batchId: "run-1-loop-clips",
    requestKey: "run-1:loop-clips:visuals", moduleId: "loop_clips", runId: "run-1", itemKey: "run-1:loop_clips",
    sceneSourceSha256: "b".repeat(64), sceneManifestSha256: "c".repeat(64),
    expectedScenes: [{ ordinal: 0, sceneId: "segment-1-scene-1", requestManifestSha256: "d".repeat(64) }],
  };
  const connection = { baseUrl: STUDIO_ENGINE_API_BASE, projectName: STUDIO_ENGINE_PROJECT, apiKey: "f".repeat(64),
    fetchImpl: async (url: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(String(url), `${STUDIO_ENGINE_API_BASE}/module-h3-batches/admit`);
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body, { projectName: STUDIO_ENGINE_PROJECT, ...source, manifestSha256: body.manifestSha256 });
      assert.match(body.manifestSha256, /^[a-f0-9]{64}$/);
      return Response.json({ batchId: source.batchId, handoffSha256: body.manifestSha256, reused: false }, { status: 201 });
    } };
  const admission = await admitModuleH3RunInRenderEngine(connection, source);
  assert.equal(admission.batchId, source.batchId);
  assert.equal(admission.reused, false);
  await assert.rejects(admitModuleH3RunInRenderEngine(connection, { ...source, expectedScenes: [] }), /source is invalid/);
});
