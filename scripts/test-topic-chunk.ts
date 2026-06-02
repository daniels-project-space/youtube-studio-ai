/**
 * Phase-1 validation: the Director-chosen, identity-aligned, non-repeating topic
 * chunk. Runs the REAL block against a live channel's identity + topic history,
 * with dryRun=true so nothing is written. Costs a few cents of LLM, no render.
 *
 *   NEXT_PUBLIC_OWNER_ID=owner_daniel npx tsx scripts/test-topic-chunk.ts
 */
import { hydrateEnv } from "@/lib/vault";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { topicSelect } from "@/trigger/blocks/lofiBlocks";
import type { StageContext } from "@/engine/types";

const OWNER = process.env.NEXT_PUBLIC_OWNER_ID ?? "owner_daniel";
const URL = "https://astute-camel-689.convex.cloud";

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

async function main() {
  if (!process.env.GEMINI_API_KEY) await hydrateEnv("gemini");
  if (!process.env.ANTHROPIC_API_KEY) await hydrateEnv("anthropic");
  process.env.NEXT_PUBLIC_CONVEX_URL = URL;
  const c = new ConvexHttpClient(URL);

  const channels = (await c.query(api.channels.listChannels, { ownerId: OWNER })) as Array<{
    _id: Id<"channels">;
    name: string;
    slug: string;
    template: string;
    identity?: { persona?: string; niche?: string; styleGrammar?: string; topicPool?: string[]; bannedWords?: string[] };
  }>;
  const ch = channels.find((x) => x.slug.startsWith("the-quiet-stoic")) ?? channels[0];
  console.log(`channel: ${ch.name} (${ch.slug}, template ${ch.template})`);

  const used = (await c.query(api.topicMemory.listForChannel, { channelId: ch._id })) as Array<{ key: string }>;
  const usedNorm = new Set(used.map((r) => normalize(r.key)));
  console.log(`used history: ${used.length} topic(s)${used.length ? " → " + used.map((r) => r.key).join(" | ") : ""}`);

  const ctx: StageContext = {
    ownerId: OWNER,
    runId: "topic-test",
    channelId: ch._id,
    keyPrefix: `test/`,
    budgetUsd: 1,
    params: { policy: "no_repeat", dryRun: true },
    store: {
      channelName: ch.name,
      persona: ch.identity?.persona ?? "",
      niche: ch.identity?.niche ?? "",
      styleGrammar: ch.identity?.styleGrammar ?? "",
      topicPool: ch.identity?.topicPool ?? [],
    },
    log: (m, x) => console.log("  [log]", m, x ? JSON.stringify(x) : ""),
  };

  console.log("\n--- run 1 ---");
  const out1 = (await topicSelect.run(ctx)) as { topic: string };
  console.log(`=> chosen: "${out1.topic}"`);

  console.log("\n--- run 2 (independent; should differ) ---");
  const out2 = (await topicSelect.run(ctx)) as { topic: string };
  console.log(`=> chosen: "${out2.topic}"`);

  // Assertions
  const a1 = !usedNorm.has(normalize(out1.topic));
  const a2 = !usedNorm.has(normalize(out2.topic));
  const a3 = out1.topic.trim().length > 0;
  console.log("\nchecks:");
  console.log(`  ${a1 ? "✓" : "✗"} run1 not in used history`);
  console.log(`  ${a2 ? "✓" : "✗"} run2 not in used history`);
  console.log(`  ${a3 ? "✓" : "✗"} non-empty topic`);
  console.log(`  ${out1.topic !== out2.topic ? "✓" : "~"} run1 ≠ run2 (variety; not guaranteed but expected)`);

  if (!(a1 && a2 && a3)) {
    console.log("\nTOPIC CHUNK TEST FAILED");
    process.exit(1);
  }
  console.log("\nTOPIC CHUNK TEST PASSED (dryRun — nothing written)");
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.stack : e);
  process.exit(1);
});
