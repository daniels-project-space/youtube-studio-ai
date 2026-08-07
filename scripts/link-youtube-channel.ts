/**
 * Link a YouTube channel to an app channel.
 *
 *   1) Get a consent URL (pick the target YouTube channel at Google's chooser):
 *        npx tsx scripts/youtube-oauth.ts url
 *   2) Exchange the code and store the token for an app channel (by slug):
 *        npx tsx scripts/link-youtube-channel.ts <appChannelSlug> <CODE>
 *
 * Stores the refresh token in Convex `youtubeAuth` (per channel) so that
 * channel's uploads go to its OWN YouTube channel. Falls back to the global
 * token for unlinked channels.
 */
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../convex/_generated/api";
import { encryptSecret } from "@/lib/secretEnvelope";
import { YT_SCOPES } from "@/lib/youtube";
import {
  requireInternalQuerySecret,
  youtubeConnectorAad,
} from "@/lib/youtubeConnector";

const VAULT = "https://fantastic-roadrunner-485.convex.cloud/api/query";
const CONVEX = "https://astute-camel-689.convex.cloud";
const REDIRECT = "http://localhost";

async function vaultYouTube(): Promise<Record<string, string>> {
  const r = await fetch(VAULT, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: "secrets:listByService", args: { service: "youtube" }, format: "json" }),
  });
  const j = (await r.json()) as { value: { keyName: string; value: string }[] };
  const o: Record<string, string> = {};
  for (const s of j.value) o[s.keyName] = s.value; // last-wins
  return o;
}

async function main() {
  const slug = process.argv[2];
  const code = process.argv[3];
  if (!slug || !code) throw new Error("usage: link-youtube-channel.ts <appChannelSlug> <CODE>");

  const yt = await vaultYouTube();
  const clientId = yt.YOUTUBE_CLIENT_ID, clientSecret = yt.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("missing YOUTUBE_CLIENT_ID/SECRET in vault");
  if (!process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY && yt.YOUTUBE_TOKEN_ENCRYPTION_KEY) {
    process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY = yt.YOUTUBE_TOKEN_ENCRYPTION_KEY;
  }

  // Exchange the auth code for a refresh token.
  const tok = await (await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: REDIRECT, grant_type: "authorization_code" }),
  })).json() as { refresh_token?: string; access_token?: string; scope?: string; error?: string; error_description?: string };
  if (!tok.refresh_token) throw new Error(`no refresh_token: ${tok.error ?? ""} ${tok.error_description ?? ""} (codes are single-use — re-run the consent URL for a fresh code, and ensure offline access/prompt=consent)`);

  // Which YouTube channel did this token land on?
  const ch = await (await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
    headers: { Authorization: `Bearer ${tok.access_token}` },
  })).json() as { items?: { id: string; snippet: { title: string } }[] };
  const yc = ch.items?.[0];
  console.log(`token controls YouTube channel: ${yc?.snippet.title ?? "(unknown)"} (${yc?.id ?? "?"})`);

  // Resolve the app channel by slug.
  const convex = new ConvexHttpClient(CONVEX);
  const channels = (await convex.query(api.channels.listChannels, { ownerId: "owner_daniel" })) as Array<{ _id: string; slug: string; name: string }>;
  const app = channels.find((c) => c.slug === slug || c.slug.startsWith(slug));
  if (!app) throw new Error(`app channel not found for slug "${slug}". Available: ${channels.map((c) => c.slug).join(", ")}`);

  const ownerId = "owner_daniel";
  const refreshTokenCiphertext = encryptSecret(tok.refresh_token, {
    envName: "YOUTUBE_TOKEN_ENCRYPTION_KEY",
    aad: youtubeConnectorAad(ownerId, app._id),
  });
  await convex.mutation(api.youtubeAuth.set, {
    secret: requireInternalQuerySecret(),
    ownerId,
    channelId: app._id as never,
    refreshTokenCiphertext,
    ytChannelId: yc?.id,
    ytTitle: yc?.snippet.title,
    grantedScopes: (tok.scope ?? "").split(/\s+/).filter(Boolean),
    scopeHealth: tok.scope
      ? YT_SCOPES.split(" ").every((scope) => tok.scope!.split(/\s+/).includes(scope))
        ? "healthy"
        : "partial"
      : "unknown",
    updatedAt: Date.now(),
  });
  console.log(`✓ linked app channel "${app.name}" (${app.slug}) → YouTube "${yc?.snippet.title}". Future uploads go there.`);
}
main().catch((e) => { console.error("FAIL:", e instanceof Error ? e.message : e); process.exit(1); });
