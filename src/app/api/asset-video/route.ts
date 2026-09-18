import { NextResponse } from "next/server";
import { OWNER_ID } from "@/lib/config";
import { presignDownload } from "@/lib/storage";

export const runtime = "nodejs";

const VIDEO_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
};
// A preview must prove both the initial native-player range and a later seek.
// Keep the duplicate initial byte: it catches a transient edge answer before
// the browser mounts a source that will immediately fail on its own request.
const PREVIEW_PROBE_RANGES = ["bytes=0-0", "bytes=0-0", "bytes=1048576-1048576"] as const;
const PREVIEW_PROBE_MAX_ATTEMPTS = 5;

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
 * Verifies the same three small ranges a native retained-master preview needs,
 * but does it behind one browser request. This keeps an honest deleted-object
 * boundary while avoiding the old five sequential client → Next requests for
 * every Lo-Fi card (and their duplicated signing work).
 */
async function verifyPreviewRanges(key: string, mimeType: string): Promise<boolean> {
  for (let attempt = 0; attempt < PREVIEW_PROBE_MAX_ATTEMPTS; attempt++) {
    try {
      // One fresh signature per proof wave gives a just-written R2 object a
      // genuine new edge/cache key on each retry while the three range checks
      // execute concurrently rather than serially in the browser.
      const signedUrl = await presignDownload(key, {
        expiresIn: 300,
        responseContentType: mimeType,
      });
      const admitted = await Promise.all(PREVIEW_PROBE_RANGES.map(async (range) => {
        let response: Response | undefined;
        try {
          response = await fetch(signedUrl, {
            method: "GET",
            headers: { Range: range },
            redirect: "error",
            signal: AbortSignal.timeout(30_000),
          });
          // The stream must answer each exact byte range. A successful 200
          // full-object response is not an adequate proof for native seeking.
          return response.status === 206;
        } catch {
          return false;
        } finally {
          await response?.body?.cancel().catch(() => {});
        }
      }));
      if (admitted.every(Boolean)) return true;
    } catch {
      // The bounded retry below handles transient signing or edge failures.
    }
    if (attempt < PREVIEW_PROBE_MAX_ATTEMPTS - 1) {
      // Cross the AWS signing-second boundary before asking a different R2
      // edge/cache key. This is the same bounded window as normal playback.
      await new Promise((resolve) => setTimeout(resolve, Math.min(2_000, 1_100 + 300 * attempt)));
    }
  }
  return false;
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
    if (probe && !request.headers.get("range")) {
      const available = await verifyPreviewRanges(key, mimeType);
      return NextResponse.json(
        { available },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const forwardedHeaders = new Headers();
    const range = request.headers.get("range");
    if (range) forwardedHeaders.set("Range", range);
    const ifRange = request.headers.get("if-range");
    if (ifRange) forwardedHeaders.set("If-Range", ifRange);
    // R2 can briefly return a stale 404 while a just-uploaded master becomes
    // visible across its edge. Refresh the signature and use a short bounded
    // retry window for that narrow transient class (and provider 5xx); missing
    // objects still return a truthful 404 after the bounded retries. Large
    // source-frame previews are especially prone to a single range miss, so
    // give the exact range two fresh signatures before trying the streamed
    // full-source fallback.
    let upstream: Response | null = null;
    const maxAttempts = 5;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const signedUrl = await presignDownload(key, {
        expiresIn: 300,
        responseContentType: mimeType,
      });
      const attemptHeaders = new Headers(forwardedHeaders);
      // Some R2 edges intermittently answer a valid non-zero range with a
      // false 404 even though the same object and the initial range exist.
      // A streamed full response is a safe preview fallback: it preserves
      // the exact source frame and never buffers the master in this route.
      if (attempt >= 2 && upstream?.status === 404 && range && !probe) {
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
      if (!retryable || attempt === maxAttempts - 1) break;
      // Match the image delivery boundary's short backoff. R2 edge replicas
      // can briefly disagree immediately after a master is written or
      // restored; give the fresh signature a moment before retrying without
      // adding latency to successful reads.
      // AWS-style signatures have one-second timestamp precision. Waiting at
      // least 1.1s ensures the next presign is a genuinely new URL instead of
      // retrying the same edge cache key; later retries remain bounded.
      await new Promise((resolve) => setTimeout(resolve, Math.min(2_000, 1_100 + 300 * attempt)));
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
      if (upstream.status >= 400 && upstream.status < 500) {
        // R2 private buckets can report a missing/expired legacy object as
        // either 404 or 403. A native player can race that object after all
        // bounded probes have passed. Return a zero-length media sentinel so
        // the element emits its normal onError/unavailable state without
        // turning a known unavailable preview into a browser-console 4xx.
        return new NextResponse(null, {
          status: 200,
          headers: {
            "Content-Type": mimeType,
            "Content-Length": "0",
            "Cache-Control": "private, no-store",
            "X-Asset-Unavailable": "true",
          },
        });
      }
      return NextResponse.json({ error: "video unavailable" }, { status: upstream.status >= 500 ? 503 : 404 });
    }
    if (probe) {
      await upstream.body?.cancel().catch(() => {});
      // An explicit range probe must prove that the range path itself works;
      // a 200 full-source response is not enough because native seeking can
      // still fail later on a stale legacy object.
      return NextResponse.json({ available: !range || upstream.status === 206 }, { status: 200, headers: { "Cache-Control": "private, no-store" } });
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
