import { NextResponse } from "next/server";

/**
 * POST /api/novita-render
 * GET  /api/novita-render?prefix=<prefix>
 *
 * Thin, typed proxy to the VPS render-API bridge (`render_api.py`, alongside
 * the rest of the render infra at /root/ltx-build/novita on the VPS). The
 * bridge wraps orchestrator.py's `launch()`/`status()` so an arbitrary shot
 * list can drive an image or video render without SSH.
 *
 * - POST forwards the request body verbatim to `${NOVITA_RENDER_API}` (the
 *   bridge's `POST /render`), which validates phase/shots/caps itself.
 * - GET forwards `?prefix=` to the bridge's `GET /render/status?prefix=`.
 *
 * The bearer token (`NOVITA_RENDER_TOKEN`) never reaches the browser — this
 * route runs server-side only and attaches it to the outbound request.
 */
export const runtime = "nodejs";

const RENDER_API = process.env.NOVITA_RENDER_API ?? "http://87.106.233.113:8791/render";
const RENDER_TOKEN = process.env.NOVITA_RENDER_TOKEN ?? "";

/** Derive the bridge's base URL (strip a trailing `/render`) so we can also hit `/render/status`. */
function bridgeBase(): string {
  return RENDER_API.replace(/\/render\/?$/, "");
}

function authHeaders(): Record<string, string> {
  return RENDER_TOKEN ? { Authorization: `Bearer ${RENDER_TOKEN}` } : {};
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  try {
    const upstream = await fetch(RENDER_API, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    });
    const text = await upstream.text();
    const data = safeJson(text);
    return NextResponse.json(data ?? { ok: upstream.ok, raw: text }, { status: upstream.status });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "render-api request failed" },
      { status: 502 },
    );
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const prefix = searchParams.get("prefix") ?? "adart2";

  try {
    const statusUrl = `${bridgeBase()}/render/status?prefix=${encodeURIComponent(prefix)}`;
    const upstream = await fetch(statusUrl, { headers: authHeaders(), cache: "no-store" });
    const text = await upstream.text();
    const data = safeJson(text);
    return NextResponse.json(data ?? { ok: upstream.ok, raw: text }, { status: upstream.status });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "render-api status request failed" },
      { status: 502 },
    );
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
