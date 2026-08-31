import assert from "node:assert/strict";

import { listActiveMusicVideoA2VidRuntimeAdmissions } from "../../../convex/musicVideoA2VidState";

const OWNER = "owner_a2vid_runtime";

function identity(role: "owner" | "service", ownerId = OWNER) {
  return {
    subject: role === "owner" ? ownerId : "service:youtube-studio-ai",
    issuer: "https://youtube-studio-ai.local",
    tokenIdentifier: `test|${role}`,
    role,
    owner_id: ownerId,
  };
}

function context(role: "owner" | "service", rows: Record<string, unknown>[] = []) {
  return {
    auth: { getUserIdentity: async () => identity(role) },
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          collect: async () => table === "musicVideoA2VidRuntimeRevocations" ? rows : [],
        }),
      }),
    },
  };
}

async function invoke<T>(definition: unknown, handlerContext: unknown, args: unknown): Promise<T> {
  return await (definition as {
    _handler: (ctx: unknown, input: unknown) => Promise<T>;
  })._handler(handlerContext, args);
}

async function main(): Promise<void> {
  await assert.rejects(
    invoke(listActiveMusicVideoA2VidRuntimeAdmissions, context("owner"), { ownerId: OWNER }),
    /requires the bound studio service identity/,
    "an owner/browser identity may not read the self-hosted A2Vid runtime registry",
  );

  assert.deepEqual(
    await invoke(listActiveMusicVideoA2VidRuntimeAdmissions, context("service"), { ownerId: OWNER }),
    [],
    "an empty service-owned A2Vid registry must remain not installed rather than inventing a runtime approval",
  );

  await assert.rejects(
    invoke(
      listActiveMusicVideoA2VidRuntimeAdmissions,
      context("service", [{
        ownerId: OWNER,
        version: "music-video-a2vid-runtime-revocation/v1",
        admissionFingerprint: "a".repeat(64),
        reason: "short",
        revocationFingerprint: "b".repeat(64),
      }]),
      { ownerId: OWNER },
    ),
    /revocation reason is corrupt/,
    "corrupt A2Vid revocation evidence must block instead of silently restoring a runtime",
  );

  console.log("music-video A2Vid runtime state service-bound read tests passed");
}

void main();
