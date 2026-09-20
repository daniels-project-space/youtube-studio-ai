import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

type Row = Record<string, unknown>;
type Definition = { id: string; cron?: string; maxDuration?: number; retry?: { maxAttempts: number }; run: (payload?: Row, options?: Row) => Promise<unknown> };
const handlers = {
  bundleFanoutDispatcher: "dispatchDueBundleFanouts",
  factualReviewContinuationDispatcher: "dispatchPendingFactualReviewContinuations",
  musicAuditionContinuationDispatcher: "dispatchPendingMusicAuditionContinuations",
  reviewedDataStoryInitialDispatcher: "dispatchPendingReviewedDataStoryInitialRuns",
  routeQualificationBenchmarkDispatcher: "dispatchPendingRouteQualificationBenchmarks",
  serializedProgramEpisodeRetryDispatcher: "dispatchDueSerializedProgramEpisodeRetries",
} as const;

function evaluate(path: string, requireFixture: (name: string) => unknown, env: Row = {}): Row {
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "process", compiled)(requireFixture, loaded, loaded.exports, { env });
  return loaded.exports;
}

function fixture(mode?: string, dispatch: (name: string, args: unknown) => Promise<unknown> = async () => ({ pending: 0, triggered: 0 })) {
  const calls: { name: string; args: unknown }[] = [];
  const env = mode === undefined ? {} : { STUDIO_DELIVERY_RECOVERY_MODE: mode };
  const modeExports = evaluate("src/lib/deliveryRecoveryMode.ts", name => { throw new Error(name); }, env);
  const requireFixture = (name: string): unknown => {
    if (name === "@trigger.dev/sdk") return { schedules: { task: (definition: Definition) => definition } };
    if (name === "@/lib/deliveryRecoveryMode") return modeExports;
    if (name === "../../convex/_generated/api") return { api: {} };
    const file = name.startsWith("./") ? name.slice(2) : "";
    if (file in handlers) return { [handlers[file as keyof typeof handlers]]: (args: unknown) => {
      calls.push({ name: file, args });
      return dispatch(file, args);
    } };
    // Legacy task declarations must not perform any provider/DB work at import
    // time, and their disabled run wrappers must return before using these deps.
    return new Proxy({}, { get: (_target, property) => {
      return () => { throw new Error(`Forbidden dependency use: ${name}:${String(property)}`); };
    } });
  };
  const load = (file: string) => evaluate(`src/trigger/${file}.ts`, requireFixture, env);
  return { calls, load, mode: modeExports.deliveryRecoveryMode as () => string };
}

test("exactly six individual crons or one shared cron are declared, never both", async () => {
  for (const mode of [undefined, "individual", "shared"]) {
    const f = fixture(mode);
    const individual = Object.keys(handlers).map(file => f.load(file)[file] as Definition);
    const shared = f.load("sharedDeliveryRecovery").sharedDeliveryRecovery as Definition;
    assert.equal(individual.filter(task => task.cron === "* * * * *").length, mode === "shared" ? 0 : 6);
    assert.equal(shared.cron, mode === "shared" ? "* * * * *" : undefined);
    if (mode === "shared") {
      for (const task of individual) assert.deepEqual(await task.run(), { skipped: "shared-delivery-recovery" });
    } else {
      assert.deepEqual(await shared.run(), { skipped: "individual-delivery-recovery" });
    }
    assert.deepEqual(f.calls, []);
  }
});

test("invalid deployment mode fails closed during task declaration", () => {
  for (const mode of ["", "SHARED", " shared", "disabled", "SECRET_SENTINEL"]) {
    const f = fixture(mode);
    assert.throws(() => f.load("sharedDeliveryRecovery"), error => {
      assert.match(String(error), /must be individual or shared/);
      assert.doesNotMatch(String(error), /SECRET_SENTINEL/);
      return true;
    });
  }
});

test("shared tick invokes all six real entry points directly and passes exact deployment scope", async () => {
  const f = fixture("shared");
  const shared = f.load("sharedDeliveryRecovery").sharedDeliveryRecovery as Definition;
  const ctx = { project: { id: "project-a" }, environment: { id: "production-a" } };
  const result = await shared.run({}, { ctx });
  assert.equal(f.calls.length, 6);
  assert.deepEqual(new Set(f.calls.map(call => call.name)), new Set(Object.keys(handlers)));
  for (const call of f.calls) {
    if (["musicAuditionContinuationDispatcher", "factualReviewContinuationDispatcher", "serializedProgramEpisodeRetryDispatcher"].includes(call.name)) {
      assert.deepEqual(call.args, { dispatchContext: { projectId: "project-a", environmentId: "production-a" } });
    } else assert.equal(call.args, undefined);
  }
  assert.equal(Object.keys(result as Row).length, 6);
  assert.equal(shared.retry?.maxAttempts, 1, "a failed aggregate must not automatically replay successful sibling handlers");
});

test("one synchronous failure does not suppress other handlers and aggregate waits for settlement", async () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const f = fixture("shared", (name) => {
    if (name === "bundleFanoutDispatcher") throw new Error("SECRET_SENTINEL");
    return name === "musicAuditionContinuationDispatcher" ? pending : Promise.resolve({ pending: 0, triggered: 0 });
  });
  const shared = f.load("sharedDeliveryRecovery").sharedDeliveryRecovery as Definition;
  let settled = false;
  const outcome = shared.run().then(() => { settled = true; return null; }, error => { settled = true; return error; });
  await Promise.resolve();
  assert.equal(f.calls.length, 6);
  assert.equal(settled, false);
  release();
  const error = await outcome;
  assert.equal(error.message, "Delivery recovery failed for: bundle");
  assert.doesNotMatch(error.message, /SECRET_SENTINEL/);
});
