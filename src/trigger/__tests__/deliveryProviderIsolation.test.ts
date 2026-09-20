import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import * as bundle from "@/lib/bundleFanout";
import * as serialized from "@/lib/serializedProgramEpisode";
import * as deployment from "@/lib/pipelineWorkerDeployment";

type Row = Record<string, unknown>;
type Kind = "bundle" | "serialized";
const files = {
  bundle: "bundleFanoutDispatcher",
  serialized: "serializedProgramEpisodeRetryDispatcher",
} as const;
const functions = {
  bundle: "dispatchDueBundleFanouts",
  serialized: "dispatchDueSerializedProgramEpisodeRetries",
} as const;

function fixture(kind: Kind, due: Row[] = [], claim?: Row, triggerFailure: boolean | ((payload: Row) => Promise<void>) = false) {
  const queries: { name: string; args: Row }[] = [];
  const mutations: { name: string; args: Row }[] = [];
  const keys: { seed: string; options: Row }[] = [];
  const triggers: { task: string; payload: Row; options: Row }[] = [];
  const compiled = ts.transpileModule(readFileSync(`src/trigger/${files[kind]}.ts`, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  class Convex {
    constructor(url: string) { assert.equal(url, "https://convex.fixture.invalid"); }
    async query(name: string, args: Row) { queries.push({ name, args }); return due; }
    async mutation(name: string, args: Row) {
      mutations.push({ name, args });
      if (name === "claimBundleFanoutDispatch") return claim;
      return null;
    }
  }
  const loaded = { exports: {} as Record<string, (input: Row) => Promise<unknown>> };
  const requireFixture = (name: string) => {
    if (name === "@trigger.dev/sdk") return {
      schedules: { task: (definition: unknown) => definition },
      idempotencyKeys: { create: async (seed: string, options: Row) => {
        keys.push({ seed, options }); return `key:${seed}`;
      } },
      tasks: { trigger: async (task: string, payload: Row, options: Row) => {
        triggers.push({ task, payload, options });
        if (typeof triggerFailure === "function") await triggerFailure(payload);
        else if (triggerFailure) throw new Error("fixture enqueue failure");
        return { id: "trigger-fixture" };
      } },
    };
    if (name === "../../convex/_generated/api") return { api: { runs: new Proxy({}, {
      get: (_target, property) => property,
    }) } };
    if (name === "@/lib/studioConvexHttpClient") return { StudioConvexHttpClient: Convex };
    if (name === "@/lib/bundleFanout") return bundle;
    if (name === "@/lib/serializedProgramEpisode") return serialized;
    if (name === "@/lib/pipelineWorkerDeployment") return deployment;
    if (name === "@/lib/deliveryRecoveryMode") return { deliveryRecoveryMode: () => "individual" };
    throw new Error(`Provider/bootstrap import forbidden in delivery-only task: ${name}`);
  };
  // Execute real dispatcher bodies with real payload builders; no network or provider credentials.
  new Function("require", "module", "exports", "process", compiled)(requireFixture, loaded, loaded.exports, {
    env: { NEXT_PUBLIC_CONVEX_URL: "https://convex.fixture.invalid" },
  });
  return {
    queries, mutations, keys, triggers,
    run: (input: Row = {}) => loaded.exports[functions[kind]]({ ownerId: "owner-fixture", now: 2_000_000, ...input }),
  };
}

test("empty delivery ticks perform one indexed-query call and no provider bootstrap", async () => {
  for (const kind of ["bundle", "serialized"] as const) {
    const f = fixture(kind);
    assert.deepEqual(await f.run(), kind === "bundle" ? { due: 0, triggered: 0, deferred: 0 } : { due: 0, triggered: 0 });
    assert.equal(f.queries.length, 1);
    assert.deepEqual(f.queries[0].args, { ownerId: "owner-fixture", now: 2_000_000 });
    assert.deepEqual(f.mutations, []);
    assert.deepEqual(f.triggers, []);
    assert.deepEqual(f.keys, []);
  }
});

test("bundle delivery preserves immutable payload, global identity, and acknowledgement lease", async () => {
  const envelope = bundle.bundleFanoutEnvelope({
    ownerId: "owner-fixture", baseRunId: "base", baseChannelId: "base-channel",
    siblingChannelId: "sibling", reuse: { language: "fr", footageKeys: [], musicKey: "retained-music" },
  });
  const request = bundle.bundleFanoutDispatchSchedule({ runId: "child", envelope });
  for (const failure of [false, true]) {
    const f = fixture("bundle", [{ runId: "child" }], { kind: "claimed", runId: "child", envelope, leaseToken: "lease" }, failure);
    assert.deepEqual(await f.run(), { due: 1, triggered: failure ? 0 : 1, deferred: failure ? 1 : 0 });
    assert.deepEqual(f.keys, [{ seed: request.idempotencySeed, options: { scope: "global" } }]);
    assert.deepEqual(f.triggers, [{ task: "run-pipeline", payload: request.payload, options: {
      concurrencyKey: request.concurrencyKey, idempotencyKey: `key:${request.idempotencySeed}`,
    } }]);
    assert.deepEqual(f.mutations.map(x => x.name), ["claimBundleFanoutDispatch", failure ? "deferBundleFanoutDispatch" : "markBundleFanoutDispatchEnqueued"]);
    assert.equal(f.mutations[1].args.leaseToken, "lease");
  }
});

test("busy bundle claims cannot trigger generation", async () => {
  const f = fixture("bundle", [{ runId: "child" }], { kind: "busy", runId: "child" });
  assert.deepEqual(await f.run(), { due: 1, triggered: 0, deferred: 0 });
  assert.deepEqual(f.triggers, []);
});

test("serialized delivery retains frozen invocation, exact worker pin and not-before delay", async () => {
  const workerDeployment = { version: "worker-a", projectId: "project-a", environmentId: "environment-a" };
  const receipt = { runId: "run-a", channelId: "channel-a", invocationSha256: "a".repeat(64), retryAt: 2_000_000, attempt: 1, workerDeployment };
  const f = fixture("serialized", [receipt]);
  assert.deepEqual(await f.run({ dispatchContext: workerDeployment }), { due: 1, triggered: 1 });
  assert.equal(f.triggers[0].options.version, "worker-a");
  assert.deepEqual(f.triggers[0].options.delay, new Date(receipt.retryAt));
  assert.equal(f.triggers[0].payload.invocationSha256, receipt.invocationSha256);
  assert.deepEqual(f.keys[0].options, { scope: "global" });
  const foreign = fixture("serialized", [receipt]);
  await assert.rejects(foreign.run({ dispatchContext: { ...workerDeployment, projectId: "foreign" } }), /worker deployment/);
  assert.deepEqual(foreign.triggers, []);
});

test("serialized recovery isolates a poison receipt and bounds concurrent delivery to four", async () => {
  const due = Array.from({ length: 51 }, (_, index) => ({
    runId: `run-${index}`, channelId: `channel-${index}`, invocationSha256: "a".repeat(64),
    retryAt: 2_000_000, attempt: 1,
  }));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let active = 0, peak = 0, completed = 0;
  const f = fixture("serialized", due, undefined, async payload => {
    active++; peak = Math.max(peak, active);
    try {
      await gate;
      if (payload.runId === "run-0") throw new Error("fixture poison receipt");
      completed++;
    } finally { active--; }
  });
  let settled = false;
  const result = f.run().then(() => { settled = true; return null; }, error => { settled = true; return error; });
  for (let tick = 0; tick < 10; tick++) await Promise.resolve();
  assert.equal(f.triggers.length, 4);
  assert.equal(active, 4);
  assert.equal(settled, false);
  release();
  assert.match(String(await result), /fixture poison receipt/);
  assert.equal(peak, 4);
  assert.equal(active, 0);
  assert.equal(completed, 49);
  assert.equal(f.triggers.length, 50, "preserve the durable batch cap");
  assert.equal(new Set(f.triggers.map(row => row.payload.runId)).size, 50);
  assert.equal(f.queries.length, 1);
  assert.deepEqual(f.mutations, []);
});

test("foreign worker receipt fails closed without starving valid sibling channels", async () => {
  const valid = { runId: "valid", channelId: "channel", invocationSha256: "a".repeat(64), retryAt: 2_000_000, attempt: 1 };
  const f = fixture("serialized", [{ ...valid, runId: "foreign", workerDeployment: {
    version: "worker-a", projectId: "foreign", environmentId: "production",
  } }, valid]);
  await assert.rejects(f.run({ dispatchContext: { projectId: "project-a", environmentId: "production" } }), /worker deployment/);
  assert.deepEqual(f.triggers.map(row => row.payload.runId), ["valid"]);
  assert.equal(f.keys.length, 1, "foreign receipts cannot acquire a delivery key");
});
