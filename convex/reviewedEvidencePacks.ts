import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

import { assertReviewedEvidencePackEditorialAuthorityReference } from "../src/lib/reviewedEvidencePackAuthorityReference";
import { requireStudioServiceIdentity } from "./studioFunctions";
import { mutation, query } from "./studioFunctions";

const REVIEW_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const REVIEW_CLOCK_SKEW_MS = 5 * 60_000;
const SHA256 = /^[a-f0-9]{64}$/;

type StoredReviewedEvidencePack = {
  contentFingerprint: string;
  routeSeedFingerprint: string;
  topicFingerprint: string;
  authorityContentFingerprint: string;
  routeKey: string;
  family: string;
  contentLaneKey: string;
  showProfileFingerprint: string;
  capabilityFingerprint: string;
  selectedCapabilityKeys: string[];
  authorityKind: "editorial_evidence_packet" | "data_story_source_ledger";
  review: { reviewerId: string; reviewId: string; reviewedAt: string };
  reviewedEvidenceRouteBindingFingerprint?: string;
};

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`reviewed evidence pack ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`reviewed evidence pack ${label} is required`);
  }
  return value;
}

function fingerprint(value: unknown, label: string): string {
  const candidate = string(value, label);
  if (!SHA256.test(candidate)) throw new Error(`reviewed evidence pack ${label} must be a SHA-256 fingerprint`);
  return candidate;
}

function capabilityKeys(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((key) => typeof key !== "string" || !key.trim())) {
    throw new Error("reviewed evidence pack selectedCapabilityKeys must be a string array");
  }
  if (value.length > 48) throw new Error("reviewed evidence pack selectedCapabilityKeys exceeds the safe bound");
  for (let index = 1; index < value.length; index += 1) {
    if (value[index - 1]! >= value[index]!) {
      throw new Error("reviewed evidence pack selectedCapabilityKeys must be sorted and unique");
    }
  }
  return [...value];
}

/**
 * Convex cannot import Node's engine crypto validators. The authenticated Node
 * service re-validates the full `ReviewedEvidencePack` immediately before this
 * mutation; this narrow shape prevents a browser caller from smuggling an
 * execution instruction, raw browser result, or mutable review into storage.
 */
function privatePackShape(value: unknown, now: number): StoredReviewedEvidencePack {
  const pack = object(value, "payload");
  if (
    pack.version !== "reviewed-evidence-pack/v1" ||
    pack.release !== "private_reviewed_evidence_pack_only" ||
    pack.requiresHumanEditorialReview !== true
  ) {
    throw new Error("reviewed evidence pack must remain a private human-review-only receipt");
  }

  const route = object(pack.route, "route");
  const profile = object(pack.showProfile, "Show Profile binding");
  const authority = object(pack.sourceAuthority, "source authority");
  const review = object(pack.review, "approval");
  if (
    review.decision !== "approved" ||
    fingerprint(review.reviewedPackFingerprint, "approval reviewedPackFingerprint") !== fingerprint(pack.contentFingerprint, "contentFingerprint")
  ) {
    throw new Error("reviewed evidence pack approval must bind an approved exact content fingerprint");
  }
  const reviewedAt = string(review.reviewedAt, "approval reviewedAt");
  const reviewedAtMs = Date.parse(reviewedAt);
  if (!Number.isFinite(reviewedAtMs) || reviewedAtMs > now + REVIEW_CLOCK_SKEW_MS || now - reviewedAtMs > REVIEW_MAX_AGE_MS) {
    throw new Error("reviewed evidence pack approval must be fresh");
  }
  if (
    authority.kind !== "editorial_evidence_packet" &&
    authority.kind !== "data_story_source_ledger"
  ) {
    throw new Error("reviewed evidence pack source authority kind is invalid");
  }
  const authorityContentFingerprint = fingerprint(
    pack.authorityContentFingerprint,
    "authorityContentFingerprint",
  );
  if (authority.kind === "editorial_evidence_packet") {
    const editorialPacket = object(
      authority.editorialEvidencePacket,
      "editorial source authority",
    );
    if (
      fingerprint(
        editorialPacket.contentFingerprint,
        "editorial source authority contentFingerprint",
      ) !== authorityContentFingerprint
    ) {
      throw new Error(
        "reviewed evidence pack editorial source authority must match its authority fingerprint",
      );
    }
  }

  let reviewedEvidenceRouteBindingFingerprint: string | undefined;
  if (pack.reviewedPlan !== undefined) {
    const plan = object(pack.reviewedPlan, "reviewed plan");
    const binding = object(plan.reviewedEvidenceRouteBinding, "reviewed plan binding");
    reviewedEvidenceRouteBindingFingerprint = fingerprint(binding.bindingFingerprint, "reviewed plan binding fingerprint");
  }

  return {
    contentFingerprint: fingerprint(pack.contentFingerprint, "contentFingerprint"),
    routeSeedFingerprint: fingerprint(pack.routeSeedFingerprint, "routeSeedFingerprint"),
    topicFingerprint: fingerprint(pack.topicFingerprint, "topicFingerprint"),
    authorityContentFingerprint,
    routeKey: string(route.routeKey, "route routeKey"),
    family: string(route.family, "route family"),
    contentLaneKey: string(route.contentLaneKey, "route contentLaneKey"),
    showProfileFingerprint: fingerprint(profile.showProfileFingerprint, "Show Profile fingerprint"),
    capabilityFingerprint: fingerprint(profile.capabilityFingerprint, "capabilityFingerprint"),
    selectedCapabilityKeys: capabilityKeys(profile.selectedCapabilityKeys),
    authorityKind: authority.kind,
    review: {
      reviewerId: string(review.reviewerId, "approval reviewerId"),
      reviewId: string(review.reviewId, "approval reviewId"),
      reviewedAt,
    },
    ...(reviewedEvidenceRouteBindingFingerprint ? { reviewedEvidenceRouteBindingFingerprint } : {}),
  };
}

async function ownedPack(
  ctx: Pick<MutationCtx | QueryCtx, "db">,
  packId: Id<"reviewedEvidencePacks">,
  ownerId: string,
) {
  const pack = await ctx.db.get(packId);
  if (!pack || pack.ownerId !== ownerId) throw new Error("reviewed evidence pack not found");
  return pack;
}

/**
 * Stores a private immutable reviewed evidence pack. It has no channel,
 * provider, render, run, release, or publish side effect. The immutable
 * review ID and content fingerprint make an exact retry idempotent while
 * rejecting re-use of either identity for changed evidence.
 */
export const admit = mutation({
  args: {
    ownerId: v.string(),
    pack: v.any(),
    editorialEvidencePacketId: v.optional(v.id("editorialEvidencePackets")),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "reviewed evidence pack persistence");
    const now = args.now ?? Date.now();
    const pack = privatePackShape(args.pack, now);
    const storedEditorialEvidencePacket = args.editorialEvidencePacketId === undefined
      ? undefined
      : await ctx.db.get(args.editorialEvidencePacketId);
    assertReviewedEvidencePackEditorialAuthorityReference({
      authorityKind: pack.authorityKind,
      authorityContentFingerprint: pack.authorityContentFingerprint,
      ownerId: args.ownerId,
      ...(args.editorialEvidencePacketId === undefined
        ? {}
        : { editorialEvidencePacketId: String(args.editorialEvidencePacketId) }),
      ...(storedEditorialEvidencePacket === undefined
        ? {}
        : { storedEditorialEvidencePacket }),
    });
    const editorialEvidencePacketId = pack.authorityKind === "editorial_evidence_packet"
      ? args.editorialEvidencePacketId
      : undefined;
    const existingReview = await ctx.db
      .query("reviewedEvidencePacks")
      .withIndex("by_owner_review", (q) => q.eq("ownerId", args.ownerId).eq("reviewId", pack.review.reviewId))
      .unique();
    if (existingReview) {
      if (
        existingReview.contentFingerprint !== pack.contentFingerprint ||
        existingReview.reviewerId !== pack.review.reviewerId ||
        existingReview.reviewedAt !== pack.review.reviewedAt ||
        existingReview.editorialEvidencePacketId !== editorialEvidencePacketId
      ) {
        throw new Error("reviewed evidence pack reviewId is already bound to different immutable evidence");
      }
      return existingReview;
    }

    const existingContent = await ctx.db
      .query("reviewedEvidencePacks")
      .withIndex("by_owner_content", (q) => q.eq("ownerId", args.ownerId).eq("contentFingerprint", pack.contentFingerprint))
      .unique();
    if (existingContent) {
      if (
        existingContent.reviewId !== pack.review.reviewId ||
        existingContent.reviewerId !== pack.review.reviewerId ||
        existingContent.reviewedAt !== pack.review.reviewedAt ||
        existingContent.editorialEvidencePacketId !== editorialEvidencePacketId
      ) {
        throw new Error("reviewed evidence pack content is already bound to a different immutable approval");
      }
      return existingContent;
    }

    const { review, ...storedPack } = pack;
    const id = await ctx.db.insert("reviewedEvidencePacks", {
      ownerId: args.ownerId,
      ...storedPack,
      reviewerId: review.reviewerId,
      reviewId: review.reviewId,
      reviewedAt: review.reviewedAt,
      ...(editorialEvidencePacketId === undefined ? {} : { editorialEvidencePacketId }),
      pack: args.pack,
      createdAt: now,
    });
    return await ctx.db.get(id);
  },
});

export const get = query({
  args: { ownerId: v.string(), packId: v.id("reviewedEvidencePacks") },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "reviewed evidence pack retrieval");
    return await ownedPack(ctx, args.packId, args.ownerId);
  },
});

export const listForOwner = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "reviewed evidence pack retrieval");
    return await ctx.db
      .query("reviewedEvidencePacks")
      .withIndex("by_owner_created", (q) => q.eq("ownerId", args.ownerId))
      .order("desc")
      .take(100);
  },
});
