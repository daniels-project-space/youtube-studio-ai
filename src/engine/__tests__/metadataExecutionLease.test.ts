import assert from "node:assert/strict";
import { readTitleReview } from "@/lib/titleReviewPresentation";
import Module from "node:module";
import { getFunctionName } from "convex/server";
import { assertInlineLease } from "../../../convex/runExecutionAdmission";
import { upsertRunStage } from "../../../convex/runStages";
import { makeConvexSink } from "@/engine/convexSink";
import { MODULE_CONTRACTS } from "@/engine/moduleContracts";
import { manifestFromBlock } from "@/engine/moduleManifest";
import { _clear, registerManifest } from "@/engine/registry";
import { runPipeline } from "@/engine/runner";
import type { RunStageSink } from "@/engine/types";
import { validatePipeline } from "@/engine/validate";
import { openRouterModel } from "@/lib/openRouter";
import type { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { createInlinePaidExecutionLeaseCheck } from "@/trigger/inlinePaidExecutionLease";

// Exercise the real runner, metadata block, title selection, JSON transport,
// accounting, checkpoint validation and authenticated Convex handler. Only the
// HTTP/storage/database boundaries are deterministic fixtures; no live spend.
type Phase = "generator" | "judge" | "package" | "comment";
type Row = NonNullable<Awaited<ReturnType<NonNullable<RunStageSink["getResumeState"]>>>>[number];
const honest = "47 Engineers Died in the Bridge Collapse";
const contradicted = "47 Engineers Survived the Bridge Collapse";
const narration = "A sourced account. ".repeat(100) + "The bridge collapse killed 47 engineers. No engineers survived.";
let expectedNarration = narration;
let requestSizes: { phase: Phase; messageBytes: number }[] = [];
const objects = new Map<string, Uint8Array>();
let afterPut: (key: string) => void = () => {};
let afterResponse: (phase: Phase) => void = () => {};
let calls: Phase[] = [], events: string[] = [], suggestionCalls = 0, performanceReads = 0;
let rejectedSelections = 0, rejectedPackages = 0;
let usageShape: "absent" | "native" | "legacy" | "invalid" = "absent";
let checkpointReads = 0;
let beforeGet: (key: string) => void = () => {};
let beforeStageWrite: (args: Record<string, unknown>) => void = () => {};
const loader = (Module as unknown as { _load: (...args: unknown[]) => unknown });
const originalLoad = loader._load;
loader._load = function(this: unknown, request: string, ...rest: unknown[]) {
  const actual = originalLoad.call(this, request, ...rest) as Record<string, unknown>;
  if (request.endsWith("/storage")) return { ...actual,
    getObjectBytes: async (key: string) => {
      if (key.includes("/metadata-title/v1/")) checkpointReads++;
      beforeGet(key);
      const value = objects.get(key);
      if (!value) throw Object.assign(new Error("not found"), { name: "NoSuchKey" });
      return Uint8Array.from(value);
    },
    putObject: async (key: string, value: Uint8Array, options: { ifNoneMatch?: string }) => {
      assert.equal(options.ifNoneMatch, "*", "every checkpoint remains create-only");
      if (objects.has(key)) throw Object.assign(new Error("exists"), { $metadata: { httpStatusCode: 412 } });
      objects.set(key, Uint8Array.from(value)); events.push("put:" + key.split("/").at(-1)); afterPut(key);
      return key;
    },
  };
  if (request.endsWith("/performance")) return { ...actual, loadPerformanceContext: async () => {
    performanceReads++; return "Frozen performance evidence";
  } };
  return actual;
} as never;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { metadataOptimized } = require("../../trigger/blocks/intelligenceBlocks") as typeof import("../../trigger/blocks/intelligenceBlocks");
loader._load = originalLoad;

const originalFetch = globalThis.fetch;
const originalKey = process.env.OPENROUTER_API_KEY;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.hostname === "suggestqueries.google.com" && url.pathname === "/complete/search") {
    suggestionCalls++; return Response.json(["Bridge collapse", []]);
  }
  assert.equal(url.origin, "https://openrouter.ai", "an unexpected network target must fail");
  assert.equal(url.pathname, "/api/v1/chat/completions");
  assert.equal(init?.method, "POST");
  assert.equal(events.at(-1), "lease:ok", "fresh authenticated authority immediately precedes every provider request");
  const body = JSON.parse(String(init?.body));
  assert.equal(body.model, openRouterModel("intelligence"), "no fixture-only model downgrade");
  const prompt = body.messages.find((message: { role: string }) => message.role === "user").content as string;
  const phase: Phase = prompt.startsWith("Write SEVEN") ? "generator" : prompt.startsWith("You are") ? "judge" :
    prompt.startsWith("Write the YouTube") ? "package" : "comment";
  assert.ok(prompt.includes(JSON.stringify(expectedNarration)),
    `${phase}: the complete JSON-escaped source reaches the actual HTTP boundary, not a truncated excerpt`);
  requestSizes.push({ phase, messageBytes: Buffer.byteLength(JSON.stringify(body.messages)) });
  calls.push(phase); events.push("provider:" + phase);
  let value: unknown;
  if (phase === "generator") value = { candidates: [{ frame: "direct_verdict", title: honest }] };
  else if (phase === "judge") {
    assert.ok(prompt.includes("No engineers survived."), "full narration, including its decisive tail, reaches the real judge transport");
    value = { rankings: [
      { idx: 0, clickScore: 10, direct: 10, identityFit: 9, grounding: "contradicted", reason: "No engineers survived" },
      { idx: 1, clickScore: rejectedSelections-- > 0 ? 1 : 9, direct: 9, identityFit: 9, grounding: "supported", reason: "Source says killed 47" },
    ] };
  } else if (phase === "package") value = rejectedPackages-- > 0 ? {} : {
    description: "A sourced engineering account.", tagsCsv: "bridge,engineers,collapse,history,design",
  };
  else value = { comment: "Which engineering decision mattered most?" };
  afterResponse(phase);
  return Response.json({ id: "fixture-" + calls.length, model: body.model,
    choices: [{ message: { content: JSON.stringify(value) } }],
    usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200,
      ...(usageShape === "legacy" ? { reasoning_tokens: 190 } : {}),
      ...(usageShape === "native" || usageShape === "invalid"
        ? { completion_tokens_details: { reasoning_tokens: usageShape === "invalid" ? 201 : 190 } } : {}),
    },
  });
};

function harness(paidAdmissionFixture = false, sourceNarration = narration) {
  objects.clear(); calls = []; events = []; suggestionCalls = 0; performanceReads = 0;
  afterPut = () => {}; afterResponse = () => {}; process.env.OPENROUTER_API_KEY = "fixture-key-no-network";
  rejectedSelections = 0; rejectedPackages = 0;
  usageShape = "absent";
  expectedNarration = sourceNarration; requestSizes = [];
  checkpointReads = 0; beforeGet = () => {}; beforeStageWrite = () => {};
  const run = { _id: "run-lease", ownerId: "owner-lease", channelId: "channel-lease", status: "running",
    leaseOwner: "worker-a", executionAttempts: 1, leaseExpiresAt: Date.now() + 120_000 };
  const channel = { _id: run.channelId, ownerId: run.ownerId };
  const rows = new Map<string, Row>();
  const sink: RunStageSink = {
    async upsert(args) {
      // Persistence fixture, NOT a claim to test Convex OCC/write fences here.
      const previous = rows.get(args.block) ?? { block: args.block, status: "queued", cost: 0 };
      rows.set(args.block, { ...previous, ...Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined)) });
    },
    async getResumeState() { return structuredClone([...rows.values()]); },
  };
  const requestIds = new Set<string>();
  let checks = 0, reads = 0;
  const ctx = {
    auth: { getUserIdentity: async () => ({ subject: "service:youtube-studio-ai", role: "service", owner_id: run.ownerId }) },
    db: {
      normalizeId: (_table: string, id: string) => id,
      get: async (id: string) => { reads++; return id === run._id ? structuredClone(run) : id === channel._id ? structuredClone(channel) : null; },
      query: () => { throw new Error("no stage scan allowed"); },
      patch: () => { throw new Error("lease check must not write or renew"); },
    },
  };
  const client = { query: async (ref: Parameters<StudioConvexHttpClient["query"]>[0], args: { requestId: string }) => {
    assert.equal(getFunctionName(ref), "runExecutionAdmission:assertInlineLease");
    assert.ok(!requestIds.has(args.requestId), "no query grant is reused"); requestIds.add(args.requestId); checks++;
    const value = await (assertInlineLease as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })._handler(ctx, args);
    events.push("lease:ok"); return value;
  } } as unknown as Pick<StudioConvexHttpClient, "query">;
  // A second path uses the actual production sink and mutation handler too.
  // The database remains in memory: this proves handler behavior, not live OCC.
  const mutationCtx = { ...ctx, db: { ...ctx.db,
    query: (table: string) => {
      assert.equal(table, "runStages");
      return { withIndex: (name: string, select: (q: unknown) => unknown) => {
        assert.equal(name, "by_run_block");
        const terms: Record<string, unknown> = {};
        const q = { eq: (key: string, value: unknown) => { terms[key] = value; return q; } };
        select(q); assert.equal(terms.runId, run._id);
        return { unique: async () => {
          const row = rows.get(String(terms.block));
          return row ? { ...structuredClone(row), _id: "stage-" + row.block } : null;
        } };
      } };
    },
    insert: async (table: string, data: Row) => {
      assert.equal(table, "runStages"); rows.set(data.block, structuredClone(data)); return "stage-" + data.block;
    },
    patch: async (id: string, patch: Partial<Row>) => {
      assert.equal(id, "stage-metadata");
      const row = { ...rows.get("metadata")!, ...structuredClone(patch) };
      rows.set("metadata", row);
    },
  } };
  const writerClient = { mutation: async (ref: Parameters<StudioConvexHttpClient["mutation"]>[0], args: unknown) => {
    assert.equal(getFunctionName(ref), "runStages:upsertRunStage");
    beforeStageWrite(args as Record<string, unknown>);
    const value = await (upsertRunStage as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })._handler(mutationCtx, args);
    if ((args as Record<string, unknown>).checkpointCostReceipts) events.push("stage:receipts-persisted");
    return value;
  } } as unknown as StudioConvexHttpClient;
  // This is an explicit TEST envelope for the fixed HTTP usage fixture below,
  // not a qualified production ceiling or permission to flip metadata paid.
  assert.equal(Boolean(metadataOptimized.paid), false);
  _clear(); registerManifest(manifestFromBlock(paidAdmissionFixture ? { ...metadataOptimized, paid: true } : metadataOptimized,
    paidAdmissionFixture ? { ...MODULE_CONTRACTS.metadata, maxCostUsd: 0.012 } : MODULE_CONTRACTS.metadata));
  const pipeline = validatePipeline([{ block: "metadata" }], ["topic"]);
  assert.equal(pipeline.manifests[0].costAndLatency.paid, paidAdmissionFixture);
  const execute = (authority = true, fencedWrites = false, budgetUsd = paidAdmissionFixture ? 0.012 : 1) => runPipeline(pipeline, {
    ownerId: run.ownerId, channelId: run.channelId, runId: run._id, keyPrefix: "lease-fixture/",
    budgetUsd, defaultRetries: 0, sink: fencedWrites ? { ...sink, upsert: makeConvexSink(writerClient, run.ownerId, {
      leaseOwner: run.leaseOwner, executionLeaseToken: run.executionAttempts,
    }).upsert } : sink,
    executionLease: { leaseOwner: run.leaseOwner, executionLeaseToken: run.executionAttempts },
    ...(authority ? { assertInlinePaidExecutionLease: createInlinePaidExecutionLeaseCheck(client, {
      ownerId: run.ownerId, channelId: run.channelId, runId: run._id,
      leaseOwner: run.leaseOwner, executionLeaseToken: run.executionAttempts,
    }) } : {}),
    seedStore: { topic: "Bridge collapse", channelName: "Field Notes", narrationText: sourceNarration,
      plannedTitle: contradicted, competitors: [] },
    rehydrate: async (_block, outputs) => ({ ok: true, outputs }),
  });
  const outcome = (name: string) => {
    const bytes = objects.get("lease-fixture/runs/run-lease/metadata-title/v1/" + name + ".outcome.json");
    return bytes ? JSON.parse(Buffer.from(bytes).toString()) : undefined;
  };
  const checkpointCost = () => ["selection", "package-1", "package-2", "comment"]
    .reduce((sum, name) => sum + (outcome(name)?.cost.costUsd ?? 0), 0);
  return { run, rows, execute, outcome, checkpointCost, stats: () => ({ checks, reads }) };
}
function equalCost(actual: number, expected: number) {
  assert.ok(expected > 0 && Math.abs(actual - expected) < 1e-10, `actual transport accounting ${actual} != durable receipts ${expected}`);
}

async function main() {
  let h = harness();
  const fresh = await h.execute();
  assert.equal(fresh.ok, true, fresh.error); assert.equal(fresh.store.title, honest);
  assert.deepEqual(calls, ["generator", "judge", "package", "comment"]);
  assert.deepEqual(h.stats(), { checks: 8, reads: 24 }); equalCost(fresh.costTotal, h.checkpointCost());
  const originalObjects = structuredClone(objects), originalDecision = fresh.store.titleDecision;
  delete process.env.OPENROUTER_API_KEY;
  const completed = await h.execute(false);
  assert.equal(completed.ok, true, completed.error); assert.equal(calls.length, 4);
  assert.deepEqual(h.stats(), { checks: 8, reads: 24 }); equalCost(completed.costTotal, fresh.costTotal);
  // Force actual metadata-body checkpoint restoration, not only runner skip.
  h.rows.get("metadata")!.status = "failed";
  const restored = await h.execute(false);
  assert.equal(restored.ok, true, restored.error); assert.equal(calls.length, 4);
  assert.deepEqual(restored.store.titleDecision, originalDecision);
  assert.deepEqual(readTitleReview(restored.store), readTitleReview(fresh.store),
    "real engine restoration retains the same human-readable review without another purchase");
  assert.equal(readTitleReview(restored.store)?.state, "recorded");
  assert.deepEqual(objects, originalObjects); equalCost(restored.costTotal, fresh.costTotal);
  assert.equal(performanceReads, 1); assert.equal(suggestionCalls, 1);
  assert.deepEqual(h.stats(), { checks: 8, reads: 24 });

  h = harness(); rejectedSelections = 1; rejectedPackages = 1;
  const bounded = await h.execute();
  assert.equal(bounded.ok, true, bounded.error);
  assert.deepEqual(calls, ["generator", "judge", "generator", "judge", "package", "package", "comment"]);
  assert.deepEqual(h.stats(), { checks: 12, reads: 36 }, "both bounded retries still have fresh request/claim checks");
  equalCost(bounded.costTotal, h.checkpointCost());

  h = harness();
  const absent = await h.execute(false);
  assert.equal(absent.ok, false); assert.match(absent.error ?? "", /INLINE_PAID_EXECUTION_LEASE_REQUIRED/);
  assert.equal(calls.length, 0); assert.equal(objects.size, 0);
  for (const patch of [{ status: "cancelled" }, { leaseExpiresAt: Date.now() - 1000 }]) {
    h = harness(); Object.assign(h.run, patch);
    const denied = await h.execute(); assert.equal(denied.ok, false);
    assert.match(denied.error ?? "", /INLINE_PAID_EXECUTION_LEASE_REQUIRED/);
    assert.equal(calls.length, 0); assert.equal(objects.size, 0);
  }

  for (const phase of ["judge", "package"] as const) {
    h = harness();
    afterResponse = (received) => { if (received === phase) h.run.executionAttempts++; };
    const stopped = await h.execute();
    assert.equal(stopped.ok, false); assert.match(stopped.error ?? "", /INLINE_PAID_EXECUTION_LEASE_REQUIRED/);
    assert.equal(h.outcome("selection").status, "ok", "received decision survives worker revocation");
    if (phase === "package") assert.equal(h.outcome("package-1").status, "ok");
    const decision = structuredClone(h.outcome("selection"));
    equalCost(stopped.costTotal, h.checkpointCost());
    assert.deepEqual(calls, phase === "judge" ? ["generator", "judge"] : ["generator", "judge", "package"]);
    afterResponse = () => {};
    const recovered = await h.execute();
    assert.equal(recovered.ok, true, recovered.error); assert.equal(recovered.store.title, honest);
    assert.deepEqual(calls, ["generator", "judge", "package", "comment"], "new generation buys only missing work");
    assert.deepEqual(h.outcome("selection"), decision, "recovery cannot rewrite the title or its receipt");
    equalCost(recovered.costTotal, h.checkpointCost());
    assert.equal(performanceReads, 1); assert.equal(suggestionCalls, 1);
  }

  // A partial selection is not falsely promoted to a valid title checkpoint.
  h = harness(); afterResponse = (phase) => { if (phase === "generator") h.run.executionAttempts++; };
  const partial = await h.execute();
  assert.equal(partial.ok, false); assert.deepEqual(calls, ["generator"]);
  assert.equal(h.outcome("selection").status, "held"); equalCost(partial.costTotal, h.checkpointCost());
  afterResponse = () => {};
  const held = await h.execute();
  assert.equal(held.ok, false); assert.match(held.error ?? "", /RECONCILIATION_REQUIRED/);
  assert.deepEqual(calls, ["generator"], "an incomplete accepted purchase must not be silently bought again");
  equalCost(held.costTotal, partial.costTotal);

  h = harness(); afterPut = (key) => { if (key.endsWith("selection.claim.json")) h.run.executionAttempts++; };
  const between = await h.execute();
  assert.equal(between.ok, false); assert.equal(calls.length, 0);
  assert.equal(h.outcome("selection").status, "held"); assert.equal(h.outcome("selection").cost.costUsd, 0);
  afterPut = () => {};
  assert.equal((await h.execute()).ok, false); assert.equal(calls.length, 0);

  for (const phase of ["judge", "package", "comment"] as const) {
    h = harness(); afterResponse = (received) => { if (received === phase) h.run.executionAttempts++; };
    await assert.rejects(h.execute(true, true), /stale/, "actual production stage sink/handler refuses stale terminal writes");
    assert.equal(h.rows.get("metadata")!.status, "running");
    assert.equal(h.rows.get("metadata")!.cost, 0, "stale worker cannot update the stage's cost or result");
    assert.ok(h.checkpointCost() > 0, "received responses and cost receipts survive in the immutable checkpoint");
    const beforeResume = structuredClone(objects);
    afterResponse = () => {};
    const recovered = await h.execute(true, true);
    assert.equal(recovered.ok, true, recovered.error);
    assert.deepEqual(calls, ["generator", "judge", "package", "comment"], "actual fenced recovery never repurchases completed work");
    equalCost(recovered.costTotal, h.checkpointCost());
    equalCost(h.rows.get("metadata")!.cost!, h.checkpointCost());
    assert.equal(h.rows.get("metadata")!.status, "ok");
    for (const [key, value] of beforeResume) assert.deepEqual(objects.get(key), value);
  }

  // Real metadata through the paid-admission hook, with a clearly labelled
  // fixture ceiling. These tests do not change the production classification.
  h = harness(true);
  const admitted = await h.execute(true, true);
  assert.equal(admitted.ok, true, admitted.error); equalCost(admitted.costTotal, h.checkpointCost());
  assert.equal(checkpointReads, 18, "engine inspection plus independent body revalidation: nine keys each");
  h.rows.get("metadata")!.status = "failed";
  delete process.env.OPENROUTER_API_KEY;
  const replay = await h.execute(false, true, admitted.costTotal);
  assert.equal(replay.ok, true, replay.error); equalCost(replay.costTotal, admitted.costTotal);
  assert.equal(calls.length, 4); assert.equal(checkpointReads, 36);

  for (const phase of ["judge", "package", "comment"] as const) {
    h = harness(true); afterResponse = (received) => { if (received === phase) h.run.executionAttempts++; };
    await assert.rejects(h.execute(true, true), /stale/);
    assert.equal(h.rows.get("metadata")!.cost, 0);
    const savedCost = h.checkpointCost(), savedObjects = structuredClone(objects), bought = calls.length;
    afterResponse = () => {};
    beforeStageWrite = (args) => {
      if (args.status === "running" && args.checkpointCostReceipts) {
        equalCost(Number(args.cost), savedCost);
        assert.equal(calls.length, bought, "recover accepted cost durably before any further HTTP purchase");
      }
    };
    const recovered = await h.execute(true, true);
    assert.equal(recovered.ok, true, recovered.error); equalCost(recovered.costTotal, h.checkpointCost());
    assert.deepEqual(calls, ["generator", "judge", "package", "comment"]);
    for (const [key, bytes] of savedObjects) assert.deepEqual(objects.get(key), bytes);
    const resumeEvents = events.slice(events.indexOf("stage:receipts-persisted"));
    if (phase !== "comment") assert.ok(resumeEvents.includes("provider:comment"));
  }

  h = harness(true); afterResponse = (phase) => { if (phase === "judge") h.run.executionAttempts++; };
  const partialAccounted = await h.execute();
  assert.equal(partialAccounted.ok, false); equalCost(partialAccounted.costTotal, h.checkpointCost());
  afterResponse = () => {};
  const accountedResume = await h.execute(true, true);
  assert.equal(accountedResume.ok, true, accountedResume.error); equalCost(accountedResume.costTotal, h.checkpointCost());
  assert.equal(calls.length, 4);

  h = harness(true); afterResponse = (phase) => { if (phase === "judge") h.run.executionAttempts++; };
  await assert.rejects(h.execute(true, true), /stale/);
  afterResponse = () => {};
  beforeStageWrite = (args) => { if (args.status === "running" && args.checkpointCostReceipts) throw new Error("Convex write unavailable"); };
  const persistFailed = await h.execute(true, true);
  assert.equal(persistFailed.ok, false); assert.match(persistFailed.error!, /Convex write unavailable/);
  equalCost(persistFailed.costTotal, h.checkpointCost());
  assert.deepEqual(calls, ["generator", "judge"]);
  beforeStageWrite = () => {};
  assert.equal((await h.execute(true, true)).ok, true); assert.equal(calls.length, 4);

  for (const budget of [0, NaN, Infinity, 0.011]) {
    h = harness(true);
    const denied = await h.execute(true, true, budget);
    assert.equal(denied.ok, false); assert.equal(calls.length, 0); assert.equal(objects.size, 0);
  }
  h = harness(true); beforeGet = () => { throw new Error("R2 unavailable"); };
  assert.equal((await h.execute(true, true)).ok, false); assert.equal(calls.length, 0); assert.equal(objects.size, 0);
  h = harness(true); h.rows.set("metadata", { block: "metadata", status: "running", cost: 0 });
  assert.equal((await h.execute(true, true)).ok, false); assert.equal(calls.length, 0); assert.equal(objects.size, 0);
  h = harness(true); afterResponse = (phase) => { if (phase === "generator") h.run.executionAttempts++; };
  await assert.rejects(h.execute(true, true), /stale/); afterResponse = () => {};
  const heldPaid = await h.execute(true, true);
  assert.equal(heldPaid.ok, false); assert.deepEqual(calls, ["generator"]);
  equalCost(heldPaid.costTotal, h.checkpointCost());
  equalCost(h.rows.get("metadata")!.cost!, h.checkpointCost());
  const heldBytes = structuredClone(objects);
  delete process.env.OPENROUTER_API_KEY;
  for (let attempt = 0; attempt < 3; attempt++) {
    const repeated = await h.execute(false, true, 0);
    assert.equal(repeated.ok, false); equalCost(repeated.costTotal, heldPaid.costTotal);
    assert.deepEqual(calls, ["generator"]); assert.deepEqual(objects, heldBytes);
    assert.equal(h.rows.get("metadata")!.checkpointCostReceipts!.length, 1);
  }

  h = harness(true);
  afterPut = (key) => {
    if (key.endsWith("package-1.claim.json")) {
      h.run.executionAttempts++; throw new Error("fixture: paid-claim acknowledgment lost");
    }
  };
  await assert.rejects(h.execute(true, true), /stale/);
  assert.equal(h.outcome("package-1"), undefined); assert.equal(h.rows.get("metadata")!.cost, 0);
  afterPut = () => {};
  const unknownPackage = await h.execute(true, true);
  assert.equal(unknownPackage.ok, false); assert.match(unknownPackage.error!, /in-flight\/unknown paid outcome/);
  equalCost(unknownPackage.costTotal, h.checkpointCost()); equalCost(h.rows.get("metadata")!.cost!, h.checkpointCost());
  assert.deepEqual(calls, ["generator", "judge"], "an unknown claim never authorizes a replacement request");

  // A transport outage on one fixed R2 key does not erase independently scoped
  // known charges from readable keys; restore later without another purchase.
  h = harness(true); const beforeReadFailure = await h.execute(true, true);
  const rowBeforeReadFailure = h.rows.get("metadata")!;
  Object.assign(rowBeforeReadFailure, { status: "running", cost: 0, checkpointCostReceipts: [] });
  beforeGet = (key) => { if (key.endsWith("comment.outcome.json")) throw new Error("fixture R2 response unavailable"); };
  const r2Held = await h.execute(true, true);
  assert.equal(r2Held.ok, false); assert.match(r2Held.error!, /R2 response unavailable/);
  equalCost(r2Held.costTotal, h.outcome("selection").cost.costUsd + h.outcome("package-1").cost.costUsd);
  equalCost(h.rows.get("metadata")!.cost!, r2Held.costTotal); assert.equal(calls.length, 4);
  beforeGet = () => {}; delete process.env.OPENROUTER_API_KEY;
  const r2Restored = await h.execute(false, true);
  assert.equal(r2Restored.ok, true, r2Restored.error); equalCost(r2Restored.costTotal, beforeReadFailure.costTotal);
  assert.equal(calls.length, 4);

  for (const failure of ["unavailable", "stale"] as const) {
    h = harness(true); afterResponse = (phase) => { if (phase === "generator") h.run.executionAttempts++; };
    await assert.rejects(h.execute(true, true), /stale/); afterResponse = () => {};
    beforeStageWrite = (args) => {
      if (args.status === "failed" && args.checkpointCostReceipts) {
        if (failure === "stale") h.run.executionAttempts++;
        else throw new Error("fixture held-cost summary unavailable");
      }
    };
    if (failure === "stale") await assert.rejects(h.execute(true, true), /stale/);
    else {
      const failedSummary = await h.execute(true, true);
      assert.equal(failedSummary.ok, false); equalCost(failedSummary.costTotal, h.checkpointCost());
    }
    assert.equal(h.rows.get("metadata")!.cost, 0); assert.deepEqual(calls, ["generator"]);
    beforeStageWrite = () => {};
    const saved = await h.execute(true, true);
    assert.equal(saved.ok, false); equalCost(saved.costTotal, h.checkpointCost());
    equalCost(h.rows.get("metadata")!.cost!, h.checkpointCost()); assert.deepEqual(calls, ["generator"]);
  }
  h = harness(true); rejectedSelections = 1; rejectedPackages = 1;
  const admittedRetries = await h.execute(true, true);
  assert.equal(admittedRetries.ok, true, admittedRetries.error); equalCost(admittedRetries.costTotal, h.checkpointCost());
  assert.equal(calls.length, 7);
  for (const shape of ["native", "legacy"] as const) {
    h = harness(true); usageShape = shape;
    const normalized = await h.execute(true, true);
    assert.equal(normalized.ok, true, normalized.error);
    equalCost(normalized.costTotal, 0.006); equalCost(h.checkpointCost(), 0.006);
    equalCost(h.rows.get("metadata")!.cost!, 0.006);
    assert.deepEqual(calls, ["generator", "judge", "package", "comment"]);
    const savedReceipts = structuredClone(objects);
    delete process.env.OPENROUTER_API_KEY;
    const restored = await h.execute(false, true);
    assert.equal(restored.ok, true, restored.error); equalCost(restored.costTotal, 0.006);
    assert.equal(calls.length, 4); assert.deepEqual(objects, savedReceipts, "normalization never rewrites existing immutable outcomes");
  }
  h = harness(true); usageShape = "invalid";
  const malformedUsage = await h.execute(true, true);
  assert.equal(malformedUsage.ok, false); equalCost(malformedUsage.costTotal, 0.0015);
  assert.deepEqual(calls, ["generator"], "malformed reasoning holds before the next paid judge request");
  delete process.env.OPENROUTER_API_KEY;
  const malformedRecovery = await h.execute(false, true);
  assert.equal(malformedRecovery.ok, false); equalCost(malformedRecovery.costTotal, 0.0015);
  assert.deepEqual(calls, ["generator"], "known-cost recovery does not repurchase the held operation");
  for (const [name, passage] of [
    ["long-form", "The archive describes the design, the inspection and the witnesses, without changing who survived.\n"],
    ["multilingual", "橋の記録。الوثيقة الأصلية。Ingenieurbericht: \"Prüfung\" — récit vérifié 🏗️\n"],
  ] as const) {
    const source = passage.repeat(1200) + "The bridge collapse killed 47 engineers. No engineers survived.";
    h = harness(true, source); rejectedSelections = 1; rejectedPackages = 1;
    const expanded = await h.execute(true, true);
    assert.equal(expanded.ok, true, expanded.error);
    assert.deepEqual(calls, ["generator", "judge", "generator", "judge", "package", "package", "comment"]);
    assert.ok(requestSizes.every(row => row.messageBytes > 50_000));
    assert.deepEqual((expanded.store.titleDecision as { sourceCoverage: unknown }).sourceCoverage,
      { kind: "full_narration", providedChars: source.length, totalChars: source.length });
    const original = structuredClone(objects);
    h.rows.get("metadata")!.status = "failed"; delete process.env.OPENROUTER_API_KEY;
    const replay = await h.execute(false, true);
    assert.equal(replay.ok, true, replay.error); assert.equal(calls.length, 7);
    assert.deepEqual(objects, original); assert.deepEqual(replay.store.titleDecision, expanded.store.titleDecision);
    console.log(JSON.stringify({ sourcePreservationFixture: name, sourceChars: source.length,
      sourceBytes: Buffer.byteLength(source), requests: requestSizes,
      liveDispatches: 0, pricingQualification: false }));
  }
  console.log("Real metadata engine/transport lease integration: 8 fresh checks, zero-purchase stale rejection, immutable completed outcomes, exact missing-work recovery and cost deduplication passed (fixture boundaries only)");
  console.log("Real paid metadata admission: 18 checkpoint reads, paid-fenced cost recovery before purchase, zero-cost replay, refused missing/unreadable/held ledgers and bounded retries passed (TEST envelope only)");
  console.log("Held-cost recovery: known charges survive unknown claims, partial R2 outage, stale/unavailable summary writes and repeated retries; no held body or duplicate purchase (fixture boundaries only)");
  console.log("Native/legacy inclusive reasoning costs persist exactly once through real stage handlers; malformed usage retains known cost and blocks later purchase (fixture boundaries only)");
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  globalThis.fetch = originalFetch; loader._load = originalLoad;
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = originalKey;
});
