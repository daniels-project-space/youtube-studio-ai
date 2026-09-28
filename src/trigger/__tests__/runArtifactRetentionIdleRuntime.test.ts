import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mock, test } from "node:test";
import { getFunctionName } from "convex/server";
import type { Id } from "../../../convex/_generated/dataModel";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import {
  runStudioRetentionMaintenance,
  runScheduledArtifactRetentionSweep,
  reconcileRunArtifactReleaseChecks,
  sweepDueRunArtifactRetentions,
} from "../runArtifactRetentionSweeper";

test("release observation commits are split at the Convex 50-row batch limit", async () => {
  const channelId = "channel-fixture" as Id<"channels">;
  const checks = Array.from({ length: 51 }, (_, index) => ({
    retentionId: `retention-${index}` as Id<"runArtifactRetentions">,
    channelId,
    runId: `run-${index}` as Id<"runs">,
    videoId: `video${String(index).padStart(8, "0")}`,
  }));
  const observedSizes: number[] = [];
  const recordedSizes: number[] = [];
  const result = await reconcileRunArtifactReleaseChecks({
    checks,
    observeChannel: async (_channel, videoIds) => {
      observedSizes.push(videoIds.length);
      return {
        connectorId: "connector-fixture" as Id<"youtubeAuth">,
        connectorVersion: 1,
        videos: new Map(videoIds.map((videoId) => [videoId, { videoId, channelId: "UC-fixture" }])),
      };
    },
    record: async (observations) => {
      recordedSizes.push(observations.length);
      assert.ok(observations.length <= 50);
      return { confirmed: observations.length, deferred: 0 };
    },
    now: () => 1,
  });
  assert.deepEqual(observedSizes, [50, 1]);
  assert.deepEqual(recordedSizes, [50, 1]);
  assert.deepEqual(result, { confirmed: 51, deferred: 0 });
});

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

test("legacy sweeper keeps global cleanup work while delegating observation/copy under both gates", async () => {
  const previousGlobal = process.env.STUDIO_SCHEDULES_ENABLED;
  const previousMaintenance = process.env.STUDIO_RETENTION_MAINTENANCE_ENABLED;
  process.env.STUDIO_SCHEDULES_ENABLED = "true";
  process.env.STUDIO_RETENTION_MAINTENANCE_ENABLED = "true";
  const env = {
    R2_ACCOUNT_ID: "fixture", R2_ACCESS_KEY_ID: "fixture", R2_SECRET_ACCESS_KEY: "fixture", R2_BUCKET: "fixture",
    STUDIO_CONVEX_JWT_PRIVATE_KEY: generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey
      .export({ format: "pem", type: "pkcs8" }).toString(),
    NEXT_PUBLIC_CONVEX_URL: "https://retention-fixture.convex.cloud", STUDIO_OWNER_ID: "owner-fixture",
    VAULT_URL: "https://vault-fixture.invalid", VAULT_ACCESS_TOKEN: "fixture",
  };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  const calls: string[] = [];
  const services: string[] = [];
  const fetchMock = mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    assert.equal(url, "https://vault-fixture.invalid/api/query");
    services.push(JSON.parse(String(init?.body)).args.service);
    return Response.json({ status: "success", value: [] });
  });
  const query = mock.method(StudioConvexHttpClient.prototype, "query", async (reference: never) => {
    const name = getFunctionName(reference);
    calls.push(name);
    assert.fail(`delegated maintenance query should not run in legacy sweeper: ${name}`);
  });
  const mutation = mock.method(StudioConvexHttpClient.prototype, "mutation", async (reference: never) => {
    const name = getFunctionName(reference);
    calls.push(name);
    assert.equal(name, "runArtifactRetentions:claimDue");
    return null;
  });
  try {
    assert.deepEqual(await runScheduledArtifactRetentionSweep(), {
      claimed: 0, completed: 0, blocked: 0, removedObjects: 0,
    });
    assert.deepEqual(calls, ["runArtifactRetentions:claimDue"]);
    assert.ok(services.length === 0 || services.join(",") === "cloudflare,youtube",
      "cached secrets or the expected Cloudflare/YouTube bootstrap are the only allowed paths");
  } finally {
    fetchMock.mock.restore(); query.mock.restore(); mutation.mock.restore();
    if (previousGlobal === undefined) delete process.env.STUDIO_SCHEDULES_ENABLED;
    else process.env.STUDIO_SCHEDULES_ENABLED = previousGlobal;
    if (previousMaintenance === undefined) delete process.env.STUDIO_RETENTION_MAINTENANCE_ENABLED;
    else process.env.STUDIO_RETENTION_MAINTENANCE_ENABLED = previousMaintenance;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("multi-channel observation commits hand off cleanup before early proofs age out", async () => {
  const previousGlobal = process.env.STUDIO_SCHEDULES_ENABLED;
  const previousMaintenance = process.env.STUDIO_RETENTION_MAINTENANCE_ENABLED;
  process.env.STUDIO_SCHEDULES_ENABLED = "true";
  process.env.STUDIO_RETENTION_MAINTENANCE_ENABLED = "true";
  const channelIds = Array.from({ length: 12 }, (_, index) => `channel-${index}` as Id<"channels">);
  const checks = channelIds.map((channelId, index) => ({
    retentionId: `retention-${index}` as Id<"runArtifactRetentions">,
    channelId,
    runId: `run-${index}` as Id<"runs">,
    videoId: `video${String(index).padStart(8, "0")}`,
  }));
  const calls: Array<{ kind: string; observedAt?: number }> = [];
  let clock = 0;
  try {
    const result = await reconcileRunArtifactReleaseChecks({
      checks,
      observeChannel: async (_channel, videoIds) => {
        // Twelve sequential 31-second provider reads exceed the five-minute
        // freshness window for the first channel by the end of this pass.
        clock += 31_000;
        return {
          connectorId: "connector-fixture" as Id<"youtubeAuth">,
          connectorVersion: 1,
          videos: new Map(videoIds.map((videoId) => [videoId, { videoId, channelId: "UC-fixture" }])),
        };
      },
      record: async (observations, observedAt) => {
        calls.push({ kind: "runArtifactRetentions:recordReleaseObservations", observedAt });
        return { confirmed: observations.length, deferred: 0 };
      },
      afterRecord: async (_observations, observedAt) => {
        assert.ok(clock - observedAt >= 0 && clock - observedAt < 5 * 60_000,
          "cleanup claims each channel immediately after its fresh observation commit");
        calls.push({ kind: "runArtifactRetentions:claimDue", observedAt });
        calls.push({ kind: "runArtifactRetentions:complete", observedAt });
      },
      now: () => clock,
    });
    assert.ok(clock > 5 * 60_000, "the total observation pass exceeds the proof freshness window");
    assert.equal(result.confirmed, 12);
    assert.equal(calls.length, 36);
    for (let index = 0; index < calls.length; index += 3) {
      assert.deepEqual(calls.slice(index, index + 3).map((call) => call.kind), [
        "runArtifactRetentions:recordReleaseObservations",
        "runArtifactRetentions:claimDue",
        "runArtifactRetentions:complete",
      ]);
      assert.equal(calls[index].observedAt, calls[index + 1].observedAt);
      assert.equal(calls[index + 1].observedAt, calls[index + 2].observedAt);
    }
  } finally {
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
    assert.ok(services.length === 0 || services.join(",") === "cloudflare,youtube",
      "cached secrets or the expected Cloudflare/YouTube bootstrap are the only allowed paths");
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
