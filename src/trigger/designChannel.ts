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
import type { PipelineEntry } from "@/engine/types";
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
  // Inception now includes up to TWO end-to-end probe renders (~10-20 min
  // each at 60s scale) — the channel isn't "ready" until it has PROVEN it can
  // finish a video.
  maxDuration: 3600,
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
      // AUDIT FIX: the wizard's Advanced-editor per-block overrides were sent
      // but never forwarded — every advanced knob silently did nothing.
      paramOverrides: payload.paramOverrides,
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
        ?? (fam.defaultThumbnailStyle === "title_card" ? "title_card" : "banana"),
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
          // Operator hard rail: wizard toggles set to OFF may never be re-added
          // by the architect, however good its identity reasoning.
          const t = payload.toggles ?? {};
          const disabledBlocks = [
            t.shorts === false ? "shorts_spinoff" : "",
            t.crosspost === false ? "crosspost" : "",
            t.quotes === false ? "quote_overlays" : "",
            t.notify === false ? "notify" : "",
          ].filter(Boolean);
          // VOICE CASTING — audition real ElevenLabs voices against the DNA
          // register, judged by a model that LISTENS; the architect casts the
          // winner when the channel deserves the premium tier.
          let voiceCasting = null;
          if (fam.narrated && styleDNA) {
            try {
              const { castVoice } = await import("@/lib/voiceCasting");
              voiceCasting = await castVoice({ channelName: name, niche: identity.niche, dna: styleDNA, log });
              if (voiceCasting) {
                await convex.mutation(api.channels.updateChannel, {
                  channelId,
                  identity: { ...identity, voiceCasting } as typeof identity,
                });
              }
            } catch (e) { log(`voiceCasting skipped: ${e instanceof Error ? e.message : e}`); }
          }
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
            disabledBlocks,
            voiceCasting,
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

            // MODULE FORGE: instead of leaving missing capabilities as wishes,
            // AUTHOR them — Claude writes a declarative spec over the trusted
            // primitives (schema-gated), it persists fleet-wide, and the
            // architect re-runs ONCE with the new tools so it can wire them in.
            const forgeable = arch.report.missingCapabilities.slice(0, 2);
            if (forgeable.length) {
              try {
                const { authorForgedModule } = await import("@/engine/forge/forge");
                const { registerForgedSpecs } = await import("@/engine/forge/runtime");
                const { toolFromForgedSpec } = await import("@/engine/creative/architect");
                const forgedTools = [];
                for (const cap of forgeable) {
                  const res = await authorForgedModule({
                    capability: cap, channelName: name, niche: identity.niche, dna: styleDNA, log,
                  });
                  if ("error" in res) { log(`forge: ${cap.name} — ${res.error.slice(0, 160)}`); continue; }
                  await convex.mutation(api.forgedModules.save, {
                    ownerId, blockId: res.spec.id, spec: res.spec, status: "active",
                    forChannelId: channelId, capability: cap.name,
                  });
                  registerForgedSpecs([res.spec]);
                  forgedTools.push(toolFromForgedSpec(res.spec));
                  log(`forge: CREATED ${res.spec.id} for "${cap.name}" (${res.spec.steps.length} steps, ceiling $${res.spec.maxCostUsd})`);
                }
                if (forgedTools.length) {
                  const arch2 = await architectPipeline({
                    family: payload.family, channelName: name, niche: identity.niche,
                    persona: identity.persona, pipeline: arch.pipeline, dna: styleDNA,
                    bible: creativeBrief, qualityBar, competitorCount, disabledBlocks, forgedTools, log,
                  });
                  if (arch2) {
                    await convex.mutation(api.channels.updateChannel, {
                      channelId, pipeline: arch2.pipeline,
                      architectReport: { ...arch2.report, forged: forgedTools.map((t) => t.block) },
                    });
                    log(`architect (post-forge): ${arch2.report.applied.length} applied — forged modules wired in`);
                  }
                }
              } catch (e) { log(`forge loop failed (non-fatal): ${e instanceof Error ? e.message : e}`); }
            }
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

    // 8. ARCHITECT CHANNEL-LEVEL OUTPUTS: apply the proposed upload schedule
    // when the operator didn't pin one (operator choice always wins).
    try {
      const chNow = await convex.query(api.channels.getChannel, { channelId });
      const archReport = (chNow as { architectReport?: { schedule?: { frequency: string; days?: number[] }; budgetAllocation?: string } } | null)?.architectReport;
      if (!payload.cadence && archReport?.schedule) {
        await convex.mutation(api.channels.updateChannel, {
          channelId,
          schedule: { frequency: archReport.schedule.frequency, days: archReport.schedule.days },
        });
        log(`architect schedule applied: ${archReport.schedule.frequency} (days ${archReport.schedule.days?.join(",") ?? "any"})`);
      }
      if (archReport?.budgetAllocation) log(`architect budget allocation: ${archReport.budgetAllocation}`);
    } catch (e) { log(`schedule apply skipped: ${e instanceof Error ? e.message : e}`); }

    // 9. PROBE RENDER — prove the architected pipeline can START AND FINISH a
    // video end-to-end BEFORE the channel is declared ready. A cheap ~60s test
    // exercises every module (script→voice→visuals→music→assembly→QA, upload
    // skipped). On failure the architect gets the error and FIXES its own
    // config; one re-probe. Still failing → channel stays DRAFT with the
    // report (never "ready" on hope).
    let probeOutcome: { ok: boolean; attempts: number; error?: string } = { ok: !design.available, attempts: 0 };
    if (design.available) {
      try {
        const { tasks } = await import("@trigger.dev/sdk");
        for (let attempt = 1; attempt <= 2; attempt++) {
          const chNow = await convex.query(api.channels.getChannel, { channelId });
          const probePipe = buildProbePipeline((chNow?.pipeline ?? design.pipeline) as PipelineEntry[]);
          const probeRunId = await convex.mutation(api.runs.createRun, { ownerId, channelId });
          log(`probe: attempt ${attempt} — 60s end-to-end test (${probePipe.length} blocks, upload skipped)`);
          await tasks.triggerAndWait(
            "run-pipeline",
            { channelId, runId: probeRunId, pipelineOverride: probePipe },
            { concurrencyKey: String(channelId) },
          );
          const run = await convex.query(api.runs.getRun, { runId: probeRunId as Id<"runs"> });
          if (run?.status === "ok") {
            probeOutcome = { ok: true, attempts: attempt };
            log(`probe PASSED on attempt ${attempt} — pipeline proven end-to-end ✓`);
            // CRITICAL DIAL-IN: the architect now reviews the ACTUAL probe
            // output — the video (native watch: vision+audio), the thumbnail
            // (vision vs the DNA spec), and the SEO it really produced — and
            // tunes the pipeline against what the channel is SUPPOSED to be.
            try {
              if (styleDNA) {
                const review = await reviewProbeArtifacts(convex, probeRunId as Id<"runs">, name, styleDNA, log);
                const tune = await architectPipeline({
                  family: payload.family, channelName: name, niche: identity.niche,
                  persona: identity.persona,
                  pipeline: ((await convex.query(api.channels.getChannel, { channelId }))?.pipeline ?? design.pipeline) as PipelineEntry[],
                  dna: styleDNA, bible: creativeBrief, qualityBar, competitorCount,
                  probeReport: { ok: true, ...review }, log,
                });
                if (tune && (tune.report.applied.length || tune.report.groundingActions.length)) {
                  await convex.mutation(api.channels.updateChannel, {
                    channelId, pipeline: tune.pipeline,
                    architectReport: { ...tune.report, probeDialIn: { feel: review.feel, thumbnailCritique: review.thumbnailCritique?.slice(0, 300) } },
                  });
                  log(`probe DIAL-IN: ${tune.report.applied.length} tuning change(s) applied from the critical review`);
                }
              }
            } catch (e) { log(`probe dial-in skipped (non-fatal): ${e instanceof Error ? e.message : e}`); }
            break;
          }
          const error = String((run as { error?: string } | null)?.error ?? "unknown failure");
          const stages = await convex.query(api.runStages.listRunStages, { runId: probeRunId as Id<"runs"> });
          const failedBlock = (stages as { block: string; status: string }[]).find((s) => s.status === "failed")?.block;
          probeOutcome = { ok: false, attempts: attempt, error: error.slice(0, 300) };
          log(`probe FAILED at ${failedBlock ?? "?"}: ${error.slice(0, 200)}`);
          if (attempt === 1 && styleDNA) {
            // FIX PASS: the architect sees the real failure and corrects itself.
            const fix = await architectPipeline({
              family: payload.family, channelName: name, niche: identity.niche,
              persona: identity.persona, pipeline: (chNow?.pipeline ?? design.pipeline) as PipelineEntry[],
              dna: styleDNA, bible: creativeBrief, qualityBar, competitorCount,
              probeReport: { ok: false, error, failedBlock }, log,
            });
            if (fix) {
              await convex.mutation(api.channels.updateChannel, {
                channelId, pipeline: fix.pipeline,
                architectReport: { ...fix.report, probeFix: { attempt, error: error.slice(0, 200), failedBlock } },
              });
              log(`probe FIX applied: ${fix.report.applied.length} change(s) — re-probing`);
            }
          }
        }
        if (!probeOutcome.ok) {
          await convex.mutation(api.channels.updateChannel, { channelId, status: "draft" });
          log(`probe: FAILED after ${probeOutcome.attempts} attempt(s) — channel stays DRAFT (honest: it cannot yet finish a video)`);
        }
      } catch (e) { log(`probe loop error (channel kept as designed): ${e instanceof Error ? e.message : e}`); }
    }

    return {
      ok: true, channelId, slug, name, family: payload.family,
      status: !design.available ? "draft" : probeOutcome.ok ? "paused" : "draft",
      probe: probeOutcome, warnings: design.warnings,
    };
  },
});

/**
 * CRITICAL-REVIEW evidence for a successful probe: native full-watch of the
 * probe video (Gemini sees motion AND hears audio), a vision critique of the
 * thumbnail vs the DNA spec, and the SEO the run actually produced. All
 * best-effort — a missing artifact just narrows the review.
 */
async function reviewProbeArtifacts(
  convex: ConvexHttpClient,
  runId: Id<"runs">,
  channelName: string,
  dna: { recurringSubject?: string; setting?: string; motifs?: string[]; thumbnail?: { subject?: string; palette?: string[] }; seo?: { titleFormula?: string } },
  log: (m: string) => void,
): Promise<{
  feel?: { moodMatch?: number; pacing?: number; musicFit?: number; summary?: string };
  defects?: string[];
  thumbnailCritique?: string;
  seo?: { title?: string; description?: string; tags?: string[] };
  notes?: string;
}> {
  const stages = await convex.query(api.runStages.listRunStages, { runId });
  const sOut = (block: string) =>
    (stages.find((s: { block: string; status: string }) => s.block === block && s.status === "ok") as
      | { outputs?: Record<string, unknown> }
      | undefined)?.outputs ?? {};
  const out: Awaited<ReturnType<typeof reviewProbeArtifacts>> = {};

  // SEO as actually produced.
  const meta = sOut("metadata");
  if (meta["title"]) {
    out.seo = {
      title: String(meta["title"]),
      description: String(meta["description"] ?? "").slice(0, 300),
      tags: (meta["tags"] as string[] | undefined)?.slice(0, 15),
    };
  }

  const { getObjectBytes } = await import("@/lib/storage");
  const { writeBytes, makeRunTempDir } = await import("@/lib/files");
  const { join } = await import("node:path");
  const tmp = await makeRunTempDir(`probe_review_${runId}`);

  // NATIVE WATCH of the probe video — sees motion, hears the mix.
  try {
    const videoKey = String(sOut("timeline_assemble")["videoKey"] ?? "");
    const durationSec = Number(sOut("timeline_assemble")["videoDurationSec"] ?? 0);
    if (videoKey && durationSec > 5) {
      const vPath = join(tmp, "probe.mp4");
      await writeBytes(vPath, await getObjectBytes(videoKey));
      const { nativeWatchRender } = await import("@/lib/renderWatch");
      const watch = await nativeWatchRender(
        vPath, durationSec,
        {
          title: String(meta["title"] ?? channelName),
          channelWorld: [dna.recurringSubject, dna.setting, ...(dna.motifs ?? []).slice(0, 3)].filter(Boolean).join("; "),
        },
        { log },
      );
      if (watch) {
        out.feel = { moodMatch: watch.moodMatch, pacing: watch.pacing, musicFit: watch.musicFit, summary: watch.summary };
        out.defects = watch.defects.map((d) => `[${d.severity}] ${d.issue}`).slice(0, 8);
      }
    }
  } catch (e) { log(`probe review: native watch skipped: ${e instanceof Error ? e.message : e}`); }

  // THUMBNAIL vision critique vs the DNA spec.
  try {
    const thumbKey = String(sOut("thumbnail_gen")["thumbnailKey"] ?? "");
    if (thumbKey) {
      const tPath = join(tmp, "probe_thumb.jpg");
      await writeBytes(tPath, await getObjectBytes(thumbKey));
      const { geminiVisionLocal, parseJsonLoose } = await import("@/lib/gemini");
      const raw = await geminiVisionLocal({
        prompt:
          `CRITICAL thumbnail review for "${channelName}". The channel's locked thumbnail identity: ` +
          `subject "${dna.thumbnail?.subject ?? dna.recurringSubject ?? "?"}", palette ${(dna.thumbnail?.palette ?? []).join(",") || "?"}.\n` +
          `Judge HARSHLY: on-identity? instantly readable at feed size? premium craft or template-y? ` +
          `Return STRICT JSON {"score":1-10,"critique":"<=60 words: the gaps vs the identity and what to change"}.`,
        imagePaths: [tPath],
        json: true,
        maxTokens: 300,
      });
      const v = parseJsonLoose<{ score?: number; critique?: string }>(raw);
      out.thumbnailCritique = `${v.score ?? "?"}/10 — ${v.critique ?? ""}`;
      log(`probe review: thumbnail ${out.thumbnailCritique.slice(0, 100)}`);
    }
  } catch (e) { log(`probe review: thumbnail critique skipped: ${e instanceof Error ? e.message : e}`); }

  return out;
}

/**
 * Shrink a production pipeline into a cheap ~60s END-TO-END probe: every
 * module still runs (the point is proving the whole machine), but short,
 * single-track, few-clips, and WITHOUT publishing (upload/notify/cleanup and
 * spin-offs dropped).
 */
function buildProbePipeline(pipe: PipelineEntry[]): PipelineEntry[] {
  const DROP = new Set(["upload_draft", "notify", "cleanup", "shorts_spinoff", "crosspost", "emit_bundle"]);
  return pipe
    .filter((e) => !DROP.has(e.block))
    .map((e) => {
      const p: Record<string, unknown> = { ...(e.params ?? {}) };
      if (e.block === "script_gen") { p.maxSeconds = 60; p.endWithSummary = false; }
      if (e.block === "length_check") { p.minSeconds = 20; p.maxSeconds = 220; }
      if (e.block === "music") { p.trackCount = 1; }
      if (e.block === "gen_footage") { p.maxClips = 6; }
      if (e.block === "stock_footage") { p.signatureGenClips = 0; }
      if (e.block === "visual_inserts") { p.maxInserts = 1; }
      if (e.block === "quote_overlays") { p.maxQuotes = 1; }
      if (e.block === "assemble") { p.durationSec = 120; }
      return { block: e.block, params: Object.keys(p).length ? p : undefined };
    });
}
