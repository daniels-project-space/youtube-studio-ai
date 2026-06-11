import { NextResponse } from "next/server";

/**
 * POST /api/youtube-provision  { channelId: string, name: string }
 * Fires `provision-youtube`: create a YouTube channel + auto-link it (OAuth done
 * by the cloud agent). Cloud only. 503 when Trigger isn't activated.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { channelId?: string; name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const channelId = body.channelId?.trim();
  const name = body.name?.trim();
  if (!channelId || !name) {
    return NextResponse.json({ error: "missing channelId or name" }, { status: 400 });
  }
  if (!process.env.TRIGGER_SECRET_KEY) {
    return NextResponse.json({ error: "Engine not activated.", inactive: true }, { status: 503 });
  }
  try {
    const { tasks } = await import("@trigger.dev/sdk");
    const handle = await tasks.trigger("provision-youtube", { appChannelId: channelId, name });
    return NextResponse.json({ id: handle.id });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "trigger failed" },
      { status: 500 },
    );
  }
}
