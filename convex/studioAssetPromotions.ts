import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

import {
  approveStudioAssetPromotionCandidate,
  assertStudioAssetPromotionCandidate,
  studioAssetPromotionCandidateInventory,
} from "../src/engine/studioAssetPromotion";
import { assertStudioAssetLibraryEntry } from "../src/engine/studioAssetLibrary";
import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";

type AssetRow = {
  readonly _id: Id<"studioAssetLibraryEntries">;
  readonly fingerprint: string;
  readonly logicalId: string;
  readonly entry: unknown;
};

function currentEntries(rows: readonly AssetRow[]) {
  const superseded = new Set<string>();
  const parsed = rows.map((row) => ({ row, entry: assertStudioAssetLibraryEntry(row.entry) }));
  for (const { entry } of parsed) {
    if (entry.supersedesFingerprint) superseded.add(entry.supersedesFingerprint);
  }
  return parsed.filter(({ entry }) => !superseded.has(entry.fingerprint));
}

/**
 * Capture a channel-only, unresolvable candidate after qa_visual has already
 * persisted and reloaded its final-master certificate. No browser can call
 * this mutation, and no candidate is an approved asset by itself.
 */
export const recordCandidate = mutation({
  args: { ownerId: v.string(), candidate: v.any() },
  returns: v.id("studioAssetPromotionCandidates"),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "Studio Asset Library candidate capture");
    const candidate = assertStudioAssetPromotionCandidate(args.candidate);
    if (candidate.ownerId !== args.ownerId) throw new Error("studio asset candidate owner mismatch");
    const [channel, run] = await Promise.all([
      ctx.db.get(candidate.channelId as Id<"channels">),
      ctx.db.get(candidate.runId as Id<"runs">),
    ]);
    if (!channel || channel.ownerId !== args.ownerId) {
      throw new Error("studio asset candidate channel must belong to the same owner");
    }
    if (!run || run.ownerId !== args.ownerId || run.channelId !== candidate.channelId) {
      throw new Error("studio asset candidate must bind an owned source run and channel");
    }
    const existing = await ctx.db
      .query("studioAssetPromotionCandidates")
      .withIndex("by_owner_fingerprint", (q) => q.eq("ownerId", args.ownerId).eq("candidateFingerprint", candidate.candidateFingerprint))
      .unique();
    if (existing) {
      assertStudioAssetPromotionCandidate(existing.candidate);
      return existing._id;
    }
    return await ctx.db.insert("studioAssetPromotionCandidates", {
      ownerId: args.ownerId,
      channelId: candidate.channelId as Id<"channels">,
      runId: candidate.runId as Id<"runs">,
      candidateFingerprint: candidate.candidateFingerprint,
      certificateFingerprint: candidate.origin.finalMasterReleaseCertificateFingerprint,
      finalMasterSha256: candidate.origin.finalMasterSha256,
      candidate,
      createdAt: Date.now(),
    });
  },
});

/** Browser-safe pending list: it deliberately omits recipe text and R2 evidence keys. */
export const listPendingForOwner = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "Studio Asset Library candidate inventory");
    const [candidateRows, approvalRows] = await Promise.all([
      ctx.db.query("studioAssetPromotionCandidates").withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId)).collect(),
      ctx.db.query("studioAssetPromotionApprovals").withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId)).collect(),
    ]);
    const approved = new Set(approvalRows.map((row) => row.candidateFingerprint));
    return studioAssetPromotionCandidateInventory(
      candidateRows
        .filter((row) => !approved.has(row.candidateFingerprint))
        .map((row) => assertStudioAssetPromotionCandidate(row.candidate)),
    );
  },
});

/** Server-only retrieval for the owner API's certificate re-verification step. */
export const getForOwnerApproval = query({
  args: { ownerId: v.string(), candidateFingerprint: v.string() },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "Studio Asset Library candidate approval read");
    const row = await ctx.db
      .query("studioAssetPromotionCandidates")
      .withIndex("by_owner_fingerprint", (q) => q.eq("ownerId", args.ownerId).eq("candidateFingerprint", args.candidateFingerprint))
      .unique();
    return row ? assertStudioAssetPromotionCandidate(row.candidate) : null;
  },
});

/**
 * Create the immutable approved entry only after the server has re-verified
 * the candidate's durable release certificate. A candidate can never become
 * Studio-wide here; its proposal is structurally channel-scoped.
 */
export const approveCandidate = mutation({
  args: { ownerId: v.string(), candidateFingerprint: v.string(), approvedBy: v.string(), approvedAt: v.number() },
  returns: v.id("studioAssetLibraryEntries"),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "Studio Asset Library candidate approval");
    if (args.approvedBy !== args.ownerId) {
      throw new Error("Studio asset candidate approval must identify the owning operator");
    }
    const candidateRow = await ctx.db
      .query("studioAssetPromotionCandidates")
      .withIndex("by_owner_fingerprint", (q) => q.eq("ownerId", args.ownerId).eq("candidateFingerprint", args.candidateFingerprint))
      .unique();
    if (!candidateRow) throw new Error("Studio asset candidate is unavailable");
    const candidate = assertStudioAssetPromotionCandidate(candidateRow.candidate);
    const [channel, run] = await Promise.all([
      ctx.db.get(candidate.channelId as Id<"channels">),
      ctx.db.get(candidate.runId as Id<"runs">),
    ]);
    if (!channel || channel.ownerId !== args.ownerId || !run || run.ownerId !== args.ownerId || run.channelId !== candidate.channelId) {
      throw new Error("Studio asset candidate source binding is no longer valid");
    }
    const previous = await ctx.db
      .query("studioAssetPromotionApprovals")
      .withIndex("by_owner_candidate", (q) => q.eq("ownerId", args.ownerId).eq("candidateFingerprint", candidate.candidateFingerprint))
      .unique();
    if (previous) return previous.assetEntryId;

    const entry = approveStudioAssetPromotionCandidate({
      candidate,
      approvedBy: args.approvedBy,
      approvedAt: args.approvedAt,
    });
    const sameLogicalRows = await ctx.db
      .query("studioAssetLibraryEntries")
      .withIndex("by_owner_logical_id", (q) => q.eq("ownerId", args.ownerId).eq("logicalId", entry.logicalId))
      .collect();
    const current = currentEntries(sameLogicalRows as AssetRow[]);
    const sameFingerprint = sameLogicalRows.find((row) => row.fingerprint === entry.fingerprint);
    let assetEntryId: Id<"studioAssetLibraryEntries">;
    if (sameFingerprint) {
      assertStudioAssetLibraryEntry(sameFingerprint.entry);
      assetEntryId = sameFingerprint._id;
    } else {
      if (current.length > 0) {
        throw new Error("Studio asset candidate conflicts with a newer current logical asset");
      }
      assetEntryId = await ctx.db.insert("studioAssetLibraryEntries", {
        ownerId: args.ownerId,
        version: entry.version,
        logicalId: entry.logicalId,
        fingerprint: entry.fingerprint,
        scope: entry.scope,
        channelId: entry.channelId as Id<"channels">,
        assetKind: entry.assetKind,
        status: entry.status,
        entry,
        createdAt: entry.approval.approvedAt,
      });
    }
    await ctx.db.insert("studioAssetPromotionApprovals", {
      ownerId: args.ownerId,
      candidateFingerprint: candidate.candidateFingerprint,
      assetEntryId,
      assetEntryFingerprint: entry.fingerprint,
      approvedAt: args.approvedAt,
    });
    return assetEntryId;
  },
});
