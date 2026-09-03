import { NextResponse } from "next/server";

import {
  getStudioActor,
  operatorSessionCookie,
  renewedOperatorSessionToken,
  sessionCookieOptions,
  STUDIO_SESSION_COOKIE,
} from "@/lib/operatorSession";
import { issueStudioConvexToken } from "@/lib/studioConvexAuth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (
    (origin && origin !== requestUrl.origin) ||
    (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none")
  ) {
    return Response.json(
      { error: "cross-origin token request refused" },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  try {
    const actor = await getStudioActor(request);
    const ownerSession = actor?.authKind === "session" && actor.role === "owner";
    const role = ownerSession ? "owner" : "viewer";
    const result = issueStudioConvexToken({
      role,
      ownerId: ownerSession ? actor.ownerId : undefined,
    });
    const response = NextResponse.json({ ...result, role }, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        Pragma: "no-cache",
        Vary: "Cookie",
      },
    });

    // Renew the session while it is being used. The client polls this endpoint
    // to keep its Convex token fresh, which makes it the one place that sees
    // every active owner without adding a request of its own. An owner who uses
    // the studio at all is therefore never signed out — the previous 8-hour
    // window meant a full YouTube consent round trip before most sessions.
    if (ownerSession) {
      const renewed = await renewedOperatorSessionToken(operatorSessionCookie(request));
      if (renewed) {
        response.cookies.set(STUDIO_SESSION_COOKIE, renewed, sessionCookieOptions(request.url));
      }
    }
    return response;
  } catch (error) {
    console.error("[studio-auth] Convex token signing unavailable", error);
    return Response.json(
      { error: "Convex authentication is not configured" },
      {
        status: 503,
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      },
    );
  }
}
