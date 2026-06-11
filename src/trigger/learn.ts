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
import type { Id, Doc } from "../../convex/_generated/dataModel";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { channelPrefix } from "@/lib/storage";
import { fetchVideoAnalytics, hasAnalyticsAccess } from "@/lib/youtubeAnalytics";
import { loadLedger, saveLedger, loadPerformanceContext, type PerfEntry } from "@/lib/performance";
import { agentJson } from "@/agents/mastra";
import { z } from "zod";

const SETTLE_MS = 72 * 3_600_000;
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

type Logger = (m: string) => void;

const InsightsSchema = z.object({
  worksInSpace: z.array(z.string()).max(8),
  avoidInSpace: z.array(z.string()).max(8),
});

type Identity = NonNullable<Doc<"channels">["identity"]>;
type Brief = NonNullable<Identity["creativeBrief"]>;

/**
 * Close the creative loop: turn the performance ledger's winners/losers into an
 * updated Show Bible doctrine (worksInSpace / avoidInSpace) so the film crew leans
 * toward what actually performed. Only fires when there's a Bible AND ≥4 measured
 * videos (loadPerformanceContext returns "" below that, so we never bias on noise).
 */
async function adaptShowBible(
  convex: ConvexHttpClient,
  ch: { _id: Id<"channels">; name: string; identity?: Identity },
  prefix: string,
  log: Logger,
): Promise<boolean> {
  const identity = ch.identity;
  const brief: Brief | undefined = identity?.creativeBrief;
  if (!identity || !brief) return false;
  const perf = await loadPerformanceContext(prefix, { minViews: 50 });
  if (!perf) return false;
  try {
    const insights = await agentJson({
      role: "showrunner",
      schema: InsightsSchema,
      maxTokens: 600,
      system: "You refine a channel's creative doctrine from REAL performance data. Be concrete and brand-true; only assert what the data + existing doctrine support.",
      prompt:
        `Refine the creative doctrine for "${ch.name}" (${(identity.niche as string) ?? ""}).\n` +
        `Positioning: ${brief.positioning}\n` +
        `Current worksInSpace: ${(brief.worksInSpace ?? []).join("; ") || "(none)"}\n` +
        `Current avoidInSpace: ${(brief.avoidInSpace ?? []).join("; ") || "(none)"}\n\n` +
        `${perf}\n\n` +
        `Update worksInSpace (concrete choices to DO MORE of) and avoidInSpace (to do LESS of), grounded in the ` +
        `performance above + the existing doctrine. Short, concrete, actionable entries. STRICT JSON ` +
        `{worksInSpace:string[], avoidInSpace:string[]}.`,
      log,
    });
    const nextBrief: Brief = {
      ...brief,
      worksInSpace: insights.worksInSpace?.length ? insights.worksInSpace : brief.worksInSpace,
      avoidInSpace: insights.avoidInSpace?.length ? insights.avoidInSpace : brief.avoidInSpace,
      refreshedAt: Date.now(),
    };
    await convex.mutation(api.channels.updateChannel, {
      channelId: ch._id,
      identity: { ...identity, creativeBrief: nextBrief },
    });
    log(`learning-refresh: adapted Show Bible for ${ch.name} (works=${nextBrief.worksInSpace.length}, avoid=${nextBrief.avoidInSpace.length})`);
    return true;
  } catch (e) {
    log(`adaptShowBible failed (${e instanceof Error ? e.message : e})`);
    return false;
  }
}

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
    identity?: Identity;
  }>;
  let videos = 0;
  let adapted = 0;
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
    // Close the creative loop — adapt the Show Bible from the refreshed ledger.
    if (await adaptShowBible(convex, ch, prefix, log)) adapted++;
  }
  log(`learning-refresh: done — ${videos} video(s) updated, ${adapted} Show Bible(s) adapted across ${channels.length} channel(s)`);
  return { ok: true, channels: channels.length, videos, adapted };
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
