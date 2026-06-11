/**
 * `plan-week-ahead` — pre-build the upcoming-videos queue for a channel: pick N
 * fresh topics, then for each generate an SEO title, a short description, and a
 * thumbnail (same Flux-Pro / statue-right pipeline as a real render), and store
 * them in the `contentPlan` table for the channel page's "Week ahead" section.
 * Cheap relative to a full render (no video/TTS) — just stills + text.
 */
import { task } from "@trigger.dev/sdk";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { channelPrefix, putObject } from "@/lib/storage";
import { geminiJson, hasGeminiKey } from "@/lib/gemini";
import { claudeJson, hasAnthropicKey } from "@/lib/anthropic";
import { generateFalFluxProImage, hasFalKey } from "@/lib/falImage";
import { optimizeTopics } from "@/lib/topicOptimizer";
import { guardedThumbnailDesign, thumbnailText, planSubjectLayout } from "@/lib/ffmpeg";
import {
  resolveThumbnailStyle,
  styleFromDNA,
  buildBasePrompt,
  artDirectorBrief,
  shortTitleFallback,
  TEXT_FREE_SUFFIX,
} from "@/lib/thumbnailFormula";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
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
      alsoAvoid: existing.map((r) => r.topic),
      log,
    });
    const topics = optimized.map((o) => o.topic);
    if (topics.length === 0) throw new Error("plan-week-ahead: no topics");

    const ids = await convex.mutation(api.contentPlan.addItems, { ownerId, channelId, topics });

    const dir = join(tmpdir(), `plan_${channelId}_${ids.length}`);
    mkdirSync(dir, { recursive: true });
    const brush = join(process.cwd(), "src/assets/thumb_brush_swash.png");

    // 2) per topic: title + description + thumbnail
    for (let i = 0; i < topics.length; i++) {
      const topic = topics[i];
      const id = ids[i] as Id<"contentPlan">;
      let title = topic;
      let description = "";
      try {
        if (hasGeminiKey()) {
          const meta = await geminiJson<{ title?: string; description?: string }>({
            prompt:
              `For a ${niche || "YouTube"} video about "${topic}" on "${channelName}":\n` +
              `- title: high-CTR, 60-90 chars, front-load the main keyword in the first ~40 chars, a number or ` +
              `bracket if natural, NO channel name, no clickbait that the video can't honour.\n` +
              `- description: ONE hook line + ONE short paragraph (<=60 words) with the keyword in the first 25 words, ` +
              `then 3 hashtags. No script.\nReturn STRICT JSON {"title":string,"description":string}.`,
            maxTokens: 500,
            temperature: 0.7,
          });
          if (meta.title) title = meta.title.trim().slice(0, 100);
          if (meta.description) description = meta.description.trim();
        }
      } catch (e) {
        log(`meta gen failed for "${topic}": ${e instanceof Error ? e.message : e}`);
      }

      let thumbnailKey: string | undefined;
      try {
        thumbnailKey = await genThumb({ id, topic, title, style, channelName, niche, ownerId, slug: channel.slug, dir, brush });
      } catch (e) {
        log(`thumbnail failed for "${topic}": ${e instanceof Error ? e.message : e}`);
      }

      await convex.mutation(api.contentPlan.setGenerated, { id, title, description, thumbnailKey, status: "ready" });
      log(`planned ${i + 1}/${topics.length}: "${title.slice(0, 50)}"`);
    }
    return { ok: true, planned: topics.length };
  },
});

/* eslint-disable @typescript-eslint/no-explicit-any */
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
  brush: string;
}): Promise<string | undefined> {
  if (!hasFalKey()) return undefined;
  let thumbTitle = shortTitleFallback(o.title);
  let basePrompt = buildBasePrompt(o.style, o.topic, o.niche);
  if (hasAnthropicKey()) {
    try {
      const c = await claudeJson<{ flux_prompt?: string; thumbnail_title?: string }>({
        maxTokens: 500,
        system: "You are an elite YouTube thumbnail art director. Return ONLY JSON.",
        prompt:
          `Design a click-worthy 16:9 thumbnail for "${o.title}".\n` +
          artDirectorBrief(o.style) +
          `\nReturn JSON {"flux_prompt":string (TEXT-FREE), "thumbnail_title":string (3-5 words)}.`,
      });
      if (c.flux_prompt) basePrompt = `${c.flux_prompt} ${TEXT_FREE_SUFFIX}`;
      if (c.thumbnail_title) thumbTitle = c.thumbnail_title;
    } catch {
      /* deterministic fallback */
    }
  }
  // Generate the base and compose with the SAME deterministic overlap guard the
  // render pipeline uses — regenerate a wider base until the title sits CLEAR of
  // the statue (no text-over-head). Accept the last attempt as a fallback.
  const outJpg = join(o.dir, `t_${o.id}.jpg`);
  const MAX = 4;
  for (let k = 0; k < MAX; k++) {
    const last = k === MAX - 1;
    const url = await generateFalFluxProImage({ prompt: basePrompt });
    const base = join(o.dir, `b_${o.id}_${k}.jpg`);
    writeFileSync(base, Buffer.from(await (await fetch(url)).arrayBuffer()));
    const layout = await planSubjectLayout(base);
    // The statue-right/left-dark layout contract only applies to the brush
    // composite — DNA styles use their own composition (often centered).
    if (o.style.design && !layout.leftZoneClean && !last) continue; // subject not cleanly on the right → regen
    if (o.style.design?.treatment === "brush_swash") {
      const d = await guardedThumbnailDesign({
        basePath: base,
        outJpg,
        brushPath: o.brush,
        title: thumbTitle,
        tagline: o.style.design.tagline,
        channel: o.channelName,
        badge: o.style.design.badge,
        accentHex: o.style.design.accentHex,
        font: o.style.title.font,
        flipBase: layout.flip,
      });
      if (!d.clear && !last) continue; // title would touch the statue → regen
    } else {
      await thumbnailText({ basePath: base, outJpg, title: thumbTitle, subtitle: o.channelName, font: o.style.title.font, uppercase: o.style.title.uppercase });
    }
    break;
  }
  const key = `${channelPrefix(o.ownerId, o.slug)}plan/${o.id}.jpg`;
  await putObject(key, readFileSync(outJpg), { contentType: "image/jpeg" });
  return key;
}
