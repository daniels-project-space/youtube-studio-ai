import { scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { createOperatorSessionToken, sessionCookieOptions, STUDIO_SESSION_COOKIE } from "@/lib/operatorSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const scrypt = promisify(scryptCallback);
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 5;
let windowStarted = 0;
let failures = 0;

export async function POST(request: Request) {
  if (process.env.YOUTUBE_STUDIO_WORKSHOP_PRIVATE !== "1") return new Response(null, { status: 404 });
  // A self-hosted Next server may construct request.url with its internal
  // hostname. Compare the browser origin with the actual Host and trusted
  // reverse-proxy scheme instead, then use that origin for redirects/cookies.
  const host = request.headers.get("host") ?? "";
  const scheme = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.slice(0, -1);
  const origin = request.headers.get("origin");
  if (!host || !["http", "https"].includes(scheme) || origin !== `${scheme}://${host}`) return new Response(null, { status: 403 });
  const url = new URL(origin);
  const length = request.headers.get("content-length");
  if (!length || !/^\d+$/.test(length) || Number(length) > 2048 ||
      !/^application\/x-www-form-urlencoded(?:;|$)/i.test(request.headers.get("content-type") ?? "")) {
    return new Response(null, { status: 400 });
  }
  const verifier = process.env.YOUTUBE_STUDIO_WORKSHOP_PASSWORD_SCRYPT ?? "";
  const match = /^scrypt\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(verifier);
  if (!match) return new Response("Sign-in is not configured.", { status: 503, headers: { "Cache-Control": "no-store" } });
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 2048) return new Response(null, { status: 400 });
  const now = Date.now();
  if (now - windowStarted >= WINDOW_MS) { windowStarted = now; failures = 0; }
  if (failures >= MAX_ATTEMPTS) return new Response("Please wait a minute and try again.", { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } });
  failures++;
  const password = new URLSearchParams(raw).get("password") ?? "";
  const actual = await scrypt(password.slice(0, 256), Buffer.from(match[1]!, "hex"), 32) as Buffer;
  const expected = Buffer.from(match[2]!, "hex");
  if (password.length > 256 || !timingSafeEqual(actual, expected)) {
    const response = NextResponse.redirect(new URL("/operator-login?error=1", url), 303);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  failures = 0;
  const response = NextResponse.redirect(new URL("/workshop", url), 303);
  response.cookies.set(STUDIO_SESSION_COOKIE, await createOperatorSessionToken(), sessionCookieOptions(url.href));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
