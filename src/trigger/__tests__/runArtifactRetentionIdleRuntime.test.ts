import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mock, test } from "node:test";
import { getFunctionName } from "convex/server";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { sweepDueRunArtifactRetentions } from "../runArtifactRetentionSweeper";

test("actual idle cleanup worker loads only storage/YouTube credentials and performs no mutations beyond its empty claim", async () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const env = {
    R2_ACCOUNT_ID: "fixture", R2_ACCESS_KEY_ID: "fixture", R2_SECRET_ACCESS_KEY: "fixture", R2_BUCKET: "fixture",
    STUDIO_CONVEX_JWT_PRIVATE_KEY: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    NEXT_PUBLIC_CONVEX_URL: "https://retention-fixture.convex.cloud", STUDIO_OWNER_ID: "owner-fixture",
    VAULT_URL: "https://vault-fixture.invalid", VAULT_ACCESS_TOKEN: "fixture",
  };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  const services: string[] = [];
  const operations: string[] = [];
  const fetchMock = mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    assert.equal(url, "https://vault-fixture.invalid/api/query", "unexpected provider request");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.path, "secrets:listByService");
    services.push(body.args.service);
    return Response.json({ status: "success", value: [] });
  });
  const query = mock.method(StudioConvexHttpClient.prototype, "query", async (reference: never) => {
    const name = getFunctionName(reference);
    operations.push(name);
    assert.equal(name, "runArtifactRetentions:listReleaseChecks");
    return [];
  });
  const mutation = mock.method(StudioConvexHttpClient.prototype, "mutation", async (reference: never) => {
    const name = getFunctionName(reference);
    operations.push(name);
    assert.equal(name, "runArtifactRetentions:claimDue");
    return null;
  });
  try {
    assert.deepEqual(await sweepDueRunArtifactRetentions(), { claimed: 0, completed: 0, blocked: 0, removedObjects: 0 });
    assert.deepEqual(services, ["cloudflare", "youtube"]);
    assert.deepEqual(operations, ["runArtifactRetentions:listReleaseChecks", "runArtifactRetentions:claimDue"]);
  } finally {
    fetchMock.mock.restore(); query.mock.restore(); mutation.mock.restore();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
