import { NextResponse } from "next/server";
import { OWNER_ID } from "@/lib/config";

/**
 * POST /api/build-channel  { seed: string }   → { id }  (Trigger run handle)
 * GET  /api/build-channel?id=<runId>          → { status, output }
 *
 * Fires + polls the autonomous `build-channel-package` task. Server-only (the
 * Trigger SDK needs Node + the secret key). Graceful 503 when the engine isn't
 * deployed yet (no TRIGGER_SECRET_KEY).
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { seed?: string; design?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const seed = body.seed?.trim();
  if (!seed && !body.design) {
    return NextResponse.json({ error: "missing seed or design" }, { status: 400 });
  }
  if (!process.env.TRIGGER_SECRET_KEY) {
    return NextResponse.json(
      { error: "Builder not activated (no TRIGGER_SECRET_KEY).", inactive: true },
      { status: 503 },
    );
  }
  try {
    const { tasks } = await import("@trigger.dev/sdk");
    // Structured wizard design → modular `design-channel`; legacy single seed →
    // `build-channel-package`. Advanced-editor param overrides are sanitized
    // (unknown blocks/keys dropped, numbers clamped) before reaching the task.
    let design = body.design;
    if (design && design.paramOverrides) {
      const { sanitizeParamOverrides } = await import("@/engine/moduleCatalog");
      design = { ...design, paramOverrides: sanitizeParamOverrides(design.paramOverrides) };
    }
    const handle = design
      ? await tasks.trigger("design-channel", { ...design, ownerId: OWNER_ID })
      : await tasks.trigger("build-channel-package", { seed, ownerId: OWNER_ID });
    return NextResponse.json({ id: handle.id });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "trigger failed" },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  if (!process.env.TRIGGER_SECRET_KEY) {
    return NextResponse.json({ error: "inactive", inactive: true }, { status: 503 });
  }
  try {
    const { runs } = await import("@trigger.dev/sdk");
    const run = await runs.retrieve(id);
    return NextResponse.json({
      status: run.status,
      output: run.output ?? null,
      error: run.error ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "retrieve failed" },
      { status: 500 },
    );
  }
}
