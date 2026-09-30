import assert from "node:assert/strict";
import test from "node:test";
import { STUDIO_ZIMAGE_TURBO_PROFILE, provisionStudioZImageWorkflowInRenderEngine, stageStudioZImageRequestInRenderEngine, type RenderEngineStudioZImageStageConfig } from "@/lib/renderEngineStudioZImageStageClient";

const config: RenderEngineStudioZImageStageConfig = {
  baseUrl: "https://jovial-camel-68.convex.site",
  projectName: "youtube-studio",
  workflowId: "jn77hkybrrm6vfyctyv4eznmqx8ezqrg",
  projectCapability: "a".repeat(64),
  request: {
    version: 1, idempotencyKey: "youtube-studio:week-1:scene-1", sourceId: "week-1:scene-1", profile: "production",
    candidates: [{ id: "scene-1", prompt: "A warm sunrise over a quiet coastal home", negativePrompt: "No people", seed: 42, width: 1920, height: 1088 }],
    output: { contentType: "image/png" }, maxCostUsd: 1.2, profileRevisionSha256: STUDIO_ZIMAGE_TURBO_PROFILE.profileRevisionSha256,
  },
};
const response = (body: unknown, status = 202) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("provisions only Studio's project-owned exact Final workflow", async () => {
  let submitted: unknown;
  const receipt = await provisionStudioZImageWorkflowInRenderEngine({ ...config, fetchImpl: async (_input, init) => {
    submitted = JSON.parse(String(init?.body));
    return response({ workflowId: config.workflowId, profileRevisionSha256: STUDIO_ZIMAGE_TURBO_PROFILE.profileRevisionSha256 }, 200);
  } });
  assert.deepEqual(submitted, { projectName: config.projectName, workflowName: "studio-zimage-final", profileId: "studio-zimage-turbo" });
  assert.equal(receipt.profileRevisionSha256, STUDIO_ZIMAGE_TURBO_PROFILE.profileRevisionSha256);
  await assert.rejects(provisionStudioZImageWorkflowInRenderEngine({ ...config, fetchImpl: async () => response({ workflowId: config.workflowId, profileRevisionSha256: "f".repeat(64) }, 200) }), /does not match/);
});

test("stages only the exact Studio Z-Image Final contract", async () => {
  let captured: { url: string; init?: RequestInit } | undefined;
  const receipt = await stageStudioZImageRequestInRenderEngine({ ...config, fetchImpl: async (input, init) => {
    captured = { url: String(input), init };
    return response({ jobId: "jd75yszsg3yt0nrgr2g43brtdd8f6f6t", state: "awaiting-final-qualification", manifestSha256: "b".repeat(64) });
  } });
  assert.equal(receipt.state, "awaiting-final-qualification");
  assert.equal(captured?.url, "https://jovial-camel-68.convex.site/client/studio-zimage-batches");
  assert.equal(new Headers(captured?.init?.headers).get("authorization"), `Bearer ${config.projectCapability}`);
  assert.deepEqual(JSON.parse(String(captured?.init?.body)), { projectName: config.projectName, workflowId: config.workflowId, request: config.request });
});

test("rejects any changed Final geometry, candidate count, model receipt, or unsafe origin before sending", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => { calls += 1; return response({}); };
  await assert.rejects(stageStudioZImageRequestInRenderEngine({ ...config, fetchImpl, baseUrl: "http://jovial-camel-68.convex.site" }), /HTTPS Convex site origin/);
  await assert.rejects(stageStudioZImageRequestInRenderEngine({ ...config, fetchImpl, request: { ...config.request, candidates: [{ ...config.request.candidates[0]!, width: 1920, height: 1080 }] } as unknown as RenderEngineStudioZImageStageConfig["request"] }), /outside the Final contract/);
  await assert.rejects(stageStudioZImageRequestInRenderEngine({ ...config, fetchImpl, request: { ...config.request, candidates: [{ ...config.request.candidates[0]!, negativePrompt: undefined }] } as unknown as RenderEngineStudioZImageStageConfig["request"] }), /outside the Final contract/);
  await assert.rejects(stageStudioZImageRequestInRenderEngine({ ...config, fetchImpl, request: { ...config.request, profileRevisionSha256: "f".repeat(64) } as RenderEngineStudioZImageStageConfig["request"] }), /outside the Final contract/);
  assert.equal(calls, 0);
});

test("accepts durable replay states and rejects non-202 or invalid receipts", async () => {
  await assert.rejects(stageStudioZImageRequestInRenderEngine({ ...config, fetchImpl: async () => response({}, 400) }), /HTTP 400/);
  await assert.rejects(stageStudioZImageRequestInRenderEngine({ ...config, fetchImpl: async () => response({ jobId: "bad", state: "awaiting-final-qualification", manifestSha256: "b".repeat(64) }) }), /invalid Studio Z-Image stage receipt/);
  const replay = await stageStudioZImageRequestInRenderEngine({ ...config, fetchImpl: async () => response({ jobId: "jd75yszsg3yt0nrgr2g43brtdd8f6f6t", state: "completed", manifestSha256: "b".repeat(64) }) });
  assert.equal(replay.state, "completed");
});
