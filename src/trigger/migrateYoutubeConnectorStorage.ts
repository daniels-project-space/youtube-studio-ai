import { task } from "@trigger.dev/sdk";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { decryptSecret, encryptSecret } from "@/lib/secretEnvelope";
import { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import {
  requireInternalQuerySecret,
  youtubeConnectorAad,
} from "@/lib/youtubeConnector";

type MigrationPayload = Readonly<{ ownerId?: string }>;

type LinkStatus = Readonly<{
  connectorId: Id<"youtubeAuth">;
  channelId: Id<"channels">;
  status: "active" | "revoked" | "error";
}>;

function client(): StudioConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("YouTube connector migration: Convex URL is not configured");
  return new StudioConvexHttpClient(url);
}

/**
 * One-time/idempotent at-rest migration for legacy per-channel refresh tokens.
 * It never calls Google and never changes the logical connector version. No
 * credential bytes, ciphertext, or token-derived material are returned/logged.
 */
export async function migrateYoutubeConnectorStorage(payload: MigrationPayload = {}) {
  await bootstrapSecrets(() => {}, {
    required: [
      "STUDIO_CONVEX_JWT_PRIVATE_KEY",
      "INTERNAL_QUERY_SECRET",
      "YOUTUBE_TOKEN_ENCRYPTION_KEY",
    ],
  });
  const ownerId = payload.ownerId ?? process.env.STUDIO_OWNER_ID ?? "owner_daniel";
  const convex = client();
  const links = await convex.query(api.youtubeAuth.linkStatus, { ownerId }) as LinkStatus[];
  let migrated = 0;
  let alreadyEncrypted = 0;
  let inactive = 0;
  let missingCredential = 0;

  for (const link of links) {
    if (link.status !== "active") {
      inactive++;
      continue;
    }
    const connector = await convex.query(api.youtubeAuth.getForChannel, {
      ownerId,
      channelId: link.channelId,
      secret: requireInternalQuerySecret(),
    });
    if (!connector) {
      missingCredential++;
      continue;
    }
    if (connector.refreshTokenCiphertext && !connector.refreshToken) {
      alreadyEncrypted++;
      continue;
    }
    if (!connector.refreshToken || connector.refreshTokenCiphertext) {
      missingCredential++;
      continue;
    }
    const aad = youtubeConnectorAad(ownerId, String(link.channelId));
    const refreshTokenCiphertext = encryptSecret(connector.refreshToken, {
      envName: "YOUTUBE_TOKEN_ENCRYPTION_KEY",
      aad,
    });
    if (decryptSecret(refreshTokenCiphertext, {
      envName: "YOUTUBE_TOKEN_ENCRYPTION_KEY",
      aad,
    }) !== connector.refreshToken) {
      throw new Error(`YouTube connector migration round-trip failed for ${link.channelId}`);
    }
    await convex.mutation(api.youtubeAuth.migrateLegacyTokenStorage, {
      secret: requireInternalQuerySecret(),
      ownerId,
      channelId: link.channelId,
      connectorId: link.connectorId,
      expectedTokenVersion: connector.tokenVersion ?? 1,
      expectedUpdatedAt: connector.updatedAt,
      refreshTokenCiphertext,
      migratedAt: Date.now(),
    });
    migrated++;
  }

  return {
    ok: true,
    examined: links.length,
    migrated,
    alreadyEncrypted,
    inactive,
    missingCredential,
  };
}

export const migrateYoutubeConnectorStorageTask = task({
  id: "migrate-youtube-connector-storage",
  machine: "small-1x",
  maxDuration: 120,
  retry: { maxAttempts: 2, minTimeoutInMs: 5_000, maxTimeoutInMs: 20_000, factor: 2 },
  run: async (payload: MigrationPayload) => migrateYoutubeConnectorStorage(payload),
});
