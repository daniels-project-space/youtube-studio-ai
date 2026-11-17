import assert from "node:assert/strict";
import { reapExpiredQueuedForRun } from "../../../convex/routeQualificationBenchmarkRuns";
import { createRouteQualificationBenchmarkInput, prepareRouteQualificationBenchmarkDispatchEnvelope } from "../routeQualificationBenchmark";

async function main() {
  const digest = "a".repeat(64);
  const input = createRouteQualificationBenchmarkInput({
    productionPipeline: [{ block: "topic_select", params: { targetSeconds: 420 } }, { block: "script_gen", params: { maxSeconds: 420 } },
      { block: "timeline_assemble" }, { block: "qa_visual", params: { qaProfile: "production" } }, { block: "upload_draft" }],
    moduleConfigOverride: {}, invocationContext: { keyPrefix: "owner/owner-a/channel/channel-a/", seedStore: {}, madeForKids: false },
    preflightReceiptFingerprint: digest,
  });
  const envelope = prepareRouteQualificationBenchmarkDispatchEnvelope({ ownerId: "owner-a", channelId: "channel-a", runId: "run-a",
    dispatchKey: "route-qualification-benchmark:request-a", input, maximumCostUsd: 5, approval: { action: "route-qualification-benchmark", maxCostUsd: 5 } as never });
  const row: Record<string, unknown> = { _id: "run-a", ownerId: "owner-a", channelId: "channel-a",
    status: "awaiting_route_qualification_benchmark_dispatch", routeQualificationBenchmarkDispatchState: "queued",
    routeQualificationBenchmarkDispatchKey: envelope.dispatchKey, routeQualificationBenchmarkDispatchEnvelope: envelope,
    routeQualificationBenchmarkDispatchEnvelopeFingerprint: envelope.dispatchEnvelopeFingerprint,
    routeQualificationBenchmarkDispatchAttempts: 1, routeQualificationBenchmarkDispatchQueueDeadlineAt: 1000 };
  const other = { _id: "run-b", ownerId: "owner-a", channelId: "channel-b", marker: "unchanged" };
  const patched: string[] = [];
  const db = { normalizeId: (_table: string, id: string) => id,
    get: async (id: string) => id === "run-a" ? row : id === "run-b" ? other : id === "channel-a" ? { _id: id, ownerId: "owner-a" } : null,
    patch: async (id: string, patch: Record<string, unknown>) => { patched.push(id); Object.assign(row, patch); } };
  const ctx = { db, auth: { getUserIdentity: async () => ({ subject: "service:youtube-studio-ai", role: "service", owner_id: "owner-a" }) } };
  const invoke = (args: unknown) => (reapExpiredQueuedForRun as unknown as { _handler: (c: unknown, a: unknown) => Promise<{ state: string }> })._handler(ctx, args);
  assert.equal((await invoke({ ownerId: "owner-a", channelId: "channel-a", runId: "run-a", now: 999 })).state, "unchanged");
  assert.deepEqual(patched, []);
  await assert.rejects(invoke({ ownerId: "owner-a", channelId: "channel-a", runId: "run-b", now: 2000 }), /ownership|access/i);
  assert.equal((await invoke({ ownerId: "owner-a", channelId: "channel-a", runId: "run-a", now: 2000 })).state, "requeued");
  assert.equal(row.routeQualificationBenchmarkDispatchState, "pending");
  assert.deepEqual(patched, ["run-a"]);
  assert.equal(other.marker, "unchanged");
  console.log("Targeted benchmark recovery respects the deadline and never modifies another run");
}
void main();
