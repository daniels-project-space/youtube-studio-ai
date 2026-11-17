import assert from "node:assert/strict";
import { getFunctionName } from "convex/server";
import { dispatchPendingRouteQualificationBenchmarks } from "@/trigger/routeQualificationBenchmarkDispatcher";

async function main() {
  const calls: Array<{ name: string; args: unknown }> = [];
  const convex = {
    query: async (reference: Parameters<typeof getFunctionName>[0], args: unknown) => {
      calls.push({ name: getFunctionName(reference), args });
      return null;
    },
    mutation: async (reference: Parameters<typeof getFunctionName>[0], args: Record<string, unknown>) => {
      assert.equal(getFunctionName(reference), "routeQualificationBenchmarkRuns:reapExpiredQueuedForRun");
      assert.equal(args.ownerId, "owner-a");
      assert.equal(args.channelId, "channel-a");
      assert.equal(args.runId, "run-a");
      assert.equal(typeof args.now, "number");
      return { state: "unchanged" };
    },
  };
  const result = await dispatchPendingRouteQualificationBenchmarks({
    ownerId: "owner-a", target: { channelId: "channel-a", runId: "run-a" }, convex: convex as never,
  });
  assert.deepEqual(result, { pending: 0, triggered: 0 });
  assert.deepEqual(calls, [{ name: "routeQualificationBenchmarkRuns:getPendingForRun", args: {
    ownerId: "owner-a", channelId: "channel-a", runId: "run-a",
  } }]);
  console.log("Targeted private dispatch does not scan or recover other channels");
}
void main();
