import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertInlineLease } from "../../../convex/runExecutionAdmission";

function harness() {
  const run = {
    _id: "run-a", ownerId: "owner-a", channelId: "channel-a", status: "running",
    leaseOwner: "worker-a", executionAttempts: 3, leaseExpiresAt: Date.now() + 120_000,
    remoteChildWaitUntil: Date.now() + 60_000, remoteChildWaitDispatchKey: "active-child",
    remoteChildWaitBlockId: "render", remoteChildWaitLeaseOwner: "worker-a", remoteChildWaitExecutionLeaseToken: 3,
  };
  const channel = { _id: "channel-a", ownerId: "owner-a", status: "paused" };
  let role = "service", identityOwner = "owner-a", reads = 0, writes = 0, failRead = false, missingRun = false;
  const ctx = {
    auth: { getUserIdentity: async () => ({
      subject: role === "service" ? "service:youtube-studio-ai" : role === "viewer" ? "viewer:" + identityOwner : identityOwner,
      role, owner_id: identityOwner,
    }) },
    db: {
      normalizeId: (_table: string, id: string) => id,
      get: async (id: string) => {
        reads++; if (failRead) throw new Error("database unavailable");
        return id === run._id ? (missingRun ? null : structuredClone(run)) : id === channel._id ? structuredClone(channel) : null;
      },
      query: () => { throw new Error("no stage scans allowed"); },
      patch: () => { writes++; throw new Error("no writes allowed"); },
      insert: () => { writes++; throw new Error("no writes allowed"); },
      delete: () => { writes++; throw new Error("no writes allowed"); },
    },
  };
  const args = { ownerId: "owner-a", channelId: "channel-a", runId: "run-a", leaseOwner: "worker-a", executionLeaseToken: 3, requestId: String(randomUUID()) };
  const invoke = (input = args) => (assertInlineLease as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<{ requestId: string; checkedAt: number; leaseExpiresAt: number }> })._handler(ctx, input);
  return { run, channel, args, invoke, stats: () => ({ reads, writes }), role: (next: string) => { role = next; },
    owner: (next: string) => { identityOwner = next; }, failRead: () => { failRead = true; }, missingRun: () => { missingRun = true; } };
}

async function main() {
  const h = harness(), original = structuredClone(h.run), started = Date.now();
  const result = await h.invoke();
  assert.equal(result.requestId, h.args.requestId);
  assert.equal(result.leaseExpiresAt, h.run.leaseExpiresAt);
  assert.ok(result.checkedAt >= started && result.checkedAt <= Date.now());
  assert.deepEqual(Object.keys(result).sort(), ["checkedAt", "leaseExpiresAt", "requestId"]);
  assert.deepEqual(h.stats(), { reads: 3, writes: 0 }, "two existing ownership reads plus one run read; no stage scan or writes");
  assert.deepEqual(h.run, original, "checking does not clear remote wait state or renew expiry");
  assert.equal(h.channel.status, "paused", "scheduling pause does not silently become active-run cancellation");

  for (const role of ["owner", "viewer"]) { const x = harness(); x.role(role); await assert.rejects(x.invoke(), /bound studio service identity/); assert.equal(x.stats().writes, 0); }
  const foreign = harness(); foreign.owner("foreign"); await assert.rejects(foreign.invoke(), /owner access denied/);
  for (const patch of [{ leaseOwner: "other-worker" }, { executionLeaseToken: 2 }, { executionLeaseToken: 0 },
    { executionLeaseToken: 1.5 }, { executionLeaseToken: NaN }, { leaseOwner: " " }, { requestId: "constant" }]) {
    const x = harness(); await assert.rejects(x.invoke({ ...x.args, ...patch }), /invalid|stale|owns/);
    assert.equal(x.stats().writes, 0);
  }
  for (const status of ["queued", "failed", "done", "cancelled"]) { const x = harness(); x.run.status = status; await assert.rejects(x.invoke(), /active lease/); }
  for (const expiresAt of [Date.now() - 1, 0, NaN, Infinity]) {
    const x = harness(); x.run.leaseExpiresAt = expiresAt;
    await assert.rejects(x.invoke(), /expired|expiry is invalid/);
  }
  const crossChannel = harness(); crossChannel.run.channelId = "channel-b";
  await assert.rejects(crossChannel.invoke(), /ownership\/channel mismatch/);
  const wrongRunOwner = harness(); wrongRunOwner.run.ownerId = "foreign";
  await assert.rejects(wrongRunOwner.invoke(), /access denied/);
  const wrongChannelOwner = harness(); wrongChannelOwner.channel.ownerId = "foreign";
  await assert.rejects(wrongChannelOwner.invoke(), /access denied/);
  const missing = harness(); missing.missingRun(); await assert.rejects(missing.invoke(), /access denied/);
  const outage = harness(); outage.failRead(); await assert.rejects(outage.invoke(), /database unavailable/);
  // A caller cannot backdate a check. Real Convex also rejects this undeclared
  // argument; bypassing only its validator here still does not affect the clock.
  const backdated = harness(); backdated.run.leaseExpiresAt = Date.now() - 1000;
  await assert.rejects(backdated.invoke({ ...backdated.args, now: 1 } as typeof backdated.args), /expired/);
  console.log("Inline execution admission: real authenticated handler rejects stale/foreign/expired work; three reads, no writes or remote-wait changes");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
