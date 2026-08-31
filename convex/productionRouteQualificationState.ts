import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";
import {
  ROUTE_PREFLIGHT_READY,
  ROUTE_RELEASE_QUALIFIED,
  assertProductionRouteQualificationReceipt,
  createRoutePreflightReadyReceipt,
  createRouteReleaseQualifiedReceipt,
  type ProductionRouteQualificationReceipt,
} from "@/engine/productionRouteQualificationReceipt";
import { canonicalJson } from "@/lib/canonicalJson";

/**
 * Durable, provider-free state for staged production-route qualification.
 *
 * This module deliberately does not import a scheduler, run pipeline, render
 * adapter, or publishing surface. A stored preflight only documents that a
 * future explicit private-benchmark gate may consider the route. A stored
 * release qualification is still an inert evidence receipt until another
 * policy-specific runtime admission consumes it.
 */

const MAX_INPUT_CONTRACT_BYTES = 128_000;

function assertFingerprint(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`productionRouteQualificationState: ${label} must be a lowercase SHA-256 fingerprint`);
  }
}

function assertSafeOwnerId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 320 || /[\u0000-\u001f]/.test(value)) {
    throw new Error("productionRouteQualificationState: invalid owner identity");
  }
}

function assertContractSize(value: unknown, label: string): void {
  const bytes = new TextEncoder().encode(canonicalJson(value)).byteLength;
  if (bytes > MAX_INPUT_CONTRACT_BYTES) {
    throw new Error(`productionRouteQualificationState: ${label} exceeds the compact durable receipt size limit`);
  }
}

function sameFrozenContract(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

async function requireOwnedChannel(
  ctx: Pick<MutationCtx | QueryCtx, "db">,
  ownerId: string,
  channelId: Id<"channels">,
  purpose: string,
) {
  const channel = await ctx.db.get(channelId);
  if (!channel || channel.ownerId !== ownerId) {
    throw new Error(`productionRouteQualificationState: ${purpose} channel ownership mismatch`);
  }
  return channel;
}

type ReceiptRow = {
  readonly _id: Id<"productionRouteQualificationReceipts">;
  readonly ownerId: string;
  readonly channelId: Id<"channels">;
  readonly version: string;
  readonly level: string;
  readonly bindingFingerprint: string;
  readonly family: string;
  readonly contentLaneKey: string;
  readonly programBriefFingerprint: string;
  readonly showProfileFingerprint: string;
  readonly routeKey: string;
  readonly routeAdmission: string;
  readonly routeFingerprint: string;
  readonly compositionFingerprint: string;
  readonly pipelineFingerprint: string;
  readonly receiptFingerprint: string;
  readonly supersedesReceiptFingerprint?: string;
  readonly preflightReceiptFingerprint?: string;
  readonly finalMasterSha256?: string;
  readonly receipt: unknown;
};

function assertReceiptRowIntegrity(row: ReceiptRow): ProductionRouteQualificationReceipt {
  const receipt = assertProductionRouteQualificationReceipt(row.receipt);
  const projectionMatches = (
    row.version === receipt.version
    && row.level === receipt.level
    && row.ownerId === receipt.ownerId
    && String(row.channelId) === receipt.channelId
    && row.bindingFingerprint === receipt.binding.bindingFingerprint
    && row.family === receipt.binding.family
    && row.contentLaneKey === receipt.binding.contentLaneKey
    && row.programBriefFingerprint === receipt.binding.programBriefFingerprint
    && row.showProfileFingerprint === receipt.binding.showProfileFingerprint
    && row.routeKey === receipt.binding.routeKey
    && row.routeAdmission === receipt.binding.routeAdmission
    && row.routeFingerprint === receipt.binding.routeFingerprint
    && row.compositionFingerprint === receipt.binding.compositionFingerprint
    && row.pipelineFingerprint === receipt.binding.pipelineFingerprint
    && row.receiptFingerprint === receipt.receiptFingerprint
    && row.supersedesReceiptFingerprint === receipt.supersedesReceiptFingerprint
    && row.preflightReceiptFingerprint === (
      receipt.level === ROUTE_RELEASE_QUALIFIED
        ? receipt.preflightReceiptFingerprint
        : undefined
    )
    && row.finalMasterSha256 === (
      receipt.level === ROUTE_RELEASE_QUALIFIED
        ? receipt.provenance.finalMasterSha256
        : undefined
    )
  );
  if (!projectionMatches) {
    throw new Error("productionRouteQualificationState: immutable qualification receipt row is corrupt");
  }
  return receipt;
}

function activeReceiptRows(rows: readonly ReceiptRow[]): ReceiptRow[] {
  const parsed = rows.map((row) => ({ row, receipt: assertReceiptRowIntegrity(row) }));
  const superseded = new Set(
    parsed
      .map(({ receipt }) => receipt.supersedesReceiptFingerprint)
      .filter((value): value is string => Boolean(value)),
  );
  return parsed
    .filter(({ receipt }) => !superseded.has(receipt.receiptFingerprint))
    .map(({ row }) => row);
}

async function recordImmutableReceipt(
  ctx: Pick<MutationCtx, "db">,
  ownerId: string,
  channelId: Id<"channels">,
  receipt: ProductionRouteQualificationReceipt,
): Promise<Id<"productionRouteQualificationReceipts">> {
  const exact = await ctx.db
    .query("productionRouteQualificationReceipts")
    .withIndex("by_channel_receipt", (q) =>
      q.eq("channelId", channelId).eq("receiptFingerprint", receipt.receiptFingerprint),
    )
    .unique() as ReceiptRow | null;
  if (exact) {
    const stored = assertReceiptRowIntegrity(exact);
    if (exact.ownerId !== ownerId || !sameFrozenContract(stored, receipt)) {
      throw new Error("productionRouteQualificationState: qualification receipt fingerprint ownership or immutable payload conflict");
    }
    return exact._id;
  }

  const siblings = await ctx.db
    .query("productionRouteQualificationReceipts")
    .withIndex("by_channel_level_binding", (q) =>
      q.eq("channelId", channelId)
        .eq("level", receipt.level)
        .eq("bindingFingerprint", receipt.binding.bindingFingerprint),
    )
    .collect() as ReceiptRow[];
  if (siblings.some((row) => row.ownerId !== ownerId)) {
    throw new Error("productionRouteQualificationState: qualification receipt owner conflict");
  }
  const active = activeReceiptRows(siblings);
  if (active.length > 1) {
    throw new Error("productionRouteQualificationState: qualification receipt supersession chain has multiple active heads");
  }
  const supersedes = receipt.supersedesReceiptFingerprint;
  if (supersedes) {
    const predecessor = active[0];
    if (!predecessor || predecessor.receiptFingerprint !== supersedes) {
      throw new Error("productionRouteQualificationState: supersession must name the exact current receipt for the same level and binding");
    }
  } else if (active.length) {
    throw new Error("productionRouteQualificationState: changed qualification evidence requires explicit immutable supersession");
  }

  return await ctx.db.insert("productionRouteQualificationReceipts", {
    ownerId,
    channelId,
    version: receipt.version,
    level: receipt.level,
    bindingFingerprint: receipt.binding.bindingFingerprint,
    family: receipt.binding.family,
    contentLaneKey: receipt.binding.contentLaneKey,
    programBriefFingerprint: receipt.binding.programBriefFingerprint,
    showProfileFingerprint: receipt.binding.showProfileFingerprint,
    routeKey: receipt.binding.routeKey,
    routeAdmission: receipt.binding.routeAdmission,
    routeFingerprint: receipt.binding.routeFingerprint,
    compositionFingerprint: receipt.binding.compositionFingerprint,
    pipelineFingerprint: receipt.binding.pipelineFingerprint,
    receiptFingerprint: receipt.receiptFingerprint,
    ...(receipt.supersedesReceiptFingerprint
      ? { supersedesReceiptFingerprint: receipt.supersedesReceiptFingerprint }
      : {}),
    ...(receipt.level === ROUTE_RELEASE_QUALIFIED
      ? {
        preflightReceiptFingerprint: receipt.preflightReceiptFingerprint,
        finalMasterSha256: receipt.provenance.finalMasterSha256,
      }
      : {}),
    receipt,
    createdAt: Date.now(),
  });
}

/** Owner-scoped exact receipt read. Browser identities cannot create receipts. */
export const getRouteQualificationReceipt = query({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    receiptFingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    assertSafeOwnerId(args.ownerId);
    assertFingerprint(args.receiptFingerprint, "qualification receipt fingerprint");
    await requireOwnedChannel(ctx, args.ownerId, args.channelId, "qualification receipt read");
    const row = await ctx.db
      .query("productionRouteQualificationReceipts")
      .withIndex("by_channel_receipt", (q) =>
        q.eq("channelId", args.channelId).eq("receiptFingerprint", args.receiptFingerprint),
      )
      .unique() as ReceiptRow | null;
    if (!row) return null;
    if (row.ownerId !== args.ownerId) {
      throw new Error("productionRouteQualificationState: qualification receipt owner mismatch");
    }
    assertReceiptRowIntegrity(row);
    return row;
  },
});

/** Owner-scoped current-head read for one immutable level/binding chain. */
export const getCurrentRouteQualificationReceipt = query({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    level: v.union(v.literal(ROUTE_PREFLIGHT_READY), v.literal(ROUTE_RELEASE_QUALIFIED)),
    bindingFingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    assertSafeOwnerId(args.ownerId);
    assertFingerprint(args.bindingFingerprint, "production route binding fingerprint");
    await requireOwnedChannel(ctx, args.ownerId, args.channelId, "current qualification receipt read");
    const rows = await ctx.db
      .query("productionRouteQualificationReceipts")
      .withIndex("by_channel_level_binding", (q) =>
        q.eq("channelId", args.channelId)
          .eq("level", args.level)
          .eq("bindingFingerprint", args.bindingFingerprint),
      )
      .collect() as ReceiptRow[];
    if (rows.some((row) => row.ownerId !== args.ownerId)) {
      throw new Error("productionRouteQualificationState: current qualification receipt owner mismatch");
    }
    const active = activeReceiptRows(rows);
    if (active.length > 1) {
      throw new Error("productionRouteQualificationState: qualification receipt supersession chain has multiple active heads");
    }
    return active[0] ?? null;
  },
});

/**
 * Service-only first-stage write. The mutation receives only compact planner
 * contracts and writes only the sealed compact envelope; it cannot receive or
 * store provider responses, media bytes, a final master, QA, or provenance.
 */
export const recordRoutePreflightReady = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    binding: v.any(),
    planner: v.any(),
    inception: v.any(),
    runtime: v.any(),
    visualMatter: v.any(),
    supersedesReceiptFingerprint: v.optional(v.string()),
  },
  returns: v.id("productionRouteQualificationReceipts"),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "production route preflight persistence");
    assertSafeOwnerId(args.ownerId);
    await requireOwnedChannel(ctx, args.ownerId, args.channelId, "production route preflight persistence");
    assertContractSize(args.binding, "route binding");
    assertContractSize(args.planner, "planner evidence");
    assertContractSize(args.inception, "inception evidence");
    assertContractSize(args.runtime, "runtime evidence");
    assertContractSize(args.visualMatter, "Visual Matter evidence");
    if (args.supersedesReceiptFingerprint !== undefined) {
      assertFingerprint(args.supersedesReceiptFingerprint, "superseded qualification receipt fingerprint");
    }
    const receipt = createRoutePreflightReadyReceipt({
      ownerId: args.ownerId,
      channelId: String(args.channelId),
      binding: args.binding,
      planner: args.planner,
      inception: args.inception,
      runtime: args.runtime,
      visualMatter: args.visualMatter,
      ...(args.supersedesReceiptFingerprint
        ? { supersedesReceiptFingerprint: args.supersedesReceiptFingerprint }
        : {}),
    });
    return await recordImmutableReceipt(ctx, args.ownerId, args.channelId, receipt);
  },
});

/**
 * Service-only second-stage write. It resolves one stored preflight then
 * rebuilds a release receipt from a full engine qualification. It cannot turn
 * a bare `qualified` label, review result, or provider payload into a release
 * qualification.
 */
export const recordRouteReleaseQualified = mutation({
  args: {
    ownerId: v.string(),
    channelId: v.id("channels"),
    preflightReceiptFingerprint: v.string(),
    qualification: v.any(),
    supersedesReceiptFingerprint: v.optional(v.string()),
  },
  returns: v.id("productionRouteQualificationReceipts"),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "production route release qualification persistence");
    assertSafeOwnerId(args.ownerId);
    assertFingerprint(args.preflightReceiptFingerprint, "preflight qualification receipt fingerprint");
    await requireOwnedChannel(ctx, args.ownerId, args.channelId, "production route release qualification persistence");
    assertContractSize(args.qualification, "full route qualification");
    if (args.supersedesReceiptFingerprint !== undefined) {
      assertFingerprint(args.supersedesReceiptFingerprint, "superseded qualification receipt fingerprint");
    }
    const preflightRow = await ctx.db
      .query("productionRouteQualificationReceipts")
      .withIndex("by_channel_receipt", (q) =>
        q.eq("channelId", args.channelId)
          .eq("receiptFingerprint", args.preflightReceiptFingerprint),
      )
      .unique() as ReceiptRow | null;
    if (!preflightRow || preflightRow.ownerId !== args.ownerId) {
      throw new Error("productionRouteQualificationState: release qualification requires an exact owner-owned preflight receipt");
    }
    const preflight = assertReceiptRowIntegrity(preflightRow);
    if (preflight.level !== ROUTE_PREFLIGHT_READY) {
      throw new Error("productionRouteQualificationState: release qualification cannot use another release receipt as its preflight");
    }
    const preflightSiblings = await ctx.db
      .query("productionRouteQualificationReceipts")
      .withIndex("by_channel_level_binding", (q) =>
        q.eq("channelId", args.channelId)
          .eq("level", ROUTE_PREFLIGHT_READY)
          .eq("bindingFingerprint", preflight.binding.bindingFingerprint),
      )
      .collect() as ReceiptRow[];
    const activePreflight = activeReceiptRows(preflightSiblings);
    if (
      activePreflight.length !== 1
      || activePreflight[0]?.receiptFingerprint !== preflight.receiptFingerprint
    ) {
      throw new Error("productionRouteQualificationState: release qualification requires the current unsuperseded preflight receipt");
    }
    const receipt = createRouteReleaseQualifiedReceipt({
      ownerId: args.ownerId,
      channelId: String(args.channelId),
      preflight,
      qualification: args.qualification,
      ...(args.supersedesReceiptFingerprint
        ? { supersedesReceiptFingerprint: args.supersedesReceiptFingerprint }
        : {}),
    });
    return await recordImmutableReceipt(ctx, args.ownerId, args.channelId, receipt);
  },
});

/** Small pure helpers exposed for focused state tests; no Convex/provider access. */
export const productionRouteQualificationStateGuardsForTests = {
  activeReceiptRows,
  assertReceiptRowIntegrity,
};
