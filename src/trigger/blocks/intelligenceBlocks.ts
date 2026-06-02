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
import { titleCard, thumbnailText, imageToJpeg, solidImage } from "@/lib/ffmpeg";
import { generateFluxImage } from "@/lib/replicate";
import { generateIdeogramThumbnail, hasIdeogramKey } from "@/lib/ideogram";
import { claudeJson, hasAnthropicKey } from "@/lib/anthropic";
import { geminiVision, parseJsonLoose, hasGeminiKey } from "@/lib/gemini";
import { agentJson } from "@/agents/mastra";
import { produceAndCritique } from "@/engine/critiqueLoop";
import { z } from "zod";

/** SEO chunk structured-output schemas (validated on Mastra + REST). */
const seoSchema = z.object({
  title: z.string(),
  description: z.string(),
  tags: z.array(z.string()).optional().default([]),
});
const seoDirectorSchema = z.object({
  score: z.number().optional(),
  issues: z.array(z.string()).optional().default([]),
});
/** lofi/study-music framing — flagged when the channel niche is NOT music. */
const LOFI_LEAK = /lo-?fi|beats to (relax|study)|study music|chill beats/i;
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
    const channelName = (ctx.store["channelName"] as string | undefined) ?? "this channel";
    const niche = (ctx.store["niche"] as string | undefined) ?? "";
    const persona = (ctx.store["persona"] as string | undefined) ?? "";

    const nicheIntel = (ctx.store["nicheIntel"] as NicheIntel | null) ?? null;
    const databank = (ctx.store["seoDatabank"] as SeoDatabank | null) ?? null;
    const competitors = (ctx.store["competitors"] as CompetitorRow[] | null) ?? [];
    const competitorTitles = competitors
      .flatMap((c) => c.topVideos)
      .sort((a, b) => b.views - a.views)
      .slice(0, 12)
      .map((v) => v.title);
    const powerWords = (nicheIntel?.powerWords ?? []).map((p) => p.word).slice(0, 12);
    const titleMax = nicheIntel?.optimalTitleLen ?? 70;
    // Music niches legitimately use "lofi / study / relax" framing; others don't.
    const isMusicNiche = /lofi|lo-fi|study|chill|ambient|sleep|relax|music|beats/i.test(niche);

    // Script context grounds the SEO in the ACTUAL video (narrated archetypes).
    let scriptExcerpt = "";
    const nt = ctx.store["narrationText"];
    if (typeof nt === "string" && nt.length > 0) {
      scriptExcerpt = nt.slice(0, 800);
    } else {
      const sc = ctx.store["script"] as { sections?: { heading?: string }[] } | undefined;
      if (sc?.sections?.length) {
        scriptExcerpt = sc.sections.map((s) => s.heading).filter(Boolean).join("; ").slice(0, 800);
      }
    }

    const viewEstimate = async (tags: string[]) => {
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
      if (estimatedViews === undefined || estimatedViews === null) estimatedViews = 0;
      return { estimatedViews, estimatedViewsSource };
    };

    // Degrade: no model available → niche-correct (NOT lofi) static metadata.
    if (!hasGeminiKey()) {
      const title = topic.slice(0, titleMax);
      const description = `${topic}.\n\n${persona || channelName}.`;
      const tags = [topic.toLowerCase(), niche].filter(Boolean) as string[];
      const ve = await viewEstimate(tags);
      ctx.log(`metadata (degraded, no Gemini): "${title}"`);
      return { title, description, tags, ...ve };
    }

    // Producer ↔ Director SEO loop: niche-aware, script-grounded, high-CTR.
    const loop = await produceAndCritique<{
      title: string;
      description: string;
      tags: string[];
    }>({
      label: "metadata/seo",
      threshold: 0.8,
      maxIters: 3,
      log: ctx.log,
      produce: async (priorIssues) => {
        const out = await agentJson({
          role: "producer",
          schema: seoSchema,
          log: ctx.log,
          maxTokens: 900,
          temperature: 0.8,
          prompt:
            `Write YouTube SEO metadata for a video about "${topic}" on the channel "${channelName}".\n` +
            `NICHE: ${niche || "general"}\nPERSONA: ${persona || "n/a"}\n` +
            (scriptExcerpt ? `SCRIPT EXCERPT:\n${scriptExcerpt}\n` : "") +
            (competitorTitles.length ? `TOP COMPETITOR TITLES:\n${competitorTitles.join("\n")}\n` : "") +
            (powerWords.length ? `POWER WORDS: ${powerWords.join(", ")}\n` : "") +
            (databank?.titleTemplates?.length ? `TITLE TEMPLATES:\n${databank.titleTemplates.join("\n")}\n` : "") +
            `RULES:\n` +
            `- title: high-CTR, <= ${titleMax} chars, main keyword + hook in the first ~40 chars.\n` +
            `- description: the FIRST 150 chars must stand alone as a compelling summary (shown above the fold); then 150-350 words with natural keywords; end with 3-5 hashtags.\n` +
            `- tags: 10-15 relevant tags.\n` +
            `- MATCH THE NICHE. Do NOT use "lofi" / "beats to relax / study" / study-music framing unless the niche actually IS lofi/study/ambient music.\n` +
            (priorIssues.length ? `FIX these issues from the last attempt: ${priorIssues.join("; ")}\n` : "") +
            `Return STRICT JSON {"title":string,"description":string,"tags":string[]}.`,
        });
        return {
          title: (out.title ?? "").trim(),
          description: (out.description ?? "").trim(),
          tags: (out.tags ?? []).filter(Boolean),
        };
      },
      critique: async (cand) => {
        // DETERMINISTIC checks (computed, not model-judged).
        const issues: string[] = [];
        if (!cand.title) issues.push("empty title");
        if (cand.title.length > titleMax + 5) issues.push(`title ${cand.title.length} chars > ${titleMax}`);
        if (cand.description.length < 120) issues.push("description too short (<120 chars; first 150 must summarize)");
        if (cand.tags.length < 5) issues.push("fewer than 5 tags");
        const lofiLeak =
          !isMusicNiche && (LOFI_LEAK.test(cand.title) || LOFI_LEAK.test(cand.description));
        if (lofiLeak) issues.push(`off-niche lofi/study-music framing for a "${niche}" video — remove it`);

        // SUBJECTIVE: Director scores CTR + on-brand fit + clarity.
        let dirScore = 0.7;
        let dirIssues: string[] = [];
        if (hasAnthropicKey()) {
          try {
            const v = await agentJson({
              role: "director",
              schema: seoDirectorSchema,
              log: ctx.log,
              maxTokens: 500,
              temperature: 0.3,
              system: "You are the DIRECTOR: a YouTube SEO + CTR strategist. Return ONLY JSON.",
              prompt:
                `Channel "${channelName}" — niche: ${niche || "n/a"}; persona: ${persona || "n/a"}.\n` +
                `TITLE: ${cand.title}\nDESCRIPTION (first 200): ${cand.description.slice(0, 200)}\nTAGS: ${cand.tags.join(", ")}\n\n` +
                `Score 0..1 on click appeal, on-niche/on-brand fit, and clarity. Penalize generic or off-niche framing. Return JSON {"score":number,"issues":string[]}.`,
            });
            dirScore = typeof v.score === "number" ? Math.max(0, Math.min(1, v.score)) : 0.7;
            dirIssues = Array.isArray(v.issues) ? v.issues : [];
          } catch (e) {
            ctx.log(`metadata: director failed (continuing): ${e instanceof Error ? e.message : e}`);
          }
        }
        const hardFail = !cand.title || lofiLeak;
        return {
          score: hardFail ? Math.min(dirScore, 0.4) : dirScore,
          pass: !hardFail && issues.length === 0 && dirScore >= 0.8,
          issues: [...issues, ...dirIssues],
        };
      },
    });

    let { title, description, tags } = loop.value;
    // Merge top niche tags (dedup, cap 15); never ship empty.
    const nicheTags = (nicheIntel?.topTags ?? []).map((t) => t.tag);
    tags = Array.from(new Set([...tags, ...nicheTags])).slice(0, 15);
    if (tags.length === 0) tags = [topic.toLowerCase()];

    // Append chapters (from the captions block) to the description if present.
    const chaptersText = ctx.store["chaptersText"] as string | undefined;
    if (chaptersText && chaptersText.trim()) {
      description = `${description}\n\nChapters:\n${chaptersText}`;
    }
    // License/attribution ledger (Wikimedia CC credits) → required for CC-BY.
    const attributions = ctx.store["attributions"] as string[] | undefined;
    if (attributions && attributions.length) {
      description = `${description}\n\nImage credits:\n${attributions.join("\n")}`;
    }

    const ve = await viewEstimate(tags);
    ctx.log(
      `metadata: title="${title.slice(0, 60)}…" (score=${loop.critique.score.toFixed(2)}, accepted=${loop.accepted}) est=${ve.estimatedViews} (${ve.estimatedViewsSource})`,
    );
    return { title, description, tags, ...ve };
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
  let base: string;
  if (baseUrl) {
    base = await downloadTo(baseUrl, join(tmp, "thumb_base.png"));
  } else {
    // No keyframe (narrated archetypes) — synthesise a base: Flux, else solid.
    try {
      const fluxUrl = await generateFluxImage({
        prompt: `cinematic background image for a video about "${topic}", no text, no words, no letters`,
        aspectRatio: "16:9",
      });
      base = await downloadTo(fluxUrl, join(tmp, "thumb_base.png"));
    } catch {
      base = await solidImage(join(tmp, "thumb_base.jpg"));
    }
  }
  await titleCard({ basePath: base, outJpg, title: channelName, subtitle: topic });
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
    const niche = (ctx.store["niche"] as string | undefined) ?? "";

    // PREFERRED: Ideogram 3.0 text-first thumbnail (great headlines, ~95% text
    // accuracy). Director vision QA gates legibility/CTR; retry once on fail.
    // Falls through to claude_flux / title_card on absence or failure.
    if (hasIdeogramKey() && thumbnailer !== "title_card") {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const url = await generateIdeogramThumbnail({ title, niche });
          if (!url) break;
          const tmp = await makeRunTempDir(ctx.runId);
          const raw = await downloadTo(url, join(tmp, "ideogram.png"));
          const outJpg = join(tmp, "thumbnail.jpg");
          await imageToJpeg(raw, outJpg);
          const thumbnailKey = `${ctx.keyPrefix}runs/${ctx.runId}/thumbnail.jpg`;
          await putObject(thumbnailKey, await readBytes(outJpg), { contentType: "image/jpeg" });
          if (hasGeminiKey() && attempt < 2) {
            try {
              const qraw = await geminiVision({
                prompt:
                  `You are a thumbnail QA reviewer. Judge this YouTube thumbnail for "${title}". ` +
                  `Is the text legible at small size and the composition click-worthy + on-brand` +
                  (niche ? ` for a ${niche} channel` : "") +
                  `? Return ONLY JSON {"pass":true|false,"reason":"..."}.`,
                imageUrls: [publicUrl(thumbnailKey)],
                json: true,
                maxTokens: 200,
              });
              const qa = parseJsonLoose<{ pass?: boolean; reason?: string }>(qraw);
              if (qa.pass === false) {
                ctx.log(`thumbnail_gen: ideogram QA fail (${qa.reason ?? ""}) — retry`);
                continue;
              }
            } catch (e) {
              ctx.log(`thumbnail_gen: ideogram QA errored (accepting): ${e instanceof Error ? e.message : e}`);
            }
          }
          await recordAsset(ctx, "thumbnail", thumbnailKey, { strategy: "ideogram" });
          ctx.log("thumbnail_gen: ideogram thumbnail ✓");
          return { thumbnailKey };
        } catch (e) {
          ctx.log(`thumbnail_gen: ideogram attempt ${attempt} failed: ${e instanceof Error ? e.message : e}`);
        }
      }
      ctx.log("thumbnail_gen: ideogram unavailable/failed — falling back to claude_flux");
    }

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
