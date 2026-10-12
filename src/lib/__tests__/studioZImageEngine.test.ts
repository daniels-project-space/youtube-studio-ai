import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { StudioRenderEngineClient, StudioEngineError, STUDIO_ENGINE_PROJECT } from "../studioRenderEngineClient";
import { StudioZImageRequestSchema, STUDIO_ZIMAGE_PROFILE_SHA256 } from "../../engine/studioZImageRequest";
import { STUDIO_ENGINE_ZIMAGE_WORKFLOW } from "../studioRenderEngineWorkflows";

const workflowId = STUDIO_ENGINE_ZIMAGE_WORKFLOW.workflowId, jobId = "b".repeat(32);
const request = StudioZImageRequestSchema.parse({ version: 1, idempotencyKey: "studio:exact:zimage:0001", sourceId: "studio-channel:scene:001",
  profile: "production", candidates: [{ id: "scene-1", prompt: "  Exact channel-identity prompt.  ", negativePrompt: " lettering, extra subjects ",
    seed: 0, width: 1920, height: 1088 }], output: { contentType: "image/png" }, maxCostUsd: 0, profileRevisionSha256: STUDIO_ZIMAGE_PROFILE_SHA256 });
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

test("owned native Z-Image intake keeps the complete Final request and held state without provider fallback", async () => {
  let posts = 0, corrupt = false;
  const client = new StudioRenderEngineClient("f".repeat(64), async (url, init) => {
    assert.ok(String(url).startsWith(`https://render-engine-sable.vercel.app/api/v1/projects/${STUDIO_ENGINE_PROJECT}/`));
    assert.equal(init?.redirect, "error");
    if (String(url).endsWith("/workflows")) return Response.json({ workflowId, profileRevisionSha256: STUDIO_ZIMAGE_PROFILE_SHA256 });
    if (init?.method === "POST") {
      posts++; assert.deepEqual(JSON.parse(String(init.body)), { workflowId, request });
      assert.equal(request.candidates[0].negativePrompt, "lettering, extra subjects");
      return Response.json({ jobId, state: "awaiting-final-qualification", manifestSha256: sha(request) });
    }
    return Response.json({ jobId, workflowId, profileId: "studio-zimage-turbo", requestSha256: corrupt ? "c".repeat(64) : sha(request),
      status: "awaiting-final-qualification", outputRetired: false });
  });
  assert.equal((await client.prepareZImage()).workflowId, workflowId);
  const admission = await client.submitZImage(workflowId, request);
  assert.equal(admission.state, "awaiting-final-qualification");
  assert.equal((await client.observeZImage(admission, workflowId)).status, "awaiting-final-qualification");
  assert.equal(posts, 1);
  corrupt = true; await assert.rejects(client.observeZImage(admission, workflowId), /identity changed/);
  let calls = 0;
  const lost = new StudioRenderEngineClient("f".repeat(64), async () => { calls++; throw Error("lost response"); });
  await assert.rejects(lost.submitZImage(workflowId, request), error => error instanceof StudioEngineError && error.submissionMayExist);
  assert.equal(calls, 1);
});

test("Final model/canvas/seed/candidate boundaries reject unsupported changes before network", async () => {
  const client = new StudioRenderEngineClient("f".repeat(64), async () => { throw Error("must not call"); });
  for (const changed of [{ ...request, profile: "draft" }, { ...request, profileRevisionSha256: "d".repeat(64) },
    { ...request, candidates: [{ ...request.candidates[0], width: 896 }] },
    { ...request, candidates: [{ ...request.candidates[0], seed: -1 }] },
    { ...request, candidates: [request.candidates[0], request.candidates[0]] }]) {
    await assert.rejects(client.submitZImage(workflowId, changed as typeof request));
  }
  const hero = StudioZImageRequestSchema.parse({ ...request, profile: "hero", candidates: [0, 1].map(index => ({
    ...request.candidates[0], id: `hero-${index}`, width: 2048, height: 1152,
  })) });
  assert.equal(hero.candidates.length, 2);
});
