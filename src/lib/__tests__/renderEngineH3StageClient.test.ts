import assert from "node:assert/strict";
import test from "node:test";
import { bindStudioScenesInRenderEngine, admitStudioBatchInRenderEngine, getH3JobStatusInRenderEngine, getVerifiedH3OutputReadbackInRenderEngine, provisionStudioH3WorkflowInRenderEngine, qualifyH3InputInRenderEngine, stageH3RequestInRenderEngine, uploadH3InputToRenderEngine, type RenderEngineH3StageConfig } from "@/lib/renderEngineH3StageClient";

const config: RenderEngineH3StageConfig = {
  baseUrl: "https://jovial-camel-68.convex.site",
  projectName: "youtube-studio",
  workflowId: "jn77hkybrrm6vfyctyv4eznmqx8ezqrg",
  projectCapability: "a".repeat(64),
  request: {
    version: 2,
    idempotencyKey: "youtube-studio:run-1:shot-1",
    prompt: "A quiet morning at home",
    firstFrame: { r2Key: `projects/youtube-studio/inputs/sha256/${"b".repeat(64)}.png`, sha256: "b".repeat(64) },
    seed: 19,
    durationSeconds: 5,
    output: { width: 1280, height: 736, fps: 24, container: "mp4", videoCodec: "h264" },
    maxCostUsd: 1,
    profileRevisionSha256: "c".repeat(64),
  },
};

const jsonResponse = (value: unknown, status = 202) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json" },
});

test("uses only the Engine stage request branch and validates its receipt", async () => {
  let captured: { url: string; init: RequestInit } | undefined;
  const receipt = { jobId: "jd75yszsg3yt0nrgr2g43brtdd8f6f6t", state: "awaiting-input-qualification", manifestSha256: "d".repeat(64) };
  const result = await stageH3RequestInRenderEngine({
    ...config,
    fetchImpl: async (input, init) => {
      captured = { url: String(input), init: init ?? {} };
      return jsonResponse(receipt);
    },
  });
  assert.deepEqual(result, receipt);
  assert.equal(captured?.url, "https://jovial-camel-68.convex.site/client/h3-jobs");
  assert.equal(captured?.init.method, "POST");
  assert.equal(new Headers(captured?.init.headers).get("authorization"), `Bearer ${config.projectCapability}`);
  const posted = JSON.parse(String(captured?.init.body));
  assert.deepEqual(Object.keys(posted).sort(), ["projectName", "request", "workflowId"]);
  assert.deepEqual(posted.request, config.request);
});

test("rejects requests outside the Engine's exact 720p stage contract before sending", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => { calls += 1; return jsonResponse({}); };
  await assert.rejects(() => stageH3RequestInRenderEngine({
    ...config, fetchImpl, request: { ...config.request, firstFrame: { ...config.request.firstFrame, r2Key: "another-project/frame.png" } },
  }), /outside the Render Engine contract/);
  await assert.rejects(() => stageH3RequestInRenderEngine({
    ...config, fetchImpl,
    request: { ...config.request, output: { ...config.request.output, width: 1920 } } as unknown as RenderEngineH3StageConfig["request"],
  }), /outside the Render Engine contract/);
  assert.equal(calls, 0);
});

test("accepts durable replay states and rejects malformed staging receipts", async () => {
  let callCount = 0;
  const fetchImpl: typeof fetch = async (_input, init) => {
    callCount += 1;
    const body = JSON.parse(String(init?.body));
    assert.equal(Object.hasOwn(body, "prompt"), false);
    return jsonResponse({ jobId: "job1234567890", state: "not-a-job-state", manifestSha256: "d".repeat(64) });
  };
  await assert.rejects(() => stageH3RequestInRenderEngine({ ...config, fetchImpl }), /invalid H3 staging receipt/);
  assert.equal(callCount, 1);
  const replay = await stageH3RequestInRenderEngine({
    ...config,
    fetchImpl: async () => jsonResponse({ jobId: "jd75yszsg3yt0nrgr2g43brtdd8f6f6t", state: "completed", manifestSha256: "d".repeat(64) }),
  });
  assert.equal(replay.state, "completed", "an idempotent replay must not turn a terminal job into input work");
});

test("rejects unsafe Engine origins and non-202 responses", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => { calls += 1; return jsonResponse({}, 200); };
  await assert.rejects(() => stageH3RequestInRenderEngine({ ...config, baseUrl: "http://jovial-camel-68.convex.site", fetchImpl }), /HTTPS Convex site origin/);
  await assert.rejects(() => stageH3RequestInRenderEngine({ ...config, fetchImpl }), /HTTP 200/);
  assert.equal(calls, 1);
});

test("qualifies only the staged job through the non-billable Engine endpoint", async () => {
  let captured: { url: string; init: RequestInit } | undefined;
  const jobId = "jd75yszsg3yt0nrgr2g43brtdd8f6f6t";
  const receipt = await qualifyH3InputInRenderEngine({
    baseUrl: config.baseUrl, projectName: config.projectName, projectCapability: config.projectCapability,
    fetchImpl: async (input, init) => {
      captured = { url: String(input), init: init ?? {} };
      return jsonResponse({ jobId, state: "awaiting-final-qualification" });
    },
  }, jobId);
  assert.deepEqual(receipt, { jobId, state: "awaiting-final-qualification" });
  assert.equal(captured?.url, "https://jovial-camel-68.convex.site/client/h3-jobs/qualify-input");
  assert.deepEqual(JSON.parse(String(captured?.init.body)), { projectName: config.projectName, jobId });
});

test("admits the frozen Studio batch before any scene is staged", async () => {
  let captured: { url: string; init: RequestInit } | undefined;
  const receipt = await admitStudioBatchInRenderEngine({
    baseUrl: config.baseUrl, projectName: config.projectName, projectCapability: config.projectCapability,
    fetchImpl: async (input, init) => {
      captured = { url: String(input), init: init ?? {} };
      return jsonResponse({ batchId: "batch-1", handoffSha256: "a".repeat(64), state: "awaiting-scene-artifacts", itemCount: 1, admittedAt: 1, reused: false });
    },
  }, { ownerId: "owner-1", batchId: "batch-1" });
  assert.equal(receipt.batchId, "batch-1");
  assert.equal(captured?.url, "https://jovial-camel-68.convex.site/client/studio-batch-admission");
  assert.deepEqual(JSON.parse(String(captured?.init.body)), { projectName: config.projectName, ownerId: "owner-1", batchId: "batch-1" });
});

test("provisions the current profile revision and uploads only a hash-addressed project frame", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const frame = new Uint8Array([1, 2, 3, 4]);
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    if (String(input).endsWith("/client/workflows")) {
      return jsonResponse({ workflowId: "jn7amn3mdzgyy66h04njbvjbax8f98p7", profileRevisionSha256: "e".repeat(64) }, 200);
    }
    if (String(input).endsWith("/client/input-uploads")) {
      return jsonResponse({ bucket: "youtube-studio-renders", key: `projects/youtube-studio/inputs/sha256/${"b".repeat(64)}.png`, bytes: 4, sha256: "b".repeat(64), contentType: "image/png", url: "https://r2.example/signed-put", headers: { "Content-Type": "image/png", "Content-Length": "4", "x-amz-meta-sha256": "b".repeat(64) } }, 200);
    }
    return new Response(null, { status: 200 });
  };
  const base = { baseUrl: config.baseUrl, projectName: config.projectName, projectCapability: config.projectCapability, fetchImpl };
  assert.deepEqual(await provisionStudioH3WorkflowInRenderEngine(base), { workflowId: "jn7amn3mdzgyy66h04njbvjbax8f98p7", profileRevisionSha256: "e".repeat(64) });
  assert.equal((await uploadH3InputToRenderEngine(base, { sha256: "b".repeat(64), bytes: 4, contentType: "image/png" }, frame)).key,
    `projects/youtube-studio/inputs/sha256/${"b".repeat(64)}.png`);
  assert.deepEqual(calls.map((call) => call.url), [
    "https://jovial-camel-68.convex.site/client/workflows",
    "https://jovial-camel-68.convex.site/client/input-uploads",
    "https://r2.example/signed-put",
  ]);
  assert.equal(new Headers(calls[2]?.init.headers).get("x-amz-meta-sha256"), "b".repeat(64));
  await assert.rejects(uploadH3InputToRenderEngine(base, { sha256: "b".repeat(64), bytes: 5, contentType: "image/png" }, frame), /byte length/);
});

test("reads only a verified completed H3 receipt and its short-lived project output capability", async () => {
  const jobId = "jd75yszsg3yt0nrgr2g43brtdd8f6f6t";
  const output = {
    bucket: "youtube-studio-renders",
    key: `projects/project-id/workflows/workflow-id/jobs/${jobId}/outputs/h3-render.mp4`,
    bytes: 12_345,
    sha256: "f".repeat(64),
    contentType: "video/mp4",
    verifiedAt: 100,
  };
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const base = {
    baseUrl: config.baseUrl,
    projectName: config.projectName,
    projectCapability: config.projectCapability,
    fetchImpl: async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      if (String(input).includes("/client/jobs/output?")) {
        return jsonResponse({ ...output, url: "https://r2.example/signed-get", expiresInSeconds: 3_600 }, 200);
      }
      return jsonResponse({
        jobId, status: "completed", profileId: "minimax-h3", lane: "h3", createdAt: 1,
        completedAt: 101, progress: "stopped", measurement: null, attempt: null,
        output, outputRetired: false,
      }, 200);
    },
  };
  assert.deepEqual(await getH3JobStatusInRenderEngine(base, jobId), {
    jobId, status: "completed", progress: "stopped", completedAt: 101, outputRetired: false, output,
  });
  assert.deepEqual(await getVerifiedH3OutputReadbackInRenderEngine(base, jobId), {
    ...output, url: "https://r2.example/signed-get", expiresInSeconds: 3_600,
  });
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), ["/client/jobs", "/client/jobs/output"]);
  assert.equal(new URL(calls[0]!.url).searchParams.get("projectName"), config.projectName);
  assert.equal(new Headers(calls[1]?.init.headers).get("authorization"), `Bearer ${config.projectCapability}`);
});

test("rejects an unverified, retired, or cross-job output before it can be consumed", async () => {
  const jobId = "jd75yszsg3yt0nrgr2g43brtdd8f6f6t";
  const base = { baseUrl: config.baseUrl, projectName: config.projectName, projectCapability: config.projectCapability,
    fetchImpl: async () => jsonResponse({
      jobId, status: "completed", profileId: "minimax-h3", lane: "h3", createdAt: 1, completedAt: 2,
      progress: null, measurement: null, attempt: null,
      output: { bucket: "youtube-studio-renders", key: `projects/project/workflows/workflow/jobs/${jobId}/outputs/h3-render.mp4`, bytes: 1, sha256: "f".repeat(64), contentType: "video/mp4", verifiedAt: 2 },
      outputRetired: true,
    }, 200) };
  await assert.rejects(getH3JobStatusInRenderEngine(base, jobId), /invalid verified H3 output receipt/);
  const crossJob = { ...base, fetchImpl: async () => jsonResponse({ bucket: "youtube-studio-renders", key: "projects/project/workflows/workflow/jobs/anotherjob1234567890123456789012/outputs/h3-render.mp4", bytes: 1, sha256: "f".repeat(64), contentType: "video/mp4", verifiedAt: 2, url: "https://r2.example/signed-get", expiresInSeconds: 3_600 }, 200) };
  await assert.rejects(getVerifiedH3OutputReadbackInRenderEngine(crossJob, jobId), /invalid H3 output readback receipt/);
});

test("scene binding uses the actual authenticated Engine endpoint and rejects invalid scene counts",async()=>{
 const binding={ownerId:"owner1",batchId:"week1",itemId:"item1",manifestSha256:"d".repeat(64)};
 const client: RenderEngineH3StageConfig={...config,fetchImpl:async(url,init)=>{
  assert.equal(new URL(url instanceof Request ? url.url : url).pathname,"/client/studio-batch-scenes");
  assert.equal(new Headers(init?.headers).get("authorization"),`Bearer ${config.projectCapability}`);
  assert.ok(init && typeof init.body === "string");
  assert.deepEqual(JSON.parse(init.body),{projectName:config.projectName,...binding});
  assert.ok(init?.signal);return jsonResponse({sceneCount:2,reused:true});
 }};
 assert.deepEqual(await bindStudioScenesInRenderEngine(client,binding),{sceneCount:2,reused:true});
 await assert.rejects(bindStudioScenesInRenderEngine({...config,fetchImpl:async()=>jsonResponse({sceneCount:0,reused:true})},binding),/binding failed/);
 await assert.rejects(bindStudioScenesInRenderEngine({...config,fetchImpl:async()=>jsonResponse({sceneCount:2,reused:true},409)},binding),/binding failed/);
});
