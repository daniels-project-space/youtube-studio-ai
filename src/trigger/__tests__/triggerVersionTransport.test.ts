import assert from "node:assert/strict";
import { mock } from "node:test";
import { task } from "@trigger.dev/sdk/v3";
import {
  apiClientManager, runtime, taskContext, TaskRunContext, ServerBackgroundWorker, parsePacket,
  type ApiRequestOptions, type TriggerAndWaitOptions,
} from "@trigger.dev/core/v3";

const origin = "https://trigger-version-fixture.invalid";
const parentVersion = "20260919.1";
const explicitVersion = "20260919.2";
const requestOptions: ApiRequestOptions = { retry: { maxAttempts: 1 } };
const parent = {
  ctx: TaskRunContext.parse({
    task: { id: "fixture-parent", filePath: "fixture-parent.ts" },
    attempt: { number: 1, startedAt: new Date(0) },
    run: { id: "run_parent", tags: [], isTest: true, createdAt: new Date(0) },
    queue: { id: "queue_fixture", name: "fixture" },
    environment: { id: "env_fixture", slug: "staging", type: "STAGING" },
    project: { id: "proj_fixture", ref: "fixture", slug: "fixture", name: "Fixture" },
    organization: { id: "org_fixture", slug: "fixture", name: "Fixture" },
    machine: { name: "small-1x", cpu: 1, memory: 1, centsPerMs: 0 },
  }),
  worker: ServerBackgroundWorker.parse({ id: "worker_fixture", version: parentVersion, contentHash: "fixture" }),
};

// Compile-time guard: awaited children inherit their worker instead of accepting a pin.
const invalidAwaitedOptions: TriggerAndWaitOptions = {
  // @ts-expect-error TriggerAndWaitOptions deliberately excludes version.
  version: explicitVersion,
};
void invalidAwaitedOptions;

async function main() {
  // Run this standalone with tsx: no real Trigger worker or credentials are involved.
  assert.equal(taskContext.ctx, undefined, "fixture must not run inside a live task");
  const previousVersion = process.env.TRIGGER_VERSION;
  process.env.TRIGGER_VERSION = "20990101.9";
  let localExecutions = 0;
  let waitCalls = 0;
  let rejectVersion = false;
  const requests: Array<{ payload: unknown; options: Record<string, unknown> }> = [];
  const child = task({
    id: "sdk-version-fixture",
    run: async (_payload: { fixture: string }): Promise<{ fixture: string }> => {
      void _payload;
      localExecutions++;
      throw new Error("SDK must never fall back to local task execution");
    },
  });
  const fetchMock = mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    assert.equal(request.url, `${origin}/api/v1/tasks/${child.id}/trigger`, "all other HTTP is forbidden");
    assert.equal(request.method, "POST");
    assert.equal(request.headers.get("authorization"), "Bearer tr_test_fixture_not_a_secret");
    const body = await request.json();
    requests.push(body);
    if (rejectVersion) {
      return Response.json({ error: "fixture: requested worker version unavailable" }, {
        status: 404, headers: { "x-should-retry": "false" },
      });
    }
    return Response.json({ id: "run_child", isCached: false }, {
      headers: { "x-trigger-jwt": "fixture-public-token" },
    });
  });
  const waitMock = mock.method(runtime, "waitForTask", async (args: Parameters<typeof runtime.waitForTask>[0]) => {
    waitCalls++;
    assert.equal(args.id, "run_child");
    assert.equal(args.ctx.run.id, parent.ctx.run.id);
    return { ok: true as const, id: args.id, output: JSON.stringify({ fixture: "completed" }), outputType: "application/json" };
  });
  try {
    await apiClientManager.runWithConfig({
      baseURL: origin, accessToken: "tr_test_fixture_not_a_secret", requestOptions,
    }, async () => {
      const handle = await child.trigger({ fixture: "plain" }, { version: explicitVersion }, requestOptions);
      assert.equal(handle.id, "run_child");
      assert.equal(requests.length, 1);
      assert.deepEqual(await parsePacket({ data: requests[0]!.payload as string,
        dataType: requests[0]!.options.payloadType as string }), { fixture: "plain" });
      assert.equal(requests[0]!.options.lockToVersion, explicitVersion, "explicit pin overrides TRIGGER_VERSION");
      assert.equal(requests[0]!.options.parentRunId, undefined);
      assert.equal(waitCalls, 0);
      assert.equal(localExecutions, 0);

      taskContext.setGlobalTaskContext(parent);
      const completed = await child.triggerAndWait({ fixture: "awaited" }, {}, requestOptions);
      assert.deepEqual(completed, { ok: true, id: "run_child", taskIdentifier: child.id, output: { fixture: "completed" } });
      assert.equal(requests.length, 2);
      assert.equal(requests[1]!.options.lockToVersion, parentVersion, "awaited child ignores conflicting environment version");
      assert.equal(requests[1]!.options.parentRunId, parent.ctx.run.id);
      assert.equal(requests[1]!.options.resumeParentOnCompletion, true);
      assert.equal(waitCalls, 1);
      assert.equal(localExecutions, 0);

      rejectVersion = true;
      for (const awaited of [false, true]) {
        const before: number = requests.length;
        await assert.rejects(async () => awaited
          ? await child.triggerAndWait({ fixture: "unavailable" }, {}, requestOptions)
          : await child.trigger({ fixture: "unavailable" }, { version: explicitVersion }, requestOptions),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal((error as Error & { status?: number }).status, 404);
          assert.match(error.message, /requested worker version unavailable/);
          return true;
        });
        assert.equal(requests.length, before + 1, "unavailable pin must not retry on the default deployment");
        assert.equal(requests[before]!.options.lockToVersion, awaited ? parentVersion : explicitVersion);
        assert.equal(waitCalls, 1, "rejected submissions never enter the completion wait");
        assert.equal(localExecutions, 0);
      }
      assert.equal(requests.every((request) => typeof request.options.lockToVersion === "string"), true);
    });
  } finally {
    fetchMock.mock.restore();
    waitMock.mock.restore();
    if (previousVersion === undefined) delete process.env.TRIGGER_VERSION;
    else process.env.TRIGGER_VERSION = previousVersion;
  }
  console.log("TRIGGER VERSION TRANSPORT PASS - four installed-SDK cases; all HTTP intercepted, zero local task executions");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
