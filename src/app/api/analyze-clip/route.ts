import { NextResponse } from "next/server";
import { authorizeStudioRoute } from "@/lib/operatorSession";
import { exampleClipAnalysisUnavailable } from "@/lib/exampleClipAnalysisUnavailable";

/**
 * POST /api/analyze-clip  { url }            → structured unavailable state
 * GET  /api/analyze-clip?id=<legacy-run-id>  → structured unavailable state
 *
 * The former asynchronous example-video analyzer depended on a remote model. It
 * is deliberately unavailable under the no-Gemini runtime policy until a real,
 * local frame-analysis capability is integrated. Never queue a task or claim an
 * analysis that did not happen.
 */
export const runtime = "nodejs";

function unavailableResponse() {
  return NextResponse.json(exampleClipAnalysisUnavailable(), {
    status: 503,
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: Request) {
  const authFailure = await authorizeStudioRoute(request);
  if (authFailure) return authFailure;
  let body: { url?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const url = body.url?.trim();
  if (!url) return NextResponse.json({ error: "missing url" }, { status: 400 });
  return unavailableResponse();
}

export async function GET(request: Request) {
  const authFailure = await authorizeStudioRoute(request);
  if (authFailure) return authFailure;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  return unavailableResponse();
}
