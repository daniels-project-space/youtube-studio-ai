import assert from "node:assert/strict";
import Module from "node:module";
import { getFunctionName } from "convex/server";
import { assertInlineLease } from "../../../convex/runExecutionAdmission";
import { createInlinePaidExecutionLeaseCheck } from "@/trigger/inlinePaidExecutionLease";
import { _clear, register } from "@/engine/registry";
import { runPipeline } from "@/engine/runner";
import { validatePipeline } from "@/engine/validate";
import type { RunStageSink } from "@/engine/types";
import { creativeTextJson } from "@/lib/creativeText";
import { createModelUsageScope } from "@/lib/modelUsage";
import { ExecutionError } from "@/engine/executionErrors";

const identity = {
  ownerId: "owner-fixture", channelId: "channel-fixture", runId: "run-fixture",
  leaseOwner: "worker-fixture", executionLeaseToken: 3,
};
type Request = typeof identity & { requestId: string };
type Grant = { requestId: string; checkedAt: number; leaseExpiresAt: number };
type Phase = "generator" | "judge" | "package" | "comment";
const title = "Roman Aqueducts Changed City Life";
const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const originalLoad = loader._load;
const originalFetch = globalThis.fetch;
const originalKey = process.env.OPENROUTER_API_KEY;
const originalUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const events: string[] = [];
let requests: Phase[] = [];
let checks = 0;
let revokeAfter: number | undefined;
let invalidFirst: "generator" | "judge" | undefined;
let ambiguous: Phase | undefined;
const run = {
  _id: identity.runId, ownerId: identity.ownerId, channelId: identity.channelId,
  status: "running", leaseOwner: identity.leaseOwner, executionAttempts: 3,
  leaseExpiresAt: Date.now() + 120_000,
};
const ctx = {
  auth: { getUserIdentity: async () => ({
    subject: "service:youtube-studio-ai", role: "service", owner_id: identity.ownerId,
  }) },
  db: {
    normalizeId: (_table: string, id: string) => id,
    get: async (id: string) => id === run._id ? structuredClone(run)
      : id === identity.channelId ? { _id: id, ownerId: identity.ownerId } : null,
    query: () => { throw new Error("unexpected database scan"); },
    patch: () => { throw new Error("admission must be read-only"); },
  },
};
const client = {
  query: async (reference: unknown, args: Request): Promise<Grant> => {
    assert.equal(getFunctionName(reference as never), "runExecutionAdmission:assertInlineLease");
    checks++;
    events.push("check");
    return (assertInlineLease as unknown as {
      _handler: (context: unknown, input: Request) => Promise<Grant>;
    })._handler(ctx, args);
  },
};

function reset() {
  requests = []; checks = 0; events.length = 0;
  revokeAfter = undefined; invalidFirst = undefined; ambiguous = undefined;
  Object.assign(run, { status: "running", executionAttempts: 3, leaseExpiresAt: Date.now() + 120_000 });
}

async function main() {
  process.env.OPENROUTER_API_KEY = "fixture-only-no-network";
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://fixture.convex.cloud";
  loader._load = function(request, ...rest) {
    const loaded = originalLoad.call(this, request, ...rest) as Record<string, unknown>;
    if (request.endsWith("/performance")) return { ...loaded, loadPerformanceContext: async () => "" };
    if (request.endsWith("/studioConvexHttpClient")) return {
      ...loaded,
      StudioConvexHttpClient: class {
        async query(reference: never) {
          assert.equal(getFunctionName(reference), "videos:listRecentChannelTitles");
          return [];
        }
      },
    };
    return loaded;
  };
  // All HTTP is intercepted. The provider client/parser/accounting are real.
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith("https://suggestqueries.google.com/")) return Response.json(["", []]);
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions", "unexpected network request");
    const body = JSON.parse(String(init?.body)) as { model: string; messages: { content: string }[] };
    const prompt = body.messages.at(-1)!.content;
    const phase: Phase = prompt.startsWith("Write SEVEN") ? "generator"
      : prompt.startsWith("You are a YouTube CTR strategist") ? "judge"
      : prompt.includes("description + tags") ? "package" : "comment";
    requests.push(phase); events.push("fetch");
    const output: unknown = phase === "generator" ? { candidates: [{ frame: "mechanism", title }] }
      : phase === "judge" ? {
        rankings: [{ idx: 0, clickScore: 9, direct: 9, identityFit: 9, viewerMotivation: 9,
          grounding: "supported", reason: "Fixture judgment, not model quality evidence." }],
        winner: 0, runnerUp: 0,
      } : phase === "package" ? { description: "Roman aqueducts changed city life.", tagsCsv: "rome,water,aqueduct,engineering,history" }
        : { comment: "Which engineering detail matters most?" };
    if (revokeAfter === requests.length) run.executionAttempts++;
    if (phase === ambiguous) return Response.json({ error: { message: "ambiguous fixture dispatch" } }, { status: 503 });
    return Response.json({
      id: "fixture-" + requests.length, model: body.model,
      choices: [{ message: { content:
        (invalidFirst === "generator" && requests.length === 1) ||
        (invalidFirst === "judge" && phase === "judge" && requests.length === 2)
          ? "not JSON" : JSON.stringify(output),
      } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    });
  };
  const { metadataOptimized } = await import("@/trigger/blocks/intelligenceBlocks");
  _clear(); register(metadataOptimized);
  const seedStore = {
    topic: "Roman aqueduct engineering", channelName: "Water Archive",
    narrationText: "Roman aqueducts changed city life by moving water across difficult terrain.",
    competitors: [{ topVideos: [{ title: "Roman water systems", views: 200 }] }],
  };
  const resolved = validatePipeline([{ block: "metadata" }], Object.keys(seedStore));
  async function execute(withAuthority = true) {
    const rows: Parameters<RunStageSink["upsert"]>[0][] = [];
    const result = await runPipeline(resolved, {
      ...identity, executionLease: identity, keyPrefix: "fixture/metadata/", budgetUsd: 5,
      seedStore, resume: false,
      ...(withAuthority ? { assertInlinePaidExecutionLease: createInlinePaidExecutionLeaseCheck(client as never, identity) } : {}),
      sink: { upsert: async (row) => { rows.push(row); } },
    });
    return { result, rows };
  }
  function assertBlocked(result: Awaited<ReturnType<typeof execute>>["result"], purchases: number) {
    assert.equal(result.status, "failed");
    assert.equal(requests.length, purchases, "revocation must stop all later requests and retries");
    assert.match(JSON.stringify(result), /INLINE_PAID_EXECUTION_LEASE_REQUIRED/);
    assert.equal(checks, purchases + 1, "lease denial must not enter the engine retry loop");
  }
  reset();
  const success = await execute();
  assert.equal(success.result.status, "completed");
  assert.deepEqual(requests, ["generator", "judge", "package", "comment"]);
  assert.deepEqual(events, Array.from({ length: 4 }, () => ["check", "fetch"]).flat());

  for (const state of ["stale", "expired", "cancelled"] as const) {
    reset();
    if (state === "stale") run.executionAttempts++;
    if (state === "expired") run.leaseExpiresAt = Date.now() - 1;
    if (state === "cancelled") run.status = "cancelled";
    assertBlocked((await execute()).result, 0);
  }
  reset();
  const missing = await execute(false);
  assert.equal(missing.result.status, "failed");
  assert.match(JSON.stringify(missing.result), /no local execution authority/);
  assert.equal(requests.length, 0);

  reset();
  delete process.env.OPENROUTER_API_KEY;
  const fallback = await metadataOptimized.run({
    ...identity, keyPrefix: "fixture/metadata/", params: {}, store: seedStore,
    budgetUsd: 5, log: () => {},
  });
  assert.equal(fallback.titleDecision, null, "the no-key fallback remains deterministic and unfenced");
  const noKey = await execute(false);
  assert.equal(noKey.result.status, "failed");
  assert.match(JSON.stringify(noKey.result), /titleDecision.*returned null/,
    "retain the existing runner output contract; fencing does not admit degraded output");
  assert.equal(checks, 0); assert.equal(requests.length, 0);
  process.env.OPENROUTER_API_KEY = "fixture-only-no-network";

  for (const count of [1, 2, 3]) {
    reset(); revokeAfter = count;
    const failed = await execute();
    assertBlocked(failed.result, count);
    assert.ok(failed.result.costTotal > 0, "already-received usage stays accounted");
    assert.equal(failed.rows.at(-1)?.status, "failed", "denial cannot become optional output success");
  }
  for (const phase of ["generator", "judge"] as const) {
    reset(); invalidFirst = phase; revokeAfter = phase === "generator" ? 1 : 2;
    assertBlocked((await execute()).result, revokeAfter);
    reset(); invalidFirst = phase;
    const retried = await execute();
    assert.equal(retried.result.status, "completed");
    assert.equal(requests.length, phase === "generator" ? 5 : 6);
    assert.deepEqual(events, Array.from({ length: requests.length }, () => ["check", "fetch"]).flat());
  }
  for (const phase of ["generator", "judge", "package"] as const) {
    reset(); ambiguous = phase;
    assert.equal((await execute()).result.status, "failed");
    assert.equal(requests.length, phase === "generator" ? 1 : phase === "judge" ? 2 : 3,
      "ambiguous paid responses retain the existing no-replay policy");
  }

  // A cache hit buys nothing and needs no new grant; a changed request does.
  reset();
  const scope = createModelUsageScope();
  const check = createInlinePaidExecutionLeaseCheck(client as never, identity);
  await scope.run(async () => {
    const args = { prompt: "memo fixture", beforeDispatch: check };
    await creativeTextJson(args);
    run.executionAttempts++;
    await creativeTextJson(args);
    assert.equal(checks, 1); assert.equal(requests.length, 1);
    await assert.rejects(creativeTextJson({ ...args, prompt: "different request" }),
      (error: unknown) => error instanceof ExecutionError && error.retryable === false);
    assert.equal(requests.length, 1);
  });
  reset();
  const concurrentScope = createModelUsageScope();
  await concurrentScope.run(async () => {
    const args = { prompt: "coalesced fixture", beforeDispatch: check };
    await Promise.all([creativeTextJson(args), creativeTextJson(args)]);
    assert.equal(checks, 1); assert.equal(requests.length, 1);
  });
  console.log("Metadata inline fencing: real runner/block/transport and authenticated handler; fresh dispatch, ownership loss, retry refusal, memo reuse and no-replay passed");
}

main().finally(() => {
  loader._load = originalLoad; globalThis.fetch = originalFetch; _clear();
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalKey;
  if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_CONVEX_URL;
  else process.env.NEXT_PUBLIC_CONVEX_URL = originalUrl;
}).catch((error) => { console.error(error); process.exitCode = 1; });
