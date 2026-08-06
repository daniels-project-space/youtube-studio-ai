import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Public liveness/release identity only. This intentionally does not probe
 * Convex or providers: doing that on an unauthenticated endpoint would turn a
 * deployment check into billable traffic and expose infrastructure state.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      ok: true,
      service: "youtube-studio-ai",
      revision:
        process.env.VERCEL_GIT_COMMIT_SHA ??
        process.env.RELEASE_SHA ??
        "development",
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
