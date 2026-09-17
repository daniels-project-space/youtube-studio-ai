import { mutation, query } from "./studioFunctions";
import { v } from "convex/values";
import { normalizeChildrenReviewDraft } from "../src/lib/childrenReviewIntake";

async function requireOwner(ctx: { auth: { getUserIdentity: () => Promise<{ role?: unknown; owner_id?: unknown; subject?: unknown } | null> } }, ownerId: string) {
  const identity = await ctx.auth.getUserIdentity();
  if (identity?.role !== "owner" || identity.owner_id !== ownerId || identity.subject !== ownerId) {
    throw new Error("Children review drafts require owner access");
  }
}

/** A bounded owner-only list; these drafts never supply run invocation seeds. */
export const listMine = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.ownerId);
    return ctx.db
      .query("childrenReviewIntakes")
      .withIndex("by_owner_updated", (q) => q.eq("ownerId", args.ownerId))
      .order("desc")
      .take(24);
  },
});

/** Save a private draft or flag it as ready for a real child editor to review. */
export const saveMine = mutation({
  args: {
    ownerId: v.string(),
    intakeId: v.optional(v.id("childrenReviewIntakes")),
    channelName: v.string(),
    ageBand: v.union(v.literal("toddler"), v.literal("preschool"), v.literal("early_primary")),
    learningObjective: v.string(),
    curriculumDraft: v.string(),
    showBibleDraft: v.string(),
    readyForReview: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx, args.ownerId);
    const draft = normalizeChildrenReviewDraft(args, args.readyForReview);
    const now = Date.now();
    if (args.intakeId) {
      const existing = await ctx.db.get(args.intakeId);
      if (!existing || existing.ownerId !== args.ownerId) {
        throw new Error("Children review draft not found");
      }
      await ctx.db.patch(existing._id, { ...draft, readyForReview: args.readyForReview, updatedAt: now });
      return existing._id;
    }
    return ctx.db.insert("childrenReviewIntakes", {
      ownerId: args.ownerId,
      ...draft,
      readyForReview: args.readyForReview,
      createdAt: now,
      updatedAt: now,
    });
  },
});
