import { NextResponse } from "next/server";
import { OWNER_ID } from "@/lib/config";

/**
 * POST /api/make-multilingual  { channelId: string, languages: string[] }
 *
 * Fires the `make-multilingual` Trigger task: clones the base channel into language
 * siblings (DE, ES …) that form a group — identical locale-patched pipeline, shared
 * avatar, flag banner. Graceful 503 when Trigger isn't activated.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { channelId?: string; languages?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const channelId = body.channelId?.trim();
  const languages = (body.languages ?? []).filter((l) => typeof l === "string" && l.length);
  if (!channelId || languages.length === 0) {
    return NextResponse.json({ error: "missing channelId or languages" }, { status: 400 });
  }
  if (!process.env.TRIGGER_SECRET_KEY) {
    return NextResponse.json(
      { error: "Engine not activated (no TRIGGER_SECRET_KEY).", inactive: true },
      { status: 503 },
    );
  }
  try {
    const { tasks } = await import("@trigger.dev/sdk");
    const handle = await tasks.trigger("make-multilingual", {
      ownerId: OWNER_ID,
      channelId,
      languages,
    });
    return NextResponse.json({ id: handle.id });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "trigger failed" },
      { status: 500 },
    );
  }
}
