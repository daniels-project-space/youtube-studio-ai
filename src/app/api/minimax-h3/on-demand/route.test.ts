import assert from "node:assert/strict";
import { POST } from "./route";

const token = "studio-test-service-token-that-is-long-enough";
const originalToken = process.env.STUDIO_INTERNAL_API_TOKEN;
const originalTrigger = process.env.TRIGGER_SECRET_KEY;
const originalFetch = globalThis.fetch;

async function main() {
  process.env.STUDIO_INTERNAL_API_TOKEN = token;
  process.env.TRIGGER_SECRET_KEY = "trigger-key-that-must-not-be-used";
  let externalCalls = 0;
  globalThis.fetch = async () => {
    externalCalls += 1;
    throw new Error("retired route contacted a service");
  };
  try {
    const admitted = await POST(new Request("https://studio.test/api/minimax-h3/on-demand", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "{}",
    }));
    assert.equal(admitted.status, 410);
    assert.deepEqual(await admitted.json(), {
      ok: false,
      state: "render-engine",
      error: "Direct Novita generation is retired; stage this request through Render Engine.",
    });
    assert.equal(externalCalls, 0, "retired request cannot queue a task or query a provider");

    const denied = await POST(new Request("https://studio.test/api/minimax-h3/on-demand", { method: "POST" }));
    assert.equal(denied.status, 401);
    assert.equal(externalCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.STUDIO_INTERNAL_API_TOKEN;
    else process.env.STUDIO_INTERNAL_API_TOKEN = originalToken;
    if (originalTrigger === undefined) delete process.env.TRIGGER_SECRET_KEY;
    else process.env.TRIGGER_SECRET_KEY = originalTrigger;
  }
}

void main();
