/**
 * Persist every channel's runtime-effective production catalog pipeline.
 *
 * This intentionally preserves specialist module choices. It does not flatten
 * whiteboard, motion-comic, finance, lofi, or other customized channels into a
 * generic A/B/C/D/E archetype. Identity (voice, art, palette, topic pool),
 * scheduling, status, and publishing configuration are never touched.
 *
 * DRY_RUN=1 prints the diff without writing.
 *
 *   NEXT_PUBLIC_CONVEX_URL=https://astute-camel-689.convex.cloud \
 *   NEXT_PUBLIC_OWNER_ID=owner_daniel npx tsx scripts/migrate-channel-pipelines.ts
 */
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { syncChannelPipelines } from "@/lib/goldenChannelSync";

const OWNER = process.env.NEXT_PUBLIC_OWNER_ID ?? "owner_daniel";
const DRY = process.env.DRY_RUN === "1";

async function main() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is required");
  const convex = new ConvexHttpClient(url);
  const report = await syncChannelPipelines({
    convex,
    ownerId: OWNER,
    dryRun: DRY,
    log: (message) => console.log(message),
  });
  console.log(
    `\n${DRY ? `would change ${report.changed}` : `applied ${report.applied}`}/${report.checked} channel(s)` +
      `${report.conflicts ? `; ${report.conflicts} concurrent conflict(s) skipped` : ""}` +
      `; verification ${report.verification}`,
  );
}

main().catch((e) => {
  console.error("MIGRATION FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
