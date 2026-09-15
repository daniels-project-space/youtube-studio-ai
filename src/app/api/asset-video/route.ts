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
  const probe = searchParams.get("probe") === "1";
  const mimeType = contentType(key);
  if (!mimeType || !isOwnedVideoKey(key)) {
    return NextResponse.json({ error: "forbidden video key" }, { status: 403 });
  }

  try {
    const forwardedHeaders = new Headers();
    const range = request.headers.get("range");
    if (range) forwardedHeaders.set("Range", range);
    const ifRange = request.headers.get("if-range");
    if (ifRange) forwardedHeaders.set("If-Range", ifRange);
    // R2 can briefly return a stale 404 while a just-uploaded master becomes
    // visible across its edge. Refresh the signature and retry once for that
    // narrow transient class (and provider 5xx); missing objects still return
    // a truthful 404 after the bounded retry.
    let upstream: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const signedUrl = await presignDownload(key, {
        expiresIn: 300,
        responseContentType: mimeType,
      });
      const attemptHeaders = new Headers(forwardedHeaders);
      // Some R2 edges intermittently answer a valid non-zero range with a
      // false 404 even though the same object and the initial range exist.
      // A streamed full response is a safe preview fallback: it preserves
      // the exact source frame and never buffers the master in this route.
      if (attempt === 1 && upstream?.status === 404 && range) {
        attemptHeaders.delete("Range");
        attemptHeaders.delete("If-Range");
      }
      upstream = await fetch(signedUrl, {
        method: "GET",
        headers: attemptHeaders,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
      if (upstream.ok || (upstream.status >= 200 && upstream.status < 300)) break;
      const retryable = upstream.status === 404 || upstream.status >= 500;
      await upstream.body?.cancel().catch(() => {});
      if (!retryable || attempt === 1) break;
      // Match the image delivery boundary's short backoff. R2 edge replicas
      // can briefly disagree immediately after a master is written or
      // restored; give the fresh signature a moment before retrying without
      // adding latency to successful reads.
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    if (!upstream) throw new Error("video request did not produce a response");
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
      if (probe) {
        return NextResponse.json({ available: false }, { status: 200, headers: { "Cache-Control": "private, no-store" } });
      }
      return NextResponse.json({ error: "video unavailable" }, { status: upstream.status >= 500 ? 503 : 404 });
    }
    if (probe) {
      await upstream.body?.cancel().catch(() => {});
      return NextResponse.json({ available: true }, { status: 200, headers: { "Cache-Control": "private, no-store" } });
    }
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    if (probe) {
      return NextResponse.json({ available: false }, { status: 200, headers: { "Cache-Control": "private, no-store" } });
    }
    return NextResponse.json(
      { error: "video unavailable" },
      { status: 503, headers: { "Cache-Control": "private, no-store", "Retry-After": "60" } },
    );
  }
}
