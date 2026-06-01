/**
 * Competitor-intelligence pipeline blocks (faithful v1 port).
 *
 *   competitor_research → ensures the channel's niche databank is fresh and
 *                         loads nicheIntelligence / seoDatabank / competitors
 *                         into ctx.store for downstream blocks. (no produces
 *                         the engine guards on emptiness; we emit a boolean)
 *   metadata_optimized  → base metadata + title optimised against the databank
 *                         + competitor titles + power words, plus an
 *                         overlap-weighted view estimate. Replaces `metadata`.
 *   thumbnail_gen       → claude_flux thumbnail (Claude concept → Flux base →
 *                         ffmpeg text overlay → Gemini QA), degrading to the
 *                         legacy title_card path. Produces `thumbnailKey`.
 *
 * All external calls are guarded: missing keys log + degrade, never crash.
 */
import type { Block, StageContext } from "@/engine/types";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { makeRunTempDir, downloadTo, readBytes } from "@/lib/files";
import { putObject } from "@/lib/storage";
import { titleCard, thumbnailText } from "@/lib/ffmpeg";
import { generateFluxImage } from "@/lib/replicate";
import { claudeJson, hasAnthropicKey } from "@/lib/anthropic";
import { geminiJson, geminiVision, parseJsonLoose, hasGeminiKey } from "@/lib/gemini";
import { refreshNicheResearchCore } from "@/lib/nicheResearch";
import { publicUrl } from "@/lib/storage";
import { join } from "node:path";

/* ----------------------------- helpers --------------------------------- */

function convex(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  return new ConvexHttpClient(url);
}

function str(ctx: StageContext, key: string): string {
  const v = ctx.store[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`intel: expected non-empty string store["${key}"], got ${JSON.stringify(v)}`);
  }
  return v;
}

/** Best-effort asset record (mirrors lofiBlocks.recordAsset). */
async function recordAsset(
  ctx: StageContext,
  kind: string,
  r2Key: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    await convex().mutation(api.assets.recordAsset, {
      ownerId: ctx.ownerId,
      channelId: ctx.channelId as Id<"channels">,
      runId: ctx.runId as Id<"runs">,
      kind,
      r2Key,
      meta,
    });
  } catch (e) {
    ctx.log(`recordAsset(${kind}) failed (non-fatal): ${e instanceof Error ? e.message : e}`);
  }
}

/** Load the channel doc (for identity.niche / thumbnailIdentity / persona). */
async function loadChannel(ctx: StageContext) {
  try {
    return await convex().query(api.channels.getChannel, {
      channelId: ctx.channelId as Id<"channels">,
    });
  } catch (e) {
    ctx.log(`loadChannel failed (non-fatal): ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/** Resolve the niche from params, store, or channel identity. */
function resolveNiche(
  ctx: StageContext,
  channel: { identity?: { niche?: string } } | null,
): string | undefined {
  return (
    (ctx.params["niche"] as string | undefined) ??
    (ctx.store["niche"] as string | undefined) ??
    channel?.identity?.niche ??
    undefined
  );
}

/* ----------------------- 1. competitor_research ------------------------- */

export const competitorResearch: Block = {
  id: "competitor_research",
  consumes: [],
  produces: ["nicheReady"],
  run: async (ctx) => {
    const channel = await loadChannel(ctx);
    const niche = resolveNiche(ctx, channel);

    if (!niche) {
      ctx.log("competitor_research: no niche configured — skipping research");
      return { nicheReady: false, niche: "" };
    }

    // Ensure the databank is fresh (no-op if <7d old or no YouTube key).
    try {
      const res = await refreshNicheResearchCore(
        { ownerId: ctx.ownerId, niche, channelId: ctx.channelId },
        (m, x) => ctx.log(`competitor_research: ${m}`, x),
      );
      ctx.log(`competitor_research: refresh ${JSON.stringify(res).slice(0, 200)}`);
    } catch (e) {
      ctx.log(`competitor_research: refresh failed (continuing): ${e instanceof Error ? e.message : e}`);
    }

    // Load cached intelligence into the store for downstream blocks.
    const c = convex();
    const [nicheIntel, databank, competitors] = await Promise.all([
      c.query(api.seo.getNiche, { ownerId: ctx.ownerId, niche }).catch(() => null),
      c.query(api.seo.getDatabank, { ownerId: ctx.ownerId, niche }).catch(() => null),
      c
        .query(api.competitors.listCompetitors, { ownerId: ctx.ownerId, niche })
        .catch(() => []),
    ]);

    return {
      nicheReady: true,
      niche,
      nicheIntel: nicheIntel ?? null,
      seoDatabank: databank ?? null,
      competitors: competitors ?? [],
      thumbnailIdentity: channel?.identity?.thumbnailIdentity ?? null,
      persona: channel?.identity?.persona ?? "",
      thumbnailer: (channel as { thumbnailer?: string } | null)?.thumbnailer ?? "claude_flux",
    };
  },
};

/* ---------------------- 2. metadata_optimized --------------------------- */

interface NicheIntel {
  powerWords?: { word: string; count: number }[];
  topTags?: { tag: string; count: number }[];
  optimalTitleLen?: number;
  medianViewsTop50?: number;
  avgViewsTop50?: number;
}
interface SeoDatabank {
  titleTemplates?: string[];
  hookPatterns?: string[];
}
interface CompetitorRow {
  topVideos: { title: string; views: number; tags: string[] }[];
}

export const metadataOptimized: Block = {
  id: "metadata",
  consumes: ["topic"],
  produces: [
    "title",
    "description",
    "tags",
    "estimatedViews",
    "estimatedViewsSource",
  ],
  run: async (ctx) => {
    const topic = str(ctx, "topic");
    const channelName = (ctx.store["channelName"] as string | undefined) ?? "Lofi";
    const niche = (ctx.store["niche"] as string | undefined) ?? "";

    // Base (lofi-style) metadata — same shape the legacy block produced.
    let title = `${topic} — Lofi Beats to Relax / Study To 🎧 ${channelName}`;
    const baseTags = [
      "lofi",
      "lofi hip hop",
      "study music",
      "relaxing music",
      "focus music",
      "chill beats",
      "ambient",
      topic.toLowerCase(),
    ];

    const nicheIntel = (ctx.store["nicheIntel"] as NicheIntel | null) ?? null;
    const databank = (ctx.store["seoDatabank"] as SeoDatabank | null) ?? null;
    const competitors = (ctx.store["competitors"] as CompetitorRow[] | null) ?? [];

    // Optimise the title against competitor intelligence (Gemini Flash).
    if (hasGeminiKey() && (databank || competitors.length)) {
      const competitorTitles = competitors
        .flatMap((c) => c.topVideos)
        .sort((a, b) => b.views - a.views)
        .slice(0, 15)
        .map((v) => v.title);
      const powerWords = (nicheIntel?.powerWords ?? [])
        .map((p) => p.word)
        .slice(0, 12);
      try {
        const out = await geminiJson<{ title?: string }>({
          prompt:
            "You are a YouTube title optimisation expert. Write ONE high-CTR " +
            `title for a video about "${topic}" on a ${niche || "lofi"} channel ` +
            `named "${channelName}". Use the proven patterns below. Keep it ` +
            `under ${nicheIntel?.optimalTitleLen ?? 70} characters. Return ONLY ` +
            'JSON: {"title": "..."}.\n\n' +
            `TITLE TEMPLATES:\n${(databank?.titleTemplates ?? []).join("\n")}\n\n` +
            `TOP COMPETITOR TITLES:\n${competitorTitles.join("\n")}\n\n` +
            `POWER WORDS TO CONSIDER: ${powerWords.join(", ")}`,
          maxTokens: 200,
        });
        if (out.title && out.title.trim()) title = out.title.trim();
      } catch (e) {
        ctx.log(`metadata: title optimise failed (using base): ${e instanceof Error ? e.message : e}`);
      }
    }

    // Merge top niche tags into the tag set (dedup, cap 15).
    const nicheTags = (nicheIntel?.topTags ?? []).map((t) => t.tag);
    const tags = Array.from(new Set([...baseTags, ...nicheTags])).slice(0, 15);

    const description =
      `${topic}.\n\nLofi beats to relax, study, and focus. Seamless ambient loop with calm instrumentals.\n\n` +
      `Generated by ${channelName}. New uploads regularly — subscribe for more.\n\n#lofi #studymusic #relax`;

    // Overlap-weighted view estimate (Convex query ports the predictor).
    let estimatedViews = nicheIntel?.medianViewsTop50 ?? nicheIntel?.avgViewsTop50 ?? 0;
    let estimatedViewsSource = "niche_fallback";
    if (niche) {
      try {
        const est = await convex().query(api.seo.viewEstimate, {
          ownerId: ctx.ownerId,
          niche,
          tags,
        });
        estimatedViews = est.estimatedViews;
        estimatedViewsSource = est.source;
      } catch (e) {
        ctx.log(`metadata: viewEstimate failed (using fallback): ${e instanceof Error ? e.message : e}`);
      }
    }
    // The runner forbids null/undefined produced values — always emit numbers.
    if (estimatedViews === undefined || estimatedViews === null) estimatedViews = 0;

    ctx.log(`metadata: title="${title.slice(0, 60)}…" est=${estimatedViews} (${estimatedViewsSource})`);
    return { title, description, tags, estimatedViews, estimatedViewsSource };
  },
};

/* -------------------------- 3. thumbnail_gen ---------------------------- */

interface ThumbConcept {
  flux_prompt: string;
  thumbnail_title: string;
  text_color: string;
  text_shadow: boolean;
  visual_rationale: string;
}
interface ThumbIdentity {
  colorPalette?: string[];
  visualStyle?: string;
  textPosition?: string;
  avoid?: string[];
}

/** Legacy title_card fallback — guaranteed to yield a thumbnailKey. */
async function titleCardFallback(ctx: StageContext): Promise<string> {
  const channelName = (ctx.store["channelName"] as string | undefined) ?? "Lofi";
  const topic = (ctx.store["topic"] as string | undefined) ?? "";
  const baseUrl = (ctx.store["f1Url"] as string | undefined) ?? "";
  const tmp = await makeRunTempDir(ctx.runId);
  const outJpg = join(tmp, "thumbnail.jpg");
  if (baseUrl) {
    const base = await downloadTo(baseUrl, join(tmp, "thumb_base.png"));
    await titleCard({ basePath: base, outJpg, title: channelName, subtitle: topic });
  } else {
    // No keyframe — synthesise a flat base via flux if possible, else a solid.
    throw new Error("thumbnail_gen: no f1Url available for title_card fallback");
  }
  const thumbnailKey = `${ctx.keyPrefix}runs/${ctx.runId}/thumbnail.jpg`;
  await putObject(thumbnailKey, await readBytes(outJpg), { contentType: "image/jpeg" });
  await recordAsset(ctx, "thumbnail", thumbnailKey, { strategy: "title_card_fallback" });
  return thumbnailKey;
}

export const thumbnailGen: Block = {
  id: "thumbnail_gen",
  consumes: ["title"],
  produces: ["thumbnailKey"],
  paid: true,
  run: async (ctx) => {
    const title = str(ctx, "title");
    const persona = (ctx.store["persona"] as string | undefined) ?? "";
    const thumbId = (ctx.store["thumbnailIdentity"] as ThumbIdentity | null) ?? null;
    const styleGuide = (ctx.store["nicheIntel"] as { thumbnailStyleGuide?: unknown } | null)
      ?.thumbnailStyleGuide;
    const thumbnailer =
      (ctx.store["thumbnailer"] as string | undefined) ??
      (ctx.params["thumbnailer"] as string | undefined) ??
      "claude_flux";

    // Honour explicit non-flux selection, or degrade if Claude/Replicate absent.
    if (thumbnailer === "title_card" || !hasAnthropicKey()) {
      if (!hasAnthropicKey()) {
        ctx.log("thumbnail_gen: ANTHROPIC_API_KEY missing — using title_card fallback");
      }
      const thumbnailKey = await titleCardFallback(ctx);
      return { thumbnailKey };
    }

    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts + 1; attempt++) {
      try {
        // Phase 1 — Claude Sonnet concept.
        const concept = await claudeJson<ThumbConcept>({
          maxTokens: 600,
          system:
            "You are an elite YouTube thumbnail art director. Return ONLY JSON.",
          prompt:
            `Design a click-worthy 16:9 thumbnail for the video titled "${title}".\n` +
            `Channel persona: ${persona || "n/a"}.\n` +
            `Thumbnail identity: ${JSON.stringify(thumbId ?? {})}.\n` +
            `Niche style guide: ${JSON.stringify(styleGuide ?? {})}.\n\n` +
            "Return JSON with keys: flux_prompt (a vivid, TEXT-FREE image " +
            "generation prompt — never request words/letters in the image), " +
            "thumbnail_title (<= 8 words, punchy overlay text), text_color " +
            "(hex like #FFEE00 with high contrast vs the scene), text_shadow " +
            "(boolean), visual_rationale (1 sentence).",
        });

        // Phase 2 — Flux base render (text-free).
        const fluxUrl = await generateFluxImage({
          prompt: `${concept.flux_prompt}. No text, no words, no letters, no watermark.`,
          aspectRatio: "16:9",
        });

        // Phase 3 — overlay title text via ffmpeg.
        const tmp = await makeRunTempDir(ctx.runId);
        const base = await downloadTo(fluxUrl, join(tmp, "flux_base.png"));
        const outJpg = join(tmp, "thumbnail.jpg");
        await thumbnailText({
          basePath: base,
          outJpg,
          title: concept.thumbnail_title || title,
          textColor: concept.text_color,
          textShadow: Boolean(concept.text_shadow),
        });

        // Upload first (so QA can fetch the rendered image by URL).
        const thumbnailKey = `${ctx.keyPrefix}runs/${ctx.runId}/thumbnail.jpg`;
        await putObject(thumbnailKey, await readBytes(outJpg), {
          contentType: "image/jpeg",
        });

        // Phase 3b — Gemini Vision QA (legibility / brand). Retry on fail
        // while attempts remain; otherwise accept the render.
        if (hasGeminiKey() && attempt <= maxAttempts) {
          try {
            const raw = await geminiVision({
              prompt:
                "You are a thumbnail QA reviewer. Judge this YouTube thumbnail " +
                `for the title "${title}". Is the overlay text legible at small ` +
                "size and is the composition on-brand and click-worthy? Return " +
                'ONLY JSON: {"pass": true|false, "reason": "..."}.',
              imageUrls: [publicUrl(thumbnailKey)],
              json: true,
              maxTokens: 200,
            });
            const qa = parseJsonLoose<{ pass?: boolean; reason?: string }>(raw);
            if (qa.pass === false) {
              ctx.log(`thumbnail_gen: QA fail (attempt ${attempt}): ${qa.reason ?? ""} — retrying`);
              continue;
            }
          } catch (e) {
            ctx.log(`thumbnail_gen: QA errored (accepting): ${e instanceof Error ? e.message : e}`);
          }
        }

        await recordAsset(ctx, "thumbnail", thumbnailKey, {
          strategy: "claude_flux",
          visualRationale: concept.visual_rationale,
          thumbnailTitle: concept.thumbnail_title,
        });
        return { thumbnailKey };
      } catch (e) {
        ctx.log(`thumbnail_gen: claude_flux attempt ${attempt} failed: ${e instanceof Error ? e.message : e}`);
        // fall through to retry; on final failure, degrade to title_card.
      }
    }

    ctx.log("thumbnail_gen: claude_flux exhausted — degrading to title_card");
    const thumbnailKey = await titleCardFallback(ctx);
    return { thumbnailKey };
  },
};

/** All intelligence blocks (registration order). */
export const intelligenceBlocks: Block[] = [
  competitorResearch,
  metadataOptimized,
  thumbnailGen,
];
