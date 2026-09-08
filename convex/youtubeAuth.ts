import { mutation, query } from "./studioFunctions";
import { v } from "convex/values";

/**
 * Per-channel YouTube OAuth token store. Each app channel can hold its own
 * refresh token so it uploads to its OWN YouTube channel. Read server-side by
 * the upload_draft block (via ConvexHttpClient); never surfaced to the browser.
 */

/** Upsert the token for a channel (called after the consent → code exchange). */
export const set = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    refreshTokenCiphertext: v.string(),
    ytChannelId: v.optional(v.string()),
    ytTitle: v.optional(v.string()),
    grantedScopes: v.array(v.string()),
    scopeHealth: v.union(
      v.literal("healthy"),
      v.literal("partial"),
      v.literal("unknown"),
    ),
    updatedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const expected = process.env.INTERNAL_QUERY_SECRET;
    if (!expected || args.secret !== expected) {
      throw new Error("youtubeAuth.set: invalid internal secret");
    }
    const channel = await ctx.db.get(args.channelId);
    if (!channel || channel.ownerId !== args.ownerId) {
      throw new Error("youtubeAuth.set: channel owner mismatch");
    }
    const existing = await ctx.db
      .query("youtubeAuth")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        refreshTokenCiphertext: args.refreshTokenCiphertext,
        refreshToken: undefined,
        ytChannelId: args.ytChannelId,
        ytTitle: args.ytTitle,
        grantedScopes: args.grantedScopes,
        tokenVersion: (existing.tokenVersion ?? 0) + 1,
        status: "active",
        scopeHealth: args.scopeHealth,
        connectedAt: existing.connectedAt ?? args.updatedAt,
        validatedAt: args.updatedAt,
        lastRefreshAt: args.updatedAt,
        revokedAt: undefined,
        lastError: undefined,
        dataRetentionPolicy: "retain_aggregates_delete_credentials_v1",
        updatedAt: args.updatedAt,
      });
    } else {
      const { secret: _secret, ...row } = args;
      void _secret;
      await ctx.db.insert("youtubeAuth", {
        ...row,
        tokenVersion: 1,
        status: "active",
        connectedAt: args.updatedAt,
        validatedAt: args.updatedAt,
        lastRefreshAt: args.updatedAt,
        dataRetentionPolicy: "retain_aggregates_delete_credentials_v1",
      });
    }
    return null;
  },
});

/**
 * Move one unchanged legacy refresh token into its encrypted envelope.
 *
 * This is a compare-and-swap storage migration, not a connector rotation: the
 * logical credential and tokenVersion remain unchanged, so frozen upload and
 * thumbnail plans stay valid. The worker round-trips the envelope with the
 * channel-bound AAD before this mutation atomically removes the plaintext.
 */
export const migrateLegacyTokenStorage = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    connectorId: v.id("youtubeAuth"),
    expectedTokenVersion: v.number(),
    expectedUpdatedAt: v.number(),
    refreshTokenCiphertext: v.string(),
    migratedAt: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const expected = process.env.INTERNAL_QUERY_SECRET;
    if (!expected || args.secret !== expected) {
      throw new Error("youtubeAuth.migrateLegacyTokenStorage: invalid internal secret");
    }
    if (
      !Number.isSafeInteger(args.expectedTokenVersion) ||
      args.expectedTokenVersion < 1 ||
      !Number.isSafeInteger(args.expectedUpdatedAt) ||
      !Number.isSafeInteger(args.migratedAt) ||
      args.migratedAt < args.expectedUpdatedAt ||
      args.refreshTokenCiphertext.length < 40 ||
      args.refreshTokenCiphertext.length > 10_000 ||
      !/^enc:v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/.test(
        args.refreshTokenCiphertext,
      )
    ) {
      throw new Error("youtubeAuth.migrateLegacyTokenStorage: invalid migration claim");
    }
    const row = await ctx.db.get(args.connectorId);
    if (!row || row.ownerId !== args.ownerId || row.channelId !== args.channelId) {
      throw new Error("youtubeAuth.migrateLegacyTokenStorage: connector binding changed");
    }
    if (row.refreshTokenCiphertext && !row.refreshToken) {
      return { state: "already_encrypted", connectorId: row._id, tokenVersion: row.tokenVersion ?? 1 };
    }
    if (
      (row.status ?? "active") !== "active" ||
      !row.refreshToken ||
      row.refreshTokenCiphertext ||
      (row.tokenVersion ?? 1) !== args.expectedTokenVersion ||
      row.updatedAt !== args.expectedUpdatedAt
    ) {
      throw new Error("youtubeAuth.migrateLegacyTokenStorage: legacy credential changed");
    }
    await ctx.db.patch(row._id, {
      refreshTokenCiphertext: args.refreshTokenCiphertext,
      refreshToken: undefined,
      dataRetentionPolicy: "retain_aggregates_delete_credentials_v1",
      updatedAt: args.migratedAt,
    });
    return { state: "migrated", connectorId: row._id, tokenVersion: row.tokenVersion ?? 1 };
  },
});

/**
 * The token row for a channel (or null). Server-only consumers.
 *
 * SECURITY: this returns a refreshToken, and Convex queries are publicly
 * callable — so it is gated behind INTERNAL_QUERY_SECRET. When that env var is
 * set on the deployment, callers MUST pass the matching `secret` or the query
 * throws (fail closed). When the env var is unset (dev / not yet provisioned),
 * legacy callers keep working; provision the secret in Convex + Trigger, then
 * update all call sites to pass `process.env.INTERNAL_QUERY_SECRET ?? ""`.
 */
export const getForChannel = query({
  args: {
    channelId: v.id("channels"),
    ownerId: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    const expected = process.env.INTERNAL_QUERY_SECRET;
    if (!expected || args.secret !== expected) {
      throw new Error("getForChannel: invalid internal secret");
    }
    const row = await ctx.db
      .query("youtubeAuth")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .unique();
    if (row && row.ownerId !== args.ownerId) {
      throw new Error("getForChannel: connector owner mismatch");
    }
    return row;
  },
});

/** Lightweight link status for the UI (NO token) — which channels are linked. */
export const linkStatus = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("youtubeAuth")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();
    return rows.map((r) => ({
      connectorId: r._id,
      channelId: r.channelId,
      ytTitle: r.ytTitle ?? null,
      ytChannelId: r.ytChannelId ?? null,
      status: r.status ?? "active",
      tokenVersion: r.tokenVersion ?? 1,
      scopeHealth: r.scopeHealth ?? "unknown",
      grantedScopes: r.grantedScopes ?? [],
      validatedAt: r.validatedAt ?? null,
      revokedAt: r.revokedAt ?? null,
      updatedAt: r.updatedAt,
    }));
  },
});

export const validate = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    grantedScopes: v.array(v.string()),
    scopeHealth: v.union(
      v.literal("healthy"),
      v.literal("partial"),
      v.literal("unknown"),
    ),
    validatedAt: v.number(),
    lastError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const expected = process.env.INTERNAL_QUERY_SECRET;
    if (!expected || args.secret !== expected) {
      throw new Error("youtubeAuth.validate: invalid internal secret");
    }
    const row = await ctx.db
      .query("youtubeAuth")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .unique();
    if (!row || row.ownerId !== args.ownerId) {
      throw new Error("youtubeAuth.validate: connector owner mismatch");
    }
    if ((row.status ?? "active") === "revoked") {
      throw new Error("youtubeAuth.validate: connector is revoked");
    }
    await ctx.db.patch(row._id, {
      grantedScopes: args.grantedScopes,
      scopeHealth: args.scopeHealth,
      status: args.lastError ? "error" : "active",
      validatedAt: args.validatedAt,
      lastRefreshAt: args.validatedAt,
      lastError: args.lastError?.slice(0, 500),
      updatedAt: args.validatedAt,
    });
    return await ctx.db.get(row._id);
  },
});

export const revoke = mutation({
  args: {
    secret: v.string(),
    ownerId: v.string(),
    channelId: v.id("channels"),
    revokedAt: v.number(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const expected = process.env.INTERNAL_QUERY_SECRET;
    if (!expected || args.secret !== expected) {
      throw new Error("youtubeAuth.revoke: invalid internal secret");
    }
    const row = await ctx.db
      .query("youtubeAuth")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .unique();
    if (!row || row.ownerId !== args.ownerId) {
      throw new Error("youtubeAuth.revoke: connector owner mismatch");
    }
    await ctx.db.patch(row._id, {
      refreshTokenCiphertext: undefined,
      refreshToken: undefined,
      grantedScopes: [],
      tokenVersion: (row.tokenVersion ?? 1) + 1,
      status: "revoked",
      scopeHealth: "unknown",
      revokedAt: args.revokedAt,
      lastError: (args.reason ?? "revoked by operator").slice(0, 500),
      dataRetentionPolicy: "retain_aggregates_delete_credentials_v1",
      updatedAt: args.revokedAt,
    });
    const sessions = await ctx.db
      .query("youtubeUploadSessions")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .collect();
    for (const session of sessions) await ctx.db.delete(session._id);
    const intents = await ctx.db
      .query("publishIntents")
      .withIndex("by_channel_status", (q) => q.eq("channelId", args.channelId))
      .collect();
    for (const intent of intents) {
      if (["uploaded", "cancelled", "dead_letter"].includes(intent.status)) continue;
      await ctx.db.patch(intent._id, {
        status: "blocked_connector",
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        lastError: "connector revoked",
        updatedAt: args.revokedAt,
      });
    }
    return { connectorId: row._id, sessionsDeleted: sessions.length };
  },
});
