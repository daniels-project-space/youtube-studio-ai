/**
 * Stage 0 helper — mint a YouTube refresh token with the scopes the engine needs
 * for READ (competitor SERP / SEO databank / thumbnail style guide) and
 * ANALYTICS (retention/CTR learning loop). The current token only has
 * `youtube.upload`, so Data-API read + Analytics 403 (insufficientPermissions).
 *
 * One-time, interactive (Google consent can't be automated). Two steps:
 *
 *   1) Print the consent URL — open it, pick the channel's Google account, allow:
 *        npx tsx scripts/youtube-oauth.ts url
 *      After allowing you'll land on http://localhost/?code=XXXX (the page won't
 *      load — that's fine). Copy the `code` value from the address bar.
 *
 *   2) Exchange the code for a refresh token:
 *        npx tsx scripts/youtube-oauth.ts code <CODE>
 *      Then update the vault secret youtube/YOUTUBE_REFRESH_TOKEN with the printed
 *      refresh_token (and redeploy Trigger so tasks pick it up).
 *
 * If consent errors with redirect_uri_mismatch, add http://localhost as an
 * Authorized redirect URI on the OAuth client in Google Cloud Console, then retry.
 */
import { hydrateEnv } from "@/lib/vault";

const REDIRECT = "http://localhost";
const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
].join(" ");

async function main() {
  await hydrateEnv("youtube");
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("missing YOUTUBE_CLIENT_ID/SECRET in vault");

  const mode = process.argv[2];
  if (mode === "url") {
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.searchParams.set("client_id", clientId);
    u.searchParams.set("redirect_uri", REDIRECT);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", SCOPES);
    u.searchParams.set("access_type", "offline");
    u.searchParams.set("prompt", "consent");
    console.log("\nOpen this URL, choose the channel's account, and Allow:\n");
    console.log(u.toString());
    console.log("\nThen copy the `code` from the http://localhost/?code=... redirect and run:");
    console.log("  npx tsx scripts/youtube-oauth.ts code <CODE>\n");
    return;
  }
  if (mode === "code") {
    const code = process.argv[3];
    if (!code) throw new Error("usage: youtube-oauth.ts code <CODE>");
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT,
      }),
    });
    const j = (await res.json()) as { refresh_token?: string; scope?: string; error?: string; error_description?: string };
    if (!res.ok || !j.refresh_token) {
      throw new Error(`exchange failed: ${j.error ?? res.status} ${j.error_description ?? JSON.stringify(j)}`);
    }
    console.log("\n✅ Refresh token (update vault youtube/YOUTUBE_REFRESH_TOKEN with this):\n");
    console.log(j.refresh_token);
    console.log("\nGranted scopes:", j.scope, "\n");
    return;
  }
  console.log("usage: youtube-oauth.ts url | youtube-oauth.ts code <CODE>");
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
