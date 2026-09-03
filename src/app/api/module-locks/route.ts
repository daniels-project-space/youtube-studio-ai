/**
 * Owner lock API.
 *
 * The only writer of lock state. Locking and unlocking is an OWNER action taken
 * in the UI, which is why it lives behind an HTTP route rather than in a
 * library an AI worker could call: the PreToolUse guard blocks the editing
 * tools, and this path is reachable only by a human in the browser.
 */
import { NextResponse } from "next/server";

import {
  LOCKABLE_MODULES,
  channelLockEntity,
  listLocks,
  lockEntity,
  unlockEntity,
} from "@/lib/moduleLocks";

export const dynamic = "force-dynamic";

export async function GET() {
  const locks = await listLocks();
  const lockedIds = new Set(locks.map((lock) => lock.id));
  return NextResponse.json({
    modules: LOCKABLE_MODULES.map((entity) => ({
      id: entity.id,
      label: entity.label,
      kind: entity.kind,
      description: entity.description,
      fileCount: entity.paths.length,
      locked: lockedIds.has(entity.id),
      lockedAt: locks.find((lock) => lock.id === entity.id)?.lockedAt ?? null,
    })),
    channelLocks: locks.filter((lock) => lock.kind === "channel"),
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as
    | { id?: string; channelName?: string; locked?: boolean }
    | null;
  if (!body || typeof body.locked !== "boolean") {
    return NextResponse.json({ error: "locked:boolean is required" }, { status: 400 });
  }

  const entity = body.channelName
    ? channelLockEntity(body.channelName)
    : LOCKABLE_MODULES.find((candidate) => candidate.id === body.id);
  if (!entity) {
    return NextResponse.json({ error: `unknown lockable id: ${body.id}` }, { status: 404 });
  }

  if (body.locked) {
    const record = await lockEntity({ entity, lockedBy: "owner (ui)" });
    return NextResponse.json({ ok: true, locked: true, record });
  }
  const removed = await unlockEntity(entity.id);
  return NextResponse.json({ ok: true, locked: false, removed });
}
