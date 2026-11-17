import { NextResponse, type NextRequest } from "next/server";
import { getStudioActor } from "@/lib/operatorSession";

/** The personal VPS application does not offer the legacy public viewer. */
export async function proxy(request: NextRequest) {
  if (process.env.YOUTUBE_STUDIO_WORKSHOP_PRIVATE !== "1") return NextResponse.next();
  const path = request.nextUrl.pathname;
  if (path === "/operator-login" || path === "/api/auth/local-login" ||
      path === "/favicon.ico" || path === "/icon.svg" || path.startsWith("/_next/static/")) return NextResponse.next();
  const actor = await getStudioActor(request);
  if (actor?.role === "owner") return NextResponse.next();
  if (path.startsWith("/api/")) return Response.json({ error: "authentication required" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  return NextResponse.redirect(new URL("/operator-login", request.url));
}
