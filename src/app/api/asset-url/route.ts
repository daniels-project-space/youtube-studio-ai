import { NextResponse } from "next/server";
import { presignDownload } from "@/lib/storage";
import { OWNER_ID } from "@/lib/config";

/**
 * GET /api/asset-url?key=<r2Key>
 *
 * Server-only route handler that mints a short-lived presigned R2 download URL
 * for a stored asset (thumbnail / video). The R2 credentials live exclusively
 * in this server context (src/lib/storage.ts) and are NEVER shipped to the
 * client — the browser only ever receives the time-limited signed URL.
 *
 * Guard: the key MUST live under this owner's R2 prefix
 * (`owner/<ownerId>/...` — see channelPrefix in storage.ts), so the route
 * cannot be abused to presign arbitrary bucket objects.
 *
 * Runs on the Node.js runtime because the AWS SDK signer needs Node crypto.
 */
export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");

  if (!key) {
    return NextResponse.json({ error: "missing key" }, { status: 400 });
  }

  // Basic ownership guard: only keys under this owner's namespace.
  const ownerPrefix = `owner/${OWNER_ID}/`;
  // Reject traversal and out-of-namespace keys.
  if (key.includes("..") || !key.startsWith(ownerPrefix)) {
    return NextResponse.json({ error: "forbidden key" }, { status: 403 });
  }

  try {
    const url = await presignDownload(key, { expiresIn: 3600 });
    return NextResponse.json(
      { url },
      // The signed URL itself is short-lived; allow the browser to reuse it
      // briefly but never a shared/CDN cache.
      { headers: { "Cache-Control": "private, max-age=600" } },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "presign failed" },
      { status: 500 },
    );
  }
}
