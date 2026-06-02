import { hydrateEnv } from "@/lib/vault";
import { metadataOptimized } from "@/trigger/blocks/intelligenceBlocks";
import type { StageContext } from "@/engine/types";

async function main() {
  if (!process.env.GEMINI_API_KEY) await hydrateEnv("gemini");
  if (!process.env.ANTHROPIC_API_KEY) await hydrateEnv("anthropic");
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://astute-camel-689.convex.cloud";

  const ctx: StageContext = {
    ownerId: "owner_daniel",
    runId: "seo-test",
    channelId: "seo-test-channel",
    keyPrefix: "test/",
    budgetUsd: 1,
    params: {},
    store: {
      topic: "Seneca's Guide to Voluntary Hardship",
      channelName: "The Quiet Stoic",
      niche: "stoicism and practical philosophy",
      persona: "a grounded, unflinching mentor sharing firelit-table wisdom",
      narrationText:
        "Seneca, the wealthiest man in Rome, slept on hard floors and ate the simplest food for days at a time. " +
        "Not out of poverty, but practice. He called it the discipline of voluntary hardship: rehearsing loss so that " +
        "fortune could never ambush him. To fear poverty, he wrote, is to live as poverty's slave even while rich.",
    },
    log: (m, x) => console.log("  [log]", m, x ? JSON.stringify(x).slice(0, 200) : ""),
  };

  const out = (await metadataOptimized.run(ctx)) as {
    title: string; description: string; tags: string[]; estimatedViews: number;
  };
  console.log("\n=== RESULT ===");
  console.log("title:", out.title, `(${out.title.length} chars)`);
  console.log("description (first 160):", out.description.slice(0, 160));
  console.log("tags:", out.tags.join(", "));

  const LOFI = /lo-?fi|beats to (relax|study)|study music|chill beats/i;
  const checks = [
    ["title not lofi-framed", !LOFI.test(out.title)],
    ["description not lofi-framed", !LOFI.test(out.description)],
    ["title <= 75 chars", out.title.length <= 75],
    [">= 5 tags", out.tags.length >= 5],
    ["description >= 120 chars", out.description.length >= 120],
    ["title mentions Seneca/Stoic", /seneca|stoic|hardship/i.test(out.title)],
  ] as const;
  console.log("\nchecks:");
  let ok = true;
  for (const [name, pass] of checks) { console.log(`  ${pass ? "✓" : "✗"} ${name}`); if (!pass) ok = false; }
  console.log(ok ? "\nSEO CHUNK TEST PASSED" : "\nSEO CHUNK TEST FAILED");
  if (!ok) process.exit(1);
}
main().catch((e) => { console.error("FAILED:", e instanceof Error ? e.stack : e); process.exit(1); });
