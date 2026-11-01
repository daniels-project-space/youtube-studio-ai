import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mock } from "node:test";

import { GET } from "./route";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";

const TOKEN = "render-engine-studio-batch-broker-test-token";
const OWNER = "owner_daniel";
const BATCH = "batch_fixture_123";

async function main() {
  const envNames = [
    "STUDIO_RENDER_BATCH_BROKER_TOKEN",
    "STUDIO_RENDER_BATCH_OWNER_ID",
    "STUDIO_CONVEX_JWT_PRIVATE_KEY",
    "NEXT_PUBLIC_CONVEX_URL",
    "CONVEX_URL",
  ];
  const prior = new Map(envNames.map((name) => [name, process.env[name]]));
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  process.env.STUDIO_RENDER_BATCH_BROKER_TOKEN = TOKEN;
  process.env.STUDIO_RENDER_BATCH_OWNER_ID = OWNER;
  process.env.STUDIO_CONVEX_JWT_PRIVATE_KEY = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://studio-fixture.convex.cloud";
  delete process.env.CONVEX_URL;

  let calls = 0;
  let queriedArgs: Record<string, unknown> | undefined;
  const handoff = { version: "plan-batch-handoff/v1", ownerId: OWNER, batchId: BATCH, sha256: "a".repeat(64) };
  const query = mock.method(StudioConvexHttpClient.prototype, "query", async (_reference: unknown, args: Record<string, unknown>) => {
    calls += 1;
    queriedArgs = args;
    return handoff as never;
  });

  try {
    const unauthorized = await GET(new Request(`https://youtube-studio-ai.vercel.app/api/internal/render-engine/studio-batch-handoff?batchId=${BATCH}`));
    assert.equal(unauthorized.status, 401);
    assert.equal(calls, 0, "unauthenticated requests must not reach Convex");

    process.env.STUDIO_RENDER_BATCH_BROKER_TOKEN = "too-short";
    const weakCredential = await GET(new Request(`https://youtube-studio-ai.vercel.app/api/internal/render-engine/studio-batch-handoff?batchId=${BATCH}`, {
      headers: { Authorization: "Bearer too-short" },
    }));
    assert.equal(weakCredential.status, 401);
    assert.equal(calls, 0, "weak broker configuration must not reach Convex");
    process.env.STUDIO_RENDER_BATCH_BROKER_TOKEN = TOKEN;

    const malformed = await GET(new Request(`https://youtube-studio-ai.vercel.app/api/internal/render-engine/studio-batch-handoff?batchId=${encodeURIComponent("bad batch")}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    }));
    assert.equal(malformed.status, 400);
    assert.equal(calls, 0, "invalid batch identifiers must not reach Convex");

    const response = await GET(new Request(`https://youtube-studio-ai.vercel.app/api/internal/render-engine/studio-batch-handoff?batchId=${BATCH}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { handoff });
    assert.deepEqual(queriedArgs, { ownerId: OWNER, batchId: BATCH }, "owner must come from server configuration");
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");

    query.mock.restore();
    mock.method(StudioConvexHttpClient.prototype, "query", async () => null as never);
    const notReady = await GET(new Request(`https://youtube-studio-ai.vercel.app/api/internal/render-engine/studio-batch-handoff?batchId=${BATCH}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    }));
    assert.equal(notReady.status, 404);
    assert.deepEqual(await notReady.json(), { error: "handoff_not_ready" });
  } finally {
    mock.restoreAll();
    for (const [name, value] of prior) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  console.log("Studio render batch broker route tests passed");
}

void main();
