import { NextResponse } from "next/server";
import { OWNER_ID } from "@/lib/config";
import { getObjectBytes, headObjectMetadata } from "@/lib/storage";

export const runtime = "nodejs";

const MAX_INLINE_IMAGE_BYTES = 25 * 1024 * 1024;

function contentType(key: string): string | undefined {
  const extension = key.toLowerCase().split(".").pop();
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  return undefined;
}

function isOwnedKey(key: string): boolean {
  const ownerPrefix = `owner/${OWNER_ID}/`;
  return key.startsWith(ownerPrefix) && !key.includes("..") && !key.includes("\\") && key.length <= 1_024;
}

/** Same-origin image response for private R2 artwork; videos keep direct signed playback. */
export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key") ?? "";
  const mimeType = contentType(key);
  if (!mimeType || !isOwnedKey(key)) {
    return NextResponse.json({ error: "forbidden image key" }, { status: 403 });
  }
  try {
    const metadata = await headObjectMetadata(key);
    if (!metadata || metadata.contentLength === undefined || metadata.contentLength > MAX_INLINE_IMAGE_BYTES) {
      return NextResponse.json({ error: "image unavailable" }, { status: 404 });
    }
    const bytes = await getObjectBytes(key, undefined, { timeoutMs: 15_000 });
    if (bytes.byteLength > MAX_INLINE_IMAGE_BYTES) {
      return NextResponse.json({ error: "image too large" }, { status: 413 });
    }
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, max-age=600",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  } catch {
    return NextResponse.json({ error: "image unavailable" }, { status: 404 });
  }
}
