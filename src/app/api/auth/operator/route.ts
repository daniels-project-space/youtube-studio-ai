import { NextRequest, NextResponse } from "next/server";
import {
  createOperatorSessionToken,
  getStudioActor,
  sessionCookieOptions,
  STUDIO_SESSION_COOKIE,
  StudioAuthError,
  verifyOperatorLoginToken,
} from "@/lib/operatorSession";

export const runtime = "nodejs";

function errorResponse(error: unknown): NextResponse {
  const status = error instanceof StudioAuthError ? error.status : 500;
  const message =
    error instanceof StudioAuthError ? error.message : "authentication failed";
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { token?: unknown };
    const token = typeof body.token === "string" ? body.token : "";
    if (!verifyOperatorLoginToken(token)) {
      throw new StudioAuthError("invalid operator token");
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.set(
      STUDIO_SESSION_COOKIE,
      await createOperatorSessionToken(),
      sessionCookieOptions(request.url),
    );
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: NextRequest) {
  const actor = await getStudioActor(request);
  return NextResponse.json(
    actor
      ? { ok: true, ownerId: actor.ownerId, role: actor.role }
      : { ok: false },
    { status: actor ? 200 : 401 },
  );
}

export async function DELETE(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return NextResponse.json(
      { ok: false, error: "cross-origin state change refused" },
      { status: 403 },
    );
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(STUDIO_SESSION_COOKIE, "", {
    ...sessionCookieOptions(request.url),
    maxAge: 0,
  });
  return response;
}
