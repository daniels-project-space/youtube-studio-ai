import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mock } from "node:test";
import { ServerBackgroundWorker, TaskRunContext, taskContext } from "@trigger.dev/core/v3";
import ts from "typescript";
import { ExecutionError } from "@/engine/executionErrors";
import { assertRunPipelineAdmission } from "@/lib/runPipelineAdmission";
import { pipelineInvocationSha256 } from "@/lib/pipelineInvocationHash";
import {
  normalizePipelineInvocationSnapshot,
  type PipelineInvocationSnapshot,
} from "@/lib/pipelineInvocationSnapshot";
import { pipelineWorkerDeploymentDispatchOptions, type PipelineWorkerDeployment } from "@/lib/pipelineWorkerDeployment";
import { serializedProgramEpisodeBusyRetrySchedule } from "@/lib/serializedProgramEpisode";
import {
  assertFrozenPipelineWorkerDeployment,
  currentPipelineWorkerDeployment,
  type PipelineWorkerContext,
} from "@/trigger/pipelineWorkerRuntime";
import { throwForTaskRetryPolicy } from "@/trigger/taskRetryPolicy";

const binding: PipelineWorkerDeployment = {
  version: "20260919.26", projectId: "project-fixture", environmentId: "environment-fixture",
};
const NEXT_GUARD = "WORKER_ADMISSION_REACHED_SERIALIZED_RETRY_SENTINEL";

function context() {
  return TaskRunContext.parse({
    task: { id: "run-pipeline", filePath: "src/trigger/runPipeline.ts" },
    attempt: { number: 1, startedAt: new Date(0) },
    run: { id: "trigger-run-fixture", tags: [], isTest: true, createdAt: new Date(0), version: binding.version },
    queue: { id: "queue-fixture", name: "fixture" },
    environment: { id: binding.environmentId, slug: "staging", type: "STAGING" },
    project: { id: binding.projectId, ref: "fixture", slug: "fixture", name: "Fixture" },
    organization: { id: "org-fixture", slug: "fixture", name: "Fixture" },
    machine: { name: "small-1x", cpu: 1, memory: 1, centsPerMs: 0 },
    deployment: {
      id: "deployment-fixture", shortCode: "fixture", version: binding.version,
      runtime: "node", runtimeVersion: "fixture",
    },
  });
}

function snapshot(workerDeployment?: PipelineWorkerDeployment): PipelineInvocationSnapshot {
  return normalizePipelineInvocationSnapshot({
    version: 1, ownerId: "owner-fixture", runId: "run-fixture", channelId: "channel-fixture",
    source: "channel", entries: [{ block: "music" }], seedStore: {}, budgetUsd: 10,
    keyPrefix: "owner/fixture/", remoteBlocks: [], defaultRetries: 0,
    compilationFingerprint: "a".repeat(64), compilationPolicyId: "fixture", compilationPolicyVersion: "1",
    compilationModules: [], compilationCapabilities: [], reservedMaxCostUsd: 0,
    ...(workerDeployment === undefined ? {} : { workerDeployment }),
  });
}

// Extract the entire actual callback, not a copied admission prefix. External
// work is replaced below; the first post-admission guard always stops execution.
function parentCallbackSource(): string {
  const path = join(process.cwd(), "src/trigger/runPipeline.ts");
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const declarations: ts.VariableDeclaration[] = [];
  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "runPipelineTask") {
      declarations.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(declarations.length, 1);
  const call = declarations[0]!.initializer;
  assert.ok(call && ts.isCallExpression(call));
  const options = call.arguments[0];
  assert.ok(options && ts.isObjectLiteralExpression(options));
  const run = options.properties.find((property) =>
    ts.isPropertyAssignment(property) && property.name.getText(source) === "run");
  assert.ok(run && ts.isPropertyAssignment(run) && ts.isArrowFunction(run.initializer));
  return ts.transpileModule(`const callback = ${run.initializer.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
  }).outputText;
}

const compiledCallback = parentCallbackSource();
const sdkContext = {
  ctx: context(),
  worker: ServerBackgroundWorker.parse({
    id: "worker-fixture", version: binding.version, contentHash: "fixture", engine: "V2",
  }),
};

interface Case {
  name: string;
  snapshot?: PipelineInvocationSnapshot;
  workerVersion?: string;
  missingWorker?: boolean;
  contextChange?: (ctx: ReturnType<typeof context>) => void;
  error?: RegExp;
  tamperHash?: boolean;
}

async function exercise(test: Case): Promise<void> {
  const ctx = context();
  test.contextChange?.(ctx);
  sdkContext.ctx = ctx;
  if (test.missingWorker) Reflect.deleteProperty(sdkContext, "worker");
  else sdkContext.worker = { id: "worker-fixture", version: test.workerVersion ?? binding.version, contentHash: "fixture" };

  const calls = { provider: 0, lease: 0, nextGuard: 0, frozenAdmission: 0, capture: 0, registration: 0 };
  const captured: PipelineWorkerDeployment[] = [];
  const durableRun = {
    _id: "run-fixture", ownerId: "owner-fixture", channelId: "channel-fixture", status: "running",
    ...(test.snapshot === undefined ? {} : {
      pipelineInvocationSnapshot: structuredClone(test.snapshot),
      pipelineInvocationSha256: test.tamperHash ? "f".repeat(64) : pipelineInvocationSha256(test.snapshot),
    }),
  };
  const savedDurableRun = structuredClone(durableRun);
  const queries: string[] = [];
  class Client {
    constructor(url: string) { assert.equal(url, "https://worker-fixture.invalid"); }
    async query(name: string) {
      queries.push(name);
      if (name === "channel") return { _id: "channel-fixture", ownerId: "owner-fixture" };
      if (name === "run") return durableRun;
      if (name === "health") return [];
      throw new Error(`unexpected fixture query: ${name}`);
    }
    async mutation() { calls.lease++; throw new Error("worker admission cannot mutate or claim a lease"); }
    async action() { calls.provider++; throw new Error("worker admission cannot execute an action"); }
  }
  const forbiddenProvider = () => { calls.provider++; throw new Error("provider work before worker admission sentinel"); };
  const dependencies = {
    registerAllBlocks: () => { calls.registration++; },
    process: { env: { NEXT_PUBLIC_CONVEX_URL: "https://worker-fixture.invalid", TRIGGER_VERSION: "20990101.9" } },
    ConvexHttpClient: Client,
    api: { channels: { getChannel: "channel" }, runs: { getRun: "run", claimExecutionLease: "lease" } },
    automaticProviderHealthApi: { listForOwner: "health" },
    assertRunPipelineAdmission, normalizePipelineInvocationSnapshot, pipelineInvocationSha256,
    throwForTaskRetryPolicy, ExecutionError,
    currentPipelineWorkerDeployment: (value: PipelineWorkerContext) => {
      calls.capture++;
      const result = currentPipelineWorkerDeployment(value);
      captured.push(result);
      return result;
    },
    assertFrozenPipelineWorkerDeployment: (value: PipelineInvocationSnapshot, valueCtx: PipelineWorkerContext) => {
      calls.frozenAdmission++;
      return assertFrozenPipelineWorkerDeployment(value, valueCtx);
    },
    serializedProgramEpisodeBusyRetryReceipt: () => {
      calls.nextGuard++;
      throw new Error(NEXT_GUARD);
    },
    bootstrapSecrets: forbiddenProvider,
    runPipeline: forbiddenProvider,
  };
  const run = new Function(...Object.keys(dependencies), `${compiledCallback}\nreturn callback;`)(
    ...Object.values(dependencies),
  ) as (payload: { runId: string; channelId: string }, options: { ctx: ReturnType<typeof context> }) => Promise<unknown>;
  const fetchMock = mock.method(globalThis, "fetch", async () => {
    calls.provider++;
    throw new Error("network forbidden in worker admission fixture");
  });
  try {
    await assert.rejects(run({ runId: "run-fixture", channelId: "channel-fixture" }, { ctx }),
      test.error ?? new RegExp(NEXT_GUARD), test.name);
  } finally {
    fetchMock.mock.restore();
  }
  assert.equal(calls.nextGuard, test.error ? 0 : 1, test.name);
  assert.equal(calls.provider, 0, `${test.name}: zero provider calls`);
  assert.equal(calls.lease, 0, `${test.name}: zero mutation/lease calls`);
  assert.equal(calls.registration, 1);
  assert.deepEqual(queries.sort(), ["channel", "health", "run"]);
  assert.deepEqual(durableRun, savedDurableRun, "admission must not invent or rewrite a durable binding");
  assert.equal(calls.capture, test.snapshot ? 0 : 1);
  assert.equal(calls.frozenAdmission, test.snapshot && !test.tamperHash ? 1 : 0);
  if (!test.error && !test.snapshot) assert.deepEqual(captured, [binding]);
}

async function retryEnqueue(): Promise<void> {
  const path = join(process.cwd(), "src/trigger/runPipeline.ts");
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const functions = source.statements.filter((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === "enqueueSerializedProgramEpisodeBusyRetry");
  assert.equal(functions.length, 1);
  const compiled = ts.transpileModule(functions[0]!.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const input = {
    payload: { runId: "run-fixture", channelId: "channel-fixture", invocationSha256: "a".repeat(64) },
    retryAt: 1_789_855_200_000, attempt: 2,
  };
  const request = serializedProgramEpisodeBusyRetrySchedule({
    ...input, runId: input.payload.runId, channelId: input.payload.channelId,
  });
  const keys: Array<{ seed: string; options: { scope: string } }> = [];
  const dispatches: Array<{ id: string; payload: unknown; options: Record<string, unknown> }> = [];
  const dependencies = {
    serializedProgramEpisodeBusyRetrySchedule,
    pipelineWorkerDeploymentDispatchOptions,
    currentPipelineWorkerDeployment,
    idempotencyKeys: {
      create: async (seed: string, options: { scope: string }) => {
        keys.push({ seed, options });
        return `fixture-key:${seed}`;
      },
    },
    tasks: {
      trigger: async (id: string, payload: unknown, options: Record<string, unknown>) => {
        dispatches.push({ id, payload, options });
        return { id: "fake-trigger-run" };
      },
    },
  };
  const enqueue = new Function(...Object.keys(dependencies), `${compiled}\nreturn enqueueSerializedProgramEpisodeBusyRetry;`)(
    ...Object.values(dependencies),
  ) as (value: typeof input & { workerDeployment?: PipelineWorkerDeployment }) => Promise<void>;
  sdkContext.ctx = context();
  sdkContext.ctx.run.version = "20260919.27";
  sdkContext.ctx.deployment!.version = "20260919.27";
  sdkContext.worker = { id: "worker-fixture", version: "20260919.27", contentHash: "fixture" };
  assert.equal(currentPipelineWorkerDeployment(sdkContext.ctx).version, "20260919.27");
  const fetchMock = mock.method(globalThis, "fetch", async () => {
    throw new Error("enqueue fixture must not make real network calls");
  });
  try {
    await enqueue({ ...input, workerDeployment: binding });
    await enqueue({ ...input, workerDeployment: binding });
    await enqueue(input);
  } finally {
    fetchMock.mock.restore();
  }
  assert.equal(dispatches.length, 3);
  assert.deepEqual(keys, Array.from({ length: 3 }, () => ({ seed: request.idempotencySeed, options: { scope: "global" } })));
  for (const [index, dispatch] of dispatches.entries()) {
    assert.equal(dispatch.id, "run-pipeline");
    assert.deepEqual(dispatch.payload, input.payload);
    assert.deepEqual(dispatch.options, {
      ...(index < 2 ? { version: binding.version } : {}),
      delay: new Date(request.retryAt), concurrencyKey: request.concurrencyKey,
      idempotencyKey: `fixture-key:${request.idempotencySeed}`,
    });
  }
  assert.equal(Object.hasOwn(dispatches[2]!.options, "version"), false, "historical dispatch must not invent a version");
  assert.deepEqual(dispatches[0], dispatches[1], "retry identity remains stable across repeated enqueue calls");
}

async function main(): Promise<void> {
  assert.equal(taskContext.ctx, undefined, "run this fixture outside a live Trigger worker");
  assert.equal(taskContext.setGlobalTaskContext(sdkContext), true);
  const previousVersion = process.env.TRIGGER_VERSION;
  process.env.TRIGGER_VERSION = binding.version;
  try {
    const cases: Case[] = [
      { name: "fresh exact worker" },
      { name: "fresh optional context versions absent", contextChange: (ctx) => {
        delete ctx.run.version; delete ctx.deployment;
      } },
      { name: "fresh missing worker does not fall back to env or context", missingWorker: true, error: /version/ },
      { name: "fresh blank worker", workerVersion: " ", error: /version/ },
      { name: "bound exact worker", snapshot: snapshot(binding) },
      { name: "bound missing worker", snapshot: snapshot(binding), missingWorker: true, error: /version/ },
      { name: "bound changed worker", snapshot: snapshot(binding), workerVersion: "20260919.27", error: /mismatch/ },
      { name: "historical unbound without worker", snapshot: snapshot(), missingWorker: true },
      { name: "historical unbound ignores current context mismatch", snapshot: snapshot(),
        contextChange: (ctx) => { ctx.run.version = "different"; } },
      { name: "historical explicit module version requires binding", snapshot: {
        ...snapshot(), entries: [{ block: "music", version: "2.0.0" }],
      }, missingWorker: true, error: /versioned pipeline requires a frozen worker deployment/ },
      { name: "tampered invocation refused before binding check", snapshot: snapshot(binding),
        tamperHash: true, error: /identity\/hash mismatch/ },
    ];
    for (const field of ["version", "projectId", "environmentId"] as const) {
      cases.push({ name: `bound ${field} mismatch`, snapshot: snapshot({ ...binding, [field]: "other" }),
        error: new RegExp(`${field} mismatch`) });
    }
    for (const bound of [false, true]) {
      for (const field of ["runVersion", "deploymentVersion"] as const) {
        cases.push({ name: `${bound ? "bound" : "fresh"} ${field} disagreement`,
          ...(bound ? { snapshot: snapshot(binding) } : {}),
          contextChange: (ctx) => {
            if (field === "runVersion") ctx.run.version = "different";
            else ctx.deployment!.version = "different";
          }, error: new RegExp(`${field} mismatch`) });
      }
    }
    for (const field of ["project", "environment"] as const) {
      cases.push({ name: `bound callback ${field} disagreement`, snapshot: snapshot(binding),
        contextChange: (ctx) => { ctx[field].id = "other"; }, error: new RegExp(`${field}Id mismatch`) });
    }
    for (const test of cases) await exercise(test);
    assert.throws(() => assertFrozenPipelineWorkerDeployment(snapshot(binding)), /executing worker context/);
    assert.doesNotThrow(() => assertFrozenPipelineWorkerDeployment(snapshot()));
    await retryEnqueue();
    console.log(`PIPELINE WORKER RUNTIME PASS: ${cases.length} actual parent callback cases + 3 actual retry enqueues, installed SDK bridge, zero provider/lease calls`);
  } finally {
    if (previousVersion === undefined) delete process.env.TRIGGER_VERSION;
    else process.env.TRIGGER_VERSION = previousVersion;
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
