import { requireStudioActor } from "@/lib/operatorSession";
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

  let ownerId: string;
  try {
    const actor = await requireStudioActor(request);
    if (actor.authKind !== "session" || actor.role !== "owner") {
      return Response.json({ error: "operator session required" }, { status: 403 });
    }
    ownerId = actor.ownerId;
  } catch {
    return Response.json(
      { error: "authentication required" },
      {
        status: 401,
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      },
    );
  }

  try {
    const result = issueStudioConvexToken({
      role: "owner",
      ownerId,
    });
    return Response.json(result, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        Pragma: "no-cache",
      },
    });
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
