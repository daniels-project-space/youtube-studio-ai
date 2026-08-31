import assert from "node:assert/strict";

import { listActiveReviewedLtxBenchmarkAdmissions } from "../../../convex/reviewedLtxRuntimeState";

const OWNER = "owner_ltx_runtime";

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
          collect: async () => table === "reviewedLtxRuntimeRevocations" ? rows : [],
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
    invoke(listActiveReviewedLtxBenchmarkAdmissions, context("owner"), { ownerId: OWNER }),
    /requires the bound studio service identity/,
    "an owner/browser identity may not read the runtime admission registry",
  );

  assert.deepEqual(
    await invoke(listActiveReviewedLtxBenchmarkAdmissions, context("service"), { ownerId: OWNER }),
    [],
    "an empty service-owned registry must stay unattested rather than inventing a runtime approval",
  );

  await assert.rejects(
    invoke(
      listActiveReviewedLtxBenchmarkAdmissions,
      context("service", [{
        ownerId: OWNER,
        version: "reviewed-ltx-runtime-revocation/v1",
        admissionFingerprint: "a".repeat(64),
        reason: "short",
        revocationFingerprint: "b".repeat(64),
      }]),
      { ownerId: OWNER },
    ),
    /revocation reason is corrupt/,
    "corrupt revocation evidence must block instead of silently restoring an old benchmark",
  );

  console.log("reviewed LTX runtime state service-bound read tests passed");
}

void main();
