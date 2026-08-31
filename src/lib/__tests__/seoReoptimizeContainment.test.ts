import assert from "node:assert/strict";
import { reoptimize } from "@/trigger/seoReoptimize";

async function main(): Promise<void> {
  const logs: string[] = [];
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;

  globalThis.fetch = (async () => {
    providerCalls += 1;
    throw new Error("Provider calls must not occur while package attribution is unavailable");
  }) as typeof fetch;

  try {
    const scheduledResult = await reoptimize(
      "owner_test",
      (message) => logs.push(message),
      false,
    );
    assert.deepEqual(scheduledResult, { ok: true, skipped: "approval_required", updated: 0 });

    const result = await reoptimize("owner_test", (message) => logs.push(message), true);

    assert.deepEqual(result, {
      ok: false,
      updated: 0,
      admitted: false,
      action: "manual_reconciliation_required",
      reason: "verified_package_attribution_required",
      nextAction:
        "Record or reconcile the published title/thumbnail package, then collect a fresh, fully post-package, confidence-qualified attribution observation before retrying.",
    });
    assert.equal(providerCalls, 0, "blocked reoptimization must make zero Gemini, YouTube, or other provider calls");
    assert.match(logs.join("\n"), /blocked.*verified_package_attribution_required/i);
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("SEO REOPTIMIZE CONTAINMENT PASS: missing package attribution blocks all provider calls");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
