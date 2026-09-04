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
 *   thumbnail_gen       → one Style-DNA/playbook route: non-Lo-Fi uses a
 *                         native Fal Nano Banana Pro design; Lo-Fi alone uses its
 *                         exact rendered 4K scene and asks Nano Banana for its
 *                         minimal type. The production QA alarm gates both.
 */
import { COST_PATCH_KEY, type Block, type StageContext } from "@/engine/types";
import { PRICE } from "@/engine/pricing";
import { accountedModelUsageCost } from "@/engine/modelUsageCost";
import {
  assertThumbnailGate,
  qualityProfile,
  thumbnailGatePassed,
  type ThumbnailGateVerdict,
} from "@/engine/qualityPolicy";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { fileExists, makeRunTempDir, readBytes, writeBytes } from "@/lib/files";
import {
  createLofiThumbnailCurrentCandidateEvidence,
  createThumbnailCurrentCandidateEvidence,
} from "@/lib/thumbnailRefreshInventory";
import { getObjectBytes, putObject } from "@/lib/storage";
import {
  LOFI_RENDER_THUMBNAIL_CONTRACT,
  lofiNanoBananaEditPrompt,
  measureLofiThumbnailBackgroundSsim,
  measureLofiTypographyMatteUniformity,
  prepareLofiThumbnailReference,
} from "@/lib/lofiThumbnail";
import {
  beginThumbnailPaidWork,
  openThumbnailCheckpoint,
  saveThumbnailGenerationCheckpoint,
  saveThumbnailQaCheckpoint,
  thumbnailNanoBananaRequestContext,
  thumbnailRequestHash,
  type ThumbnailNanoBananaEvidence,
} from "@/lib/thumbnailCheckpoint";
import { FAL_NANO_BANANA_PRO_THUMBNAIL_PROFILE } from "@/lib/falNanoBananaProThumbnailContract";
import { loadDefectLedger, loadRecentRenders, recordRecentRender } from "@/lib/thumbnailLearningStore";
import { fingerprintThumbnail } from "@/lib/thumbnailSameness";
import { readThumbnailPalette } from "@/lib/thumbnailPaletteGuard";
import {
  generateFalNanoBananaProThumbnailWithReceipt,
  hasFalNanoBananaProThumbnail,
} from "@/lib/falNanoBananaProThumbnail";
import {
  generateFalNanoBananaLofiThumbnailWithReceipt,
  hasFalNanoBananaLofiThumbnail,
} from "@/lib/falNanoBananaLofiThumbnail";
import { craftMetadata } from "@/lib/metacraft";
import { compositeProviderTypographyOverlay } from "@/lib/ffmpeg";
import { hasAnthropicKey } from "@/lib/anthropic";
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
import {
  assertScenarioVisualTreatmentThumbnailBinding,
  createScenarioVisualTreatmentThumbnailBinding,
  createScenarioVisualTreatmentThumbnailProvenance,
  resolveScenarioVisualTreatmentForNewVisualArtifact,
  scenarioVisualTreatmentThumbnailDirection,
  scenarioVisualTreatmentThumbnailQaPassed,
} from "@/engine/scenarioVisualTreatment";
import {
  assertPackageToOpeningPlanBinding,
  createPackageToOpeningPlan,
} from "@/engine/packageToOpening";
import { loadPerformanceContext } from "@/lib/performance";
import { renderSerializedProgramEpisodeContextForPrompt } from "@/lib/serializedProgramEpisodeContext";
import { serializedProgramEpisodeContextForStage } from "@/trigger/serializedProgramEpisodeContext";
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
import { createHash } from "node:crypto";

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

/** Resolve the niche from params or store — runPipeline.ts's seedStore always
 *  carries `niche` (frozen from the channel's identity at run start), so a
 *  live channel re-fetch as a third fallback is never actually reached. */
function resolveNiche(ctx: StageContext): string | undefined {
  return (
    (ctx.params["niche"] as string | undefined) ??
    (ctx.store["niche"] as string | undefined) ??
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
    const niche = resolveNiche(ctx);

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
      thumbnailIdentity: (ctx.store["thumbnailIdentity"] as unknown) ?? null,
      persona: (ctx.store["persona"] as string | undefined) ?? "",
      thumbnailer: (ctx.store["thumbnailer"] as string | undefined) ?? "banana",
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

/**
 * The image provider must receive an actual visual story, not an SEO title
 * alone. This stays deterministic so every metadata outcome (including the
 * non-provider fallback) supplies the same required thumbnail handoff.
 */
function buildThumbnailDescription(args: {
  title: string;
  topic: string;
  scriptExcerpt: string;
  serializedEpisodeContext?: string;
}): string {
  const episodeContext = args.scriptExcerpt.replace(/\s+/g, " ").trim().slice(0, 420);
  const serialContext = args.serializedEpisodeContext?.replace(/\s+/g, " ").trim().slice(0, 360);
  return [
    `Thumbnail promise: ${args.title.trim()}.`,
    `Visually enact the topic "${args.topic.trim()}" through one dominant subject, a concrete physical action, and a clear consequence; the image must communicate the promise without decorative filler or written words.`,
    episodeContext
      ? `Ground the scene in this actual episode context: ${episodeContext}`
      : "Keep the scene specific to this episode's topic and honest promise.",
    serialContext
      ? `Serial-continuity constraint: preserve this episode's actual arc and entities without implying a different part: ${serialContext}`
      : "",
  ].join(" ");
}

export const metadataOptimized: Block = {
  id: "metadata",
  consumes: ["topic"],
  produces: [
    "title",
    "description",
    "thumbnailDescription",
    "tags",
    "estimatedViews",
    "estimatedViewsSource",
    "pinnedComment",
    "titleAlternate",
  ],
  run: async (ctx) => {
    const topic = str(ctx, "topic");
    const serializedEpisodeContext = serializedProgramEpisodeContextForStage(ctx, "metadata");
    const serializedEpisodePrompt = serializedEpisodeContext
      ? renderSerializedProgramEpisodeContextForPrompt(serializedEpisodeContext)
      : "";
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
    if (serializedEpisodePrompt) {
      // Keep serial continuity in the same bounded script-grounding channel
      // used by every metadata path, including provider fallbacks.
      scriptExcerpt = `${serializedEpisodePrompt}\n\n${scriptExcerpt}`.trim().slice(0, 1_400);
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

    // Degrade only when the permitted non-Google text provider is unavailable.
    if (!hasAnthropicKey()) {
      const title = topic.slice(0, titleMax);
      const description = `${topic}.\n\n${persona || channelName}.`;
      const tags = [topic.toLowerCase(), niche].filter(Boolean) as string[];
      const ve = await viewEstimate(tags);
      ctx.log(`metadata (degraded, no permitted text provider): "${title}"`);
      return {
        title: plannedTitle || title,
        description,
        thumbnailDescription: buildThumbnailDescription({
          title: plannedTitle || title,
          topic,
          scriptExcerpt,
          ...(serializedEpisodePrompt ? { serializedEpisodeContext: serializedEpisodePrompt } : {}),
        }),
        tags,
        pinnedComment: "",
        titleAlternate: "",
        ...ve,
      };
    }

    // Past performance, read through the CTR lens. The blended default weights
    // retention at 0.7 — but retention measures the script, and a title only
    // controls the click, so under the blend a strong title on a weak video was
    // handed to the generator as a WEAK performer to avoid.
    const perfCtx = await loadPerformanceContext(ctx.keyPrefix, { lens: "ctr" });

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
        // The scheduled plan's title now COMPETES instead of overriding. It is
        // written before the script exists and never faces the feed judge, yet
        // the packaging line below used to let it beat a judged winner purely by
        // precedence. Entering the pool keeps an owner-approved title that is
        // genuinely the strongest, and drops one that is not.
        warmStartTitle: plannedTitle || undefined,
        // Per-pipeline knob first, then the channel's frozen identity, then the
        // voice archetype's own default inside metacraft. Without the params
        // read the module surface would render a dial that changes nothing.
        clickbaitLevel: typeof ctx.params["clickbaitLevel"] === "number"
          ? (ctx.params["clickbaitLevel"] as number)
          : typeof ctx.store["clickbaitLevel"] === "number"
            ? (ctx.store["clickbaitLevel"] as number)
            : undefined,
        log: ctx.log,
      });
      let { title, description, tags } = m;
      ({ title, description, tags } = finishMetadata(ctx, { title, description, tags, channelName, nicheIntel }));
      const ve = await viewEstimate(tags);
      ctx.log(
        `metadata: METACRAFT [${m.frame}] ${m.judged ? `click ${m.clickScore}/10` : "UNJUDGED"} — ` +
        `"${title.slice(0, 60)}" est=${ve.estimatedViews} (${ve.estimatedViewsSource})` +
        (plannedTitle && title !== plannedTitle ? ` (beat the planned title "${plannedTitle.slice(0, 40)}")` : ""),
      );
      // The planned title is no longer applied here. It was passed into
      // metacraft as a candidate above, so if it is the strongest option it is
      // already `title`; if it is not, it lost on merit rather than being
      // reinstated after the judging it never took part in.
      return {
        title,
        description,
        thumbnailDescription: buildThumbnailDescription({
          title,
          topic,
          scriptExcerpt,
          ...(serializedEpisodePrompt ? { serializedEpisodeContext: serializedEpisodePrompt } : {}),
        }),
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
    return {
      title: plannedTitle || title,
      description,
      thumbnailDescription: buildThumbnailDescription({
        title: plannedTitle || title,
        topic,
        scriptExcerpt,
        ...(serializedEpisodePrompt ? { serializedEpisodeContext: serializedEpisodePrompt } : {}),
      }),
      tags,
      pinnedComment: "",
      titleAlternate: "",
      ...ve,
    };
  },
};

/* --------------------- 3. package-to-opening plan ------------------------ */

/**
 * Freeze the package promise before the paid thumbnail boundary. The plan is
 * intentionally structural: later final QA binds it to a durable opening
 * frame, but does not infer semantic equivalence from text alone.
 */
export const packageToOpeningPlan: Block = {
  id: "package_to_opening_plan",
  consumes: ["title", "thumbnailDescription", "topic"],
  produces: ["packageToOpeningPlan"],
  run: async (ctx) => {
    return {
      packageToOpeningPlan: createPackageToOpeningPlan({
        title: str(ctx, "title"),
        thumbnailDescription: str(ctx, "thumbnailDescription"),
        topic: str(ctx, "topic"),
        route: ctx.store["channelProgramRoute"],
        script: ctx.store["script"],
        quizPlan: ctx.store["quizPlan"],
        family: ctx.store["family"],
        contentLane: ctx.store["contentLane"],
      }),
    };
  },
};

/* -------------------------- 4. thumbnail_gen ---------------------------- */

export const thumbnailGen: Block = {
  id: "thumbnail_gen",
  consumes: ["title", "thumbnailDescription", "topic", "packageToOpeningPlan"],
  // `strategy` feeds the thumbnail learning loop (which path produced the
  // shipped thumbnail); every return path below must include it.
  produces: ["thumbnailKey", "strategy", "thumbnailPublishable", "thumbnailScenarioVisualTreatmentProvenance"],
  paid: true,
  run: async (ctx) => {
    const quality = qualityProfile(ctx.params["qualityProfile"]);
    const title = str(ctx, "title");
    const thumbnailDescription = str(ctx, "thumbnailDescription").replace(/\s+/g, " ").trim();
    const packageTopic = str(ctx, "topic");
    const packageToOpening = assertPackageToOpeningPlanBinding({
      plan: ctx.store["packageToOpeningPlan"],
      title,
      thumbnailDescription,
      topic: packageTopic,
      route: ctx.store["channelProgramRoute"],
      script: ctx.store["script"],
      quizPlan: ctx.store["quizPlan"],
      family: ctx.store["family"],
      contentLane: ctx.store["contentLane"],
    });
    // Package art is a separately generated, publishable visual asset. Bind it
    // before checkpoint admission so a malformed/missing fictional treatment
    // can neither reuse a generic candidate nor begin provider work.
    const scenarioVisualTreatment = resolveScenarioVisualTreatmentForNewVisualArtifact({
      treatment: ctx.store["scenarioVisualTreatment"],
      route: ctx.store["channelProgramRoute"],
      scenario: ctx.store["syntheticScenario"],
      disclosure: ctx.store["syntheticScenarioDisclosure"],
      topic: ctx.store["topic"],
      consumer: "thumbnail_gen",
      operation: "generate thumbnail package art",
    });
    if (scenarioVisualTreatment && typeof ctx.store["topic"] !== "string") {
      throw new Error("thumbnail_gen: fictional scenario requires its exact active topic before thumbnail work");
    }
    if (scenarioVisualTreatment && ctx.store["syntheticScenarioDisclosure"] === undefined) {
      throw new Error("thumbnail_gen: fictional scenario lacks its verified disclosure receipt");
    }
    const thumbnailScenarioVisualTreatmentBinding = scenarioVisualTreatment
      ? createScenarioVisualTreatmentThumbnailBinding(scenarioVisualTreatment)
      : undefined;
    const thumbnailVisualTreatment = scenarioVisualTreatment
      ? scenarioVisualTreatmentThumbnailDirection(scenarioVisualTreatment)
      : undefined;
    const serializedEpisodeContext = serializedProgramEpisodeContextForStage(ctx, "thumbnail_gen");
    const serializedEpisodePrompt = serializedEpisodeContext
      ? renderSerializedProgramEpisodeContextForPrompt(serializedEpisodeContext)
      : "";
    if (thumbnailDescription.length < 80) {
      throw new Error("thumbnail_gen: thumbnailDescription must contain a concrete visual brief of at least 80 characters");
    }
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

    // runPipeline.ts's seedStore freezes styleDNA/thumbnailPlaybook/family/
    // channelName from the channel doc at run start (see its comment on the
    // channel-config freeze block) — reading them here instead of
    // re-fetching the channel removes another redundant getChannel call.
    const fullDna = (ctx.store["styleDNA"] as import("@/engine/creative/types").StyleDNA | null | undefined) ?? null;
    const resolved = resolveGoldenThumbnailPlaybook({
      storedPlaybook: ctx.store["thumbnailPlaybook"] as ThumbnailPlaybook | undefined,
      dna: fullDna,
      family: String(ctx.store["family"] ?? ""),
      channelName: String(ctx.store["channelName"] ?? "channel"),
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

    const scriptHint = [
      serializedEpisodePrompt ? `Immutable serial continuity:\n${serializedEpisodePrompt}` : "",
      String(ctx.store["narrationText"] ?? "").slice(0, 500),
    ].filter(Boolean).join("\n\n").slice(0, 1_000);

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

    // Lo-Fi reads the normal playbook but never mutates it. Its isolated side
    // lane supplies the exact 15-second 4K render frame to Nano Banana as an
    // image reference and asks the model for only its truthful 4K emblem.
    // Every other family continues through the usual picture-only branch.
    if (String(ctx.store["family"] ?? "") === "music_loop") {
      const referenceTmp = await makeRunTempDir(ctx.runId, "lofi-thumbnail-reference");
      const finalLocalPath = typeof ctx.store["videoLocalPath"] === "string"
        ? ctx.store["videoLocalPath"]
        : undefined;
      const videoKey = typeof ctx.store["videoKey"] === "string" ? ctx.store["videoKey"] : undefined;
      const loopUnitKey = typeof ctx.store["loopUnitKey"] === "string" ? ctx.store["loopUnitKey"] : undefined;
      let sourcePath: string;
      let sourceVideoKey: string;
      if (finalLocalPath && videoKey && await fileExists(finalLocalPath)) {
        sourcePath = finalLocalPath;
        sourceVideoKey = videoKey;
      } else if (videoKey) {
        sourcePath = await writeBytes(join(referenceTmp, "lofi-final-video.mp4"), await getObjectBytes(videoKey));
        sourceVideoKey = videoKey;
      } else if (loopUnitKey) {
        sourcePath = await writeBytes(join(referenceTmp, "lofi-loop-unit.mp4"), await getObjectBytes(loopUnitKey));
        sourceVideoKey = loopUnitKey;
      } else {
        throw new Error("thumbnail_gen: Lo-Fi requires its rendered final or retained 4K loop unit");
      }

      const reference = await prepareLofiThumbnailReference({
        videoPath: sourcePath,
        tmpDir: referenceTmp,
      });
      const lofiPlaybook: ThumbnailPlaybook = {
        ...effectivePlaybook,
        rules: [
          "The attached image is the exact 15-second frame from this video's rendered 4K Lo-Fi scene and must remain the recognizable background.",
          "Show one truthful custom 4K quality emblem in the bottom-right corner.",
          "Preserve the rendered scene as the dominant artwork at mobile size.",
          "Render a custom quality symbol with no box, pill, card, banner, or shading panel behind it.",
        ],
        avoid: [
          "separately generated replacement artwork",
          "headlines, mood labels, titles, subtitles, or any writing other than 4K",
          "large panels, arrows, faces, stickers, or generic clickbait objects",
          "black rounded text labels, caption boxes, frosted cards, or generic UI typography",
          "a 4K badge on source media below 3840x2160",
        ],
      };
      interface LofiThumbnailAttempt {
        outJpg: string;
        requestHash: string;
        backgroundSsim: number;
        typographyMatteUniformity: number;
        refQA: ThumbnailGateVerdict | null;
        providerEvidence?: ThumbnailNanoBananaEvidence;
      }
      const lofiLoop = await produceAndCritique<LofiThumbnailAttempt>({
        label: "thumbnail_gen:lofi_reference",
        threshold: 1,
        maxIters: maxThumbnailIters,
        log: (message) => ctx.log(message),
        channel: thumbnailChannel,
        produce: async (priorIssues, iter) => {
          const prompt = lofiNanoBananaEditPrompt({
            visualLanguage: effectivePlaybook.visualLanguage,
            priorIssues,
            badgeTone: reference.badgeTone,
          });
          const requestHash = thumbnailRequestHash({
            contract: LOFI_RENDER_THUMBNAIL_CONTRACT.version,
            sourceVideoKey,
            sourceFrameSha256: reference.sourceFrameSha256,
            typographyMatteSha256: reference.typographyMatteSha256,
            sourceFrameTimeSec: reference.sourceFrameTimeSec,
            badge: LOFI_RENDER_THUMBNAIL_CONTRACT.badge,
            badgeTone: reference.badgeTone,
            prompt,
            packageToOpeningPlanFingerprint: packageToOpening.planFingerprint,
            critiqueIteration: iter,
            critiqueIssues: priorIssues,
          });
          const tmp = await makeRunTempDir(ctx.runId, `lofi-thumbnail-${requestHash.slice(0, 20)}`);
          const outJpg = join(tmp, "thumbnail.jpg");
          const requestContext = thumbnailNanoBananaRequestContext({
            keyPrefix: ctx.keyPrefix,
            runId: ctx.runId,
            requestHash,
          });
          let checkpoint = await openThumbnailCheckpoint({
            checkpointRoot: `${ctx.keyPrefix}runs/${ctx.runId}/thumbnail-checkpoints`,
            requestHash,
            localImagePath: outJpg,
            beforeClaim: () => {
              if (!hasFalNanoBananaLofiThumbnail()) {
                throw new Error("thumbnail_gen: Fal Nano Banana Lo-Fi edit is not configured");
              }
              if (quality === "production" && !hasVisionKey()) {
                throw new Error("thumbnail_gen: no configured production QA provider");
              }
            },
          });
          if (checkpoint.manifest) {
            const checkpointEvidence =
              checkpoint.manifest.version === 2 || checkpoint.manifest.version === 3
                ? checkpoint.manifest.providerEvidence
                : undefined;
            if (
              (checkpoint.manifest.version !== 2 && checkpoint.manifest.version !== 3) ||
              checkpointEvidence?.version !== "thumbnail-lofi-fal-nano-banana-evidence/v1" ||
              checkpointEvidence.mode !== "lofi-render-frame-reference" ||
              checkpointEvidence.sourceFrameSha256 !== reference.sourceFrameSha256 ||
              checkpointEvidence.typographyMatteSha256 !== reference.typographyMatteSha256
            ) {
              throw new Error("thumbnail_gen: Lo-Fi checkpoint lacks its exact Nano Banana reference evidence");
            }
            checkpointGenerationCostUsd += checkpoint.manifest.generationCostUsd;
          } else {
            checkpoint = await beginThumbnailPaidWork(checkpoint);
            const spentBefore = observedImageCost();
            const generated = await generateFalNanoBananaLofiThumbnailWithReceipt({
              prompt,
              referenceImage: reference.referenceImage,
              referenceMimeType: "image/jpeg",
              typographyMatteImage: reference.typographyMatteImage,
              typographyMatteMimeType: "image/png",
              idempotencyContext: requestContext,
            });
            nanoBananaImageCostUsd += generated.receipt.costUsd;
            const providerImagePath = join(tmp, "nano-banana-provider-image");
            await writeBytes(providerImagePath, generated.bytes);
            await compositeProviderTypographyOverlay({
              baseFramePath: reference.referenceFramePath,
              providerOverlayPath: providerImagePath,
              outPath: outJpg,
              width: LOFI_RENDER_THUMBNAIL_CONTRACT.outputWidth,
              height: LOFI_RENDER_THUMBNAIL_CONTRACT.outputHeight,
              matteColor: LOFI_RENDER_THUMBNAIL_CONTRACT.typographyMatteColor,
            });
            const typographyMatteUniformity = await measureLofiTypographyMatteUniformity({
              providerOverlayPath: providerImagePath,
            });
            const backgroundSsim = await measureLofiThumbnailBackgroundSsim({
              referenceFramePath: reference.referenceFramePath,
              candidatePath: outJpg,
            });
            const providerEvidence: ThumbnailNanoBananaEvidence = {
              version: "thumbnail-lofi-fal-nano-banana-evidence/v1",
              requestContext,
              receipt: generated.receipt,
              mode: "lofi-render-frame-reference",
              sourceFrameSha256: reference.sourceFrameSha256,
              typographyMatteSha256: reference.typographyMatteSha256,
              typographyMatteUniformity,
              backgroundSsim,
              expectedText: [LOFI_RENDER_THUMBNAIL_CONTRACT.badge],
            };
            const iterationSpend = Math.max(0, observedImageCost() - spentBefore);
            checkpointGenerationCostUsd += iterationSpend;
            checkpoint = await saveThumbnailGenerationCheckpoint(
              checkpoint,
              iterationSpend,
              providerEvidence,
            );
          }

          const providerEvidence =
            checkpoint.manifest?.version === 2 || checkpoint.manifest?.version === 3
              ? checkpoint.manifest.providerEvidence
              : undefined;
          if (providerEvidence?.version !== "thumbnail-lofi-fal-nano-banana-evidence/v1") {
            throw new Error("thumbnail_gen: Lo-Fi checkpoint lacks Fal typography-overlay evidence");
          }
          const typographyMatteUniformity = providerEvidence.typographyMatteUniformity;
          const backgroundSsim = await measureLofiThumbnailBackgroundSsim({
            referenceFramePath: reference.referenceFramePath,
            candidatePath: outJpg,
          });
          if (Math.abs(backgroundSsim - providerEvidence.backgroundSsim) > 0.002) {
            throw new Error("thumbnail_gen: Lo-Fi checkpoint background-preservation evidence drifted");
          }
          if (
            typographyMatteUniformity < LOFI_RENDER_THUMBNAIL_CONTRACT.minimumTypographyMatteUniformity ||
            backgroundSsim < LOFI_RENDER_THUMBNAIL_CONTRACT.minimumBackgroundSsim
          ) {
            ctx.log(
              `thumbnail_gen: rejected Lo-Fi overlay because matte uniformity ${typographyMatteUniformity.toFixed(6)} ` +
              `or frame SSIM ${backgroundSsim.toFixed(6)} is below its preservation threshold`,
            );
            return {
              outJpg,
              requestHash,
              backgroundSsim,
              typographyMatteUniformity,
              refQA: null,
              providerEvidence,
            };
          }

          const qaRequestHash = thumbnailRequestHash({
            contract: "lofi-thumbnail-mobile-reference-qa/v1",
            candidateRequestHash: requestHash,
            title,
            playbookRules: lofiPlaybook.rules,
            referenceThumbs,
          });
          let refQA: ThumbnailGateVerdict | null = null;
          const cachedQa = checkpoint.manifest?.qa;
          if (cachedQa?.completed && cachedQa.requestHash === qaRequestHash) {
            const verdict = cachedQa.verdict as Partial<ThumbnailGateVerdict> | null;
            checkpointQaCostUsd += cachedQa.costUsd;
            if (
              verdict &&
              typeof verdict.textOk === "boolean" &&
              typeof verdict.faceClear === "boolean" &&
              Number.isFinite(verdict.punch) &&
              Number.isFinite(verdict.styleMatch) &&
              Number.isFinite(verdict.storyMatch) &&
              typeof verdict.uiClean === "boolean" &&
              typeof verdict.reason === "string"
            ) refQA = verdict as ThumbnailGateVerdict;
            else if (verdict !== null) throw new Error("thumbnail_gen: cached Lo-Fi QA verdict is invalid");
          } else {
            const qaSpentBefore = observedQaCost();
            try {
              refQA = await runThumbnailMobileReferenceQa({
                outJpg,
                tmpDir: tmp,
                title,
                niche,
                playbook: lofiPlaybook,
                referenceUrls: referenceThumbs,
                brandContext: {
                  ...(qaBrandContext ?? {}),
                  route: LOFI_RENDER_THUMBNAIL_CONTRACT.route,
                  sourceFrameTimeSec: reference.sourceFrameTimeSec,
                  sourceResolution: `${reference.sourceWidth}x${reference.sourceHeight}`,
                  exactRequiredText: [LOFI_RENDER_THUMBNAIL_CONTRACT.badge],
                  badgeTone: reference.badgeTone,
                },
                log: ctx.log,
              });
            } catch (error) {
              ctx.log(`thumbnail_gen: Lo-Fi mobile QA errored: ${error instanceof Error ? error.message : error}`);
            }
            const qaSpend = Math.max(0, observedQaCost() - qaSpentBefore);
            checkpointQaCostUsd += qaSpend;
            checkpoint = await saveThumbnailQaCheckpoint(checkpoint, {
              requestHash: qaRequestHash,
              verdict: refQA,
              costUsd: qaSpend,
            });
          }
          return {
            outJpg,
            requestHash,
            backgroundSsim,
            typographyMatteUniformity,
            refQA,
            providerEvidence:
              checkpoint.manifest?.version === 2 || checkpoint.manifest?.version === 3
                ? checkpoint.manifest.providerEvidence
                : undefined,
          };
        },
        critique: async (attempt, iter) => {
          if (
            attempt.typographyMatteUniformity < LOFI_RENDER_THUMBNAIL_CONTRACT.minimumTypographyMatteUniformity ||
            attempt.backgroundSsim < LOFI_RENDER_THUMBNAIL_CONTRACT.minimumBackgroundSsim
          ) {
            return {
              score: Math.min(attempt.typographyMatteUniformity, attempt.backgroundSsim),
              pass: false,
              issues: [
                "Preserve the supplied daytime/nighttime, palette, lighting, objects, and composition exactly; change pixels only where the bottom-right 4K emblem is drawn.",
                "Do not add a panel, pill, banner, card, or shading block behind the 4K emblem.",
              ],
            };
          }
          const verdict = attempt.refQA;
          if (!verdict) return { score: iter === 1 ? 1 : 0, pass: true, issues: [] };
          if (thumbnailGatePassed(verdict)) return { score: 1, pass: true, issues: [] };
          const numeric = (verdict.punch + verdict.styleMatch + verdict.storyMatch) / 30;
          const issues = [
            verdict.reason,
            verdict.textOk ? "" : "show only the exact characters 4K and no other writing",
            verdict.uiClean ? "" : "remove extra text, watermark, clipping, or YouTube UI collisions",
            verdict.styleMatch >= 7 ? "" : "preserve the attached Lo-Fi scene and the channel's read-only thumbnail style",
            verdict.storyMatch >= 7 ? "" : "make the supplied video frame remain the obvious background",
          ].map((issue) => String(issue ?? "").trim()).filter(Boolean).slice(0, 5);
          return { score: numeric, pass: false, issues, ...(verdict.textOk ? {} : { fatal: true }) };
        },
      });
      const winner = lofiLoop.value;
      const outJpg = winner.outJpg;
      const refQA = winner.refQA;
      if (winner.backgroundSsim < LOFI_RENDER_THUMBNAIL_CONTRACT.minimumBackgroundSsim) {
        throw new Error(
          `thumbnail_gen: Lo-Fi Nano Banana changed the rendered frame ` +
            `(SSIM ${winner.backgroundSsim.toFixed(6)} < ` +
            `${LOFI_RENDER_THUMBNAIL_CONTRACT.minimumBackgroundSsim.toFixed(3)})`,
        );
      }
      if (winner.typographyMatteUniformity < LOFI_RENDER_THUMBNAIL_CONTRACT.minimumTypographyMatteUniformity) {
        throw new Error(
          `thumbnail_gen: Lo-Fi Nano Banana did not return a clean typography matte ` +
            `(uniformity ${winner.typographyMatteUniformity.toFixed(6)} < ` +
            `${LOFI_RENDER_THUMBNAIL_CONTRACT.minimumTypographyMatteUniformity.toFixed(3)})`,
        );
      }
      assertThumbnailGate(quality, refQA, "Lo-Fi Nano Banana 15-second-frame candidate");
      const passed = refQA !== null && thumbnailGatePassed(refQA);
      const publishable = quality === "production" ? true : passed;
      const strategy = publishable ? "lofi_nano_banana_15s_reference" : "lofi_nano_banana_reference_belowbar";
      const thumbnailKey = `${ctx.keyPrefix}runs/${ctx.runId}/thumbnail.jpg`;
      const thumbnailBytes = await readBytes(outJpg);
      const artifactSha256 = createHash("sha256").update(thumbnailBytes).digest("hex");
      const providerEvidence = winner.providerEvidence;
      if (!providerEvidence) throw new Error("thumbnail_gen: Lo-Fi winner lacks provider evidence");
      const thumbnailCurrentCandidateEvidence = publishable
        ? createLofiThumbnailCurrentCandidateEvidence({
            ownerId: ctx.ownerId,
            channelId: ctx.channelId,
            runId: ctx.runId,
            r2Key: thumbnailKey,
            artifactSha256,
            sourceVideoKey,
            sourceFrameSha256: reference.sourceFrameSha256,
            sourceFrameTimeSec: reference.sourceFrameTimeSec,
            sourceWidth: reference.sourceWidth,
            sourceHeight: reference.sourceHeight,
            providerRequestSha256: providerEvidence.receipt.providerRequestSha256,
            providerResponseSha256: providerEvidence.receipt.responseSha256,
          })
        : undefined;
      await putObject(thumbnailKey, thumbnailBytes, {
        contentType: "image/jpeg",
        metadata: {
          "thumbnail-request-sha256": winner.requestHash,
          "thumbnail-provider-route": providerEvidence.receipt.route,
          "thumbnail-side-lane": LOFI_RENDER_THUMBNAIL_CONTRACT.route,
          "thumbnail-source-frame-sha256": reference.sourceFrameSha256,
        },
      });
      await recordAsset(ctx, "thumbnail", thumbnailKey, {
        strategy,
        pattern: "nano-banana-15s-video-reference",
        publishable,
        thumbnailTitle: title,
        thumbnailDescription,
        providerRoute: providerEvidence.receipt.route,
        sideLane: LOFI_RENDER_THUMBNAIL_CONTRACT.route,
        providerRequestSha256: providerEvidence.receipt.providerRequestSha256,
        providerResponseSha256: providerEvidence.receipt.responseSha256,
        sourceVideoKey,
        sourceFrameTimeSec: reference.sourceFrameTimeSec,
        sourceResolution: `${reference.sourceWidth}x${reference.sourceHeight}`,
        backgroundSsim: winner.backgroundSsim,
        typographyMatteUniformity: winner.typographyMatteUniformity,
        ...(thumbnailCurrentCandidateEvidence ? { thumbnailCurrentCandidateEvidence } : {}),
      });
      ctx.log(
        `thumbnail_gen: Lo-Fi Nano Banana edit from exact ${reference.sourceFrameTimeSec}s ` +
        `${reference.sourceWidth}x${reference.sourceHeight} frame passed mobile QA`,
      );
      return {
        thumbnailKey,
        strategy,
        thumbnailPublishable: publishable,
        [COST_PATCH_KEY]: thumbnailCost(),
      };
    }

    interface ThumbnailAttempt {
      outJpg: string;
      requestHash: string;
      qaRequestHash: string;
      refQA: ThumbnailGateVerdict | null;
      providerEvidence?: ThumbnailNanoBananaEvidence;
    }

    // LEARNING INPUTS, loaded ONCE for the whole loop so both produce() and
    // critique() see them. These features existed and were tested, and were
    // inert in production because nothing passed them: the channel's
    // accumulated defect doctrine, its recent renders for the sameness guard,
    // the recent hues for the monotony guard, and the story judge. All fail
    // soft — an empty or unreachable store just means this channel has not
    // learned anything yet, and a render must never fail for that.
    const learningChannel = thumbnailChannel.channelName ?? "channel";
    let defectLedger: Awaited<ReturnType<typeof loadDefectLedger>> | undefined;
    let recentThumbnails: Awaited<ReturnType<typeof loadRecentRenders>> = [];
    try {
      [defectLedger, recentThumbnails] = await Promise.all([
        loadDefectLedger({ keyPrefix: ctx.keyPrefix, channelName: learningChannel }),
        loadRecentRenders({ keyPrefix: ctx.keyPrefix, channelName: learningChannel }),
      ]);
      if (defectLedger.observations.length || recentThumbnails.length) {
        ctx.log(
          `thumbnail_gen: channel memory — ${defectLedger.observations.length} past defect(s), ` +
          `${recentThumbnails.length} recent render(s) for sameness and monotony`,
        );
      }
    } catch { /* learning is an enhancement, never a render failure */ }

    // Observed-CTR advisory. Empty until a channel has real volume, and framed
    // by analyseThumbnailCtr as the lowest-priority input in the brief.
    let ctrAdvisory = "";
    try {
      const { loadPerformanceSamples } = await import("@/lib/thumbnailLearningStore");
      const { analyseThumbnailCtr } = await import("@/lib/thumbnailCtrFeedback");
      const samples = (await loadPerformanceSamples({
        keyPrefix: ctx.keyPrefix,
        channelName: learningChannel,
      })).filter((sample) => sample.impressions > 0);
      if (samples.length) {
        const report = analyseThumbnailCtr({ samples });
        ctrAdvisory = report.advisory;
        if (ctrAdvisory) ctx.log(`thumbnail_gen: applying observed-CTR advisory (${report.suggestedRules.length} finding(s))`);
      }
    } catch { /* advisory only */ }

    const attemptLoop = await produceAndCritique<ThumbnailAttempt>({
      label: "thumbnail_gen",
      threshold: 1,
      maxIters: maxThumbnailIters,
      log: (message) => ctx.log(message),
      channel: thumbnailChannel,
      produce: async (priorIssues, iter): Promise<ThumbnailAttempt> => {
        const requestHash = thumbnailRequestHash({
          contract: thumbnailScenarioVisualTreatmentBinding
            ? "thumbnail-gen-checkpoint-v6-fal-nano-banana-pro-native-scenario-treatment"
            : "thumbnail-gen-checkpoint-v5-fal-nano-banana-pro-native",
          title,
          thumbnailDescription,
          packageToOpeningPlanFingerprint: packageToOpening.planFingerprint,
          scriptHint,
          sceneMandate: dnaThumb?.subject,
          pattern,
          playbook: effectivePlaybook,
          patternIndex: idx,
          providerRoute: FAL_NANO_BANANA_PRO_THUMBNAIL_PROFILE,
          ...(serializedEpisodeContext
            ? { serializedEpisodeContextFingerprint: serializedEpisodeContext.fingerprint }
            : {}),
          ...(thumbnailScenarioVisualTreatmentBinding
            ? { scenarioVisualTreatment: thumbnailScenarioVisualTreatmentBinding }
            : {}),
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
          ...(thumbnailScenarioVisualTreatmentBinding
            ? { scenarioVisualTreatmentBinding: thumbnailScenarioVisualTreatmentBinding }
            : {}),
          beforeClaim: () => {
            if (!hasFalNanoBananaProThumbnail()) {
              throw new Error("thumbnail_gen: Fal Nano Banana Pro is not configured");
            }
            if (quality === "production" && !hasVisionKey()) {
              throw new Error("thumbnail_gen: no configured production QA provider");
            }
          },
        });

        if (checkpoint.manifest) {
          if (
            ((checkpoint.manifest.version !== 2 && checkpoint.manifest.version !== 3) ||
              !checkpoint.manifest.providerEvidence)
          ) {
            throw new Error(
              "thumbnail_gen: generated Nano Banana checkpoint is missing durable provider evidence",
            );
          }
          if (thumbnailScenarioVisualTreatmentBinding) {
            assertScenarioVisualTreatmentThumbnailBinding({
              binding: checkpoint.manifest.scenarioVisualTreatment,
              treatment: scenarioVisualTreatment,
              consumer: "thumbnail_gen checkpoint",
            });
          } else if (checkpoint.manifest.scenarioVisualTreatment !== undefined) {
            throw new Error("thumbnail_gen: non-fictional thumbnail checkpoint carries a scenario visual treatment binding");
          }
          checkpointGenerationCostUsd += checkpoint.manifest.generationCostUsd;
          ctx.log(
            `thumbnail_gen: reused ${checkpoint.source} paid candidate checkpoint ${requestHash.slice(0, 12)}`,
          );
        } else {
          checkpoint = await beginThumbnailPaidWork(checkpoint);
          let nanoBananaProviderEvidence: ThumbnailNanoBananaEvidence | undefined;
          const generateDesignedThumbnail = async (
            request: import("@/lib/thumbnailLab").DesignedThumbnailRequest,
          ): Promise<Uint8Array> => {
            const generated = await generateFalNanoBananaProThumbnailWithReceipt({
              prompt: request.prompt,
              idempotencyContext: nanoBananaRequestContext,
            });
            nanoBananaImageCostUsd += generated.receipt.costUsd;
            nanoBananaProviderEvidence = {
              version: "thumbnail-fal-nano-banana-pro-evidence/v1",
              requestContext: nanoBananaRequestContext,
              receipt: generated.receipt,
              mode: "native-scene-and-typography",
              expectedWords: request.expectWords,
            };
            return generated.bytes;
          };
          const spentBefore = observedImageCost() + observedConceptCost();
          await renderCandidate({
            pattern,
            title,
            scriptHint,
            sceneSeed: thumbnailDescription,
            channelName: learningChannel,
            playbook: effectivePlaybook,
            outJpg,
            tmpDir: tmp,
            idx,
            generateDesignedThumbnail,
            log: ctx.log,
            useStoryJudge: true,
            ...(ctrAdvisory ? { ctrAdvisory } : {}),
            ...(defectLedger?.observations.length ? { defectLedger } : {}),
            ...(recentThumbnails.length ? { recentThumbnails } : {}),
            ...(dnaThumb?.subject ? { sceneMandate: dnaThumb.subject } : {}),
            ...(priorIssues.length ? { priorIssues } : {}),
            ...(criticDoctrine ? { criticDoctrine } : {}),
            ...(thumbnailVisualTreatment ? { visualTreatment: thumbnailVisualTreatment } : {}),
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
          contract: thumbnailScenarioVisualTreatmentBinding
            ? "thumbnail-mobile-reference-qa-v4-native-copy-ocr-scenario-treatment"
            : "thumbnail-mobile-reference-qa-v3-native-copy-ocr",
          candidateRequestHash: requestHash,
          quality,
          title,
          packageToOpeningPlanFingerprint: packageToOpening.planFingerprint,
          niche,
          qaBrandContext,
          playbookRules: effectivePlaybook.rules,
          playbookAvoid: effectivePlaybook.avoid,
          referenceThumbs,
          expectedWords:
            checkpoint.manifest?.version === 2 || checkpoint.manifest?.version === 3
              ? checkpoint.manifest.providerEvidence?.version === "thumbnail-fal-nano-banana-pro-evidence/v1"
                ? checkpoint.manifest.providerEvidence.expectedWords
                : undefined
              : undefined,
          ...(thumbnailScenarioVisualTreatmentBinding
            ? {
                scenarioVisualTreatment: thumbnailScenarioVisualTreatmentBinding,
                visualTreatmentCriteria: thumbnailVisualTreatment?.reviewCriteria,
              }
            : {}),
        });
        let refQA: ThumbnailGateVerdict | null;
        const cachedQa = checkpoint.manifest?.qa;
        if (cachedQa?.completed && cachedQa.requestHash === qaRequestHash) {
          checkpointQaCostUsd += cachedQa.costUsd;
          if (thumbnailScenarioVisualTreatmentBinding) {
            assertScenarioVisualTreatmentThumbnailBinding({
              binding: cachedQa.scenarioVisualTreatment?.binding,
              treatment: scenarioVisualTreatment,
              consumer: "thumbnail_gen checkpoint QA",
            });
          } else if (cachedQa.scenarioVisualTreatment !== undefined) {
            throw new Error("thumbnail_gen: non-fictional thumbnail QA checkpoint carries a scenario visual treatment binding");
          }
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
              (thumbnailScenarioVisualTreatmentBinding &&
                typeof verdict.visualTreatmentCompliant !== "boolean") ||
              typeof verdict.reason !== "string"
            ) {
              throw new Error("thumbnail_gen: cached QA verdict is invalid");
            }
            refQA = verdict as ThumbnailGateVerdict;
          }
          if (
            thumbnailScenarioVisualTreatmentBinding &&
            cachedQa.scenarioVisualTreatment?.visualTreatmentCompliant !==
              (refQA?.visualTreatmentCompliant === true)
          ) {
            throw new Error("thumbnail_gen: checkpoint QA treatment verdict does not match its sealed binding");
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
              // Feeds the catalogue-monotony guard, which cannot see a channel
              // collapsing into one colour temperature from a single frame.
              ...(recentThumbnails.length
                ? { recentHues: recentThumbnails.map((render) => render.hue) }
                : {}),
              expectedWords:
                checkpoint.manifest?.version === 2 || checkpoint.manifest?.version === 3
                  ? checkpoint.manifest.providerEvidence?.version === "thumbnail-fal-nano-banana-pro-evidence/v1"
                    ? checkpoint.manifest.providerEvidence.expectedWords
                    : undefined
                  : undefined,
              ...(thumbnailVisualTreatment
                ? { visualTreatmentCriteria: thumbnailVisualTreatment.reviewCriteria }
                : {}),
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
            ...(thumbnailScenarioVisualTreatmentBinding
              ? {
                  scenarioVisualTreatment: {
                    binding: thumbnailScenarioVisualTreatmentBinding,
                    visualTreatmentCompliant: refQA?.visualTreatmentCompliant === true,
                  },
                }
              : {}),
          });
        }
        const providerEvidence =
          (checkpoint.manifest?.version === 2 || checkpoint.manifest?.version === 3)
          ? checkpoint.manifest.providerEvidence
          : undefined;
        return {
          outJpg,
          requestHash,
          qaRequestHash,
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
        const visualTreatmentPassed =
          !thumbnailScenarioVisualTreatmentBinding || scenarioVisualTreatmentThumbnailQaPassed(verdict);
        if (thumbnailGatePassed(verdict) && visualTreatmentPassed) {
          return { score: 1, pass: true, issues: [] };
        }
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
          visualTreatmentPassed
            ? ""
            : "the thumbnail violates or lacks a passing sealed fictional-scenario visual-treatment review",
        ].map((issue) => String(issue ?? "").trim()).filter(Boolean).slice(0, 6);
        ctx.log(
          `thumbnail_gen: candidate ${iter} REJECTED by the grader (${verdict.reason.slice(0, 120)})` +
          (iter < maxThumbnailIters ? " — regenerating with the defects fed back" : " — iteration cap reached"),
        );
        // `pass:false` is authoritative; the score only ranks attempts so the
        // best near-miss ships if no candidate ever clears the bar.
        //
        // But a broken headline is not a near-miss. Ranking it against the
        // others is how a misspelled frame comes back as "best of a bad set" —
        // observed shipping a headline reading "FÖÖLED" after the reviewer had
        // already caught it. Marking it fatal removes it from best-of selection
        // entirely; the loop keeps iterating and the caller is told if every
        // attempt was unusable.
        return {
          score: 0.5 * numeric + 0.5 * booleans,
          pass: false,
          issues,
          ...(verdict.textOk ? {} : { fatal: true }),
        };
      },
    });

    if (attemptLoop.fatal) {
      ctx.log(
        "thumbnail_gen: EVERY candidate carried a broken headline — the gate below owns the " +
        "fail-closed decision rather than this frame shipping as a best-effort",
      );
    }
    const winner = attemptLoop.value;
    const outJpg = winner.outJpg;
    const requestHash = winner.requestHash;
    const qaRequestHash = winner.qaRequestHash;
    const refQA = winner.refQA;
    ctx.log(
      `thumbnail_gen: critique loop finished after ${attemptLoop.iterations} candidate(s) ` +
      `(${attemptLoop.accepted ? "accepted" : "best of the rejected set"})`,
    );
    // LEARNING WRITE. Record what the grader actually rejected, once the loop
    // has settled — not every transient candidate state. `priorIssues` only
    // survives within this video; without this the channel re-rolls the same
    // defect next week and the operator is the only memory in the loop.
    //
    // Deliberately fire-and-forget and fully swallowed: a learning write must
    // never fail a thumbnail that has already been paid for and passed its
    // gate. The worst case is a channel that has not learned yet.
    try {
      const rejectionReason = refQA?.reason?.trim();
      if (rejectionReason && !attemptLoop.accepted) {
        const { appendDefectObservations } = await import("@/lib/thumbnailLearningStore");
        const written = await appendDefectObservations({
          keyPrefix: ctx.keyPrefix,
          channelName: thumbnailChannel.channelName ?? "channel",
          // One video, one observation: the loop can reject the same candidate
          // repeatedly, and doctrine counts distinct videos, not rejections.
          observations: [{ videoKey: ctx.runId, reason: rejectionReason, at: Date.now() }],
        });
        ctx.log(
          `thumbnail_gen: recorded QA rejection for channel learning ` +
          `(${written.persisted ? `ledger now ${written.total} observation(s)` : "not persisted"})`,
        );
      }
      // Phase one of the CTR loop: the craft decisions are known now, the
      // metrics are not known for days. Recording traits keyed by run lets the
      // scheduled analytics pass attach impressions later without having to
      // reconstruct what the thumbnail actually did.
      // Close the loop: without this the sameness and monotony guards have
      // nothing to compare the NEXT video against, which is why both were
      // effectively dead in production even once they were passed in.
      try {
        const [fingerprint, palette] = await Promise.all([
          fingerprintThumbnail({ imagePath: outJpg, heroProp: thumbnailDescription }),
          readThumbnailPalette(outJpg),
        ]);
        await recordRecentRender({
          keyPrefix: ctx.keyPrefix,
          channelName: thumbnailChannel.channelName ?? "channel",
          render: { ...fingerprint, hue: palette.hue, at: Date.now() },
        });
      } catch { /* history is an enhancement, never a render failure */ }
      const { recordThumbnailTraits } = await import("@/lib/thumbnailLearningStore");
      await recordThumbnailTraits({
        keyPrefix: ctx.keyPrefix,
        channelName: thumbnailChannel.channelName ?? "channel",
        videoKey: ctx.runId,
        // Only decisions already settled at this point, and only ones the
        // module can act on later. `strategy` is deliberately excluded: it is
        // not finalised until the gate below.
        traits: {
          providerRoute: FAL_NANO_BANANA_PRO_THUMBNAIL_PROFILE.route,
          accepted: String(attemptLoop.accepted),
          iterations: String(attemptLoop.iterations),
        },
      });
    } catch (error) {
      ctx.log(`thumbnail_gen: channel learning write skipped (${error instanceof Error ? error.message : String(error)})`);
    }
    assertThumbnailGate(quality, refQA, `${strategy} candidate`);
    if (
      scenarioVisualTreatment &&
      quality === "production" &&
      !scenarioVisualTreatmentThumbnailQaPassed(refQA)
    ) {
      throw new Error("thumbnail_gen: sealed fictional scenario thumbnail lacks a passing visual-treatment QA verdict");
    }
    const passed =
      refQA !== null &&
      thumbnailGatePassed(refQA) &&
      (!scenarioVisualTreatment || scenarioVisualTreatmentThumbnailQaPassed(refQA));
    const publishable = quality === "production" ? true : passed;
    const finalStrategy = publishable ? strategy : "playbook_belowbar";
    const thumbnailKey = `${ctx.keyPrefix}runs/${ctx.runId}/thumbnail.jpg`;
    const providerEvidence = winner.providerEvidence;
    const thumbnailBytes = await readBytes(outJpg);
    const thumbnailArtifactSha256 = createHash("sha256").update(thumbnailBytes).digest("hex");
    const thumbnailScenarioVisualTreatmentProvenance =
      scenarioVisualTreatment &&
      thumbnailScenarioVisualTreatmentBinding &&
      scenarioVisualTreatmentThumbnailQaPassed(refQA)
        ? createScenarioVisualTreatmentThumbnailProvenance({
            treatment: scenarioVisualTreatment,
            binding: thumbnailScenarioVisualTreatmentBinding,
            thumbnailRequestHash: requestHash,
            qaRequestHash,
            artifactSha256: thumbnailArtifactSha256,
            visualTreatmentCompliant: true,
          })
        : undefined;
    // This marker is deliberately provenance-only. It gives the Studio a
    // durable way to distinguish a new, run-bound Golden candidate from an
    // older thumbnail without suggesting that it has been owner-approved for
    // an external replacement.
    const thumbnailCurrentCandidateEvidence =
      publishable && providerEvidence
        ? createThumbnailCurrentCandidateEvidence({
            ownerId: ctx.ownerId,
            channelId: ctx.channelId,
            runId: ctx.runId,
            r2Key: thumbnailKey,
            artifactSha256: thumbnailArtifactSha256,
            providerRequestSha256: providerEvidence.receipt.providerRequestSha256,
            providerResponseSha256: providerEvidence.receipt.responseSha256,
          })
        : undefined;
    await putObject(thumbnailKey, thumbnailBytes, {
      contentType: "image/jpeg",
      metadata: {
        "thumbnail-request-sha256": requestHash,
        ...(thumbnailScenarioVisualTreatmentProvenance ? {
          "thumbnail-scenario-visual-treatment-fingerprint": thumbnailScenarioVisualTreatmentProvenance.fingerprint,
          "thumbnail-scenario-visual-treatment-fingerprint-source":
            thumbnailScenarioVisualTreatmentProvenance.binding.treatmentFingerprint,
        } : {}),
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
      thumbnailDescription,
      providerRoute: providerEvidence?.receipt.route ?? "verified-video-still",
      providerRequestSha256: providerEvidence?.receipt.providerRequestSha256,
      providerResponseSha256: providerEvidence?.receipt.responseSha256,
      ...(thumbnailCurrentCandidateEvidence
        ? { thumbnailCurrentCandidateEvidence }
        : {}),
      scenarioVisualTreatmentProvenanceFingerprint:
        thumbnailScenarioVisualTreatmentProvenance?.fingerprint,
    });
    ctx.log(
      `thumbnail_gen: ${finalStrategy} thumbnail rendered${refQA ? ` — ref QA: ${refQA.reason}` : " (draft, unverified)"}`,
    );
    return {
      thumbnailKey,
      strategy: finalStrategy,
      thumbnailPublishable: publishable,
      ...(thumbnailScenarioVisualTreatmentProvenance
        ? { thumbnailScenarioVisualTreatmentProvenance }
        : {}),
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
  packageToOpeningPlan,
  thumbnailGen,
];
