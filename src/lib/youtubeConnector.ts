import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { hasAnyScope } from "@/lib/publishingPolicy";
import { decryptSecret } from "@/lib/secretEnvelope";

const TOKEN_KEY_ENV = "YOUTUBE_TOKEN_ENCRYPTION_KEY";

export interface YouTubeConnectorCredential {
  connectorId: Id<"youtubeAuth">;
  tokenVersion: number;
  refreshToken: string;
  ytChannelId?: string;
  ytTitle?: string;
  grantedScopes: string[];
  scopeHealth: "healthy" | "partial" | "unknown";
  storage: "encrypted" | "legacy-plaintext";
}

export function requireInternalQuerySecret(): string {
  const secret = process.env.INTERNAL_QUERY_SECRET;
  if (!secret) throw new Error("INTERNAL_QUERY_SECRET is not configured");
  return secret;
}

export function youtubeConnectorAad(
  ownerId: string,
  channelId: string,
): string {
  return `youtube-connector:${ownerId}:${channelId}`;
}

export async function requireYouTubeConnector(
  convex: ConvexHttpClient,
  args: {
    channelId: Id<"channels">;
    ownerId: string;
    expectedConnectorId?: Id<"youtubeAuth">;
    expectedConnectorVersion?: number;
    requiredScopes?: readonly string[];
  },
): Promise<YouTubeConnectorCredential> {
  const auth = await convex.query(api.youtubeAuth.getForChannel, {
    channelId: args.channelId,
    ownerId: args.ownerId,
    secret: requireInternalQuerySecret(),
  });
  if (!auth) {
    throw new Error(
      `YouTube connector missing for channel ${args.channelId}; refusing account fallback`,
    );
  }
  if (auth.ownerId !== args.ownerId) {
    throw new Error("YouTube connector owner mismatch");
  }
  if ((auth.status ?? "active") !== "active") {
    throw new Error(`YouTube connector is ${auth.status ?? "inactive"}`);
  }
  const tokenVersion = auth.tokenVersion ?? 1;
  if (args.expectedConnectorId && auth._id !== args.expectedConnectorId) {
    throw new Error("YouTube connector identity changed");
  }
  if (
    args.expectedConnectorVersion !== undefined &&
    tokenVersion !== args.expectedConnectorVersion
  ) {
    throw new Error("YouTube connector token version changed");
  }
  const grantedScopes = auth.grantedScopes ?? [];
  if (
    args.requiredScopes?.length &&
    !hasAnyScope(grantedScopes, args.requiredScopes)
  ) {
    throw new Error("YouTube connector is missing a required OAuth scope");
  }

  if (auth.refreshTokenCiphertext) {
    return {
      connectorId: auth._id,
      tokenVersion,
      refreshToken: decryptSecret(auth.refreshTokenCiphertext, {
        envName: TOKEN_KEY_ENV,
        aad: youtubeConnectorAad(args.ownerId, String(args.channelId)),
      }),
      ytChannelId: auth.ytChannelId,
      ytTitle: auth.ytTitle,
      grantedScopes,
      scopeHealth: auth.scopeHealth ?? "unknown",
      storage: "encrypted",
    };
  }

  if (
    auth.refreshToken &&
    process.env.YOUTUBE_ALLOW_LEGACY_PLAINTEXT_TOKENS === "1"
  ) {
    return {
      connectorId: auth._id,
      tokenVersion,
      refreshToken: auth.refreshToken,
      ytChannelId: auth.ytChannelId,
      ytTitle: auth.ytTitle,
      grantedScopes,
      scopeHealth: auth.scopeHealth ?? "unknown",
      storage: "legacy-plaintext",
    };
  }

  throw new Error(
    "YouTube connector uses legacy plaintext storage; reconnect or run the encrypted-token migration",
  );
}
