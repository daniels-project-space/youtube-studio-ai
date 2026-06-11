import { NextResponse } from "next/server";

/**
 * POST /api/analyze-clip  { url }            → { id }  (Trigger run handle)
 * GET  /api/analyze-clip?id=<runId>          → { status, output }
 *
 * Fires + polls `analyze-example-clip` (Gemini reads the YouTube URL directly).
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { url?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const url = body.url?.trim();
  if (!url) return NextResponse.json({ error: "missing url" }, { status: 400 });
  if (!process.env.TRIGGER_SECRET_KEY) {
    return NextResponse.json({ error: "inactive", inactive: true }, { status: 503 });
  }
  try {
    const { tasks } = await import("@trigger.dev/sdk");
    const handle = await tasks.trigger("analyze-example-clip", { url });
    return NextResponse.json({ id: handle.id });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "trigger failed" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  if (!process.env.TRIGGER_SECRET_KEY) return NextResponse.json({ error: "inactive", inactive: true }, { status: 503 });
  try {
    const { runs } = await import("@trigger.dev/sdk");
    const run = await runs.retrieve(id);
    return NextResponse.json({ status: run.status, output: run.output ?? null, error: run.error ?? null });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "retrieve failed" }, { status: 500 });
  }
}
