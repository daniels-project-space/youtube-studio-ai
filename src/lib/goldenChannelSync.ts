import type { Doc } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { registerAllBlocks } from "@/engine/blocks";
import { planChannelPipelineUpgrade } from "@/engine/channelPipelineUpgrade";
import type { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";

export interface ChannelPipelineSyncItem {
  channelId: string;
  name: string;
  slug: string;
  changed: boolean;
  inserted: string[];
  retired: string[];
  sourceCount: number;
  effectiveCount: number;
  fingerprint: string;
  writeState: "not-needed" | "dry-run" | "updated" | "current" | "conflict";
}

export interface ChannelPipelineSyncReport {
  ownerId: string;
  dryRun: boolean;
  checked: number;
  changed: number;
  applied: number;
  conflicts: number;
  verified: boolean;
  verification: "dry-run" | "skipped" | "verified";
  channels: ChannelPipelineSyncItem[];
}

interface SyncOptions {
  convex: StudioConvexHttpClient;
  ownerId: string;
  dryRun?: boolean;
  channels?: readonly Doc<"channels">[];
  verify?: boolean;
  log?: (message: string) => void;
}

/**
 * Persist runtime-effective production catalog flows without touching channel
 * identity, voice, art, schedule, status, or specialist module choices.
 */
export async function syncChannelPipelines({
  convex,
  ownerId,
  dryRun = false,
  channels: suppliedChannels,
  verify = true,
  log = () => {},
}: SyncOptions): Promise<ChannelPipelineSyncReport> {
  registerAllBlocks();
  const channels = suppliedChannels
    ? [...suppliedChannels]
    : await convex.query(api.channels.listChannels, { ownerId });

  const items: ChannelPipelineSyncItem[] = [];
  for (const channel of channels) {
    const source = channel.pipeline ?? [];
    const plan = planChannelPipelineUpgrade(source);
    const item: ChannelPipelineSyncItem = {
      channelId: String(channel._id),
      name: channel.name,
      slug: channel.slug,
      changed: plan.changed,
      inserted: plan.inserted,
      retired: plan.retired,
      sourceCount: source.length,
      effectiveCount: plan.entries.length,
      fingerprint: plan.compilation.fingerprint,
      writeState: plan.changed ? (dryRun ? "dry-run" : "conflict") : "not-needed",
    };
    items.push(item);

    if (!plan.changed) {
      log(`${channel.name}: current`);
      continue;
    }

    log(
      `${channel.name}: ${source.length} → ${plan.entries.length} modules` +
        `${plan.inserted.length ? `; add ${plan.inserted.join(", ")}` : ""}` +
        `${plan.retired.length ? `; retire ${plan.retired.join(", ")}` : ""}`,
    );
    if (!dryRun) {
      const write = await convex.mutation(api.channels.updatePipelineIfCurrent, {
        ownerId,
        channelId: channel._id,
        expectedPipeline: source,
        pipeline: plan.entries,
      });
      item.writeState = write.state;
      if (write.state === "conflict") {
        log(`${channel.name}: skipped because its pipeline changed during sync`);
      }
    }
  }

  let verified = false;
  let verification: ChannelPipelineSyncReport["verification"] = dryRun
    ? "dry-run"
    : "skipped";
  if (!dryRun && verify) {
    const persisted = await convex.query(api.channels.listChannels, { ownerId });
    const stale = persisted.filter((channel) =>
      planChannelPipelineUpgrade(channel.pipeline ?? []).changed,
    );
    if (stale.length) {
      throw new Error(
        `channel pipeline sync did not persist cleanly: ${stale
          .map((channel) => channel.name)
          .join(", ")}`,
      );
    }
    verified = true;
    verification = "verified";
  }

  return {
    ownerId,
    dryRun,
    checked: items.length,
    changed: items.filter((item) => item.changed).length,
    applied: items.filter((item) => item.writeState === "updated").length,
    conflicts: items.filter((item) => item.writeState === "conflict").length,
    verified,
    verification,
    channels: items,
  };
}
