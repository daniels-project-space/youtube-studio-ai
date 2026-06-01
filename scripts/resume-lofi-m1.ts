/**
 * FRUGAL M1 resume: reuse the already-generated Higgsfield clips + F1 still
 * (in R2 from a prior run) and run the pipeline from `upscale` onward, so we
 * don't re-spend ~18 Higgsfield credits. Music is generated fresh (Mureka).
 *
 * This exercises the REAL upscale → music → metadata → assemble → qa_light →
 * thumbnail → upload_draft → notify path against live Convex, proving M1 with
 * a real PRIVATE YouTube draft.
 *
 * Run:
 *   set -a; . ./.env.local; set +a
 *   PRIOR_PREFIX="owner/owner_daniel/channel/<slug>/runs/<runId>/" \
 *   REUSE_CHANNEL_ID=<id> npm_config_userconfig=/tmp/empty-npmrc npx tsx scripts/resume-lofi-m1.ts
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { registerAllBlocks } from "@/engine/blocks";
import { validatePipeline, preflight } from "@/engine/validate";
import { runPipeline } from "@/engine/runner";
import { makeConvexSink } from "@/engine/convexSink";
import { makeRunLogSink, teeLog } from "@/engine/runLogSink";
import { channelPrefix, presignDownload } from "@/lib/storage";
import { bootstrapSecrets } from "@/lib/bootstrap";
import type { PipelineEntry } from "@/engine/types";

const OWNER = "owner_daniel";

// Resume pipeline: everything from upscale onward (Tranche-1 tail, incl the
// Topaz loop-unit upscale + the Remotion intro_card).
const RESUME_PIPELINE: PipelineEntry[] = [
  { block: "upscale", params: { targetResolution: "4k", targetFps: 30 } },
  { block: "music", params: { provider: "mureka" } },
  { block: "metadata" },
  { block: "assemble", params: { durationSec: 90, maxHeight: 2160, encodePreset: "veryfast" } },
  { block: "intro_card", params: { introMode: "overlay" } },
  { block: "qa_light", params: { toleranceSec: 5 } },
  { block: "thumbnail" },
  { block: "upload_draft" },
  { block: "notify" },
];

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is required");
  const channelId = process.env.REUSE_CHANNEL_ID;
  const priorPrefix = process.env.PRIOR_PREFIX;
  if (!channelId) throw new Error("REUSE_CHANNEL_ID is required");
  if (!priorPrefix) throw new Error("PRIOR_PREFIX is required");

  const convex = new ConvexHttpClient(url);
  registerAllBlocks();
  await bootstrapSecrets((m, x) => console.log(`[resume] ${m}`, x ?? ""));

  const channel = await convex.query(api.channels.getChannel, {
    channelId: channelId as Id<"channels">,
  });
  if (!channel) throw new Error(`channel not found: ${channelId}`);

  // Presign the prior clips + F1 still so the resume blocks can fetch them.
  const clip1Url = await presignDownload(`${priorPrefix}clip1.mp4`, { expiresIn: 3600 });
  const clip2Url = await presignDownload(`${priorPrefix}clip2.mp4`, { expiresIn: 3600 });
  const f1Url = await presignDownload(`${priorPrefix}f1.png`, { expiresIn: 3600 });

  const runId = await convex.mutation(api.runs.createRun, {
    ownerId: OWNER,
    channelId: channelId as Id<"channels">,
    status: "running",
  });
  console.log(`[resume] created run ${runId} (reusing clips from ${priorPrefix})`);

  // Seed everything the resume pipeline consumes from upstream.
  const seedStore: Record<string, unknown> = {
    topicPool: channel.identity?.topicPool ?? [],
    styleGrammar: channel.identity?.styleGrammar ?? "",
    channelName: channel.name,
    palette: channel.identity?.palette ?? [],
    topic: channel.identity?.topicPool?.[0] ?? "rainy neon rooftop at midnight",
    f1Url,
    clip1Url,
    clip2Url,
    // assemble declares it consumes the R2 KEYS (it reads the URLs from store);
    // seed the keys so topological validation passes on the resume pipeline.
    clip1Key: `${priorPrefix}clip1.mp4`,
    clip2Key: `${priorPrefix}clip2.mp4`,
  };

  const resolved = validatePipeline(RESUME_PIPELINE, Object.keys(seedStore));
  preflight(resolved, { budgetUsd: channel.budget ?? 0 });

  const paramsByBlock: Record<string, Record<string, unknown>> = {};
  for (const e of RESUME_PIPELINE) {
    if (e.params) paramsByBlock[e.block] = e.params as Record<string, unknown>;
  }

  const sink = makeConvexSink(convex, OWNER);
  const logSink = makeRunLogSink(convex, OWNER, runId);
  const result = await runPipeline(resolved, {
    ownerId: OWNER,
    runId,
    channelId: channelId,
    keyPrefix: channelPrefix(OWNER, channel.slug),
    budgetUsd: channel.budget ?? 0,
    paramsByBlock,
    seedStore,
    sink,
    log: teeLog(logSink, (msg, extra) =>
      console.log(`[resume] ${msg}`, extra ?? ""),
    ),
  });
  await logSink.flush();

  await convex.mutation(api.runs.updateRun, {
    runId,
    status: result.ok ? "ok" : "failed",
    finishedAt: Date.now(),
    error: result.ok ? undefined : result.error,
  });

  console.log("\n===== M1 RESUME RESULT =====");
  console.log("ok:", result.ok);
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
  console.log("============================\n");
  if (!result.ok) process.exit(1);
}

main().catch((e) => {
  console.error("[resume] FATAL:", e instanceof Error ? e.stack : e);
  process.exit(1);
});
