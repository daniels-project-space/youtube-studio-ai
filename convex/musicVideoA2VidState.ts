import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { mutation, query, requireStudioServiceIdentity } from "./studioFunctions";
import {
  assertMusicVideoA2VidRuntimeAdmission,
  type MusicVideoA2VidRuntimeAdmission,
} from "@/engine/selfHostedLtxMusicVideoA2Vid";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

/**
 * Owner-scoped A2Vid runtime benchmark evidence. This module cannot enqueue a
 * render, issue a provider credential, reserve funds, or expose asset URLs.
 * It merely remembers an immutable runtime/benchmark pair so the Studio can
 * reuse a proven open-weight LTX capability instead of rediscovering it.
 */
export const MUSIC_VIDEO_A2VID_RUNTIME_ADMISSION_VERSION = "music-video-a2vid-runtime-admission/v1" as const;
export const MUSIC_VIDEO_A2VID_RUNTIME_REVOCATION_VERSION = "music-video-a2vid-runtime-revocation/v1" as const;

const MAX_ADMISSION_BYTES = 128_000;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const SAFE_OWNER = /^\S(?:[\s\S]{0,318}\S)?$/;
const SAFE_REASON = /^[\s\S]{8,1_000}$/;

type AdmissionRow = {
  readonly _id: Id<"musicVideoA2VidRuntimeAdmissions">;
  readonly ownerId: string;
  readonly version: string;
  readonly admissionFingerprint: string;
  readonly runtimeFingerprint: string;
  readonly admission: unknown;
};

type RevocationRow = {
  readonly _id: Id<"musicVideoA2VidRuntimeRevocations">;
  readonly ownerId: string;
  readonly version: string;
  readonly admissionFingerprint: string;
  readonly reason: string;
  readonly revocationFingerprint: string;
};

function assertOwnerId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !SAFE_OWNER.test(value) || /[\u0000-\u001f]/.test(value)) {
    throw new Error("musicVideoA2VidState: invalid owner identity");
  }
}

function assertFingerprint(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !SHA256_HEX.test(value)) {
    throw new Error(`musicVideoA2VidState: ${label} must be a lowercase SHA-256 fingerprint`);
  }
}

function assertContractSize(value: unknown): void {
  if (new TextEncoder().encode(canonicalJson(value)).byteLength > MAX_ADMISSION_BYTES) {
    throw new Error("musicVideoA2VidState: runtime admission exceeds the compact durable size limit");
  }
}

function sameFrozenContract(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function assertAdmissionRow(row: AdmissionRow): MusicVideoA2VidRuntimeAdmission {
  const admission = assertMusicVideoA2VidRuntimeAdmission(row.admission);
  if (
    row.version !== MUSIC_VIDEO_A2VID_RUNTIME_ADMISSION_VERSION
    || row.admissionFingerprint !== admission.fingerprint
    || row.runtimeFingerprint !== admission.runtime.fingerprint
  ) {
    throw new Error("musicVideoA2VidState: immutable runtime admission row is corrupt");
  }
  return admission;
}

function revocationFingerprint(args: {
  readonly ownerId: string;
  readonly admissionFingerprint: string;
  readonly reason: string;
}): string {
  return sha256Hex(canonicalJson({
    version: MUSIC_VIDEO_A2VID_RUNTIME_REVOCATION_VERSION,
    ownerId: args.ownerId,
    admissionFingerprint: args.admissionFingerprint,
    reason: args.reason,
  }));
}

export const listActiveMusicVideoA2VidRuntimeAdmissions = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "music-video A2Vid runtime read");
    assertOwnerId(args.ownerId);
    const [admissionRows, revocationRows] = await Promise.all([
      ctx.db
        .query("musicVideoA2VidRuntimeAdmissions")
        .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
        .collect() as Promise<AdmissionRow[]>,
      ctx.db
        .query("musicVideoA2VidRuntimeRevocations")
        .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
        .collect() as Promise<RevocationRow[]>,
    ]);
    const revoked = new Set<string>();
    for (const row of revocationRows) {
      if (row.version !== MUSIC_VIDEO_A2VID_RUNTIME_REVOCATION_VERSION || row.ownerId !== args.ownerId) {
        throw new Error("musicVideoA2VidState: immutable runtime revocation row is corrupt");
      }
      assertFingerprint(row.admissionFingerprint, "revoked runtime admission fingerprint");
      if (typeof row.reason !== "string" || !SAFE_REASON.test(row.reason)) {
        throw new Error("musicVideoA2VidState: immutable runtime revocation reason is corrupt");
      }
      if (row.revocationFingerprint !== revocationFingerprint(row)) {
        throw new Error("musicVideoA2VidState: immutable runtime revocation fingerprint is corrupt");
      }
      revoked.add(row.admissionFingerprint);
    }
    return admissionRows
      .map((row) => {
        if (row.ownerId !== args.ownerId) throw new Error("musicVideoA2VidState: runtime admission owner mismatch");
        return assertAdmissionRow(row);
      })
      .filter((admission) => !revoked.has(admission.fingerprint));
  },
});

export const recordMusicVideoA2VidRuntimeAdmission = mutation({
  args: { ownerId: v.string(), admission: v.any() },
  returns: v.id("musicVideoA2VidRuntimeAdmissions"),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "music-video A2Vid runtime persistence");
    assertOwnerId(args.ownerId);
    assertContractSize(args.admission);
    const admission = assertMusicVideoA2VidRuntimeAdmission(args.admission);
    const existing = await ctx.db
      .query("musicVideoA2VidRuntimeAdmissions")
      .withIndex("by_owner_admission", (q) =>
        q.eq("ownerId", args.ownerId).eq("admissionFingerprint", admission.fingerprint),
      )
      .unique() as AdmissionRow | null;
    if (existing) {
      const stored = assertAdmissionRow(existing);
      if (!sameFrozenContract(stored, admission)) {
        throw new Error("musicVideoA2VidState: admission fingerprint conflicts with its immutable payload");
      }
      return existing._id;
    }
    return await ctx.db.insert("musicVideoA2VidRuntimeAdmissions", {
      ownerId: args.ownerId,
      version: MUSIC_VIDEO_A2VID_RUNTIME_ADMISSION_VERSION,
      admissionFingerprint: admission.fingerprint,
      runtimeFingerprint: admission.runtime.fingerprint,
      admission,
      createdAt: Date.now(),
    });
  },
});

export const revokeMusicVideoA2VidRuntimeAdmission = mutation({
  args: { ownerId: v.string(), admissionFingerprint: v.string(), reason: v.string() },
  returns: v.id("musicVideoA2VidRuntimeRevocations"),
  handler: async (ctx, args) => {
    await requireStudioServiceIdentity(ctx, args.ownerId, "music-video A2Vid runtime revocation");
    assertOwnerId(args.ownerId);
    assertFingerprint(args.admissionFingerprint, "runtime admission fingerprint");
    if (!SAFE_REASON.test(args.reason)) {
      throw new Error("musicVideoA2VidState: revocation reason must be 8-1,000 printable characters");
    }
    const admission = await ctx.db
      .query("musicVideoA2VidRuntimeAdmissions")
      .withIndex("by_owner_admission", (q) =>
        q.eq("ownerId", args.ownerId).eq("admissionFingerprint", args.admissionFingerprint),
      )
      .unique() as AdmissionRow | null;
    if (!admission) throw new Error("musicVideoA2VidState: runtime admission was not found for this owner");
    assertAdmissionRow(admission);
    const fingerprint = revocationFingerprint(args);
    const existing = await ctx.db
      .query("musicVideoA2VidRuntimeRevocations")
      .withIndex("by_owner_revocation", (q) => q.eq("ownerId", args.ownerId).eq("revocationFingerprint", fingerprint))
      .unique() as RevocationRow | null;
    if (existing) return existing._id;
    return await ctx.db.insert("musicVideoA2VidRuntimeRevocations", {
      ownerId: args.ownerId,
      version: MUSIC_VIDEO_A2VID_RUNTIME_REVOCATION_VERSION,
      admissionFingerprint: args.admissionFingerprint,
      reason: args.reason,
      revocationFingerprint: fingerprint,
      revokedAt: Date.now(),
    });
  },
});

export const musicVideoA2VidStateGuardsForTests = {
  assertAdmissionRow,
  revocationFingerprint,
};
