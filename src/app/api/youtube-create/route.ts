import { NextResponse } from "next/server";

/**
 * POST /api/youtube-create  { name: string, channelId?: string }
 * Fires the `youtube-create-channel` Trigger task (Browserbase + Stagehand, cloud
 * browser — never runs on a local machine). Best-effort headless Brand Account
 * creation; returns the run id to poll. The assisted Connect button is the
 * fallback when Google blocks headless creation.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { name?: string; channelId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "missing name" }, { status: 400 });
  if (!process.env.TRIGGER_SECRET_KEY) {
    return NextResponse.json({ error: "Engine not activated.", inactive: true }, { status: 503 });
  }
  try {
    const { tasks } = await import("@trigger.dev/sdk");
    const handle = await tasks.trigger("youtube-create-channel", { name, channelId: body.channelId });
    return NextResponse.json({ id: handle.id });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "trigger failed" },
      { status: 500 },
    );
  }
}
