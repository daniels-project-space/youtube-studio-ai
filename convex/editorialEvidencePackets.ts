import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

import { requireStudioServiceIdentity } from "./studioFunctions";
import { mutation, query } from "./studioFunctions";

type StoredPrivatePacket = {
  subject: string;
  contentFingerprint: string;
  review: { reviewerId: string; reviewId: string; reviewedAt: string };
  release: "private_human_editorial_review_only";
  requiresHumanEditorialReview: true;
};

/**
 * The Node API validates the exact engine schema and SHA-256 review binding.
 * Convex deliberately does not import that Node-only crypto module; this
 * function is service-only, so no browser/user Convex caller can bypass the
 * authenticated API boundary. The API re-validates the exact packet on every
 * write before this narrow persistence shape is accepted.
 */
function privatePacketShape(value: unknown): StoredPrivatePacket {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("editorial evidence packet must be an object");
  const packet = value as Record<string, unknown>;
  const review = packet.review;
  if (!review || typeof review !== "object" || Array.isArray(review)) throw new Error("editorial evidence packet review is required");
  const reviewRecord = review as Record<string, unknown>;
  if (
    typeof packet.subject !== "string" ||
    typeof packet.contentFingerprint !== "string" ||
    typeof reviewRecord.reviewerId !== "string" ||
    typeof reviewRecord.reviewId !== "string" ||
    typeof reviewRecord.reviewedAt !== "string" ||
    packet.release !== "private_human_editorial_review_only" ||
    packet.requiresHumanEditorialReview !== true
  ) {
    throw new Error("editorial evidence packet must remain a private reviewer-bound receipt");
  }
  return packet as unknown as StoredPrivatePacket;
}

async function ownedPacket(
  ctx: Pick<MutationCtx | QueryCtx, "db">,
  packetId: Id<"editorialEvidencePackets">,
  ownerId: string,
) {
  const packet = await ctx.db.get(packetId);
  if (!packet || packet.ownerId !== ownerId) throw new Error("editorial evidence packet not found");
  return packet;
}

/**
 * Stores an immutable, reviewer-signed factual evidence packet. This is a
 * private review record only: it has no render, provider, channel, or publish
 * side effect. The authenticated Node API validates the exact schema and
 * fingerprint immediately before this service-only mutation is invoked.
 */
export const admit = mutation({
  args: { ownerId: v.string(), packet: v.any(), now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "editorial evidence persistence");
    const packet = privatePacketShape(args.packet);
    const existing = await ctx.db
      .query("editorialEvidencePackets")
      .withIndex("by_owner_review", (q) => q.eq("ownerId", args.ownerId).eq("reviewId", packet.review.reviewId))
      .unique();
    if (existing) {
      if (existing.contentFingerprint !== packet.contentFingerprint) {
        throw new Error("editorial evidence reviewId is already bound to a different packet");
      }
      return existing;
    }

    const id = await ctx.db.insert("editorialEvidencePackets", {
      ownerId: args.ownerId,
      subject: packet.subject,
      contentFingerprint: packet.contentFingerprint,
      reviewerId: packet.review.reviewerId,
      reviewId: packet.review.reviewId,
      reviewedAt: packet.review.reviewedAt,
      release: packet.release,
      requiresHumanEditorialReview: packet.requiresHumanEditorialReview,
      packet,
      createdAt: args.now ?? Date.now(),
    });
    return await ctx.db.get(id);
  },
});

export const get = query({
  args: { ownerId: v.string(), packetId: v.id("editorialEvidencePackets") },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "editorial evidence retrieval");
    return await ownedPacket(ctx, args.packetId, args.ownerId);
  },
});

export const listForOwner = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "editorial evidence retrieval");
    return await ctx.db
      .query("editorialEvidencePackets")
      .withIndex("by_owner_created", (q) => q.eq("ownerId", args.ownerId))
      .order("desc")
      .take(100);
  },
});
