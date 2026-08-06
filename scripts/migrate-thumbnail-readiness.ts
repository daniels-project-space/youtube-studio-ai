/**
 * Read-only by default. Audits family-aware channels and prepares only free,
 * deterministic configuration repairs; it never generates media or calls a
 * model/provider.
 *
 *   npx tsx scripts/migrate-thumbnail-readiness.ts
 *   npx tsx scripts/migrate-thumbnail-readiness.ts --apply
 */
import { loadEnvConfig } from "@next/env";

import { api } from "../convex/_generated/api";
import type { Doc } from "../convex/_generated/dataModel";
import { FAMILIES, type FamilyKey } from "@/engine/families";
import type { StyleDNA } from "@/engine/creative/types";
import { buildStyleDnaPlaybook } from "@/lib/thumbnailLab";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";

loadEnvConfig(process.cwd());

const APPLY = process.argv.includes("--apply");
const OWNER = process.env.NEXT_PUBLIC_OWNER_ID ?? "owner_daniel";

type ThumbnailChannel = Doc<"channels">;

interface Repair {
  channel: ThumbnailChannel;
  family: FamilyKey;
  setEngine: boolean;
  setIdentityTemplate: boolean;
  addFoundationPlaybook: boolean;
  blockedReason?: string;
}

function isFamilyKey(value: string | undefined): value is FamilyKey {
  return Boolean(value && Object.prototype.hasOwnProperty.call(FAMILIES, value));
}

function inspect(channel: ThumbnailChannel): Repair | null {
  if (!isFamilyKey(channel.family)) return null;
  const hasPlaybook = Boolean(
    channel.thumbnailPlaybook?.patterns?.length &&
    channel.thumbnailPlaybook.visualLanguage?.imageStyle &&
    channel.thumbnailPlaybook.visualLanguage?.accentColor,
  );
  const addFoundationPlaybook = !hasPlaybook && Boolean(channel.styleDNA);
  return {
    channel,
    family: channel.family,
    setEngine: channel.thumbnailer !== "banana",
    setIdentityTemplate: channel.identity.thumbnailTemplate !== "banana",
    addFoundationPlaybook,
    ...(!hasPlaybook && !channel.styleDNA
      ? { blockedReason: "missing Style DNA; rerun channel grounding before production" }
      : {}),
  };
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is required");
  const convex = new ConvexHttpClient(url);
  const channels = (await convex.query(api.channels.listChannels, {
    ownerId: OWNER,
  })) as ThumbnailChannel[];
  const repairs = channels.map(inspect).filter((repair): repair is Repair => Boolean(repair));

  for (const repair of repairs) {
    const actions = [
      repair.setEngine ? `${repair.channel.thumbnailer ?? "unset"} -> banana engine` : "engine already banana",
      repair.setIdentityTemplate ? "identity template -> banana" : "identity template ready",
      repair.addFoundationPlaybook ? "add 3-pattern Style-DNA foundation" : "playbook ready",
      repair.blockedReason ? `BLOCKED: ${repair.blockedReason}` : "",
    ].filter(Boolean);
    console.log(`${APPLY ? "APPLY" : "WOULD"} ${repair.channel.name} [${repair.family}/${repair.channel.status}]: ${actions.join("; ")}`);
  }

  if (APPLY) {
    for (const repair of repairs) {
      const foundation = repair.addFoundationPlaybook && repair.channel.styleDNA
        ? buildStyleDnaPlaybook({
            dna: repair.channel.styleDNA as StyleDNA,
            family: repair.family,
            channelName: repair.channel.name,
          })
        : undefined;
      const hasPatch = repair.setEngine || repair.setIdentityTemplate || Boolean(foundation);
      if (hasPatch) {
        await convex.mutation(api.channels.updateChannel, {
          channelId: repair.channel._id,
          ...(repair.setEngine ? { thumbnailer: "banana" as const } : {}),
          ...(repair.setIdentityTemplate
            ? { identity: { ...repair.channel.identity, thumbnailTemplate: "banana" } }
            : {}),
          ...(foundation ? { thumbnailPlaybook: foundation } : {}),
        });
      }
    }

    const after = (await convex.query(api.channels.listChannels, { ownerId: OWNER })) as ThumbnailChannel[];
    for (const repair of repairs) {
      const channel = after.find((candidate) => candidate._id === repair.channel._id);
      if (!channel) throw new Error(`verification failed: ${repair.channel.name} disappeared`);
      if (channel.thumbnailer !== "banana" || channel.identity.thumbnailTemplate !== "banana") {
        throw new Error(`verification failed: ${repair.channel.name} did not persist the banana engine`);
      }
      if (!channel.thumbnailPlaybook?.patterns?.length || !channel.thumbnailPlaybook.visualLanguage?.imageStyle) {
        throw new Error(`verification failed: ${repair.channel.name} has no executable playbook`);
      }
    }
  }

  const changes = repairs.filter((repair) =>
    repair.setEngine || repair.setIdentityTemplate || repair.addFoundationPlaybook,
  ).length;
  const blocked = repairs.filter((repair) => repair.blockedReason).length;
  console.log(
    `\n${APPLY ? "APPLIED + VERIFIED" : "READ-ONLY"}: ${repairs.length} family channels; ` +
    `${changes} ${APPLY ? "changed" : "would change"}; ${blocked} require grounding. ` +
    "No image generation or paid provider calls were made.",
  );
}

main().catch((error) => {
  console.error("THUMBNAIL READINESS MIGRATION FAILED:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
