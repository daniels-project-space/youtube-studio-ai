import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";
import { v } from "convex/values";

const MAX_DAILY_ATTEMPT_LIMIT = 200;
const UTC_DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

function assertDailyClaimArgs(args: { day: string; limit: number }): void {
  if (!UTC_DAY_KEY.test(args.day)) {
    throw new Error("Casefile research day must be a UTC YYYY-MM-DD key");
  }
  if (!Number.isInteger(args.limit) || args.limit < 0 || args.limit > MAX_DAILY_ATTEMPT_LIMIT) {
    throw new Error(`Casefile research daily limit must be an integer from 0 to ${MAX_DAILY_ATTEMPT_LIMIT}`);
  }
}

/**
 * Daily spend ledger for the automatic Casefile case-research path.
 *
 * `researchCase()` (src/engine/casefileCaseResearcher.ts) is the one place in
 * this system that spends real money BEFORE `run-pipeline` starts, so it is
 * structurally outside every `invocation.budgetUsd` check. These two
 * functions are the counter behind the fleet-wide daily ceiling enforced in
 * `casefileAutoResearchDispatch.ts`.
 *
 * The `day` bucket is supplied by the caller (a UTC "YYYY-MM-DD" key) rather
 * than derived here, so the boundary is deterministic and unit-testable on
 * the TypeScript side instead of depending on Convex's clock.
 */

/** Fleet-wide (all channels for this owner) billable attempts already made in `day`. */
export const countForDay = query({
  args: { ownerId: v.string(), day: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("casefileResearchAttempts")
      .withIndex("by_owner_day", (q) => q.eq("ownerId", args.ownerId).eq("day", args.day))
      .collect();
    return rows.length;
  },
});

/**
 * Atomically admits and records ONE billable research attempt. Convex retries
 * this indexed read + insert as one mutation transaction, so concurrent
 * schedulers cannot both observe the final remaining slot. This is deliberately
 * service-only: a client must never manufacture or bypass pre-pipeline spend
 * admission.
 */
export const claimAttemptUnderDailyCap = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    day: v.string(),
    limit: v.number(),
  },
  returns: v.union(
    v.object({
      kind: v.literal("claimed"),
      attemptsToday: v.number(),
      limit: v.number(),
    }),
    v.object({
      kind: v.literal("daily_ceiling_reached"),
      attemptsToday: v.number(),
      limit: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "Casefile research daily spend admission");
    assertDailyClaimArgs(args);
    const channel = await ctx.db.get(args.channelId);
    if (!channel || channel.ownerId !== args.ownerId) {
      throw new Error("Casefile research attempt channel ownership mismatch");
    }
    // `take(limit + 1)` is intentionally bounded: all the caller needs to
    // know is whether the cap has already been reached. The mutation remains
    // correct even if historical data predates a lower configured ceiling.
    const rows = args.limit === 0
      ? []
      : await ctx.db
        .query("casefileResearchAttempts")
        .withIndex("by_owner_day", (q) => q.eq("ownerId", args.ownerId).eq("day", args.day))
        .take(args.limit + 1);
    const attemptsToday = rows.length;
    if (attemptsToday >= args.limit) {
      return { kind: "daily_ceiling_reached" as const, attemptsToday, limit: args.limit };
    }
    await ctx.db.insert("casefileResearchAttempts", {
      ownerId: args.ownerId,
      channelId: args.channelId,
      day: args.day,
      attemptedAt: Date.now(),
    });
    return {
      kind: "claimed" as const,
      attemptsToday: attemptsToday + 1,
      limit: args.limit,
    };
  },
});
