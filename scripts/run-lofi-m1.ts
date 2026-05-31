/**
 * Milestone-1 driver: seed the "Rainy Neon Lofi" channel, create a run, and
 * execute the FULL Template-C (Lofi) pipeline end-to-end against live Convex
 * using the exact same engine runner + Convex sink the `run-pipeline` Trigger
 * task uses. Proves M1: a finished lofi video uploaded as a YouTube PRIVATE
 * draft with zero manual steps.
 *
 * Run:
 *   set -a; . ./.env.local; set +a
 *   npm_config_userconfig=/tmp/empty-npmrc npx tsx scripts/run-lofi-m1.ts
 *
 * Reuses an existing channel via REUSE_CHANNEL_ID to avoid duplicate seeds.
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { registerAllBlocks } from "@/engine/blocks";
import { validatePipeline, preflight } from "@/engine/validate";
import { runPipeline } from "@/engine/runner";
import { makeConvexSink } from "@/engine/convexSink";
import { channelPrefix } from "@/lib/storage";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { accountStatus } from "@/lib/higgsfield";
import { LOFI_PIPELINE } from "@/trigger/blocks/lofiBlocks";
import type { PipelineEntry } from "@/engine/types";

const OWNER = "owner_daniel";

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is required");
  const convex = new ConvexHttpClient(url);

  registerAllBlocks();
  await bootstrapSecrets((m, x) => console.log(`[m1] ${m}`, x ?? ""));

  // Credit baseline (before).
  let creditsBefore = NaN;
  try {
    creditsBefore = (await accountStatus()).credits;
  } catch (e) {
    console.warn("[m1] account status failed:", e instanceof Error ? e.message : e);
  }
  console.log(`[m1] higgsfield credits BEFORE: ${creditsBefore}`);

  // 1. Channel (reuse or create).
  let channelId: Id<"channels">;
  if (process.env.REUSE_CHANNEL_ID) {
    channelId = process.env.REUSE_CHANNEL_ID as Id<"channels">;
    console.log(`[m1] reusing channel ${channelId}`);
  } else {
    channelId = await convex.mutation(api.channels.createChannel, {
      ownerId: OWNER,
      slug: `rainy-neon-lofi-${Date.now()}`,
      name: "Rainy Neon Lofi",
      identity: {
        persona:
          "Calm late-night lofi channel set in a rainy neon-soaked cyberpunk city.",
        bannedWords: [],
        requiredCallbacks: [],
        styleGrammar:
          "rainy neon cyberpunk city at night, cozy window view, glowing signs reflected on wet streets, warm interior light, soft bokeh, anime/illustrated lofi art style, calm and nostalgic",
        palette: ["#0a0a1a", "#ff2e88", "#2ee6ff", "#ffb86c"],
        thumbnailTemplate: "title_card",
        topicPool: [
          "rainy neon rooftop at midnight",
          "cozy window seat overlooking a neon city",
          "lonely ramen stall in the rain",
          "train platform under neon lights",
        ],
        cadence: "daily",
      },
      template: "C",
      pipeline: LOFI_PIPELINE,
      budget: 5,
      status: "active",
    });
    console.log(`[m1] created channel ${channelId}`);
  }

  const channel = await convex.query(api.channels.getChannel, { channelId });
  if (!channel) throw new Error("channel vanished after create");

  // 2. Run.
  const runId = await convex.mutation(api.runs.createRun, {
    ownerId: OWNER,
    channelId,
    status: "running",
  });
  console.log(`[m1] created run ${runId}`);

  // 3. Validate + preflight + execute.
  const entries = channel.pipeline as PipelineEntry[];
  const resolved = validatePipeline(entries);
  preflight(resolved, { budgetUsd: channel.budget ?? 0 });

  const paramsByBlock: Record<string, Record<string, unknown>> = {};
  for (const e of entries) {
    if (e.params) paramsByBlock[e.block] = e.params as Record<string, unknown>;
  }

  const seedStore: Record<string, unknown> = {
    topicPool: channel.identity?.topicPool ?? [],
    styleGrammar: channel.identity?.styleGrammar ?? "",
    channelName: channel.name,
    palette: channel.identity?.palette ?? [],
  };

  const sink = makeConvexSink(convex, OWNER);
  const result = await runPipeline(resolved, {
    ownerId: OWNER,
    runId,
    channelId,
    keyPrefix: channelPrefix(OWNER, channel.slug),
    budgetUsd: channel.budget ?? 0,
    paramsByBlock,
    seedStore,
    sink,
    log: (msg, extra) => console.log(`[m1] ${msg}`, extra ?? ""),
  });

  await convex.mutation(api.runs.updateRun, {
    runId,
    status: result.ok ? "ok" : "failed",
    finishedAt: Date.now(),
    error: result.ok ? undefined : result.error,
  });

  // Credit after.
  let creditsAfter = NaN;
  try {
    creditsAfter = (await accountStatus()).credits;
  } catch {
    /* ignore */
  }

  console.log("\n===== M1 RESULT =====");
  console.log("ok:", result.ok);
  console.log("channelId:", channelId);
  console.log("runId:", runId);
  console.log("stages:", JSON.stringify(result.stages));
  if (!result.ok) {
    console.log("failedBlock:", result.failedBlock);
    console.log("error:", result.error);
  }
  console.log("youtubeVideoId:", result.store["youtubeVideoId"]);
  console.log("watchUrl:", result.store["watchUrl"]);
  console.log("privacy:", result.store["youtubePrivacy"]);
  console.log("videoKey:", result.store["videoKey"]);
  console.log("thumbnailKey:", result.store["thumbnailKey"]);
  console.log("musicKey:", result.store["musicKey"], "provider:", result.store["musicProvider"]);
  console.log("qaReport:", JSON.stringify(result.store["qaReport"]));
  console.log(`higgsfield credits: BEFORE=${creditsBefore} AFTER=${creditsAfter} SPENT=${creditsBefore - creditsAfter}`);
  console.log("=====================\n");

  if (!result.ok) process.exit(1);
}

main().catch((e) => {
  console.error("[m1] FATAL:", e instanceof Error ? e.stack : e);
  process.exit(1);
});
