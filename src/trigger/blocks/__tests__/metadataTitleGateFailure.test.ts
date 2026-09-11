/**
 * A configured text provider that cannot complete the title judge must fail
 * the metadata block. It must not silently re-enter the retired tournament /
 * critique paths and persist a title with no current judge receipt.
 */
process.env.OPENROUTER_API_KEY = "test-title-gate-key";

import assert from "node:assert/strict";
import Module from "node:module";

const originalLoad = (Module as unknown as { _load: (...args: unknown[]) => unknown })._load;
const originalFetch = globalThis.fetch;

async function main(): Promise<void> {
try {
  (Module as unknown as { _load: (...args: unknown[]) => unknown })._load = function patched(
    this: unknown,
    request: string,
    ...rest: unknown[]
  ) {
    const resolved = originalLoad.call(this, request, ...rest) as Record<string, unknown>;
    if (!request.includes("anthropic")) return resolved;
    return {
      ...resolved,
      hasAnthropicKey: () => true,
      claudeJson: async () => {
        throw new Error("title judge unavailable in integration fixture");
      },
    };
  } as never;

  // Keep the evidence round trip hermetic. The provider failure under test is
  // the title judge, not an external autocomplete service.
  globalThis.fetch = (async () => {
    throw new Error("network disabled in metadata title gate fixture");
  }) as typeof fetch;

  const { metadataOptimized } = await import("../intelligenceBlocks");
  const logs: string[] = [];
  const ctx = {
    ownerId: "owner-test",
    runId: "run-test",
    channelId: "channel-test",
    keyPrefix: "owner/test/",
    params: {},
    store: {
      topic: "How the Roman aqueducts moved water uphill",
      channelName: "Inked Histories",
      niche: "history",
      persona: "documentary narrator",
    },
    budgetUsd: 5,
    log: (message: string) => logs.push(message),
  } as never;

  await assert.rejects(
    () => metadataOptimized.run(ctx),
    /title gate failed; no unjudged fallback/,
    "provider failure must fail the metadata stage instead of selecting a legacy title",
  );
  assert.match(
    logs.join("\n"),
    /METACRAFT TITLE GATE FAILED — no unjudged fallback will be persisted/,
    "the stage log must make the fail-closed decision visible to the healer/operator",
  );
  console.log("METADATA TITLE GATE FAILURE PASS");
} finally {
  (Module as unknown as { _load: (...args: unknown[]) => unknown })._load = originalLoad;
  globalThis.fetch = originalFetch;
}
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
