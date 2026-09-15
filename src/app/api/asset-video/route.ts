import { NextResponse } from "next/server";
import { OWNER_ID } from "@/lib/config";
import { presignDownload } from "@/lib/storage";

export const runtime = "nodejs";

const VIDEO_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
};

function contentType(key: string): string | undefined {
  const extension = key.toLowerCase().split(".").pop() ?? "";
  return VIDEO_TYPES[extension];
}

function isOwnedVideoKey(key: string): boolean {
  return key.startsWith(`owner/${OWNER_ID}/`)
    && key.length <= 1_024
    && !key.includes("..")
    && !key.includes("\\");
}

/**
 * Same-origin streaming boundary for private video previews.
 *
 * The browser still controls seeking and sends Range requests; this route
 * forwards that range to the short-lived R2 URL and relays only safe media
 * headers. It exists for previews (including the exact Lo-Fi 15-second
 * fallback), not as a general R2 proxy.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key") ?? "";
  const mimeType = contentType(key);
  if (!mimeType || !isOwnedVideoKey(key)) {
    return NextResponse.json({ error: "forbidden video key" }, { status: 403 });
  }

  try {
    const signedUrl = await presignDownload(key, {
      expiresIn: 300,
      responseContentType: mimeType,
    });
    const forwardedHeaders = new Headers();
    const range = request.headers.get("range");
    if (range) forwardedHeaders.set("Range", range);
    const ifRange = request.headers.get("if-range");
    if (ifRange) forwardedHeaders.set("If-Range", ifRange);
    const upstream = await fetch(signedUrl, {
      method: "GET",
      headers: forwardedHeaders,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    const responseHeaders = new Headers();
    for (const name of [
      "accept-ranges",
      "content-length",
      "content-range",
      "content-type",
      "etag",
      "last-modified",
    ]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    responseHeaders.set("Content-Type", upstream.headers.get("content-type") ?? mimeType);
    responseHeaders.set("Cross-Origin-Resource-Policy", "same-origin");
    responseHeaders.set("X-Content-Type-Options", "nosniff");
    responseHeaders.set("Cache-Control", "private, max-age=600");
    if (!upstream.ok && upstream.status !== 206) {
      await upstream.body?.cancel().catch(() => {});
      return NextResponse.json({ error: "video unavailable" }, { status: upstream.status >= 500 ? 503 : 404 });
    }
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return NextResponse.json(
      { error: "video unavailable" },
      { status: 503, headers: { "Cache-Control": "private, no-store", "Retry-After": "60" } },
    );
  }
}
