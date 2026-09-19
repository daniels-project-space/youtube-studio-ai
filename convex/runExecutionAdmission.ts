import { v } from "convex/values";
import { query, requireStudioServiceIdentity } from "./studioFunctions";
import { assertRunExecutionWriteFence, effectiveRunLeaseExpiry } from "../src/lib/runLease";

/** Fresh, read-only authority for one inline request; never a heartbeat or a budget grant. */
export const assertInlineLease = query({
  args: {
    ownerId: v.string(), channelId: v.id("channels"), runId: v.id("runs"),
    leaseOwner: v.string(), executionLeaseToken: v.number(), requestId: v.string(),
  },
  returns: v.object({ requestId: v.string(), checkedAt: v.number(), leaseExpiresAt: v.number() }),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "inline paid execution admission");
    // A unique query argument prevents a previous time-based grant being reused
    // from the query cache. It does not supply or override the server clock.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(args.requestId)) {
      throw new Error("inline execution request identity is invalid");
    }
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerId !== args.ownerId || run.channelId !== args.channelId) {
      throw new Error("inline execution ownership/channel mismatch");
    }
    const checkedAt = Date.now();
    const leaseExpiresAt = effectiveRunLeaseExpiry(run);
    if (!Number.isFinite(leaseExpiresAt)) throw new Error("inline execution lease expiry is invalid");
    assertRunExecutionWriteFence(run, args, checkedAt);
    return { requestId: args.requestId, checkedAt, leaseExpiresAt };
  },
});
