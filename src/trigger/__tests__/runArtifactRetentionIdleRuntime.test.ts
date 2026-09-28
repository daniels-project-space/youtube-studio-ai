import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mock, test } from "node:test";
import { getFunctionName } from "convex/server";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import {
  runStudioRetentionMaintenance,
  sweepDueRunArtifactRetentions,
} from "../runArtifactRetentionSweeper";

test("maintenance controller does nothing when its own opt-in is absent", async () => {
  const previousGlobal = process.env.STUDIO_SCHEDULES_ENABLED;
  const previousMaintenance = process.env.STUDIO_RETENTION_MAINTENANCE_ENABLED;
  delete process.env.STUDIO_SCHEDULES_ENABLED;
  delete process.env.STUDIO_RETENTION_MAINTENANCE_ENABLED;
  const calls: string[] = [];
  const fetchMock = mock.method(globalThis, "fetch", async () => {
    calls.push("fetch");
    throw new Error("disabled maintenance must not bootstrap secrets");
  });
  const query = mock.method(StudioConvexHttpClient.prototype, "query", async () => {
    calls.push("query");
    throw new Error("disabled maintenance must not read Convex");
  });
  const mutation = mock.method(StudioConvexHttpClient.prototype, "mutation", async () => {
    calls.push("mutation");
    throw new Error("disabled maintenance must not write Convex");
  });
  try {
    assert.deepEqual(await runStudioRetentionMaintenance(), { skipped: true, reason: "retention maintenance is disabled" });
    assert.deepEqual(calls, []);
  } finally {
    fetchMock.mock.restore(); query.mock.restore(); mutation.mock.restore();
    if (previousGlobal === undefined) delete process.env.STUDIO_SCHEDULES_ENABLED;
    else process.env.STUDIO_SCHEDULES_ENABLED = previousGlobal;
    if (previousMaintenance === undefined) delete process.env.STUDIO_RETENTION_MAINTENANCE_ENABLED;
    else process.env.STUDIO_RETENTION_MAINTENANCE_ENABLED = previousMaintenance;
  }
});

test("maintenance schedule observes an empty queue without claiming cleanup or dispatching work", async () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const env = {
    R2_ACCOUNT_ID: "fixture", R2_ACCESS_KEY_ID: "fixture", R2_SECRET_ACCESS_KEY: "fixture", R2_BUCKET: "fixture",
    STUDIO_CONVEX_JWT_PRIVATE_KEY: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    NEXT_PUBLIC_CONVEX_URL: "https://retention-fixture.convex.cloud", STUDIO_OWNER_ID: "owner-fixture",
    VAULT_URL: "https://vault-fixture.invalid", VAULT_ACCESS_TOKEN: "fixture",
    STUDIO_RETENTION_MAINTENANCE_ENABLED: "true",
  };
  const names = [...Object.keys(env), "STUDIO_SCHEDULES_ENABLED"];
  const previous = Object.fromEntries(names.map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  delete process.env.STUDIO_SCHEDULES_ENABLED;
  const operations: string[] = [];
  const services: string[] = [];
  const fetchMock = mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    assert.equal(url, "https://vault-fixture.invalid/api/query");
    services.push(JSON.parse(String(init?.body)).args.service);
    return Response.json({ status: "success", value: [] });
  });
  const query = mock.method(StudioConvexHttpClient.prototype, "query", async (reference: never) => {
    const name = getFunctionName(reference);
    operations.push(name);
    assert.ok(["runArtifactRetentions:listReleaseChecks", "runArtifactRetentions:listFinalCopyChecks"].includes(name));
    return [];
  });
  const mutation = mock.method(StudioConvexHttpClient.prototype, "mutation", async (reference: never) => {
    operations.push(getFunctionName(reference));
    throw new Error("empty maintenance queue must not mutate or claim cleanup");
  });
  try {
    assert.deepEqual(await runStudioRetentionMaintenance(), { checked: 0, confirmed: 0, deferred: 0, copied: 0, held: 0 });
    assert.deepEqual(services, ["cloudflare", "youtube"]);
    assert.deepEqual(operations, ["runArtifactRetentions:listReleaseChecks", "runArtifactRetentions:listFinalCopyChecks"]);
  } finally {
    fetchMock.mock.restore(); query.mock.restore(); mutation.mock.restore();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("manual idle cleanup worker preserves objects and finishes only its empty cleanup claim", async () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const env = {
    R2_ACCOUNT_ID: "fixture", R2_ACCESS_KEY_ID: "fixture", R2_SECRET_ACCESS_KEY: "fixture", R2_BUCKET: "fixture",
    STUDIO_CONVEX_JWT_PRIVATE_KEY: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    NEXT_PUBLIC_CONVEX_URL: "https://retention-fixture.convex.cloud", STUDIO_OWNER_ID: "owner-fixture",
    VAULT_URL: "https://vault-fixture.invalid", VAULT_ACCESS_TOKEN: "fixture",
  };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  const operations: string[] = [];
  const fetchMock = mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    if (url === "https://vault-fixture.invalid/api/query") {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.path, "secrets:listByService");
      return Response.json({ status: "success", value: [] });
    }
    assert.fail(`unexpected provider request ${url}`);
  });
  const query = mock.method(StudioConvexHttpClient.prototype, "query", async (reference: never) => {
    const name = getFunctionName(reference);
    operations.push(name);
    assert.ok(["runArtifactRetentions:listReleaseChecks", "runArtifactRetentions:listFinalCopyChecks"].includes(name));
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
    assert.deepEqual(operations, [
      "runArtifactRetentions:listReleaseChecks",
      "runArtifactRetentions:listFinalCopyChecks",
      "runArtifactRetentions:claimDue",
    ]);
  } finally {
    fetchMock.mock.restore(); query.mock.restore(); mutation.mock.restore();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
