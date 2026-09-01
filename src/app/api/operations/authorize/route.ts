import { NextRequest, NextResponse } from "next/server";
import { hydrateEnv } from "@/lib/vault";
import { getOwnerSessionConsentUrl } from "@/lib/youtube";
import {
  createOperationsOAuthState,
  OPERATIONS_OAUTH_NONCE_COOKIE,
  OPERATIONS_OAUTH_STATE_TTL_MS,
} from "@/lib/operationsOAuthState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = process.env.OAUTH_REDIRECT_BASE ?? "https://youtube-studio-ai.vercel.app";
const REDIRECT_URI = `${BASE}/api/youtube-callback`;

/** Begin browser-bound YouTube owner verification without accepting a password. */
export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (
    (origin && origin !== new URL(request.url).origin)
    || (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none")
  ) {
    return NextResponse.json(
      { error: "cross-origin owner verification refused" },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  try {
    try {
      await hydrateEnv("youtube");
    } catch {
      // Local and managed deployments may already expose the provider env.
      // The consent-url builder below still fails closed if it is absent.
    }
    const { state, nonce } = createOperationsOAuthState();
    const response = NextResponse.redirect(
      getOwnerSessionConsentUrl(REDIRECT_URI, state),
    );
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.cookies.set(OPERATIONS_OAUTH_NONCE_COOKIE, nonce, {
      httpOnly: true,
      secure: new URL(BASE).protocol === "https:",
      sameSite: "lax",
      path: "/api/youtube-callback",
      maxAge: Math.floor(OPERATIONS_OAUTH_STATE_TTL_MS / 1000),
      priority: "high",
    });
    return response;
  } catch (error) {
    return NextResponse.redirect(
      `${BASE}/?operations=unavailable&detail=${encodeURIComponent(error instanceof Error ? error.message : "owner verification unavailable")}`,
    );
  }
}
