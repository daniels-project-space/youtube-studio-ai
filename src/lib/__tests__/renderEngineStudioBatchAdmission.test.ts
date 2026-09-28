import assert from "node:assert/strict";

import { admitStudioBatchToRenderEngine } from "@/lib/renderEngineStudioBatchAdmission";

const TOKEN = "a".repeat(64);
const ownerId = "owner_daniel";
const batchId = "batch_fixture_123";
const env = {
  RENDER_ENGINE_CONVEX_SITE_URL: "https://render-engine.fixture.test",
  RENDER_ENGINE_PROJECT_TOKEN: TOKEN,
};
const admitted = {
  batchId,
  handoffSha256: "b".repeat(64),
  state: "awaiting-scene-artifacts",
  itemCount: 2,
  admittedAt: 1_790_000_000_000,
  reused: false,
} as const;

async function main(): Promise<void> {
  let request: Request | undefined;
  const accepted = await admitStudioBatchToRenderEngine({ ownerId, batchId, env, request: async (input, init) => {
    request = new Request(input, init);
    return new Response(JSON.stringify(admitted), { status: 202, headers: { "content-type": "application/json" } });
  } });
  assert.deepEqual(accepted, { state: "admitted", admission: admitted });
  assert.equal(request?.url, "https://render-engine.fixture.test/client/studio-batch-admission");
  assert.equal(request?.headers.get("authorization"), `Bearer ${TOKEN}`);
  assert.deepEqual(await request?.json(), { projectName: "youtube-studio-ai", ownerId, batchId });

  const pending = await admitStudioBatchToRenderEngine({ ownerId, batchId, env,
    request: async () => new Response("not ready", { status: 404 }) });
  assert.deepEqual(pending, { state: "not-ready" });

  await assert.rejects(
    () => admitStudioBatchToRenderEngine({ ownerId, batchId, env: { ...env, RENDER_ENGINE_PROJECT_TOKEN: "missing" }, request: async () => {
      throw new Error("request must not run without a configured capability");
    } }),
    /capability is not configured/,
  );
  await assert.rejects(
    () => admitStudioBatchToRenderEngine({ ownerId: "bad owner", batchId, env, request: async () => {
      throw new Error("request must not run with invalid identifiers");
    } }),
    /owner ID is invalid/,
  );
  await assert.rejects(
    () => admitStudioBatchToRenderEngine({ ownerId, batchId, env,
      request: async () => new Response(JSON.stringify({ ...admitted, state: "queued" }), { status: 202 }) }),
    /invalid Studio admission/,
  );
  await assert.rejects(
    () => admitStudioBatchToRenderEngine({ ownerId, batchId, env,
      request: async () => new Response("source changed", { status: 409 }) }),
    /HTTP 409/,
  );
  console.log("Render Engine Studio batch admission tests passed");
}

void main();
