import { NextResponse } from "next/server";

import { compileChannelPipelinePreview } from "@/engine/channelPipelinePreview.server";

export const runtime = "nodejs";

const MAX_PREVIEW_BODY_BYTES = 64 * 1024;

/**
 * Read-only exact pipeline projection for the New Channel wizard. It has no
 * provider, persistence, approval, or spend capability and therefore remains
 * available before owner verification, like automatic-family readiness.
 */
export async function POST(request: Request): Promise<Response> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PREVIEW_BODY_BYTES) {
    return NextResponse.json({ error: "pipeline preview request is too large" }, { status: 413 });
  }

  let body: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_PREVIEW_BODY_BYTES) {
      return NextResponse.json({ error: "pipeline preview request is too large" }, { status: 413 });
    }
    body = JSON.parse(text) as unknown;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  try {
    return NextResponse.json(
      compileChannelPipelinePreview(body),
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "pipeline preview could not be compiled" },
      { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
