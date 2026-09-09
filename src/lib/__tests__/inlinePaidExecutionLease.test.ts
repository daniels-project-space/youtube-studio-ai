import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getFunctionName } from "convex/server";
import { createInlinePaidExecutionLeaseCheck } from "@/trigger/inlinePaidExecutionLease";

const identity = { ownerId: "owner-a", channelId: "channel-a", runId: "run-a", leaseOwner: "worker-a", executionLeaseToken: 3 };
type Request = typeof identity & { requestId: string };
type Grant = { requestId: string; checkedAt: number; leaseExpiresAt: number };
function client(reply: (args: Request) => Promise<Grant>) {
  return { query: async (ref: unknown, args: Request) => {
    assert.equal(getFunctionName(ref as never), "runExecutionAdmission:assertInlineLease");
    return reply(args);
  } };
}
async function main() {
  const requests: Request[] = [];
  const mutable = { ...identity };
  const check = createInlinePaidExecutionLeaseCheck(client(async (args) => {
    requests.push(structuredClone(args));
    return { requestId: args.requestId, checkedAt: 1_000_000, leaseExpiresAt: 1_060_000 };
  }) as never, mutable);
  mutable.executionLeaseToken = 99; mutable.ownerId = "changed";
  await check(); await check(); await Promise.all([check(), check()]);
  assert.equal(requests.length, 4);
  assert.equal(new Set(requests.map((r) => r.requestId)).size, 4, "every check defeats reuse of an earlier cached time-based result");
  for (const request of requests) { const { requestId, ...binding } = request; assert.deepEqual(binding, identity); assert.match(requestId, /^[a-f0-9-]{36}$/); }
  const delayed = createInlinePaidExecutionLeaseCheck(client(async ({ requestId }) => {
    await new Promise((resolve) => setTimeout(resolve, 15));
    return { requestId, checkedAt: 100, leaseExpiresAt: 105 };
  }) as never, identity);
  await assert.rejects(delayed(), /stale or invalid/, "a grant expired in transit is not authority");
  for (const mutate of [
    (r: Grant) => ({ ...r, requestId: "cached-previous-grant" }),
    (r: Grant) => ({ ...r, checkedAt: NaN }), (r: Grant) => ({ ...r, leaseExpiresAt: Infinity }),
    (r: Grant) => ({ ...r, leaseExpiresAt: r.checkedAt }),
  ]) {
    const rejected = createInlinePaidExecutionLeaseCheck(client(async ({ requestId }) => mutate({ requestId, checkedAt: 100, leaseExpiresAt: 10_000 })) as never, identity);
    await assert.rejects(rejected(), /INLINE_PAID_EXECUTION_LEASE_REQUIRED/);
  }
  const outage = createInlinePaidExecutionLeaseCheck(client(async () => { throw new Error("database unavailable"); }) as never, identity);
  await assert.rejects(outage(), (error: unknown) => error instanceof Error && error.message.includes("database unavailable") &&
    (error as Error & { retryable?: boolean }).retryable === false);
  const triggerSource = readFileSync("src/trigger/runPipeline.ts", "utf8");
  assert.match(triggerSource, /assertInlinePaidExecutionLease:\s*createInlinePaidExecutionLeaseCheck\(convex,\s*\{\s*ownerId, channelId: payload\.channelId, runId: payload\.runId, \.\.\.executionLease/);
  assert.doesNotMatch(readFileSync("src/trigger/inlinePaidExecutionLease.ts", "utf8"), /heartbeatExecutionLease|\.mutation\(|consistentQuery\(/);
  console.log("Inline lease callback: immutable identity, uncached requests, server-time/round-trip validation and production binding passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
