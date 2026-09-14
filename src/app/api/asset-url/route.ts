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
 * Public viewer boundary: the key MUST live under this owner's R2 prefix
 * (`owner/<ownerId>/...` — see channelPrefix in storage.ts), so the route
 * cannot be abused to presign arbitrary bucket objects.
 *
 * Runs on the Node.js runtime because the AWS SDK signer needs Node crypto.
 */
export const runtime = "nodejs";

function responseContentType(key: string): string | undefined {
  const extension = key.toLowerCase().split(".").pop();
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  if (extension === "mp4") return "video/mp4";
  if (extension === "webm") return "video/webm";
  if (extension === "mp3") return "audio/mpeg";
  if (extension === "wav") return "audio/wav";
  return undefined;
}

function isInlineImage(key: string): boolean {
  return responseContentType(key)?.startsWith("image/") === true;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");

  if (!key) {
    return NextResponse.json({ error: "missing key" }, { status: 400 });
  }

  // Basic ownership guard: channel/run media must remain under this owner's
  // namespace. Narrator auditions are the one deliberately shared collection:
  // their immutable provider ids are exposed in the voice catalog and the
  // audio is required by the public read-only picker. Keep this allow-list
  // exact so it cannot become a generic R2 signing oracle.
  const ownerPrefix = `owner/${OWNER_ID}/`;
  const sharedVoiceAudition = /^voicebank\/auditions\/[A-Za-z0-9_-]{8,64}\.mp3$/.test(key);
  // Reject traversal and every out-of-namespace key except the curated shared
  // audition path above.
  if (key.includes("..") || (!key.startsWith(ownerPrefix) && !sharedVoiceAudition)) {
    return NextResponse.json({ error: "forbidden key" }, { status: 403 });
  }

  try {
    // R2's direct endpoint can return an opaque/ambiguous response for image
    // objects (Chromium then blocks it with ORB). Keep the browser-facing
    // image path same-origin; the proxy below still enforces this exact owner
    // namespace and never exposes bucket credentials.
    if (isInlineImage(key)) {
      return NextResponse.json(
        { url: `/api/asset-image?key=${encodeURIComponent(key)}` },
        { headers: { "Cache-Control": "private, max-age=600" } },
      );
    }
    const mimeType = responseContentType(key);
    const url = await presignDownload(key, {
      expiresIn: 3600,
      ...(mimeType ? { responseContentType: mimeType } : {}),
    });
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
