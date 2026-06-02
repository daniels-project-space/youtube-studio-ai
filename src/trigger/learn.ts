/**
 * `learning-refresh` (Phase 7) — the feedback loop. Pulls YouTube Analytics
 * (retention/CTR) for each channel's published videos (≥72h old, so metrics are
 * settled), links them to their content attributes (topic/title/thumbnail from
 * the run's stages), and writes a per-channel performance ledger in R2. The
 * creative Directors (topic_select, seo) read it to lean toward what worked.
 *
 * Requires the yt-analytics.readonly OAuth scope (scripts/youtube-oauth.ts);
 * degrades to a no-op without it.
 */
import { schedules, task } from "@trigger.dev/sdk";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { channelPrefix } from "@/lib/storage";
import { fetchVideoAnalytics, hasAnalyticsAccess } from "@/lib/youtubeAnalytics";
import { loadLedger, saveLedger, type PerfEntry } from "@/lib/performance";

const SETTLE_MS = 72 * 3_600_000;
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

type Logger = (m: string) => void;

async function refresh(ownerId: string, log: Logger) {
  await bootstrapSecrets((m) => log(m));
  if (!hasAnalyticsAccess()) {
    log("learning-refresh: no Analytics access (re-consent yt-analytics.readonly) — skip");
    return { ok: true, skipped: "no_analytics", channels: 0, videos: 0 };
  }
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not configured");
  const convex = new ConvexHttpClient(url);

  const channels = (await convex.query(api.channels.listChannels, { ownerId })) as Array<{
    _id: Id<"channels">;
    slug: string;
    name: string;
  }>;
  let videos = 0;
  for (const ch of channels) {
    const prefix = channelPrefix(ownerId, ch.slug);
    const runs = (await convex.query(api.runs.listRunsByChannel, {
      channelId: ch._id,
    })) as Array<{ _id: Id<"runs">; youtubeVideoId?: string; finishedAt?: number }>;
    const published = runs.filter(
      (r) => r.youtubeVideoId && r.finishedAt && Date.now() - r.finishedAt > SETTLE_MS,
    );
    if (published.length === 0) continue;

    const ledger = await loadLedger(prefix);
    const byId = new Map<string, PerfEntry>(ledger.map((e) => [e.videoId, e]));
    for (const run of published) {
      const vid = run.youtubeVideoId!;
      const a = await fetchVideoAnalytics({
        videoId: vid,
        startDate: ymd(run.finishedAt!),
        endDate: ymd(Date.now()),
      });
      if (!a) continue;
      // Link to content attributes from the run's stages.
      let title = "";
      let topic = "";
      let thumbnailStrategy: string | undefined;
      try {
        const stages = (await convex.query(api.runStages.listRunStages, {
          runId: run._id,
        })) as Array<{ block: string; outputs?: Record<string, unknown> }>;
        title = (stages.find((s) => s.block === "metadata")?.outputs?.title as string) ?? "";
        topic = (stages.find((s) => s.block === "topic_select")?.outputs?.topic as string) ?? "";
        thumbnailStrategy = (stages.find((s) => s.block === "thumbnail_gen")?.outputs as { strategy?: string })?.strategy;
      } catch {
        /* attributes best-effort */
      }
      byId.set(vid, {
        videoId: vid,
        topic,
        title,
        thumbnailStrategy,
        publishedAt: run.finishedAt!,
        views: a.views,
        avgViewPct: a.avgViewPct,
        ctr: a.ctr,
        updatedAt: Date.now(),
      });
      videos++;
    }
    await saveLedger(prefix, [...byId.values()]);
    log(`learning-refresh: ${ch.name} → ${byId.size} videos in ledger`);
  }
  log(`learning-refresh: done — ${videos} video(s) updated across ${channels.length} channel(s)`);
  return { ok: true, channels: channels.length, videos };
}

export const learningRefreshSchedule = schedules.task({
  id: "learning-refresh",
  cron: "0 7 * * *", // daily, after metrics settle
  run: async () => refresh(process.env.STUDIO_OWNER_ID ?? "owner_daniel", (m) => console.log(`[learn] ${m}`)),
});

export const learningRefreshTask = task({
  id: "learning-refresh-now",
  run: async (payload: { ownerId?: string }) =>
    refresh(payload?.ownerId ?? process.env.STUDIO_OWNER_ID ?? "owner_daniel", (m) => console.log(`[learn] ${m}`)),
});
