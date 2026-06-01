/**
 * dedupe-channels — one-off maintenance script.
 *
 * The old `createChannel` did a bare insert, so re-seeding a channel produced
 * duplicate docs sharing the same (ownerId, slug). This script collapses each
 * slug group down to the OLDEST doc (lowest _creationTime): it repoints the
 * runs of every duplicate onto the kept channel, then deletes the duplicates.
 *
 * Idempotent: after a clean pass each slug has exactly one doc, so a second run
 * is a no-op. Prints a before/after summary.
 *
 * Run (orchestrator does this — DO NOT run it yourself):
 *   set -a; . ./.env.local; set +a
 *   npm_config_userconfig=/tmp/empty-npmrc npx tsx scripts/dedupe-channels.ts
 *
 * Requires the new Convex functions to be DEPLOYED first:
 *   - runs.repointChannel
 *   - channels.deleteChannel  (added below alongside this script)
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

const OWNER = process.env.NEXT_PUBLIC_OWNER_ID ?? "owner_daniel";

type Channel = {
  _id: Id<"channels">;
  _creationTime: number;
  slug: string;
  name: string;
};

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is required");
  const convex = new ConvexHttpClient(url);

  const channels = (await convex.query(api.channels.listChannels, {
    ownerId: OWNER,
  })) as Channel[];

  console.log(`\n=== dedupe-channels (owner=${OWNER}) ===`);
  console.log(`BEFORE: ${channels.length} channel docs`);

  // Group by slug.
  const bySlug = new Map<string, Channel[]>();
  for (const c of channels) {
    const arr = bySlug.get(c.slug) ?? [];
    arr.push(c);
    bySlug.set(c.slug, arr);
  }

  const dupSlugs = [...bySlug.entries()].filter(([, arr]) => arr.length > 1);
  if (dupSlugs.length === 0) {
    console.log("No duplicate slugs found. Nothing to do.");
    console.log(`AFTER:  ${channels.length} channel docs (unchanged)\n`);
    return;
  }

  let deleted = 0;
  let repointed = 0;

  for (const [slug, group] of dupSlugs) {
    // Keep the OLDEST (lowest _creationTime).
    group.sort((a, b) => a._creationTime - b._creationTime);
    const keep = group[0];
    const dups = group.slice(1);
    console.log(
      `\nslug "${slug}": ${group.length} docs → keep ${keep._id} (oldest), drop ${dups.length}`,
    );

    for (const dup of dups) {
      const moved = (await convex.mutation(api.runs.repointChannel, {
        fromChannelId: dup._id,
        toChannelId: keep._id,
      })) as number;
      repointed += moved;
      console.log(`  repointed ${moved} run(s) from ${dup._id} → ${keep._id}`);

      await convex.mutation(api.channels.deleteChannel, {
        channelId: dup._id,
      });
      deleted += 1;
      console.log(`  deleted duplicate channel ${dup._id}`);
    }
  }

  const after = (await convex.query(api.channels.listChannels, {
    ownerId: OWNER,
  })) as Channel[];

  console.log(`\n--- summary ---`);
  console.log(`duplicate slugs collapsed: ${dupSlugs.length}`);
  console.log(`channels deleted:          ${deleted}`);
  console.log(`runs repointed:            ${repointed}`);
  console.log(`AFTER:  ${after.length} channel docs\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
