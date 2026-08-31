import { NextResponse } from "next/server";
import { authorizeStudioRoute } from "@/lib/operatorSession";

/**
 * Retired legacy endpoint.
 *
 * Channel creation is a real-world, Browserbase-backed action.  The supported
 * `/api/youtube-create` flow records explicit approval and a durable creation
 * claim before it can dispatch `youtube-create-channel`.  Keep this route only
 * to fail closed for old clients; it must never enqueue `provision-youtube`.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  const authFailure = await authorizeStudioRoute(request);
  if (authFailure) return authFailure;
  return NextResponse.json(
    {
      error: "Legacy YouTube provisioning is retired. Use the approved /api/youtube-create flow.",
      code: "legacy_youtube_provision_retired",
    },
    { status: 410 },
  );
}
