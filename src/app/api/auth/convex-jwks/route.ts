import { getStudioConvexPublicJwks } from "@/lib/studioConvexAuth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(
      { keys: getStudioConvexPublicJwks() },
      {
        headers: {
          "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
        },
      },
    );
  } catch (error) {
    console.error("[studio-auth] Convex JWKS unavailable", error);
    return Response.json(
      { error: "Convex JWKS is not configured" },
      { status: 503 },
    );
  }
}
