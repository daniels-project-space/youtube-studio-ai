import assert from "node:assert/strict";
import test from "node:test";
import { stageH3RequestInRenderEngine, type RenderEngineH3StageConfig } from "@/lib/renderEngineH3StageClient";

const config: RenderEngineH3StageConfig = {
  baseUrl: "https://jovial-camel-68.convex.site",
  projectName: "youtube-studio",
  workflowId: "jn77hkybrrm6vfyctyv4eznmqx8ezqrg",
  projectCapability: "a".repeat(64),
  request: {
    version: 2,
    idempotencyKey: "youtube-studio:run-1:shot-1",
    prompt: "A quiet morning at home",
    firstFrame: { r2Key: "projects/youtube-studio/runs/run-1/shot-1.png", sha256: "b".repeat(64) },
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

test("rejects prompt-only routes, malformed receipts, and any non-staged state", async () => {
  let callCount = 0;
  const fetchImpl: typeof fetch = async (_input, init) => {
    callCount += 1;
    const body = JSON.parse(String(init?.body));
    assert.equal(Object.hasOwn(body, "prompt"), false);
    return jsonResponse({ jobId: "job1234567890", state: "queued", manifestSha256: "d".repeat(64) });
  };
  await assert.rejects(() => stageH3RequestInRenderEngine({ ...config, fetchImpl }), /invalid H3 staging receipt/);
  assert.equal(callCount, 1);
});

test("rejects unsafe Engine origins and non-202 responses", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => { calls += 1; return jsonResponse({}, 200); };
  await assert.rejects(() => stageH3RequestInRenderEngine({ ...config, baseUrl: "http://jovial-camel-68.convex.site", fetchImpl }), /HTTPS Convex site origin/);
  await assert.rejects(() => stageH3RequestInRenderEngine({ ...config, fetchImpl }), /HTTP 200/);
  assert.equal(calls, 1);
});
