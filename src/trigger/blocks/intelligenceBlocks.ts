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
 *   thumbnail_gen       → BANANA thumbnail (playbook or DNA-direct brief →
 *                         one-pass Nano Banana Pro → vision judge + retry),
 *                         real-scene overlay for keyframe channels, title_card
 *                         only as explicit operator choice. Produces
 *                         `thumbnailKey`; failure is LOUD (heal loop retries).
 */
import type { Block, StageContext } from "@/engine/types";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { makeRunTempDir, downloadTo, readBytes, writeBytes } from "@/lib/files";
import { putObject, getObjectBytes } from "@/lib/storage";
import { titleCard, thumbnailText, imageToJpeg, solidImage } from "@/lib/ffmpeg";
import { generateFluxImage } from "@/lib/replicate";
import { hasBanana } from "@/lib/banana";
import { generateKeyframe } from "@/lib/higgsfield";
import { resolveThumbnailStyle, styleFromDNA, shortTitleFallback } from "@/lib/thumbnailFormula";
import { claudeJson, hasAnthropicKey } from "@/lib/anthropic";
import { geminiVisionLocal, parseJsonLoose, hasGeminiKey } from "@/lib/gemini";
import { agentJson } from "@/agents/mastra";
import { produceAndCritique } from "@/engine/critiqueLoop";
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
      return { title, description, tags, ...ve };
    }

    // Phase 7: bias titles toward past high-CTR/retention winners ("" until data).
    const perfCtx = await loadPerformanceContext(ctx.keyPrefix);

    // Style-DNA SEO spec — the channel's own research-distilled title formula /
    // description structure (previously generated at inception and never read).
    const dnaSeo = (ctx.store["styleDNA"] as
      | { seo?: { titleFormula?: string; descriptionStructure?: string; playlistStrategy?: string } }
      | null)?.seo;
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
    // Deterministically strip the channel name from the title (it's the channel,
    // not part of the video title) — handles separators like "… | Channel".
    if (channelName && channelName !== "this channel") {
      const esc = channelName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      title = title
        .replace(new RegExp(`\\s*[|\\-–—:•]\\s*${esc}\\s*$`, "i"), "")
        .replace(new RegExp(`^\\s*${esc}\\s*[|\\-–—:•]\\s*`, "i"), "")
        .replace(new RegExp(`\\b${esc}\\b`, "gi"), "")
        .replace(/\s{2,}/g, " ")
        .replace(/\s*[|\-–—:•]\s*$/, "")
        .trim();
    }
    // Merge tags: curated subcategory SEED tags first (the v1 catalog defaults),
    // then the AI tags, then live niche tags. Dedup, cap 30; never ship empty.
    // BANNED-WORD FILTER: the niche catalog's seed tags can contradict the
    // channel's own identity (Investory's bible bans "hustle" while its finance
    // seed tags included "side hustle"/"make money online") — every tag source
    // is screened against identity.bannedWords.
    const bannedWords = ((ctx.store["bannedWords"] as string[] | undefined) ?? [])
      .map((w) => w.toLowerCase().trim())
      .filter(Boolean);
    const notBanned = (t: string) => !bannedWords.some((w) => t.toLowerCase().includes(w));
    const baseTags = (Array.isArray(ctx.params["baseTags"]) ? (ctx.params["baseTags"] as unknown[]) : [])
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0);
    const nicheTags = (nicheIntel?.topTags ?? []).map((t) => t.tag);
    const dropped = [...baseTags, ...nicheTags].filter((t) => !notBanned(t));
    if (dropped.length) ctx.log(`metadata: dropped banned-word tags: ${dropped.join(", ")}`);
    tags = Array.from(new Set([...baseTags, ...tags, ...nicheTags].filter(notBanned))).slice(0, 30);
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
      `metadata: title="${title.slice(0, 60)}…" (${tournament ? `tournament ${(tournament.score * 10).toFixed(0)}/10` : `score=${loop!.critique.score.toFixed(2)}, accepted=${loop!.accepted}`}) est=${ve.estimatedViews} (${ve.estimatedViewsSource})`,
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

/** Base-image fallback when fal.ai is unavailable: gpt_image_2 → Replicate Flux. */
async function fallbackBase(ctx: StageContext, basePrompt: string): Promise<string> {
  try {
    const r = await generateKeyframe({
      model: "gpt_image_2",
      prompt: basePrompt,
      aspectRatio: "16:9",
      resolution: "2k",
    });
    if (!r.url) throw new Error("gpt_image_2 returned no url");
    ctx.log("thumbnail_gen: base via gpt_image_2 (Higgsfield)");
    return r.url;
  } catch (e) {
    ctx.log(`thumbnail_gen: gpt_image_2 failed (${e instanceof Error ? e.message : e}) — Replicate Flux fallback`);
    return generateFluxImage({ prompt: basePrompt, aspectRatio: "16:9" });
  }
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
      "banana";
    const niche = (ctx.store["niche"] as string | undefined) ?? "";

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
    const dnaSpecClause =
      dnaThumb || dna?.recurringSubject
        ? `Channel Style-DNA thumbnail spec (FOLLOW IT — this is the locked brand): ${JSON.stringify({
            subject: dnaThumb?.subject || dna?.recurringSubject || undefined,
            composition: dnaThumb?.composition,
            textRule: dnaThumb?.textRule,
            palette: dnaThumb?.palette?.length ? dnaThumb.palette : dna?.palette,
            setting: dna?.setting,
            colorGrade: dna?.colorGrade,
          })}.\n`
        : "";
    const rulesClause = thumbnailRules.length
      ? `Niche thumbnail rules (scraped from this niche's top performers): ${thumbnailRules.join("; ")}.\n`
      : "";
    // Self-heal guidance: when the healer re-runs this block over a QA defect,
    // the defect text steers the regeneration instead of rolling the same dice.
    const healHints = ((ctx.store["healHints"] as Record<string, string[]> | undefined)?.["thumbnail_gen"] ?? []);
    const healClause = healHints.length
      ? `PREVIOUS ATTEMPT WAS REJECTED BY QA FOR: ${healHints.join("; ")} — the new design MUST fix this.\n`
      : "";

    /**
     * REFERENCE + MOBILE QA — the missing half of validation: (1) downscale the
     * candidate to real browse-strip size (~168px) and check legibility there,
     * (2) judge it SIDE-BY-SIDE against the scraped top competitor thumbnails.
     * Returns null when it can't run (no key/refs) — never blocks on infra.
     */
    const referenceMobileQA = async (
      tmp: string,
      outJpg: string,
    ): Promise<{ pass: boolean; reason: string } | null> => {
      if (!hasGeminiKey()) return null;
      try {
        const mobileJpg = join(tmp, "thumb_mobile.jpg");
        await imageToJpeg(outJpg, mobileJpg, 168, 94);
        const refPaths: string[] = [];
        for (let i = 0; i < referenceThumbs.length; i++) {
          try {
            refPaths.push(await downloadTo(referenceThumbs[i], join(tmp, `ref_${i}.jpg`)));
          } catch { /* unreachable reference — skip it */ }
        }
        const raw = await geminiVisionLocal({
          prompt:
            `Image 1 is a CANDIDATE YouTube thumbnail rendered at real mobile browse size (~168px wide). ` +
            (refPaths.length
              ? `Images 2-${refPaths.length + 1} are thumbnails of the TOP-PERFORMING videos in the same niche (the bar to beat). `
              : "") +
            `Video title: "${title}"${niche ? `, niche: ${niche}` : ""}. Judge the candidate:\n` +
            `(1) Is every word of overlay text still easily readable at THIS size?\n` +
            `(2) Does it have a single clear focal subject that reads instantly at this size?\n` +
            (refPaths.length
              ? `(3) Placed next to the reference thumbnails in a browse feed, would it hold its own or look amateur? Rate competitiveness 1-10.\n`
              : `(3) Rate overall click-appeal 1-10.\n`) +
            `Return ONLY JSON {"legible":true|false,"focal":true|false,"score":1-10,"reason":"..."}.`,
          imagePaths: [mobileJpg, ...refPaths],
          json: true,
          maxTokens: 250,
        });
        const v = parseJsonLoose<{ legible?: boolean; focal?: boolean; score?: number; reason?: string }>(raw);
        const pass = v.legible !== false && v.focal !== false && (typeof v.score !== "number" || v.score >= 6);
        return { pass, reason: `${v.reason ?? ""} (score ${v.score ?? "?"})` };
      } catch (e) {
        ctx.log(`thumbnail_gen: reference/mobile QA errored (skipping): ${e instanceof Error ? e.message : e}`);
        return null;
      }
    };

    // Resolve the channel's locked thumbnail STYLE (brand consistency). Source:
    // explicit param → channel.identity.thumbnailStyle → archetype template
    // letter (A/B/C/D/E) → generic default. Used by the real-scene path below.
    const channelDoc = await loadChannel(ctx);
    const explicitStyleKey =
      (ctx.params["thumbnailStyle"] as string | undefined) ??
      (channelDoc?.identity as { thumbnailStyle?: string } | undefined)?.thumbnailStyle;
    const styleKey =
      explicitStyleKey ??
      (channelDoc as { template?: string } | null)?.template ??
      undefined;
    let style = resolveThumbnailStyle(styleKey);
    // STYLE DNA WINS over the template-letter preset: every template-A channel
    // used to inherit the stoic marble bust regardless of what it was about.
    // An explicit per-channel thumbnailStyle still overrides everything.
    // (Shared styleFromDNA — the SAME source the week-ahead planner uses.)
    if (!explicitStyleKey) {
      const dnaStyle = styleFromDNA(dna);
      if (dnaStyle) {
        style = dnaStyle;
        ctx.log(`thumbnail_gen: style derived from Style DNA (template preset "${styleKey ?? "?"}" overridden)`);
      }
    }

    // PLAYBOOK PATH — the Thumbnail Lab's distilled patterns (evidence-derived
    // rules from VERIFIED high-view references + Remotion typography). Patterns
    // rotate per run for anti-repetition; the comparative reference QA still
    // gates the result. Falls through to the legacy paths on any failure.
    const playbook = (channelDoc as { thumbnailPlaybook?: import("@/lib/thumbnailLab").ThumbnailPlaybook } | null)
      ?.thumbnailPlaybook;
    if (playbook?.patterns?.length && hasBanana() && thumbnailer !== "title_card") {
      try {
        const { renderCandidate } = await import("@/lib/thumbnailLab");
        const tmp = await makeRunTempDir(ctx.runId);
        // Deterministic per-run rotation (no Math.random in resumable runs).
        // patternBias (architect knob): rotate within the favored subset.
        const bias = (ctx.params["patternBias"] as string[] | undefined)?.filter((n) =>
          playbook.patterns.some((p) => p.name === n),
        );
        const pool = bias?.length ? playbook.patterns.filter((p) => bias.includes(p.name)) : playbook.patterns;
        const idx = [...ctx.runId].reduce((s, c) => s + c.charCodeAt(0), 0) % pool.length;
        const pattern = pool[idx];
        const outJpg = join(tmp, "thumbnail.jpg");
        const scriptHint = String(ctx.store["narrationText"] ?? "").slice(0, 500);
        // Architect's per-channel energy override (param beats playbook tier).
        const energyOverride = ctx.params["thumbEnergy"] as "spectacle" | "bold" | "cozy_pop" | undefined;
        const pb = energyOverride ? { ...playbook, energy: energyOverride } : playbook;
        const dnaSubject = (ctx.store["styleDNA"] as { thumbnail?: { subject?: string } } | null)?.thumbnail?.subject;
        await renderCandidate({
          pattern, title, scriptHint, playbook: pb, outJpg, tmpDir: tmp, idx, log: ctx.log,
          ...(dnaSubject ? { sceneMandate: dnaSubject } : {}),
        });
        const refQA = await referenceMobileQA(tmp, outJpg);
        if (refQA && !refQA.pass) {
          ctx.log(`thumbnail_gen: playbook candidate rejected (${refQA.reason}) — falling through`);
        } else {
          const thumbnailKey = `${ctx.keyPrefix}runs/${ctx.runId}/thumbnail.jpg`;
          await putObject(thumbnailKey, await readBytes(outJpg), { contentType: "image/jpeg" });
          await recordAsset(ctx, "thumbnail", thumbnailKey, { strategy: "playbook", pattern: pattern.name });
          ctx.log(`thumbnail_gen: PLAYBOOK thumbnail ✓ (pattern "${pattern.name}")${refQA ? ` — ref QA: ${refQA.reason}` : ""}`);
          return { thumbnailKey };
        }
      } catch (e) {
        ctx.log(`thumbnail_gen: playbook path failed (${e instanceof Error ? e.message : e}) — falling through`);
      }
    }

    // REAL-SCENE PATH (music_loop/lofi): the run's own keyframe still IS the
    // most on-brand thumbnail base — it is literally the video. Use it (free,
    // perfectly DNA-grounded) with a styled contrasty title overlay; only fall
    // through to generated bases if QA rejects the composite.
    const sceneStillKey = ctx.store["f1Key"] as string | undefined;
    if (sceneStillKey && thumbnailer !== "title_card") {
      try {
        const tmp = await makeRunTempDir(ctx.runId);
        const base = await writeBytes(join(tmp, "scene_base.png"), await getObjectBytes(sceneStillKey));
        let ttl = shortTitleFallback(title);
        if (hasAnthropicKey()) {
          try {
            const c = await claudeJson<{ thumbnail_title?: string }>({
              maxTokens: 200,
              system: "You are an elite YouTube thumbnail art director. Return ONLY JSON.",
              prompt:
                `The thumbnail base is the video's own scene (a ${style.label} still). Video title: "${title}"` +
                (niche ? ` (niche: ${niche})` : "") +
                `.\n${dnaSpecClause}${rulesClause}` +
                `Write the overlay text: 2-4 punchy words, high curiosity, storybook-warm but BOLD ` +
                `(it must pop against a cozy illustrated scene). Return JSON {"thumbnail_title": string}.`,
            });
            if (c.thumbnail_title?.trim()) ttl = c.thumbnail_title.trim();
          } catch { /* fallback title below */ }
        }
        const outJpg = join(tmp, "thumbnail.jpg");
        await thumbnailText({
          basePath: base,
          outJpg,
          title: ttl,
          subtitle: (ctx.store["channelName"] as string | undefined) ?? "",
          font: style.title.font,
          uppercase: style.title.uppercase,
          textShadow: true,
        });
        const refQA = await referenceMobileQA(tmp, outJpg);
        if (refQA && !refQA.pass) {
          ctx.log(`thumbnail_gen: real-scene composite rejected (${refQA.reason}) — generating a fresh base`);
        } else {
          const thumbnailKey = `${ctx.keyPrefix}runs/${ctx.runId}/thumbnail.jpg`;
          await putObject(thumbnailKey, await readBytes(outJpg), { contentType: "image/jpeg" });
          await recordAsset(ctx, "thumbnail", thumbnailKey, { strategy: "scene_still", thumbnailTitle: ttl });
          ctx.log(`thumbnail_gen: real-scene thumbnail ✓ ("${ttl}")${refQA ? ` — ref QA: ${refQA.reason}` : ""}`);
          return { thumbnailKey };
        }
      } catch (e) {
        ctx.log(`thumbnail_gen: real-scene path failed (${e instanceof Error ? e.message : e}) — falling through`);
      }
    }

    // Operator explicitly selected the deterministic title card.
    if (thumbnailer === "title_card") {
      const thumbnailKey = await titleCardFallback(ctx);
      return { thumbnailKey };
    }

    // THE ENGINE (no playbook yet): DNA-direct Nano Banana Pro brief - the
    // same one-pass design-native render the playbook path uses. Judged with
    // one feedback retry; failure is LOUD (block heal retries - the legacy
    // ideogram/claude_flux/brush_swash machine is gone).
    const { buildThumbBrief, bananaThumbnail } = await import("@/lib/banana");
    let bananaLines: { text: string; payoff: boolean }[] = [];
    try {
      const c = await claudeJson<{ lines?: { text?: string; payoff?: boolean }[] }>({
        maxTokens: 300,
        system: "You are an elite YouTube thumbnail art director. Return ONLY JSON.",
        prompt:
          `Headline for a YouTube thumbnail. Video: "${title}"${niche ? ` (niche ${niche})` : ""}. ` +
          `2-3 lines, 1-3 punchy words each, <=5 words total, NOT restating the title, real English hook ` +
          `words, never meta-words. Mark exactly ONE line as the payoff. ` +
          `Return STRICT JSON {"lines":[{"text":string,"payoff":boolean}]}.`,
      });
      bananaLines = (c.lines ?? [])
        .filter((l) => l.text && l.text.trim())
        .map((l) => ({ text: String(l.text).trim(), payoff: l.payoff === true }));
    } catch { /* hook fallback below */ }
    if (!bananaLines.length) {
      const hook = title.split(/[\s:—-]+/).filter((w) => w.length > 2).slice(0, 2);
      bananaLines = [{ text: hook[0] ?? "WATCH", payoff: false }, { text: hook[1] ?? "THIS", payoff: true }];
    }
    const btmp = await makeRunTempDir(ctx.runId);
    const bOut = join(btmp, "thumbnail.jpg");
    const bScene = dnaThumb?.subject || dna?.recurringSubject
      ? `${dnaThumb?.subject ?? dna?.recurringSubject} - staged to literally dramatize "${title}".`
      : `a dramatic scene that literally enacts "${title}"${niche ? ` for a ${niche} channel` : ""}.`;
    const { verdict } = await bananaThumbnail({
      brief: buildThumbBrief({
        channelName: String(ctx.store["channelName"] ?? "channel"),
        imageStyle: dna?.colorGrade ?? undefined,
        palette: dnaThumb?.palette ?? dna?.palette,
        scene: bScene,
        lines: bananaLines,
        badge: String(ctx.store["channelName"] ?? ""),
      }),
      outJpg: bOut,
      expectWords: bananaLines.map((w) => w.text),
      imageStyle: dna?.colorGrade ?? undefined,
      title,
      log: ctx.log,
    });
    const thumbnailKey = `${ctx.keyPrefix}runs/${ctx.runId}/thumbnail.jpg`;
    await putObject(thumbnailKey, await readBytes(bOut), { contentType: "image/jpeg" });
    await recordAsset(ctx, "thumbnail", thumbnailKey, { strategy: "banana_dna", punch: verdict.punch });
    ctx.log(`thumbnail_gen: BANANA thumbnail OK (DNA-direct, punch ${verdict.punch ?? "?"}/10)`);
    return { thumbnailKey };
  },
};

/** All intelligence blocks (registration order). */
export const intelligenceBlocks: Block[] = [
  competitorResearch,
  metadataOptimized,
  thumbnailGen,
];
