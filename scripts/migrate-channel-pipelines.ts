/**
 * Migrate every channel's stored `pipeline[]` to its current archetype pipeline
 * so existing channels pick up the title-card + music-bed intro flow (music +
 * intro_card before assembly). Channels store a copy of their pipeline at build
 * time, so archetype changes don't reach them until re-applied.
 *
 * Mapping is by the archetype `template` letter (A/B/C/D/E) already on the
 * channel. Each new pipeline is validated before writing. Identity (voiceId,
 * palette, topicPool, …) is NOT touched — only `pipeline`.
 *
 * DRY_RUN=1 prints the diff without writing.
 *
 *   NEXT_PUBLIC_CONVEX_URL=https://astute-camel-689.convex.cloud \
 *   NEXT_PUBLIC_OWNER_ID=owner_daniel npx tsx scripts/migrate-channel-pipelines.ts
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { registerAllBlocks } from "@/engine/blocks";
import { validatePipeline } from "@/engine/validate";
import { ARCHETYPES } from "@/engine/archetypes";
import type { PipelineEntry } from "@/engine/types";

const OWNER = process.env.NEXT_PUBLIC_OWNER_ID ?? "owner_daniel";
const DRY = process.env.DRY_RUN === "1";

function archetypeForTemplate(template: string) {
  const hit = Object.values(ARCHETYPES).find((a) => a.template === template);
  if (!hit) throw new Error(`no archetype for template "${template}"`);
  return hit;
}

async function main() {
  registerAllBlocks();
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is required");
  const convex = new ConvexHttpClient(url);

  const channels = (await convex.query(api.channels.listChannels, {
    ownerId: OWNER,
  })) as Array<{
    _id: Id<"channels">;
    name: string;
    slug: string;
    template: string;
    pipeline?: PipelineEntry[];
  }>;

  console.log(`${channels.length} channel(s)${DRY ? "  [DRY RUN]" : ""}\n`);
  let changed = 0;
  for (const c of channels) {
    const arch = archetypeForTemplate(c.template);
    const before = (c.pipeline ?? []).map((p) => p.block).join(" → ");
    const after = arch.pipeline.map((p) => p.block).join(" → ");

    // Defensive: never write an invalid pipeline.
    validatePipeline(arch.pipeline);

    if (before === after) {
      console.log(`= ${c.name} (${c.template}/${arch.key}) — already current, skip`);
      continue;
    }
    console.log(`~ ${c.name} (${c.template} → ${arch.key})`);
    console.log(`   before: ${before}`);
    console.log(`   after:  ${after}`);
    if (!DRY) {
      await convex.mutation(api.channels.updateChannel, {
        channelId: c._id,
        pipeline: arch.pipeline,
      });
      console.log(`   ✓ written`);
    }
    changed++;
  }

  if (!DRY && changed > 0) {
    // Verify by re-reading.
    console.log("\nverifying…");
    const after = (await convex.query(api.channels.listChannels, {
      ownerId: OWNER,
    })) as Array<{ name: string; template: string; pipeline?: PipelineEntry[] }>;
    for (const c of after) {
      const arch = archetypeForTemplate(c.template);
      const got = (c.pipeline ?? []).map((p) => p.block).join(" → ");
      const want = arch.pipeline.map((p) => p.block).join(" → ");
      console.log(`  ${got === want ? "✓" : "✗"} ${c.name}`);
    }
  }
  console.log(`\n${DRY ? "would change" : "changed"} ${changed} channel(s)`);
}

main().catch((e) => {
  console.error("MIGRATION FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
