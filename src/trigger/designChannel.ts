/**
 * `design-channel` — build a channel from the wizard's structured choices
 * (niche + family + options) using the modular pipeline DESIGNER (not a fixed
 * archetype). Generates identity/art, persists the designed pipeline, and sets
 * status active|draft based on whether the family's visual engine is built.
 */
import { task } from "@trigger.dev/sdk";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { synthChannelConcept } from "@/lib/conceptSynth";
import { generateChannelArt } from "@/lib/channelArt";
import { designPipeline, type DesignOptions } from "@/engine/designer";
import { nichePreset } from "@/engine/golden";
import { FAMILIES, type FamilyKey } from "@/engine/families";
import { getArchetype } from "@/engine/archetypes";
import { getNiche } from "@/lib/nicheCatalog";
import { refreshNicheResearchCore } from "@/lib/nicheResearch";
import { optimizeTopics } from "@/lib/topicOptimizer";
import { channelPrefix } from "@/lib/storage";
import { synthShowBible } from "@/engine/creative/showBible";
import { synthStyleDNA, buildQualityBar, ESTABLISHED_CONFIDENCE } from "@/engine/creative/styleDNA";
import { architectPipeline } from "@/engine/creative/architect";

export interface DesignChannelArgs extends Omit<DesignOptions, "family"> {
  ownerId?: string;
  name?: string;
  family: FamilyKey;
  cadence?: string;
  days?: number[];
  budget?: number;
  persona?: string;
  palette?: string[];
  /** Auto-create + link a YouTube channel via Browserbase (default true). */
  autoYoutube?: boolean;
  /**
   * Operator's "make it like this" reference clip. Analyzed with Gemini and fed
   * into the Style-DNA distillation (it was previously collected by the wizard
   * and silently dropped here).
   */
  exampleClipUrl?: string;
}

function slugify(name: string, now: number): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `${base || "channel"}-${now}`;
}

export const designChannelTask = task({
  id: "design-channel",
  maxDuration: 600,
  run: async (payload: DesignChannelArgs) => {
    const log = (m: string, x?: Record<string, unknown>) => console.log(`[design-channel] ${m}`, x ?? "");
    // Channel inception without the model keys yields a skeleton identity/DNA
    // that poisons every future render — fail loudly instead.
    await bootstrapSecrets(log, { required: ["GEMINI_API_KEY", "ANTHROPIC_API_KEY"] });

    const ownerId = payload.ownerId ?? process.env.NEXT_PUBLIC_OWNER_ID ?? "owner_daniel";
    const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
    if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
    const convex = new ConvexHttpClient(url);

    const fam = FAMILIES[payload.family];
    if (!fam) throw new Error(`unknown family: ${payload.family}`);
    const niche = getNiche(payload.nicheKey ?? "");

    // 1. Designed, validated pipeline from the wizard choices.
    const design = designPipeline({
      family: payload.family,
      nicheKey: payload.nicheKey,
      subcategory: payload.subcategory,
      lengthMinutes: payload.lengthMinutes,
      locale: payload.locale,
      footageTheme: payload.footageTheme,
      voiceFx: payload.voiceFx,
      // PRIVATE-FIRST: default uploads to private "draft" unless the operator
      // explicitly chose public/scheduled — nothing goes live by accident.
      publishMode: payload.publishMode ?? "draft",
      seriesTitle: payload.seriesTitle,
      seriesCount: payload.seriesCount,
      toggles: payload.toggles,
    });
    log(`designed ${design.pipeline.length}-block pipeline (available=${design.available})`);

    // 2. Identity (persona/palette/topics/voice) — synthesized from niche+family.
    const seed = [niche?.label ?? payload.nicheKey, payload.subcategory, payload.name, `${fam.label} format`]
      .filter(Boolean).join(" — ");
    const concept = await synthChannelConcept(seed, undefined, log);
    const name = (payload.name ?? "").trim() || concept.name;

    const identity = {
      persona: payload.persona ?? concept.persona,
      styleGrammar: concept.styleGrammar,
      palette: payload.palette ?? concept.palette,
      topicPool: concept.topicPool,
      bannedWords: concept.bannedWords,
      requiredCallbacks: [] as string[],
      cadence: payload.cadence ?? concept.cadence,
      niche: niche?.label ?? concept.niche,
      voiceId: concept.voiceId,
      thumbnailTemplate: fam.defaultThumbnailStyle,
    };

    const now = Date.now();
    const slug = slugify(name, now);
    const archetype = getArchetype(fam.archetypeKey);
    const channelId = (await convex.mutation(api.channels.createChannel, {
      ownerId, slug, name, identity,
      // Niche preset thumbnail engine wins over the family default when set.
      thumbnailer: nichePreset(payload.nicheKey)?.thumbnailer
        ?? (fam.defaultThumbnailStyle === "title_card" ? "title_card" : "claude_flux"),
      template: archetype.template,
      pipeline: design.pipeline,
      budget: payload.budget ?? 5,
      // DEACTIVATED-FIRST: even a fully-buildable channel starts "paused" so the
      // autopilot scheduler never auto-spends until the operator flips it on. A
      // not-yet-buildable family stays "draft".
      status: design.available ? "paused" : "draft",
    })) as Id<"channels">;
    log("channel created", { channelId, slug, family: payload.family, status: design.available ? "paused" : "draft" });

    // 3. Schedule (cadence + days) if provided.
    if (payload.cadence) {
      try {
        await convex.mutation(api.channels.updateChannel, {
          channelId,
          schedule: { frequency: payload.cadence, days: payload.days },
        });
      } catch (e) { log(`schedule set failed (non-fatal): ${e instanceof Error ? e.message : e}`); }
    }

    // 4. Auto-SEO: research the niche (competitors + power words + title patterns),
    // then expand the topic pool with optimized, competitor-aware, on-brand ideas
    // so the channel launches with a strong publishing queue instead of a thin
    // concept pool. Best-effort — never blocks channel creation. Runs FIRST so the
    // Show Bible can ground itself in the refreshed competitor signals.
    let topicPool = identity.topicPool;
    try {
      if (identity.niche) {
        await refreshNicheResearchCore({ ownerId, niche: identity.niche, channelId }, log)
          .catch((e) => log(`auto-seo: niche research failed (non-fatal): ${e instanceof Error ? e.message : e}`));
      }
      const optimized = await optimizeTopics({
        convex, ownerId, channelId, keyPrefix: channelPrefix(ownerId, slug),
        count: 24, identity, log,
      });
      if (optimized.length) {
        topicPool = Array.from(new Set([...(identity.topicPool ?? []), ...optimized.map((o) => o.topic)]));
        log(`auto-seo: seeded ${optimized.length} topics (pool now ${topicPool.length})`);
      }
    } catch (e) { log(`auto-seo failed (non-fatal): ${e instanceof Error ? e.message : e}`); }

    // 5. Grounding — distil the channel's research into a Show Bible AND a frozen,
    // machine-readable Style DNA + per-channel Quality Bar. All three are grounded
    // in the SAME auto-discovered signals (top competitor titles + power words +
    // Gemini thumbnail-vision analysis + the SEO databank) the niche research just
    // refreshed. The Style DNA is the definition of "good" every block conforms to;
    // the Bar is what the critics judge against. Runs BEFORE art so the avatar uses
    // the locked identity.
    // 4b. Example-clip analysis — the wizard's "make it like this" reference,
    // previously collected and silently dropped at this boundary. Best-effort.
    let exampleClipNotes: string | undefined;
    if (payload.exampleClipUrl?.trim()) {
      try {
        const { analyzeClip } = await import("@/lib/clipAnalysis");
        const a = await analyzeClip(payload.exampleClipUrl.trim());
        if (a.couldAnalyze) {
          exampleClipNotes = [
            a.visualStyle ? `visual style: ${a.visualStyle}` : "",
            a.pacing ? `pacing: ${a.pacing}` : "",
            a.hasNarration ? `narration tone: ${a.narrationTone ?? "unspecified"}` : "no narration",
            a.musicRole !== "none" ? `music role: ${a.musicRole}` : "",
            a.captionStyle ? `captions: ${a.captionStyle}` : "",
            a.thumbnailStyle ? `thumbnail style: ${a.thumbnailStyle}` : "",
            a.notes,
          ].filter(Boolean).join("; ");
          log(`example clip analyzed → seeding the Style DNA: ${exampleClipNotes.slice(0, 160)}`);
        } else {
          log("example clip could not be analyzed (live/private/unavailable) — skipping");
        }
      } catch (e) {
        log(`example-clip analysis failed (non-fatal): ${e instanceof Error ? e.message : e}`);
      }
    }

    let creativeBrief;
    let styleDNA;
    let qualityBar;
    let competitorCount = 0;
    try {
      let competitorContext = "";
      let titles: string[] = [];
      let powerWords: string[] = [];
      let thumbnailStyleGuide: { dominantColors?: string[]; hasTextOverlayPct?: number; notes?: string } | undefined;
      let databank: { thumbnailRules?: string[]; hookPatterns?: string[]; competitorGaps?: string[]; titleTemplates?: string[] } | undefined;
      if (identity.niche) {
        const [nicheIntel, competitors, db] = await Promise.all([
          convex.query(api.seo.getNiche, { ownerId, niche: identity.niche }).catch(() => null),
          convex.query(api.competitors.listCompetitors, { ownerId, niche: identity.niche }).catch(() => []),
          convex.query(api.seo.getDatabank, { ownerId, niche: identity.niche }).catch(() => null),
        ]);
        competitorCount = (competitors as unknown[]).length;
        titles = (competitors as { topVideos?: { title: string; views: number }[] }[])
          .flatMap((c) => c.topVideos ?? []).sort((a, b) => b.views - a.views).slice(0, 15).map((v) => v.title);
        powerWords = ((nicheIntel as { powerWords?: { word: string }[] } | null)?.powerWords ?? [])
          .map((p) => p.word).slice(0, 14);
        thumbnailStyleGuide = (nicheIntel as { thumbnailStyleGuide?: typeof thumbnailStyleGuide } | null)?.thumbnailStyleGuide;
        databank = (db as typeof databank) ?? undefined;
        competitorContext = [
          titles.length ? `Top titles:\n${titles.join("\n")}` : "",
          powerWords.length ? `Power words: ${powerWords.join(", ")}` : "",
        ].filter(Boolean).join("\n\n");
      }

      // 5a. Style DNA — the frozen, conformance contract (no generic fallback: a
      // thin distillation records its own grounding gaps for the Pipeline Doctor).
      styleDNA = await synthStyleDNA({
        family: payload.family, name, niche: identity.niche, persona: identity.persona,
        styleGrammar: identity.styleGrammar, palette: identity.palette,
        competitorTitles: titles, powerWords, thumbnailStyleGuide, databank,
        exampleClipNotes, now, log,
      });
      qualityBar = buildQualityBar(payload.family, styleDNA, now);
      log(
        styleDNA.confidence >= ESTABLISHED_CONFIDENCE
          ? `grounding: Style DNA established (confidence ${styleDNA.confidence}) — "${styleDNA.recurringSubject}"`
          : `grounding: Style DNA INCUBATING (confidence ${styleDNA.confidence}) — Doctor to heal ${styleDNA.groundingGaps.length} gap(s)`,
      );

      // 5b. Show Bible — the human-readable essence (motif drives the avatar),
      // seeded with the locked Style-DNA subject so the two never diverge.
      creativeBrief = await synthShowBible({
        family: payload.family, name, niche: identity.niche, persona: identity.persona,
        styleGrammar: identity.styleGrammar, competitorContext,
        motifHint: styleDNA.recurringSubject || undefined, now, log,
      });
    } catch (e) { log(`grounding failed (non-fatal): ${e instanceof Error ? e.message : e}`); }

    // 5c. DNA → PIPELINE PARAMS — make the designed modules channel-specific at
    // birth for the knobs runtime DNA reads can't reach (design-time params).
    // Only fills params the archetype/operator left unset — explicit values win.
    let floorPipeline = design.pipeline;
    try {
      if (styleDNA) {
        const pacingText = `${styleDNA.narrative?.pacing ?? ""} ${styleDNA.narrative?.delivery ?? ""}`.toLowerCase();
        const gap = /sleep|meditat|hypnot|very slow|drowsy/.test(pacingText) ? 1.8
          : /slow|gentle|calm|soothing|unhurried/.test(pacingText) ? 1.5
          : /fast|energetic|punchy|rapid|urgent/.test(pacingText) ? 0.6
          : undefined;
        const sStyle = (styleDNA.narrative?.scriptStyle ?? "").toLowerCase();
        const styleEnum = /crime|mystery|tension|noir/.test(sStyle) ? "crime"
          : /meditat|sleep|hypnot|guided/.test(sStyle) ? "meditation"
          : /short|punchy|rapid/.test(sStyle) ? "shorts"
          : undefined;
        const changed: string[] = [];
        const customizedBase = design.pipeline.map((e) => {
          const params: Record<string, unknown> = { ...(e.params ?? {}) };
          if (e.block === "narration_tts" && gap !== undefined && params.sentenceGapSec === undefined) {
            params.sentenceGapSec = gap;
            changed.push(`narration_tts.sentenceGapSec=${gap}`);
          }
          if (e.block === "script_gen") {
            if (gap !== undefined && params.sentenceGapSec === undefined) params.sentenceGapSec = gap;
            if (styleEnum && (params.style === undefined || params.style === "generic")) {
              params.style = styleEnum;
              changed.push(`script_gen.style=${styleEnum}`);
            }
          }
          return { block: e.block, params: Object.keys(params).length ? params : undefined };
        });
        if (changed.length) {
          await convex.mutation(api.channels.updateChannel, { channelId, pipeline: customizedBase });
          log(`pipeline customized from Style DNA: ${changed.join(", ")}`);
        }
        floorPipeline = customizedBase;
      }
    } catch (e) { log(`DNA pipeline customization failed (non-fatal): ${e instanceof Error ? e.message : e}`); }

    // 5d. PIPELINE ARCHITECT — the LLM that owns the module toolbox. It
    // interrogates the grounded identity (DNA + Bible + quality bar + grounding
    // evidence) and adds/removes/tunes modules so the pipeline fits THIS
    // channel; the deterministic floor above survives any failure. Decisions
    // are executed + validated in code; the full audit (incl. missing
    // capabilities = the module build queue, and grounding repair actions) is
    // persisted as channels.architectReport.
    // 5d/6/LABS run CONCURRENTLY — once grounding exists, the architect
    // (pipeline), channel art, and the evidence LABS are independent. This
    // roughly halves inception wall-time AND every future channel is BORN with
    // its thumbnail + script playbooks (no separate lab runs needed).
    let artFields: Partial<Awaited<ReturnType<typeof generateChannelArt>>> = {};
    await Promise.all([
      (async () => {
        try {
          if (!styleDNA) return;
          const arch = await architectPipeline({
            family: payload.family,
            channelName: name,
            niche: identity.niche,
            persona: identity.persona,
            pipeline: floorPipeline,
            dna: styleDNA,
            bible: creativeBrief,
            qualityBar,
            competitorCount,
            log,
          });
          if (arch) {
            await convex.mutation(api.channels.updateChannel, {
              channelId,
              pipeline: arch.pipeline,
              architectReport: arch.report,
            });
            log(`architect: ${arch.report.applied.length} applied / ${arch.report.rejected.length} rejected — ${arch.report.summary.slice(0, 160)}`);
            for (const m of arch.report.missingCapabilities) log(`architect MISSING CAPABILITY: ${m.name} — ${m.description}`);
            for (const g of arch.report.groundingActions) log(`architect GROUNDING ACTION: ${g}`);
          }
        } catch (e) { log(`architect failed (non-fatal, floor kept): ${e instanceof Error ? e.message : e}`); }
      })(),
      (async () => {
        try {
          artFields = await generateChannelArt(ownerId, slug, {
            name, persona: identity.persona, styleGrammar: identity.styleGrammar, palette: identity.palette, niche: identity.niche,
            iconicMotif: creativeBrief?.iconicMotif, vibe: creativeBrief?.vibe,
          }, log);
        } catch (e) { log(`channel art failed (non-fatal): ${e instanceof Error ? e.message : e}`); }
      })(),
      (async () => {
        try {
          if (!styleDNA) return;
          const { acquireReferences, verifyReferences, distillPlaybook } = await import("@/lib/thumbnailLab");
          const { distillScriptPlaybook } = await import("@/lib/scriptLab");
          const { makeRunTempDir } = await import("@/lib/files");
          const positioning = creativeBrief?.positioning ?? identity.persona ?? "";
          const fresh = await acquireReferences({ channelName: name, positioning, niche: identity.niche, log });
          const tmpDir = await makeRunTempDir(`lab_${slug}`);
          const [thumbPlay, scriptPlay] = await Promise.all([
            (async () => {
              const refs = await verifyReferences({ candidates: fresh, channelName: name, positioning, tmpDir, log });
              return distillPlaybook({ refs, dna: styleDNA!, channelName: name, positioning, log });
            })(),
            distillScriptPlaybook({
              refs: fresh.map((r) => ({ videoId: r.videoId, title: r.title, views: r.views })),
              dna: styleDNA!,
              channelName: name,
              positioning,
              log,
            }),
          ]);
          await convex.mutation(api.channels.updateChannel, {
            channelId,
            thumbnailPlaybook: thumbPlay,
            scriptPlaybook: scriptPlay,
          });
          log(`labs: BORN WITH PLAYBOOKS — ${thumbPlay.patterns.length} thumbnail patterns, ${scriptPlay.openingDevices.length} opening devices`);
        } catch (e) { log(`labs failed (non-fatal — runnable later via scripts/run-*-lab): ${e instanceof Error ? e.message : e}`); }
      })(),
    ]);

    // Single identity write carrying art, the SEO-expanded pool, and the Show Bible.
    try {
      await convex.mutation(api.channels.updateChannel, {
        channelId, identity: { ...identity, ...artFields, topicPool, ...(creativeBrief ? { creativeBrief } : {}) },
        ...(styleDNA ? { styleDNA } : {}),
        ...(qualityBar ? { qaRubric: qualityBar } : {}),
      });
    } catch (e) { log(`identity update failed (non-fatal): ${e instanceof Error ? e.message : e}`); }

    // 6b. Auto-PLAN the first batch of upcoming videos — topics + SEO titles +
    // custom thumbnails into the contentPlan queue, so a new channel launches with
    // a visible "week ahead" instead of an empty plan. Fire-and-forget (it reads the
    // identity we just persisted). Best-effort.
    try {
      const { tasks } = await import("@trigger.dev/sdk");
      await tasks.trigger("plan-week-ahead", { ownerId, channelId, count: 5 });
      log("auto-plan: triggered upcoming-video topics + thumbnails");
    } catch (e) { log(`auto-plan trigger failed (non-fatal): ${e instanceof Error ? e.message : e}`); }

    // 7. Auto-CREATE the YouTube channel (Browserbase, cloud) — creation is fully
    // autonomous; linking is left to a one-click Connect in the operator's own
    // browser (Google challenges/blocks the OAuth grant from datacenter IPs, so
    // automating consent is unreliable). Fire-and-forget. Default ON.
    if (payload.autoYoutube !== false) {
      try {
        const { tasks } = await import("@trigger.dev/sdk");
        await tasks.trigger("youtube-create-channel", { name, channelId });
        log("auto-create: triggered YouTube channel creation (link via Connect button)");
      } catch (e) { log(`auto-create trigger failed (non-fatal): ${e instanceof Error ? e.message : e}`); }
    }

    return {
      ok: true, channelId, slug, name, family: payload.family,
      status: design.available ? "paused" : "draft", warnings: design.warnings,
    };
  },
});
