import { NextResponse } from "next/server";
import { OWNER_ID } from "@/lib/config";
import { getObjectBytes, isR2CredentialFailure } from "@/lib/storage";

export const runtime = "nodejs";

const MAX_INLINE_IMAGE_BYTES = 25 * 1024 * 1024;

async function readImageBytes(key: string): Promise<Uint8Array> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await getObjectBytes(key, undefined, { timeoutMs: 15_000 });
    } catch (error) {
      lastError = error;
      if (attempt === 1) break;
      // R2 can briefly miss a read at one edge immediately after a successful
      // probe. Retry once server-side so the browser never sees that transient
      // 503/404 and does not discard an otherwise valid thumbnail.
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("image unavailable");
}

function contentType(key: string): string | undefined {
  const extension = key.toLowerCase().split(".").pop();
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  return undefined;
}

function sniffContentType(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 &&
    bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return "image/gif";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return undefined;
}

function isOwnedKey(key: string): boolean {
  const ownerPrefix = `owner/${OWNER_ID}/`;
  return key.startsWith(ownerPrefix) && !key.includes("..") && !key.includes("\\") && key.length <= 1_024;
}

/** Same-origin image response for private R2 artwork; videos keep direct signed playback. */
export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const key = searchParams.get("key") ?? "";
  const probe = searchParams.get("probe") === "1";
  const mimeType = contentType(key);
  if (!mimeType || !isOwnedKey(key)) {
    return NextResponse.json({ error: "forbidden image key" }, { status: 403 });
  }
  try {
    // R2 deployments do not consistently expose a usable HEAD response. Read
    // the already owner-scoped image directly and enforce the hard byte cap
    // before returning it; this avoids turning valid artwork into a false 404.
    const bytes = await readImageBytes(key);
    if (probe) {
      return NextResponse.json({ available: true }, { status: 200, headers: { "Cache-Control": "private, no-store" } });
    }
    if (bytes.byteLength > MAX_INLINE_IMAGE_BYTES) {
      return NextResponse.json({ error: "image too large" }, { status: 413 });
    }
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        // A few retained assets have a legacy extension that does not match
        // their encoded bytes (for example JPEG data in a .png key). Prefer
        // the signature so nosniff-capable browsers still render them.
        "Content-Type": sniffContentType(bytes) ?? mimeType,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, max-age=600",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  } catch (error) {
    if (probe) {
      return NextResponse.json({ available: false }, { status: 200, headers: { "Cache-Control": "private, no-store" } });
    }
    if (isR2CredentialFailure(error)) {
      return NextResponse.json(
        { error: "private media storage is unavailable" },
        { status: 503, headers: { "Cache-Control": "private, no-store", "Retry-After": "60" } },
      );
    }
    return NextResponse.json({ error: "image unavailable" }, { status: 404 });
  }
}
