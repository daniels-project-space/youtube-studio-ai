import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";
import {
  assertReviewedLtxBenchmarkAdmission,
  type ReviewedLtxBenchmarkAdmission,
} from "@/engine/ltxBenchmarkAdmission";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

/**
 * Release-controlled, owner-scoped runtime evidence. These rows are not a
 * worker-launch API: only an independently reviewed LTX admission may enter,
 * and revocation is append-only so a later retry can detect it.
 */
export const REVIEWED_LTX_RUNTIME_ADMISSION_VERSION = "reviewed-ltx-runtime-admission/v1" as const;
export const REVIEWED_LTX_RUNTIME_REVOCATION_VERSION = "reviewed-ltx-runtime-revocation/v1" as const;

const MAX_ADMISSION_BYTES = 128_000;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const SAFE_OWNER = /^\S(?:[\s\S]{0,318}\S)?$/;
const SAFE_REASON = /^[\s\S]{8,1_000}$/;

type AdmissionRow = {
  readonly _id: Id<"reviewedLtxRuntimeAdmissions">;
  readonly ownerId: string;
  readonly version: string;
  readonly admissionFingerprint: string;
  readonly profileFingerprint: string;
  readonly admission: unknown;
};

type RevocationRow = {
  readonly _id: Id<"reviewedLtxRuntimeRevocations">;
  readonly ownerId: string;
  readonly version: string;
  readonly admissionFingerprint: string;
  readonly reason: string;
  readonly revocationFingerprint: string;
};

function assertOwnerId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !SAFE_OWNER.test(value) || /[\u0000-\u001f]/.test(value)) {
    throw new Error("reviewedLtxRuntimeState: invalid owner identity");
  }
}

function assertFingerprint(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !SHA256_HEX.test(value)) {
    throw new Error(`reviewedLtxRuntimeState: ${label} must be a lowercase SHA-256 fingerprint`);
  }
}

function assertContractSize(value: unknown): void {
  if (new TextEncoder().encode(canonicalJson(value)).byteLength > MAX_ADMISSION_BYTES) {
    throw new Error("reviewedLtxRuntimeState: reviewed benchmark admission exceeds the compact durable size limit");
  }
}

function sameFrozenContract(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function assertAdmissionRow(row: AdmissionRow): ReviewedLtxBenchmarkAdmission {
  const admission = assertReviewedLtxBenchmarkAdmission(row.admission);
  if (
    row.version !== REVIEWED_LTX_RUNTIME_ADMISSION_VERSION
    || row.admissionFingerprint !== admission.admissionFingerprint
    || row.profileFingerprint !== admission.profileFingerprint
  ) {
    throw new Error("reviewedLtxRuntimeState: immutable benchmark admission row is corrupt");
  }
  return admission;
}

function revocationFingerprint(args: {
  readonly ownerId: string;
  readonly admissionFingerprint: string;
  readonly reason: string;
}): string {
  return sha256Hex(canonicalJson({
    version: REVIEWED_LTX_RUNTIME_REVOCATION_VERSION,
    ownerId: args.ownerId,
    admissionFingerprint: args.admissionFingerprint,
    reason: args.reason,
  }));
}

export const listActiveReviewedLtxBenchmarkAdmissions = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "reviewed LTX runtime read");
    assertOwnerId(args.ownerId);
    const [admissionRows, revocationRows] = await Promise.all([
      ctx.db
        .query("reviewedLtxRuntimeAdmissions")
        .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
        .collect() as Promise<AdmissionRow[]>,
      ctx.db
        .query("reviewedLtxRuntimeRevocations")
        .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
        .collect() as Promise<RevocationRow[]>,
    ]);
    const revoked = new Set<string>();
    for (const row of revocationRows) {
      if (row.version !== REVIEWED_LTX_RUNTIME_REVOCATION_VERSION || row.ownerId !== args.ownerId) {
        throw new Error("reviewedLtxRuntimeState: immutable benchmark revocation row is corrupt");
      }
      assertFingerprint(row.admissionFingerprint, "revoked benchmark admission fingerprint");
      if (typeof row.reason !== "string" || !SAFE_REASON.test(row.reason)) {
        throw new Error("reviewedLtxRuntimeState: immutable benchmark revocation reason is corrupt");
      }
      if (row.revocationFingerprint !== revocationFingerprint(row)) {
        throw new Error("reviewedLtxRuntimeState: immutable benchmark revocation fingerprint is corrupt");
      }
      revoked.add(row.admissionFingerprint);
    }
    return admissionRows
      .map((row) => {
        if (row.ownerId !== args.ownerId) throw new Error("reviewedLtxRuntimeState: benchmark admission owner mismatch");
        return assertAdmissionRow(row);
      })
      .filter((admission) => !revoked.has(admission.admissionFingerprint));
  },
});

export const recordReviewedLtxBenchmarkAdmission = mutation({
  args: { ownerId: v.string(), admission: v.any() },
  returns: v.id("reviewedLtxRuntimeAdmissions"),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "reviewed LTX runtime persistence");
    assertOwnerId(args.ownerId);
    assertContractSize(args.admission);
    const admission = assertReviewedLtxBenchmarkAdmission(args.admission);
    const existing = await ctx.db
      .query("reviewedLtxRuntimeAdmissions")
      .withIndex("by_owner_admission", (q) =>
        q.eq("ownerId", args.ownerId).eq("admissionFingerprint", admission.admissionFingerprint),
      )
      .unique() as AdmissionRow | null;
    if (existing) {
      const stored = assertAdmissionRow(existing);
      if (!sameFrozenContract(stored, admission)) {
        throw new Error("reviewedLtxRuntimeState: benchmark admission fingerprint conflicts with its immutable payload");
      }
      return existing._id;
    }
    return await ctx.db.insert("reviewedLtxRuntimeAdmissions", {
      ownerId: args.ownerId,
      version: REVIEWED_LTX_RUNTIME_ADMISSION_VERSION,
      admissionFingerprint: admission.admissionFingerprint,
      profileFingerprint: admission.profileFingerprint,
      admission,
      createdAt: Date.now(),
    });
  },
});

export const revokeReviewedLtxBenchmarkAdmission = mutation({
  args: { ownerId: v.string(), admissionFingerprint: v.string(), reason: v.string() },
  returns: v.id("reviewedLtxRuntimeRevocations"),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "reviewed LTX runtime revocation");
    assertOwnerId(args.ownerId);
    assertFingerprint(args.admissionFingerprint, "benchmark admission fingerprint");
    if (!SAFE_REASON.test(args.reason)) {
      throw new Error("reviewedLtxRuntimeState: revocation reason must be 8-1,000 printable characters");
    }
    const admission = await ctx.db
      .query("reviewedLtxRuntimeAdmissions")
      .withIndex("by_owner_admission", (q) =>
        q.eq("ownerId", args.ownerId).eq("admissionFingerprint", args.admissionFingerprint),
      )
      .unique() as AdmissionRow | null;
    if (!admission) throw new Error("reviewedLtxRuntimeState: benchmark admission was not found for this owner");
    assertAdmissionRow(admission);
    const fingerprint = revocationFingerprint(args);
    const existing = await ctx.db
      .query("reviewedLtxRuntimeRevocations")
      .withIndex("by_owner_revocation", (q) => q.eq("ownerId", args.ownerId).eq("revocationFingerprint", fingerprint))
      .unique() as RevocationRow | null;
    if (existing) return existing._id;
    return await ctx.db.insert("reviewedLtxRuntimeRevocations", {
      ownerId: args.ownerId,
      version: REVIEWED_LTX_RUNTIME_REVOCATION_VERSION,
      admissionFingerprint: args.admissionFingerprint,
      reason: args.reason,
      revocationFingerprint: fingerprint,
      revokedAt: Date.now(),
    });
  },
});

export const reviewedLtxRuntimeStateGuardsForTests = {
  assertAdmissionRow,
  revocationFingerprint,
};
