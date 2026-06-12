/**
 * `plan-week-ahead` — pre-build the upcoming-videos queue for a channel: pick N
 * fresh topics, then for each generate an SEO title, a short description, and a
 * thumbnail (the SAME banana engine as a real render: one-pass Nano Banana Pro
 * from a design brief, judge-gated), and store them in the `contentPlan` table
 * for the channel page's "Week ahead" section. Cheap relative to a full render
 * (no video/TTS) — just stills + text.
 */
import { task } from "@trigger.dev/sdk";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { channelPrefix, putObject } from "@/lib/storage";
import { geminiJson, hasGeminiKey } from "@/lib/gemini";
import { optimizeTopics } from "@/lib/topicOptimizer";
import { buildThumbBrief, bananaThumbnail, hasBanana } from "@/lib/banana";
import {
  resolveThumbnailStyle,
  styleFromDNA,
  shortTitleFallback,
} from "@/lib/thumbnailFormula";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export interface PlanWeekArgs {
  ownerId: string;
  channelId: string;
  count?: number;
}

export const planWeekAheadTask = task({
  id: "plan-week-ahead",
  maxDuration: 1800,
  run: async (payload: PlanWeekArgs) => {
    const log = (m: string, x?: Record<string, unknown>) => console.log(`[plan-week-ahead] ${m}`, x ?? "");
    await bootstrapSecrets(log);
    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
    const convex = new ConvexHttpClient(url);

    const channelId = payload.channelId as Id<"channels">;
    const count = Math.max(1, Math.min(12, payload.count ?? 5));
    const channel = await convex.query(api.channels.getChannel, { channelId });
    if (!channel) throw new Error(`channel not found: ${payload.channelId}`);
    const ownerId = channel.ownerId;
    const niche = channel.identity?.niche ?? "";
    const persona = channel.identity?.persona ?? "";
    const channelName = channel.name;
    // STYLE DNA FIRST — same source of truth as the render pipeline's
    // thumbnail_gen. The template-letter fallback put Greek marble busts on a
    // finance channel's entire week-ahead plan.
    const style =
      styleFromDNA((channel as { styleDNA?: Parameters<typeof styleFromDNA>[0] }).styleDNA) ??
      resolveThumbnailStyle((channel as { template?: string }).template);
    log(`thumbnail style source: ${style.label === "Style DNA" ? "Style DNA" : `template preset (${style.label})`}`);

    // 1) fresh topics via the reusable optimizer (competitor + analytics + SEO +
    // done-topics, all within channel identity). Avoids the current plan too.
    const existing = await convex.query(api.contentPlan.listPlan, { ownerId, channelId });
    const optimized = await optimizeTopics({
      convex,
      ownerId,
      channelId,
      keyPrefix: channelPrefix(ownerId, channel.slug),
      count,
      identity: {
        niche,
        persona,
        topicPool: channel.identity?.topicPool,
        bannedWords: channel.identity?.bannedWords,
        requiredCallbacks: channel.identity?.requiredCallbacks,
      },
      channelName,
      alsoAvoid: existing.map((r) => r.topic),
      log,
    });
    const topics = optimized.map((o) => o.topic);
    if (topics.length === 0) throw new Error("plan-week-ahead: no topics");

    const ids = await convex.mutation(api.contentPlan.addItems, { ownerId, channelId, topics });

    const dir = join(tmpdir(), `plan_${channelId}_${ids.length}`);
    mkdirSync(dir, { recursive: true });

    // 2) per topic: title + description + thumbnail. Topicraft bets arrive
    // with a judged provisional title + thumbnail moment — use them instead of
    // re-deriving (one less LLM call per item, and the plan shows the same
    // promise unit the judge gated).
    for (let i = 0; i < topics.length; i++) {
      const topic = topics[i];
      const bet = optimized[i];
      const id = ids[i] as Id<"contentPlan">;
      let title = bet?.title?.trim() || topic;
      let description = "";
      try {
        if (hasGeminiKey()) {
          const meta = await geminiJson<{ title?: string; description?: string }>({
            prompt:
              `For a ${niche || "YouTube"} video about "${topic}" on "${channelName}"` +
              (bet?.title ? ` (title is ALREADY locked: "${title}" — do NOT return a title)` : "") + `:\n` +
              (bet?.title
                ? ""
                : `- title: high-CTR, 60-90 chars, front-load the main keyword in the first ~40 chars, a number or ` +
                  `bracket if natural, NO channel name, no clickbait that the video can't honour.\n`) +
              `- description: ONE hook line + ONE short paragraph (<=60 words) with the keyword in the first 25 words, ` +
              `then 3 hashtags. No script.\nReturn STRICT JSON {"title":string,"description":string}.`,
            maxTokens: 500,
            temperature: 0.7,
          });
          if (!bet?.title && meta.title) title = meta.title.trim().slice(0, 100);
          if (meta.description) description = meta.description.trim();
        }
      } catch (e) {
        log(`meta gen failed for "${topic}": ${e instanceof Error ? e.message : e}`);
      }

      let thumbnailKey: string | undefined;
      try {
        thumbnailKey = await genThumb({ id, topic, title, style, channelName, niche, ownerId, slug: channel.slug, dir, log, sceneSeed: bet?.thumbnailMoment });
      } catch (e) {
        log(`thumbnail failed for "${topic}": ${e instanceof Error ? e.message : e}`);
      }

      await convex.mutation(api.contentPlan.setGenerated, { id, title, description, thumbnailKey, status: "ready" });
      log(`planned ${i + 1}/${topics.length}: "${title.slice(0, 50)}"`);
    }
    return { ok: true, planned: topics.length };
  },
});

/**
 * One plan thumbnail through the banana engine: a Gemini concept pass turns the
 * channel's locked look + topic into a scene, a distilled <=12-word render
 * style, and a 2-3 line headline with one payoff word; bananaThumbnail renders
 * and judge-gates it (one feedback retry, then throws — the caller logs and the
 * plan item ships without a thumbnail rather than with a bad one).
 */
async function genThumb(o: {
  id: string;
  topic: string;
  title: string;
  style: ReturnType<typeof resolveThumbnailStyle>;
  channelName: string;
  niche: string;
  ownerId: string;
  slug: string;
  dir: string;
  log: (m: string) => void;
  /** Topicraft's judged thumbnail moment — the scene the bet was gated on. */
  sceneSeed?: string;
}): Promise<string | undefined> {
  if (!hasBanana()) return undefined;
  let scene = o.sceneSeed?.trim() || `a dramatic scene that literally enacts "${o.title}"${o.niche ? ` for a ${o.niche} channel` : ""}.`;
  let look = o.style.label === "Style DNA" ? undefined : o.style.label;
  let lines: { text: string; payoff?: boolean }[] = [{ text: shortTitleFallback(o.title), payoff: true }];
  try {
    const c = await geminiJson<{
      scene?: string;
      look?: string;
      lines?: { text?: string; payoff?: boolean }[];
    }>({
      prompt:
        `Thumbnail concept for the video "${o.title}"${o.niche ? ` (${o.niche})` : ""} on channel "${o.channelName}".\n` +
        `The channel's locked look: ${o.style.art} Palette: ${o.style.palette}.\n` +
        (o.sceneSeed?.trim() ? `The PLANNED thumbnail moment (build the scene ON this, restyled into the locked look): ${o.sceneSeed.trim()}\n` : "") +
        `- scene: ONE sentence — hero subject + background + one story-carrying detail, literally enacting the ` +
        `topic INSIDE the locked look (never a generic scene).\n` +
        `- look: the rendering style distilled to <=12 words (medium, material, grade).\n` +
        `- lines: 2-3 headline lines, 1-3 punchy words each, <=5 words total, NOT restating the title, ` +
        `exactly ONE marked as the payoff.\n` +
        `Return STRICT JSON {"scene":string,"look":string,"lines":[{"text":string,"payoff":boolean}]}.`,
      maxTokens: 600,
      temperature: 0.8,
    });
    if (c.scene?.trim()) scene = c.scene.trim();
    if (c.look?.trim()) look = c.look.trim();
    const got = (c.lines ?? [])
      .filter((l) => l.text && l.text.trim())
      .map((l) => ({ text: String(l.text).trim(), payoff: l.payoff === true }));
    if (got.length) lines = got;
  } catch {
    /* deterministic fallback above */
  }
  const outJpg = join(o.dir, `t_${o.id}.jpg`);
  await bananaThumbnail({
    brief: buildThumbBrief({
      channelName: o.channelName,
      imageStyle: look,
      palette: [o.style.palette],
      accentColor: o.style.title.accent ?? undefined,
      scene,
      lines,
      badge: o.channelName,
    }),
    outJpg,
    expectWords: lines.map((l) => l.text),
    imageStyle: look,
    title: o.title,
    log: o.log,
  });
  const key = `${channelPrefix(o.ownerId, o.slug)}plan/${o.id}.jpg`;
  await putObject(key, readFileSync(outJpg), { contentType: "image/jpeg" });
  return key;
}
