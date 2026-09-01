import { NextRequest, NextResponse } from "next/server";
import {
  getStudioActor,
  sessionCookieOptions,
  STUDIO_SESSION_COOKIE,
} from "@/lib/operatorSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Cookie",
};

function sameOriginMutation(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return origin === new URL(request.url).origin
    && (!fetchSite || fetchSite === "same-origin" || fetchSite === "none");
}

function json(
  body: Record<string, unknown>,
  init: { status?: number } = {},
): NextResponse {
  return NextResponse.json(body, {
    ...init,
    headers: RESPONSE_HEADERS,
  });
}

/** Reading the elevation state never changes or gates the public studio. */
export async function GET(request: NextRequest) {
  const actor = await getStudioActor(request);
  const elevated = actor?.authKind === "session" && actor.role === "owner";
  return json({ ok: true, elevated, role: elevated ? "owner" : "viewer" });
}

/** Lock privileged controls without changing the public viewer experience. */
export async function DELETE(request: NextRequest) {
  if (!sameOriginMutation(request)) {
    return json({ ok: false, error: "cross-origin state change refused" }, { status: 403 });
  }
  const response = json({ ok: true, elevated: false, role: "viewer" });
  response.cookies.set(STUDIO_SESSION_COOKIE, "", {
    ...sessionCookieOptions(request.url),
    maxAge: 0,
  });
  return response;
}
