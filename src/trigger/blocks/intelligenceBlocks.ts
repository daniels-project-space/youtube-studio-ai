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
 *   thumbnail_gen       → one Style-DNA/playbook route: text-free flash base →
 *                         deterministic local typography → one production QA
 *                         alarm. Generic cards are explicit nonpublishable
 *                         draft previews only; failures never swap renderers.
 */
import { COST_PATCH_KEY, type Block, type StageContext } from "@/engine/types";
import { PRICE } from "@/engine/pricing";
import { accountedModelUsageCost } from "@/engine/modelUsageCost";
import {
  assertThumbnailGate,
  assertThumbnailStrategy,
  qualityProfile,
  thumbnailGatePassed,
  type ThumbnailGateVerdict,
} from "@/engine/qualityPolicy";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { makeRunTempDir, readBytes } from "@/lib/files";
import { putObject } from "@/lib/storage";
import {
  beginThumbnailPaidWork,
  openThumbnailCheckpoint,
  saveThumbnailGenerationCheckpoint,
  saveThumbnailQaCheckpoint,
  thumbnailNanoBananaRequestContext,
  thumbnailRequestHash,
  type ThumbnailNanoBananaEvidence,
} from "@/lib/thumbnailCheckpoint";
import { titleCard, solidImage } from "@/lib/ffmpeg";
import {
  generateNanoBananaImageWithReceipt,
  hasNanoBanana,
  NANO_BANANA_THUMBNAIL_PROFILE,
} from "@/lib/banana";
import { craftMetadata } from "@/lib/metacraft";
import { hasAnthropicKey } from "@/lib/anthropic";
import { hasGeminiKey } from "@/lib/gemini";
import { hasVisionKey } from "@/lib/vision";
import {
  renderCandidate,
  resolveGoldenThumbnailPlaybook,
  runThumbnailMobileReferenceQa,
  selectGoldenThumbnailPattern,
  type ThumbnailPlaybook,
} from "@/lib/thumbnailLab";
import { agentJson } from "@/agents/mastra";
import { produceAndCritique, type ChannelCritiqueContext } from "@/engine/critiqueLoop";
import { laneQualityPolicy } from "@/engine/contentLane";
import { loadPerformanceContext } from "@/lib/performance";
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
import { loadOutlierBank } from "@/lib/topicraft";
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
  produces: [
    "nicheReady",
    "niche",
    "nicheIntel",
    "seoDatabank",
    "competitors",
    "thumbnailIdentity",
    "persona",
    "thumbnailer",
  ],
  run: async (ctx) => {
    const channel = await loadChannel(ctx);
    const niche = resolveNiche(ctx, channel);

    if (!niche) {
      throw new Error("competitor_research: no niche configured — Golden research cannot be skipped");
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


    // Keep the niche's outlier scan fresh alongside the databank — topicraft's
    // hot path then reads the bank instead of burning daily YouTube quota.
    await loadOutlierBank({
      convex: convex(),
      ownerId: ctx.ownerId,
      niche,
      query: niche,
      log: (m) => ctx.log(`competitor_research: ${m}`),
    }).catch((e) =>
      ctx.log(`competitor_research: outlier bank refresh failed (continuing): ${e instanceof Error ? e.message : e}`),
    );
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
      thumbnailer: (channel as { thumbnailer?: string } | null)?.thumbnailer ?? "banana",
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

/**
 * Shared metadata finishing pass (metacraft + legacy paths): strip the channel
 * name from the title, merge/screen tags against identity.bannedWords, append
 * chapters + CC attributions to the description.
 */
function finishMetadata(
  ctx: StageContext,
  o: { title: string; description: string; tags: string[]; channelName: string; nicheIntel: NicheIntel | null },
): { title: string; description: string; tags: string[] } {
  let { title, description, tags } = o;
  if (o.channelName && o.channelName !== "this channel") {
    const esc = o.channelName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    title = title
      .replace(new RegExp(`\\s*[|\\-–—:•]\\s*${esc}\\s*$`, "i"), "")
      .replace(new RegExp(`^\\s*${esc}\\s*[|\\-–—:•]\\s*`, "i"), "")
      .replace(new RegExp(`\\b${esc}\\b`, "gi"), "")
      .replace(/\s{2,}/g, " ")
      .replace(/\s*[|\-–—:•]\s*$/, "")
      .trim();
  }
  const bannedWords = ((ctx.store["bannedWords"] as string[] | undefined) ?? [])
    .map((w) => w.toLowerCase().trim())
    .filter(Boolean);
  const notBanned = (t: string) => !bannedWords.some((w) => t.toLowerCase().includes(w));
  const baseTags = (Array.isArray(ctx.params["baseTags"]) ? (ctx.params["baseTags"] as unknown[]) : [])
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0);
  const nicheTags = (o.nicheIntel?.topTags ?? []).map((t) => t.tag);
  const dropped = [...baseTags, ...nicheTags].filter((t) => !notBanned(t));
  if (dropped.length) ctx.log(`metadata: dropped banned-word tags: ${dropped.join(", ")}`);
  tags = Array.from(new Set([...baseTags, ...tags, ...nicheTags].filter(notBanned))).slice(0, 30);
  if (tags.length === 0) tags = [title.toLowerCase()];

  // ElevenLabs v3 [audio tags] are PERFORMED, never displayed — they leaked
  // into a live public description ("[softly]" in the hook quote).
  description = description.replace(/\[(?:softly|whispers?|pause|long pause|sighs?|exhales?|inhales? deeply|laughs?|chuckles?|seriously|slowly|thoughtful|curious|emphatic|excited|sarcastic|appalled|surprised)\]/gi, "").replace(/  +/g, " ");
  const chaptersText = ctx.store["chaptersText"] as string | undefined;
  if (chaptersText && chaptersText.trim()) description = `${description}\n\nChapters:\n${chaptersText}`;
  // TIMESTAMP HONESTY: the model sometimes writes template chapter stamps
  // ("3:45", "7:00") straight into the description; a live 75s comic shipped
  // chapters out to 7:00. Strip any line whose timestamp exceeds the runtime.
  const realDur = Number(ctx.store["videoDurationSec"] ?? 0);
  if (realDur > 0) {
    const NL = String.fromCharCode(10);
    description = description
      .split(NL)
      .filter((line) => {
        const m = line.match(/(\d{1,2}):(\d{2})/);
        if (!m) return true;
        const ts = Number(m[1]) * 60 + Number(m[2]);
        if (ts <= realDur + 5) return true;
        ctx.log(`metadata: dropped phantom timestamp line "${line.slice(0, 60)}" (${ts}s > video ${realDur}s)`);
        return false;
      })
      .join(NL)
      .replace(/\n{3,}/g, NL + NL);
  }
  const attributions = ctx.store["attributions"] as string[] | undefined;
  if (attributions && attributions.length) description = `${description}\n\nImage credits:\n${attributions.join("\n")}`;
  return { title, description, tags };
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
    "pinnedComment",
    "titleAlternate",
  ],
  run: async (ctx) => {
    const topic = str(ctx, "topic");
    const plannedTitle = typeof ctx.store["plannedTitle"] === "string"
      ? (ctx.store["plannedTitle"] as string).trim()
      : "";
    if (plannedTitle.length > 100) {
      throw new Error("metadata: claimed plan title exceeds YouTube's 100-character limit");
    }
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

    // Localization: write title/description/tags in the channel's spoken language.
    const language = ctx.params["language"] as string | undefined;
    const LANG_NAMES: Record<string, string> = {
      es: "Spanish", de: "German", fr: "French", pt: "Portuguese", it: "Italian", nl: "Dutch",
    };
    const langDirective =
      language && language !== "en"
        ? `- LANGUAGE: Write the title, description, and tags in ${LANG_NAMES[language] ?? language} ` +
          `(keep proper names/quotes in their original form). Hashtags and keywords should be in that language too.\n`
        : "";

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

    // TITLE-PROMISE CONTRACT: title, thumbnail and the first 15 seconds are ONE
    // promise unit — the title must state the SAME promise/loop the crafted
    // cold open makes (the research's "topic confirmation": the hook confirms
    // the clicked promise, so the title must BE that promise).
    const scriptDoc = ctx.store["script"] as { hook?: string; hookLoop?: string } | undefined;
    const promiseContract =
      scriptDoc?.hook || scriptDoc?.hookLoop
        ? `THE VIDEO'S COLD OPEN (the first thing a clicking viewer hears):\n"${(scriptDoc.hook ?? "").slice(0, 400)}"\n` +
          (scriptDoc.hookLoop ? `Its promise: "${scriptDoc.hookLoop}"\n` : "") +
          `TITLE-PROMISE CONTRACT: the title must state the SAME promise this cold open makes (different ` +
          `words welcome, same contract) — never promise anything the cold open doesn't set up.\n`
        : "";

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
      return { title: plannedTitle || title, description, tags, pinnedComment: "", titleAlternate: "", ...ve };
    }

    // Phase 7: bias titles toward past high-CTR/retention winners ("" until data).
    const perfCtx = await loadPerformanceContext(ctx.keyPrefix);

    // Style-DNA SEO spec — the channel's own research-distilled title formula /
    // description structure (previously generated at inception and never read).
    const dnaSeo = (ctx.store["styleDNA"] as
      | { seo?: { titleFormula?: string; descriptionStructure?: string; playlistStrategy?: string } }
      | null)?.seo;

    // METACRAFT — the engine: live autocomplete evidence + 7 framed candidates
    // (latest Pro) + deterministic lint (claims grounded in the fact-checked
    // script, mobile truncation, register) + feed judge with the title-promise
    // contract. Falls through to the legacy tournament/loop only on failure.
    try {
      const m = await craftMetadata({
        topic,
        channelName,
        niche,
        persona,
        language,
        scriptExcerpt,
        coldOpen: scriptDoc?.hook ?? undefined,
        hookLoop: scriptDoc?.hookLoop ?? undefined,
        quote: (ctx.store["script"] as { closingLine?: string } | undefined)?.closingLine ?? undefined,
        competitorTitles: competitors
          .flatMap((c) => c.topVideos)
          .sort((x, y) => y.views - x.views)
          .slice(0, 12)
          .map((v) => ({ title: v.title, views: v.views })),
        powerWords,
        titleFormula: dnaSeo?.titleFormula,
        descriptionStructure: dnaSeo?.descriptionStructure,
        perfContext: perfCtx || undefined,
        isMusicNiche,
        log: ctx.log,
      });
      let { title, description, tags } = m;
      ({ title, description, tags } = finishMetadata(ctx, { title, description, tags, channelName, nicheIntel }));
      const ve = await viewEstimate(tags);
      ctx.log(`metadata: METACRAFT [${m.frame}] click ${m.clickScore}/10 — "${title.slice(0, 60)}" est=${ve.estimatedViews} (${ve.estimatedViewsSource})`);
      return {
        title: plannedTitle || title,
        description,
        tags,
        pinnedComment: m.pinnedComment,
        titleAlternate: m.titleAlternate,
        ...ve,
      };
    } catch (e) {
      ctx.log(`metadata: metacraft failed (${e instanceof Error ? e.message : e}) — legacy tournament fallback`);
    }

    const dnaSeoClause =
      (dnaSeo?.titleFormula ? `CHANNEL TITLE FORMULA (Style DNA — prefer this shape): ${dnaSeo.titleFormula}\n` : "") +
      (dnaSeo?.descriptionStructure ? `CHANNEL DESCRIPTION STRUCTURE (Style DNA): ${dnaSeo.descriptionStructure}\n` : "");

    // TITLE TOURNAMENT — the comparative path: 5 candidates across DISTINCT
    // high-CTR frames, judged against the niche's REAL top titles WITH their
    // view counts ("would it win the click in this feed"). Iterating a single
    // candidate deadlocked at sub-bar scores; competition against evidence
    // converges. Falls back to the legacy loop on any failure.
    let tournament: { title: string; description: string; tags: string[]; score: number } | null = null;
    if (competitorTitles.length >= 5) {
      try {
        const titlesWithViews = competitors
          .flatMap((c) => c.topVideos)
          .sort((a, b) => b.views - a.views)
          .slice(0, 12)
          .map((v) => `${(v.views / 1e6).toFixed(1)}M views — "${v.title}"`);
        const genSchema = z.object({
          candidates: z.array(z.object({
            frame: z.string(),
            title: z.string(),
            description: z.string(),
            tagsCsv: z.string(),
          })).default([]),
        });
        const gen = await agentJson({
          role: "producer",
          schema: genSchema,
          log: ctx.log,
          maxTokens: 2200,
          temperature: 0.85,
          prompt:
            `Write FIVE complete SEO metadata candidates for a video about "${topic}" on "${channelName}" — ` +
            `one per frame: (1) specific-number, (2) curiosity-gap, (3) contrarian/counterintuitive, ` +
            `(4) how/why-mechanism, (5) stakes/warning.\n` +
            `NICHE: ${niche || "general"} | PERSONA: ${persona || "n/a"}\n` +
            (scriptExcerpt ? `SCRIPT EXCERPT:\n${scriptExcerpt}\n` : "") +
            promiseContract +
            dnaSeoClause +
            (powerWords.length ? `POWER WORDS: ${powerWords.join(", ")}\n` : "") +
            langDirective +
            `Each candidate: title (obey the channel formula above when given; never the channel name; one clear ` +
            `honest promise), description (hook line + ≤60-word paragraph + "Subscribe for more:" CTA + ` +
            `"Keywords: " line + hashtags line), tagsCsv (25-30 comma-separated tags relevant to THIS video).\n` +
            `Return STRICT JSON {"candidates":[{"frame","title","description","tagsCsv"}]}.`,
        });
        const cands = (gen.candidates ?? [])
          .map((c) => ({ ...c, tags: (c.tagsCsv ?? "").split(",").map((t) => t.trim()).filter(Boolean) }))
          .filter((c) =>
            c.title && c.title.length >= 25 && c.title.length <= 100 &&
            c.description && c.description.length >= 40 &&
            (isMusicNiche || !LOFI_LEAK.test(`${c.title} ${c.description}`)),
          );
        if (cands.length >= 3) {
          const judgeSchema = z.object({
            rankings: z.array(z.object({ idx: z.number(), clickScore: z.number(), why: z.string() })).default([]),
            winner: z.number().optional(),
          });
          const judged = await agentJson({
            role: "director",
            schema: judgeSchema,
            log: ctx.log,
            maxTokens: 1200,
            temperature: 0.3,
            system: "You are the DIRECTOR: a YouTube CTR strategist judging a real feed. Return ONLY JSON.",
            prompt:
              `THE FEED — this niche's top performers (real views):\n${titlesWithViews.join("\n")}\n\n` +
              `CANDIDATE TITLES for "${topic}":\n` +
              cands.map((c, i) => `${i + 1}. [${c.frame}] ${c.title}`).join("\n") +
              (promiseContract ? `\n\n${promiseContract}` : "") +
              `\n\nScore each candidate 1-10: would it WIN the click placed in this exact feed (against those ` +
              `titles), while staying honest, on the channel formula${dnaSeoClause ? " given above" : ""}` +
              `${promiseContract ? ", AND keeping the title-promise contract (a title whose promise the cold open doesn't confirm bleeds retention)" : ""}? ` +
              `Penalize hype that breaks a premium register. Return STRICT JSON ` +
              `{"rankings":[{"idx":1-based,"clickScore":1-10,"why":string}],"winner":1-based}.`,
          });
          const wIdx = Math.min(cands.length - 1, Math.max(0, (judged.winner ?? 1) - 1));
          const wScore = (judged.rankings ?? []).find((r) => (r.idx ?? 0) - 1 === wIdx)?.clickScore ?? 0;
          tournament = {
            title: cands[wIdx].title.trim(),
            description: cands[wIdx].description.trim(),
            tags: cands[wIdx].tags,
            score: wScore / 10,
          };
          ctx.log(
            `metadata TOURNAMENT: ${cands.length} frames judged vs ${titlesWithViews.length} real top titles → ` +
            `winner [${cands[wIdx].frame}] ${wScore}/10: "${tournament.title.slice(0, 70)}"`,
          );
        }
      } catch (e) {
        ctx.log(`metadata tournament failed (legacy loop): ${e instanceof Error ? e.message : e}`);
      }
    }

    // Producer ↔ Director SEO loop: niche-aware, script-grounded, high-CTR.
    const loop = tournament ? null : await produceAndCritique<{
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
            promiseContract +
            (competitorTitles.length ? `TOP COMPETITOR TITLES:\n${competitorTitles.join("\n")}\n` : "") +
            (powerWords.length ? `POWER WORDS: ${powerWords.join(", ")}\n` : "") +
            (databank?.titleTemplates?.length ? `TITLE TEMPLATES:\n${databank.titleTemplates.join("\n")}\n` : "") +
            (perfCtx ? perfCtx + "\n" : "") +
            dnaSeoClause +
            `RULES:\n` +
            // The channel's own DNA title formula is AUTHORITATIVE when present —
            // appending it under contradictory generic rules (60-90 chars +
            // "(NICHE) in caps" vs the DNA's "<60 chars, no all-caps") deadlocked
            // the producer↔Director loop at sub-bar scores forever.
            (dnaSeo?.titleFormula
              ? `- title: FOLLOW THE CHANNEL TITLE FORMULA above EXACTLY — its length/case/shape constraints WIN ` +
                `over any generic advice. Front-load the PRIMARY KEYWORD, use a CURIOSITY GAP (show the WHAT, hide ` +
                `the HOW), address the viewer with "you" where natural, ONE clear promise per title. ` +
                `NEVER promise something the video doesn't deliver. Do NOT include the channel name ("${channelName}").\n`
              : `- title: 60-90 characters (aim LONG — 70-100 char titles earn +10-14% CTR; no fluff). Front-load the ` +
                `PRIMARY KEYWORD in the first ~40 chars. Strongly prefer a NUMBER/LIST framing when the topic suits it ` +
                `(e.g. "9 Keys to …", "7 Daily Habits …"), put the NICHE in caps in parentheses near the end, and append ` +
                `"| <relevant figure>" when one fits. ` +
                `Use a CURIOSITY GAP (show the WHAT, hide the HOW — +CTR), address the viewer with "you" where natural ` +
                `(personal pronouns lift CTR), and lean on a proven high-CTR frame: specific-number list, curiosity gap, ` +
                `transformation promise, warning ("…That Kill…"), versus, or "Why …". An end bracket like "(Explained)" / ` +
                `"[2026]" can add a click. ONE clear promise per title. ` +
                `NEVER promise something the video doesn't deliver. Do NOT include the channel name ("${channelName}").\n`) +
            `- description: SEO-RICH but NOT the script. Structure exactly: (1) 2-3 punchy emotional HOOK lines, with ` +
            `the PRIMARY KEYWORD worked into the VERY FIRST sentence (above-the-fold text is weighted most by search); ` +
            `(2) ONE short paragraph (≤60 words) summarizing the value; (3) a "Subscribe for more:" call-to-action ` +
            `line; (4) a line starting "Keywords: " with 14-20 comma-separated SEO keywords/phrases; (5) a final ` +
            `line of 8-12 relevant #hashtags. Do NOT paste the script, transcript, narration, or quotes.\n` +
            `- tags: 25-30 relevant tags (include the niche, the key figures/entities THIS video actually mentions, ` +
            `and long-tail phrases).\n` +
            `- MATCH THE NICHE. Do NOT use "lofi" / "beats to relax / study" / study-music framing unless the niche actually IS lofi/study/ambient music.\n` +
            langDirective +
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
        if (cand.title.length > 100) issues.push(`title ${cand.title.length} chars > 100 (YouTube hard limit)`);
        if (cand.title.length < 30) issues.push(`title ${cand.title.length} chars — too short (aim 60-90)`);
        // hook + one short paragraph: enforce a sane floor AND ceiling so the
        // model never dumps the script into the description.
        const descNoTags = cand.description.replace(/#\w+/g, "").trim();
        if (descNoTags.length < 40) issues.push("description too short (need hook + paragraph + CTA + keywords)");
        if (descNoTags.length > 1800) issues.push("description too long — trim toward the structured SEO template (no script/transcript)");
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

    let { title, description, tags } = tournament ?? loop!.value;
    ({ title, description, tags } = finishMetadata(ctx, { title, description, tags, channelName, nicheIntel }));

    const ve = await viewEstimate(tags);
    ctx.log(
      `metadata: title="${title.slice(0, 60)}…" (${tournament ? `tournament ${(tournament.score * 10).toFixed(0)}/10` : `score=${loop!.critique.score.toFixed(2)}, accepted=${loop!.accepted}`}) est=${ve.estimatedViews} (${ve.estimatedViewsSource})`,
    );
    return { title: plannedTitle || title, description, tags, pinnedComment: "", titleAlternate: "", ...ve };
  },
};

/* -------------------------- 3. thumbnail_gen ---------------------------- */

/**
 * Explicit draft preview only. This is deliberately free, visibly labelled,
 * and marked nonpublishable; it is never an automatic recovery path.
 */
async function draftTitleCardPreview(ctx: StageContext): Promise<{ thumbnailKey: string; costUsd: 0 }> {
  const channelName = (ctx.store["channelName"] as string | undefined) ?? "Lofi";
  const topic = (ctx.store["topic"] as string | undefined) ?? "";
  const tmp = await makeRunTempDir(ctx.runId);
  const outJpg = join(tmp, "thumbnail.jpg");
  const base = await solidImage(join(tmp, "thumb_base.jpg"), 1_280, 720, "#172033");
  const seoTitle = ((ctx.store["title"] as string | undefined) ?? topic ?? channelName).split(/[:|]/)[0].trim();
  const cardTitle = seoTitle.length > 34 ? seoTitle.slice(0, 34).replace(/\s+\S*$/, "") : seoTitle;
  await titleCard({
    basePath: base,
    outJpg,
    title: cardTitle || channelName,
    subtitle: `DRAFT PREVIEW — ${channelName}`,
  });
  const thumbnailKey = `${ctx.keyPrefix}runs/${ctx.runId}/thumbnail.jpg`;
  await putObject(thumbnailKey, await readBytes(outJpg), { contentType: "image/jpeg" });
  await recordAsset(ctx, "thumbnail", thumbnailKey, {
    strategy: "draft_preview_placeholder",
    publishable: false,
    thumbnailTitle: channelName,
  });
  return { thumbnailKey, costUsd: 0 };
}

export const thumbnailGen: Block = {
  id: "thumbnail_gen",
  consumes: ["title"],
  // `strategy` feeds the thumbnail learning loop (which path produced the
  // shipped thumbnail); every return path below must include it.
  produces: ["thumbnailKey", "strategy", "thumbnailPublishable"],
  paid: true,
  run: async (ctx) => {
    const quality = qualityProfile(ctx.params["qualityProfile"]);
    const title = str(ctx, "title");
    const thumbnailer =
      (ctx.store["thumbnailer"] as string | undefined) ??
      (ctx.params["thumbnailer"] as string | undefined) ??
      "banana";
    const niche = (ctx.store["niche"] as string | undefined) ?? "";
    // P1-17: the channel's durable lane calibrates how hard the critique loop
    // pushes (iteration cap + what the critic is told to scrutinise).
    const laneKey = typeof (ctx.store["contentLane"] as { key?: unknown } | null)?.key === "string"
      ? String((ctx.store["contentLane"] as { key?: unknown }).key)
      : undefined;
    const laneQuality = laneQualityPolicy(ctx.store["contentLane"]);
    let nanoBananaImageCostUsd = 0;
    let checkpointGenerationCostUsd = 0;
    let checkpointQaCostUsd = 0;
    const observedConceptCost = (): number =>
      accountedModelUsageCost(ctx, ["text"], PRICE.thumbnailConceptUsd);
    const observedImageCost = (): number =>
      ctx.imageUsageAccounting?.().costUsd ?? nanoBananaImageCostUsd;
    const observedQaCost = (): number =>
      accountedModelUsageCost(ctx, ["vision"], PRICE.visionGraderUsd);
    const thumbnailCost = (extraCostUsd = 0): number =>
      Math.max(
        checkpointGenerationCostUsd,
        observedImageCost() + observedConceptCost(),
      ) + Math.max(checkpointQaCostUsd, observedQaCost()) + Math.max(0, extraCostUsd);

    try {

    // CHANNEL GROUNDING that previously never reached generation:
    //  - styleDNA.thumbnail — the research-distilled per-channel thumbnail spec
    //    (subject/composition/textRule/contrast-pushed palette);
    //  - seoDatabank.thumbnailRules — imperative rules scraped from top
    //    performers in the niche;
    //  - competitor thumbnail URLs — the actual reference images the candidate
    //    must rival (used in the QA comparison below).
    type DnaLite = {
      thumbnail?: { composition?: string; textRule?: string; palette?: string[]; subject?: string };
      palette?: string[];
      recurringSubject?: string;
      setting?: string;
      colorGrade?: string;
    };
    const dna = (ctx.store["styleDNA"] as DnaLite | null) ?? null;
    const dnaThumb = dna?.thumbnail;
    const thumbnailRules = (
      (ctx.store["seoDatabank"] as { thumbnailRules?: string[] } | null)?.thumbnailRules ?? []
    ).filter((r) => typeof r === "string").slice(0, 8);
    const referenceThumbs = (
      (ctx.store["competitors"] as { topVideos?: { views?: number; thumbnailUrl?: string }[] }[] | null) ?? []
    )
      .flatMap((c) => c.topVideos ?? [])
      .filter((v) => typeof v.thumbnailUrl === "string" && (v.thumbnailUrl as string).length > 0)
      .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
      .slice(0, 4)
      .map((v) => v.thumbnailUrl as string);
    const qaBrandContext = dnaThumb || dna?.recurringSubject || thumbnailRules.length
      ? {
          subject: dnaThumb?.subject || dna?.recurringSubject || undefined,
          composition: dnaThumb?.composition,
          textRule: dnaThumb?.textRule,
          palette: dnaThumb?.palette?.length ? dnaThumb.palette : dna?.palette,
          setting: dna?.setting,
          colorGrade: dna?.colorGrade,
          nicheResearchRules: thumbnailRules,
        }
      : null;

    const channelDoc = await loadChannel(ctx);
    // The generic card is an explicit UI preview, never a provider/gate
    // fallback. Production stops before creating or uploading it.
    if (thumbnailer === "title_card") {
      assertThumbnailStrategy(quality, "draft_preview_placeholder");
      const preview = await draftTitleCardPreview(ctx);
      return {
        thumbnailKey: preview.thumbnailKey,
        strategy: "draft_preview_placeholder",
        thumbnailPublishable: false,
        [COST_PATCH_KEY]: thumbnailCost(preview.costUsd),
      };
    }

    const fullDna = (
      (ctx.store["styleDNA"] as import("@/engine/creative/types").StyleDNA | null | undefined) ??
      (channelDoc as { styleDNA?: import("@/engine/creative/types").StyleDNA } | null)?.styleDNA ??
      null
    );
    const resolved = resolveGoldenThumbnailPlaybook({
      storedPlaybook: (channelDoc as { thumbnailPlaybook?: ThumbnailPlaybook } | null)?.thumbnailPlaybook,
      dna: fullDna,
      family: String(ctx.store["family"] ?? (channelDoc as { family?: string } | null)?.family ?? ""),
      channelName: String(ctx.store["channelName"] ?? channelDoc?.name ?? "channel"),
    });
    const playbook = resolved.playbook;
    const strategy = resolved.strategy;
    if (strategy === "style_dna_foundation") {
      ctx.log("thumbnail_gen: built the missing playbook from the channel's Style DNA");
    }
    const selected = selectGoldenThumbnailPattern({
      playbook,
      seed: ctx.runId,
      patternBias: ctx.params["patternBias"] as string[] | undefined,
    });
    const { pattern, patternIndex: idx } = selected;
    const energyOverride = ctx.params["thumbEnergy"] as "spectacle" | "bold" | "cozy_pop" | undefined;
    const effectivePlaybook = energyOverride ? { ...playbook, energy: energyOverride } : playbook;

    const scriptHint = String(ctx.store["narrationText"] ?? "").slice(0, 500);

    // ── PRODUCE → CRITIQUE → REGENERATE (P1-3) ───────────────────────────────
    // The thumbnail is the highest-CTR-leverage asset in the run and used to be
    // generated exactly once, graded post-hoc, and shipped regardless. It now
    // runs on the shared `produceAndCritique` primitive: a rejected candidate is
    // regenerated with the grader's concrete defects fed back into the art
    // direction.
    //
    // Cost safety (this block is `paid: true`):
    //   - Each iteration carries its OWN requestHash (the iteration index and
    //     the prior defects are part of the hash), so it gets its own immutable
    //     checkpoint. A retry/self-heal replay re-reads those checkpoints and
    //     re-purchases NOTHING — which is exactly why the healer's
    //     "thumbnail missing" rule stays safe.
    //   - A second iteration only happens when QA actually RAN and REJECTED the
    //     candidate. A grader outage stops the loop rather than blind-spending.
    //   - Default cap is 2 (at most ONE regenerate), operator-overridable via
    //     the `thumbnailCritiqueIters` param.
    const criticDoctrine = typeof ctx.store["criticDoctrine"] === "string"
      ? (ctx.store["criticDoctrine"] as string)
      : undefined;
    const thumbnailChannel: ChannelCritiqueContext = {
      ...(ctx.store["channelName"] ? { channelName: String(ctx.store["channelName"]) } : {}),
      ...(ctx.store["persona"] ? { persona: String(ctx.store["persona"]) } : {}),
      ...(criticDoctrine ? { criticDoctrine } : {}),
      ...(laneKey ? { contentLaneKey: laneKey } : {}),
      laneEmphasis: laneQuality.emphasis,
    };
    const requestedIters = Number(ctx.params["thumbnailCritiqueIters"]);
    const maxThumbnailIters = Number.isFinite(requestedIters) && requestedIters >= 1
      ? Math.min(3, Math.floor(requestedIters))
      : Math.min(2, laneQuality.maxCritiqueIters);

    interface ThumbnailAttempt {
      outJpg: string;
      requestHash: string;
      refQA: ThumbnailGateVerdict | null;
      providerEvidence?: ThumbnailNanoBananaEvidence;
    }

    const attemptLoop = await produceAndCritique<ThumbnailAttempt>({
      label: "thumbnail_gen",
      threshold: 1,
      maxIters: maxThumbnailIters,
      log: (message) => ctx.log(message),
      channel: thumbnailChannel,
      produce: async (priorIssues, iter): Promise<ThumbnailAttempt> => {
        const requestHash = thumbnailRequestHash({
          contract: "thumbnail-gen-checkpoint-v4-nano-banana-only",
          title,
          scriptHint,
          sceneMandate: dnaThumb?.subject,
          pattern,
          playbook: effectivePlaybook,
          patternIndex: idx,
          providerRoute: NANO_BANANA_THUMBNAIL_PROFILE,
          // Iteration identity: without these two, a regenerate would re-read
          // the previous rejected candidate's checkpoint and change nothing.
          critiqueIteration: iter,
          critiqueIssues: priorIssues,
          ...(criticDoctrine ? { criticDoctrine } : {}),
        });
        const tmp = await makeRunTempDir(ctx.runId, `thumbnail-${requestHash.slice(0, 20)}`);
        const outJpg = join(tmp, "thumbnail.jpg");
        const nanoBananaRequestContext = thumbnailNanoBananaRequestContext({
          keyPrefix: ctx.keyPrefix,
          runId: ctx.runId,
          requestHash,
        });
        let checkpoint = await openThumbnailCheckpoint({
          checkpointRoot: `${ctx.keyPrefix}runs/${ctx.runId}/thumbnail-checkpoints`,
          requestHash,
          localImagePath: outJpg,
          beforeClaim: () => {
            if (!hasGeminiKey()) {
              throw new Error("thumbnail_gen: no configured concept provider");
            }
            if (!hasNanoBanana()) {
              throw new Error("thumbnail_gen: Nano Banana is not configured");
            }
            if (quality === "production" && !hasVisionKey()) {
              throw new Error("thumbnail_gen: no configured production QA provider");
            }
          },
        });

        if (checkpoint.manifest) {
          if (
            (checkpoint.manifest.version !== 2 || !checkpoint.manifest.providerEvidence)
          ) {
            throw new Error(
              "thumbnail_gen: generated Nano Banana checkpoint is missing durable provider evidence",
            );
          }
          checkpointGenerationCostUsd += checkpoint.manifest.generationCostUsd;
          ctx.log(
            `thumbnail_gen: reused ${checkpoint.source} paid candidate checkpoint ${requestHash.slice(0, 12)}`,
          );
        } else {
          checkpoint = await beginThumbnailPaidWork(checkpoint);
          let nanoBananaProviderEvidence: ThumbnailNanoBananaEvidence | undefined;
          const generateScene = async (
            request: import("@/lib/thumbnailRenderer").ThumbnailImageRequest,
          ): Promise<Buffer> => {
            const generated = await generateNanoBananaImageWithReceipt({
              prompt: request.prompt,
              aspectRatio: request.aspectRatio,
              maxProviderAttempts: 1,
              idempotencyContext: nanoBananaRequestContext,
            });
            nanoBananaImageCostUsd += generated.receipt.costUsd;
            nanoBananaProviderEvidence = {
              version: "thumbnail-nano-banana-evidence/v1",
              requestContext: nanoBananaRequestContext,
              receipt: generated.receipt,
            };
            return generated.bytes;
          };
          const spentBefore = observedImageCost() + observedConceptCost();
          await renderCandidate({
            pattern,
            title,
            scriptHint,
            playbook: effectivePlaybook,
            outJpg,
            tmpDir: tmp,
            idx,
            generateScene,
            log: ctx.log,
            ...(dnaThumb?.subject ? { sceneMandate: dnaThumb.subject } : {}),
            ...(priorIssues.length ? { priorIssues } : {}),
            ...(criticDoctrine ? { criticDoctrine } : {}),
          });
          // Persist THIS iteration's authoritative generation spend: the exact
          // concept token usage plus the actual image counter delta. The local
          // manifest is written before R2, so a storage retry on this worker
          // cannot re-purchase.
          const iterationSpend = Math.max(0, observedImageCost() + observedConceptCost() - spentBefore);
          checkpointGenerationCostUsd += iterationSpend;
          checkpoint = await saveThumbnailGenerationCheckpoint(
            checkpoint,
            iterationSpend,
            nanoBananaProviderEvidence,
          );
        }

        // One post-render alarm per candidate. It can block publishing and it
        // now feeds the regenerate; it never starts another paid RENDERER or
        // swaps in a generic card.
        const qaRequestHash = thumbnailRequestHash({
          contract: "thumbnail-mobile-reference-qa-v2-exact-accounting",
          candidateRequestHash: requestHash,
          quality,
          title,
          niche,
          qaBrandContext,
          playbookRules: effectivePlaybook.rules,
          playbookAvoid: effectivePlaybook.avoid,
          referenceThumbs,
        });
        let refQA: ThumbnailGateVerdict | null;
        const cachedQa = checkpoint.manifest?.qa;
        if (cachedQa?.completed && cachedQa.requestHash === qaRequestHash) {
          checkpointQaCostUsd += cachedQa.costUsd;
          if (cachedQa.verdict === null) {
            refQA = null;
          } else {
            const verdict = cachedQa.verdict as Partial<ThumbnailGateVerdict> | undefined;
            if (
              !verdict ||
              typeof verdict.textOk !== "boolean" ||
              typeof verdict.faceClear !== "boolean" ||
              !Number.isFinite(verdict.punch) ||
              !Number.isFinite(verdict.styleMatch) ||
              !Number.isFinite(verdict.storyMatch) ||
              typeof verdict.uiClean !== "boolean" ||
              typeof verdict.reason !== "string"
            ) {
              throw new Error("thumbnail_gen: cached QA verdict is invalid");
            }
            refQA = verdict as ThumbnailGateVerdict;
          }
          ctx.log("thumbnail_gen: reused checkpointed mobile/reference QA verdict");
        } else {
          const qaSpentBefore = observedQaCost();
          try {
            refQA = await runThumbnailMobileReferenceQa({
              outJpg,
              tmpDir: tmp,
              title,
              niche,
              playbook: effectivePlaybook,
              referenceUrls: referenceThumbs,
              brandContext: qaBrandContext,
              log: ctx.log,
            });
          } catch (error) {
            ctx.log(
              `thumbnail_gen: reference/mobile QA errored: ${error instanceof Error ? error.message : error}`,
            );
            refQA = null;
          }
          const iterationQaSpend = Math.max(0, observedQaCost() - qaSpentBefore);
          checkpointQaCostUsd += iterationQaSpend;
          checkpoint = await saveThumbnailQaCheckpoint(checkpoint, {
            requestHash: qaRequestHash,
            verdict: refQA,
            costUsd: iterationQaSpend,
          });
        }
        const providerEvidence = checkpoint.manifest?.version === 2
          ? checkpoint.manifest.providerEvidence
          : undefined;
        return {
          outJpg,
          requestHash,
          refQA,
          ...(providerEvidence ? { providerEvidence } : {}),
        };
      },
      critique: async (attempt, iter) => {
        const verdict = attempt.refQA;
        if (!verdict) {
          // Grader outage. Regenerating cannot help (the next candidate would be
          // ungraded too) and would burn another paid image, so stop here. On
          // iteration 1 this reproduces the historic single-shot behaviour
          // exactly; a later outage scores 0 so the earlier GRADED candidate
          // wins best-selection. Production still fails closed below at
          // `assertThumbnailGate`, which is the real gate.
          return { score: iter === 1 ? 1 : 0, pass: true, issues: [] };
        }
        if (thumbnailGatePassed(verdict)) return { score: 1, pass: true, issues: [] };
        const numeric = (verdict.punch + verdict.styleMatch + verdict.storyMatch) / 30;
        const booleans = [verdict.textOk, verdict.faceClear, verdict.uiClean].filter(Boolean).length / 3;
        const issues = [
          verdict.reason,
          verdict.textOk ? "" : "the headline text is broken, misspelled, or unreadable at mobile size",
          verdict.faceClear ? "" : "the text or a graphic covers the subject's face / hero artwork",
          verdict.uiClean ? "" : "content sits under the YouTube duration chip or other player UI",
          verdict.punch >= 7 ? "" : `visual punch scored ${verdict.punch}/10 — the frame is not arresting enough in a feed`,
          verdict.styleMatch >= 7 ? "" : `style match scored ${verdict.styleMatch}/10 — it is off this channel's visual world`,
          verdict.storyMatch >= 7 ? "" : `story match scored ${verdict.storyMatch}/10 — the image does not enact the video's topic`,
        ].map((issue) => String(issue ?? "").trim()).filter(Boolean).slice(0, 6);
        ctx.log(
          `thumbnail_gen: candidate ${iter} REJECTED by the grader (${verdict.reason.slice(0, 120)})` +
          (iter < maxThumbnailIters ? " — regenerating with the defects fed back" : " — iteration cap reached"),
        );
        // `pass:false` is authoritative; the score only ranks attempts so the
        // best near-miss ships if no candidate ever clears the bar.
        return { score: 0.5 * numeric + 0.5 * booleans, pass: false, issues };
      },
    });

    const winner = attemptLoop.value;
    const outJpg = winner.outJpg;
    const requestHash = winner.requestHash;
    const refQA = winner.refQA;
    ctx.log(
      `thumbnail_gen: critique loop finished after ${attemptLoop.iterations} candidate(s) ` +
      `(${attemptLoop.accepted ? "accepted" : "best of the rejected set"})`,
    );
    assertThumbnailGate(quality, refQA, `${strategy} candidate`);
    const passed = refQA !== null && thumbnailGatePassed(refQA);
    const publishable = quality === "production" ? true : passed;
    const finalStrategy = publishable ? strategy : "playbook_belowbar";
    const thumbnailKey = `${ctx.keyPrefix}runs/${ctx.runId}/thumbnail.jpg`;
    const providerEvidence = winner.providerEvidence;
    await putObject(thumbnailKey, await readBytes(outJpg), {
      contentType: "image/jpeg",
      metadata: {
        "thumbnail-request-sha256": requestHash,
        ...(providerEvidence ? {
          "thumbnail-provider-request-sha256": providerEvidence.receipt.providerRequestSha256,
          "thumbnail-provider-response-sha256": providerEvidence.receipt.responseSha256,
          "thumbnail-provider-route": providerEvidence.receipt.route,
        } : {}),
      },
    });
    await recordAsset(ctx, "thumbnail", thumbnailKey, {
      strategy: finalStrategy,
      pattern: pattern.name,
      publishable,
      thumbnailTitle: title,
      providerRoute: providerEvidence?.receipt.route ?? "verified-video-still",
      providerRequestSha256: providerEvidence?.receipt.providerRequestSha256,
      providerResponseSha256: providerEvidence?.receipt.responseSha256,
    });
    ctx.log(
      `thumbnail_gen: ${finalStrategy} thumbnail rendered${refQA ? ` — ref QA: ${refQA.reason}` : " (draft, unverified)"}`,
    );
    return {
      thumbnailKey,
      strategy: finalStrategy,
      thumbnailPublishable: publishable,
      [COST_PATCH_KEY]: thumbnailCost(),
    };
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      Object.assign(failure, { observedCostUsd: thumbnailCost() });
      throw failure;
    }
  },
};

/** All intelligence blocks (registration order). */
export const intelligenceBlocks: Block[] = [
  competitorResearch,
  metadataOptimized,
  thumbnailGen,
];
