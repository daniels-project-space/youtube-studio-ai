/**
 * Revalidate encrypted per-channel YouTube connectors without printing tokens.
 * Defaults to a dry run; pass --apply to persist scope/account health.
 *
 *   npm run youtube:revalidate -- --apply [ownerId]
 */
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { refreshAccessTokenGrant, YT_SCOPES } from "@/lib/youtube";
import {
  requireInternalQuerySecret,
  requireYouTubeConnector,
} from "@/lib/youtubeConnector";

interface MineResponse {
  items?: Array<{ id: string; snippet?: { title?: string } }>;
  error?: { message?: string };
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const positional = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const ownerId = positional[0] ?? process.env.STUDIO_OWNER_ID ?? "owner_daniel";
  await bootstrapSecrets(() => {}, {
    required: [
      "YOUTUBE_CLIENT_ID",
      "YOUTUBE_CLIENT_SECRET",
      "YOUTUBE_TOKEN_ENCRYPTION_KEY",
      "INTERNAL_QUERY_SECRET",
    ],
  });
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL or CONVEX_URL is required");
  const convex = new ConvexHttpClient(url);
  const channels = await convex.query(api.channels.listChannels, { ownerId });
  const requiredScopes = YT_SCOPES.split(" ").filter(Boolean);
  let healthy = 0;
  let partial = 0;
  let invalid = 0;
  let missing = 0;

  for (const channel of channels) {
    const channelId = channel._id as Id<"channels">;
    try {
      const connector = await requireYouTubeConnector(convex, { channelId, ownerId });
      const grant = await refreshAccessTokenGrant(connector.refreshToken);
      if (grant.grantedScopes.length === 0) {
        throw new Error("Google token response omitted granted scopes");
      }
      const response = await fetch(
        "https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true",
        { headers: { Authorization: `Bearer ${grant.accessToken}` } },
      );
      const mine = (await response.json()) as MineResponse;
      const actual = mine.items?.[0];
      if (!response.ok || !actual?.id) {
        throw new Error(mine.error?.message ?? `channels.mine failed (${response.status})`);
      }
      if (!connector.ytChannelId || actual.id !== connector.ytChannelId) {
        throw new Error(
          `connector account mismatch: stored=${connector.ytChannelId ?? "missing"}, current=${actual.id}`,
        );
      }
      const scopeHealth = requiredScopes.every((scope) =>
        grant.grantedScopes.includes(scope)
      ) ? "healthy" : "partial";
      if (scopeHealth === "healthy") healthy++;
      else partial++;
      if (apply) {
        await convex.mutation(api.youtubeAuth.validate, {
          secret: requireInternalQuerySecret(),
          ownerId,
          channelId,
          grantedScopes: grant.grantedScopes,
          scopeHealth,
          validatedAt: Date.now(),
        });
      }
      console.log(
        `${apply ? "validated" : "would validate"}: ${channel.name} -> ${actual.snippet?.title ?? actual.id} (${scopeHealth}, ${grant.grantedScopes.length} scopes)`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/connector missing/i.test(message)) {
        missing++;
        console.log(`skipped: ${channel.name} (no connector)`);
        continue;
      }
      invalid++;
      if (apply) {
        try {
          await convex.mutation(api.youtubeAuth.validate, {
            secret: requireInternalQuerySecret(),
            ownerId,
            channelId,
            grantedScopes: [],
            scopeHealth: "unknown",
            validatedAt: Date.now(),
            lastError: message,
          });
        } catch {
          // Missing/revoked connectors cannot be transitioned to error.
        }
      }
      console.error(`${apply ? "invalid" : "would mark invalid"}: ${channel.name} (${message})`);
    }
  }
  console.log(
    `connector revalidation ${apply ? "applied" : "dry run"}: healthy=${healthy}, partial=${partial}, invalid=${invalid}, missing=${missing}`,
  );
  if (invalid > 0) process.exitCode = 2;
}

void main().catch((error) => {
  console.error(`connector revalidation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
