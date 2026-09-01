import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET } from "./route";
import {
  createOperationsOAuthState,
  OPERATIONS_OAUTH_NONCE_COOKIE,
} from "@/lib/operationsOAuthState";

process.env.STUDIO_SESSION_SECRET = Buffer.alloc(32, 29).toString("base64url");

async function main() {
  const { state, nonce } = createOperationsOAuthState();
  const cancelled = await GET(new NextRequest(
    `https://youtube-studio-ai.vercel.app/api/youtube-callback?error=access_denied&state=${encodeURIComponent(state)}`,
    { headers: { Cookie: `${OPERATIONS_OAUTH_NONCE_COOKIE}=${nonce}` } },
  ));
  assert.equal(cancelled.status, 307);
  assert.equal(
    cancelled.headers.get("location"),
    "https://youtube-studio-ai.vercel.app/?operations=cancelled",
  );
  const cleared = cancelled.headers.get("set-cookie") ?? "";
  assert.match(cleared, new RegExp(`${OPERATIONS_OAUTH_NONCE_COOKIE}=`));
  assert.match(cleared, /Max-Age=0/i);
  assert.doesNotMatch(cleared, /studio_session=/i);

  const ordinaryError = await GET(new NextRequest(
    "https://youtube-studio-ai.vercel.app/api/youtube-callback?error=access_denied",
  ));
  assert.equal(
    ordinaryError.headers.get("location"),
    "https://youtube-studio-ai.vercel.app/channels?yt=error",
  );
  console.log("Operations OAuth callback cancellation tests passed");
}

void main();
