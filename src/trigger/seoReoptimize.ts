/**
 * `seo-reoptimize` — the publish-side half of the learning loop. The learning
 * task (learn.ts) records each published video's CTR + retention in the per-channel
 * performance ledger; this task finds the UNDERperformers and rewrites their title +
 * tags on YouTube (videos.update) to lift click-through — no re-upload, no re-render.
 *
 * Safe + cheap: only LLM calls (re-titling) + free Data API updates. Acts only on
 * settled videos (enough views), only the channel's weakest, and never re-touches a
 * video more than once per 30 days. Degrades to a no-op without Gemini / a linked
 * token / enough data.
 */
import { schedules, task } from "@trigger.dev/sdk";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { channelPrefix } from "@/lib/storage";
import { loadLedger, saveLedger, type PerfEntry } from "@/lib/performance";
import { updateVideoMetadata } from "@/lib/youtube";
import { hasGeminiKey, geminiJson } from "@/lib/gemini";

const MS_30D = 30 * 86_400_000;
const MIN_VIEWS = 200; // enough impressions for CTR/retention to mean something
const MAX_PER_CHANNEL = 3; // gentle — don't churn the whole library at once
const score = (e: PerfEntry) => e.avgViewPct * 0.7 + (e.ctr ?? 0) * 0.3;

type Logger = (m: string) => void;

async function reoptimize(ownerId: string, log: Logger) {
  await bootstrapSecrets((m) => log(m));
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not configured");
  if (!hasGeminiKey()) {
    log("seo-reopt: no Gemini key — skip");
    return { ok: true, skipped: "no_llm", updated: 0 };
  }
  const convex = new ConvexHttpClient(url);
  const channels = (await convex.query(api.channels.listChannels, { ownerId })) as Array<{
    _id: Id<"channels">; slug: string; name: string; identity?: { niche?: string };
  }>;

  let updated = 0;
  const now = Date.now();
  for (const ch of channels) {
    const prefix = channelPrefix(ownerId, ch.slug);
    const ledger = await loadLedger(prefix);
    const settled = ledger.filter((e) => e.views >= MIN_VIEWS && e.avgViewPct > 0);
    if (settled.length < 4) continue; // not enough signal to know what "under" means

    const sorted = [...settled].sort((a, b) => score(b) - score(a));
    const top = sorted.slice(0, 3).map((e) => e.title).filter(Boolean);
    const median = score(sorted[Math.floor(sorted.length / 2)]);
    // Weakest below-median videos not re-optimized in the last 30 days.
    const cands = sorted
      .filter((e) => score(e) < median && (!e.reoptimizedAt || now - e.reoptimizedAt > MS_30D))
      .slice(-MAX_PER_CHANNEL);
    if (cands.length === 0) continue;

    let refreshToken: string | undefined;
    try {
      const auth = await convex.query(api.youtubeAuth.getForChannel, { channelId: ch._id, secret: process.env.INTERNAL_QUERY_SECRET ?? "" });
      refreshToken = auth?.refreshToken;
    } catch { /* fall back to global token */ }

    for (const c of cands) {
      try {
        const o = await geminiJson<{ title?: string; tags?: string[] }>({
          prompt:
            `Rewrite the TITLE + TAGS of an UNDERPERFORMING YouTube video to boost click-through — WITHOUT clickbait ` +
            `and without changing what the video is actually about.\n` +
            `Topic: ${c.topic || c.title}\nCurrent title: "${c.title}"\n` +
            (ch.identity?.niche ? `Niche: ${ch.identity.niche}\n` : "") +
            (top.length ? `This channel's BEST-performing titles (match this energy/structure):\n${top.join("\n")}\n` : "") +
            `Return STRICT JSON {"title": string (<=70 chars, compelling + accurate), "tags": string[] (8-12 SEO tags)}.`,
          maxTokens: 400,
          temperature: 0.8,
        });
        const newTitle = (typeof o.title === "string" ? o.title : "").replace(/\s+/g, " ").trim();
        const tags = Array.isArray(o.tags) ? o.tags.filter((t) => typeof t === "string" && t.trim()).slice(0, 12) : [];
        if (!newTitle || newTitle === c.title) continue;
        await updateVideoMetadata({ refreshToken, videoId: c.videoId, title: newTitle, tags: tags.length ? tags : undefined });
        c.reoptimizedAt = now;
        c.title = newTitle;
        updated++;
        log(`seo-reopt: ${ch.name} ${c.videoId} → "${newTitle}"`);
      } catch (e) {
        log(`seo-reopt: ${c.videoId} failed (${e instanceof Error ? e.message : e})`);
      }
    }
    await saveLedger(prefix, ledger);
  }
  log(`seo-reopt: done — ${updated} video(s) re-optimized across ${channels.length} channel(s)`);
  return { ok: true, updated };
}

export const seoReoptimizeSchedule = schedules.task({
  id: "seo-reoptimize",
  // cron: "0 9 * * 1", // weekly, Monday 09:00 — after the weekend's metrics settle // PAUSED 2026-06-14 per request: manual-trigger only. Restore this line to re-enable the cron.
  run: async () => reoptimize(process.env.STUDIO_OWNER_ID ?? "owner_daniel", (m) => console.log(`[seo-reopt] ${m}`)),
});

export const seoReoptimizeTask = task({
  id: "seo-reoptimize-now",
  run: async (payload: { ownerId?: string }) =>
    reoptimize(payload?.ownerId ?? process.env.STUDIO_OWNER_ID ?? "owner_daniel", (m) => console.log(`[seo-reopt] ${m}`)),
});
