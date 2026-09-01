import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET } from "./route";
import {
  OPERATIONS_OAUTH_NONCE_COOKIE,
  verifyOperationsOAuthState,
} from "@/lib/operationsOAuthState";
import { YT_OWNER_SESSION_SCOPES } from "@/lib/youtube";

process.env.STUDIO_SESSION_SECRET = Buffer.alloc(32, 23).toString("base64url");
process.env.YOUTUBE_CLIENT_ID = "owner-oauth-client.apps.googleusercontent.com";

async function main() {
  const endpoint = "https://youtube-studio-ai.vercel.app/api/operations/authorize";
  const crossOrigin = await GET(new NextRequest(endpoint, {
    headers: {
      Origin: "https://attacker.invalid",
      "Sec-Fetch-Site": "cross-site",
    },
  }));
  assert.equal(crossOrigin.status, 403);
  assert.equal(crossOrigin.headers.get("set-cookie"), null);

  const response = await GET(new NextRequest(endpoint, {
    headers: { "Sec-Fetch-Site": "same-origin" },
  }));
  assert.equal(response.status, 307);
  const location = new URL(response.headers.get("location") ?? "");
  assert.equal(location.origin, "https://accounts.google.com");
  assert.equal(location.searchParams.get("scope"), YT_OWNER_SESSION_SCOPES);
  assert.equal(location.searchParams.get("access_type"), "online");
  assert.equal(location.searchParams.get("redirect_uri"), "https://youtube-studio-ai.vercel.app/api/youtube-callback");
  const state = location.searchParams.get("state") ?? "";
  assert.match(state, /^ops\./);

  const setCookie = response.headers.get("set-cookie") ?? "";
  assert.match(setCookie, new RegExp(`${OPERATIONS_OAUTH_NONCE_COOKIE}=`));
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  const nonce = setCookie.match(new RegExp(`${OPERATIONS_OAUTH_NONCE_COOKIE}=([^;]+)`))?.[1];
  assert.equal(verifyOperationsOAuthState({ state, nonce }).purpose, "owner-session");
  console.log("Operations YouTube authorization start tests passed");
}

void main();
