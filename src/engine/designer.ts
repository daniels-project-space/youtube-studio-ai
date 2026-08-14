/**
 * Pipeline designer — derives a concrete, VALIDATED channel pipeline from a
 * family + niche + operator options. This is the deterministic backbone of the
 * channel builder: family → base archetype pipeline → apply length / footage
 * theme / locale / optional-module toggles → validatePipeline. (A Claude
 * "architect" + clip analysis layer on top later only adjusts these inputs.)
 */
import { ARCHETYPES } from "./archetypes";
import {
  FAMILIES,
  FAMILY_CREW,
  CREW_ROLE_BLOCK,
  assertFamilyAutonomousPlanningPipeline,
  familyAutonomousPlanningCapability,
  familyDurationContract,
  resolveFamilyEpisodeLengthSeconds,
  familyProductionReadiness,
  type FamilyKey,
} from "./families";
import { subcategoryTags } from "@/lib/nicheCatalog";
import { nichePreset } from "./golden";
import {
  dataStoryInsertParams,
  dataStoryProductionReadiness,
  isDataStoryContract,
  supportsDataStoryFamily,
  type DataStoryContract,
} from "./dataStory";
import { registerAllBlocks } from "./blocks";
import { validatePipeline } from "./validate";
import type { PipelineEntry } from "./types";
import {
  assertPipelineMatchesContentLane,
  contentLaneForFamily,
  injectContentLaneIntoPipeline,
  type ContentLane,
} from "./contentLane";
import {
  compilePipeline,
  completePipelineForPolicy,
  type PipelineCompilation,
} from "./pipelineCompiler";

export interface DesignOptions {
  family: FamilyKey;
  nicheKey?: string;
  subcategory?: string;
  lengthMinutes?: number; // narrated target length
  locale?: string; // "en" | "es" | "de" …
  footageTheme?: string; // narrated-stock visual theme, e.g. "nature"
  voiceFx?: string; // narration filter, e.g. "radio"
  publishMode?: string; // draft | scheduled | public
  /** Set only at an authenticated operator boundary after explicit confirmation. */
  approvedForPublish?: boolean;
  seriesTitle?: string; // ordered series mode, e.g. "7 Days of Stoic Calm"
  seriesCount?: number; // total episodes in the series (0/undefined = open-ended)
  /**
   * Structured external sources for the documentary-collage Short lane. These
   * are persisted on short_strategy and validated again before a render spends.
   */
  sourceReferences?: unknown;
  /**
   * Per-claim excerpts/locators for the documentary-collage Short lane. The
   * strategy lock refuses to map a claim to a source without this evidence.
   */
  claimEvidence?: unknown;
  /** Advanced editor: per-block param overrides, keyed by block id. */
  paramOverrides?: Record<string, Record<string, unknown>>;
  /**
   * Explicit opt-in for source-attributed chart-led narration. This is a
   * contract over the existing Data Inserts module, not a cosmetic toggle.
   */
  dataStory?: DataStoryContract;
  toggles?: {
    quotes?: boolean;
    captions?: boolean;
    chapters?: boolean;
    notify?: boolean;
    crosspost?: boolean;
    /** Auto-spin a 9:16 Short from each long-form (private-first). Default OFF. */
    shorts?: boolean;
    /** Mine source-windowed documentary Short candidates after a long-form draft. */
    documentaryCandidates?: boolean;
    /** Reusable visual-development contract for cinematic story renders. Default ON for cinematic. */
    visualMatter?: boolean;
    /** Film-crew creative-direction layer. Default ON. */
    crew?: boolean;
  };
}

export interface DesignResult {
  pipeline: PipelineEntry[];
  /** Exact resolved duration after applying the format contract and eligible niche preset. */
  episodeLengthSeconds: number;
  /** Immutable production lane persisted with the channel at creation. */
  contentLane: ContentLane;
  /** Whether the family template and its visual engine are implemented. */
  available: boolean;
  /** Whether the current provider/hardware contract can actually render it. */
  productionReady: boolean;
  runtimeBlockers: readonly string[];
  warnings: string[];
  compilation?: PipelineCompilation;
}

const OPTIONAL_BLOCKS = new Set([
  "quote_overlays",
  "captions",
  "notify",
  "crosspost",
]);

/** Build a validated pipeline for a channel from the wizard's choices. */
export function designPipeline(opts: DesignOptions): DesignResult {
  registerAllBlocks();
  const fam = FAMILIES[opts.family];
  if (!fam) throw new Error(`unknown family: ${opts.family}`);
  const base = ARCHETYPES[fam.archetypeKey];
  if (!base) throw new Error(`family ${opts.family} → unknown archetype ${fam.archetypeKey}`);
  if (opts.dataStory !== undefined && !isDataStoryContract(opts.dataStory)) {
    throw new Error("source-attributed data story must use the current typed evidence contract");
  }
  if (opts.dataStory && !supportsDataStoryFamily(opts.family)) {
    throw new Error("source-attributed data story is currently supported only by Narrated + Stock Footage");
  }

  const t = opts.toggles ?? {};
  const warnings: string[] = [];
  // Per-niche reference preset auto-populates length + script style on channel
  // inception when the operator/AI didn't specify them (so every niche launches
  // with its research-tuned defaults — covers wizard, API, and autopilot creation).
  const preset = nichePreset(opts.nicheKey);
  const duration = familyDurationContract(opts.family);
  let lenSec: number;
  if (opts.lengthMinutes !== undefined) {
    lenSec = resolveFamilyEpisodeLengthSeconds(opts.family, opts.lengthMinutes);
  } else {
    const presetSeconds = Number(preset?.targetSeconds);
    if (
      Number.isFinite(presetSeconds) &&
      presetSeconds >= duration.minimumSeconds &&
      presetSeconds <= duration.maximumSeconds
    ) {
      lenSec = Math.round(presetSeconds);
    } else {
      lenSec = duration.defaultSeconds;
      // A fixed-cadence product intentionally owns its timing. A long-form
      // niche preset is not an operator-visible conflict in that case; it is
      // simply inapplicable metadata and must not make a clean quiz look
      // degraded in the creator or readiness gate.
      if (duration.inputUnit !== "fixed" && Number.isFinite(presetSeconds) && presetSeconds > 0) {
        warnings.push(
          `${fam.label} uses its ${duration.defaultSeconds}s authored duration because the selected niche preset's ${Math.round(presetSeconds)}s target is outside this format's ${duration.minimumSeconds}–${duration.maximumSeconds}s contract.`,
        );
      }
    }
  }
  // Documentary collage Shorts are a distinct native-vertical product, not a
  // cropped long-form output. Keep every upstream sizing knob inside the
  // renderer's validated 5-7 beat window even when a channel preset is long.
  const documentaryShortTargetSec = opts.family === "documentary_collage_short"
    ? lenSec
    : undefined;
  const documentaryShortSources = opts.sourceReferences
    ?? opts.paramOverrides?.["short_strategy"]?.["sourceReferences"];
  const documentaryShortClaimEvidence = opts.claimEvidence
    ?? opts.paramOverrides?.["short_strategy"]?.["claimEvidence"];
  if (
    opts.family === "documentary_collage_short" &&
    (documentaryShortSources === undefined || documentaryShortClaimEvidence === undefined)
  ) {
    warnings.push(
      "Documentary collage Shorts require structured external sourceReferences and per-claim claimEvidence before a draft can render.",
    );
  }

  let pipeline: PipelineEntry[] = base.pipeline
    .filter((e) => {
      // honor optional-module toggles (default ON for quotes/captions/notify
      // when the base archetype includes them; crosspost default OFF).
      if (e.block === "quote_overlays" && t.quotes === false) return false;
      if (e.block === "captions" && t.captions === false) return false;
      if (e.block === "notify" && t.notify === false) return false;
      return true;
    })
    .map((e) => {
      const params: Record<string, unknown> = { ...(e.params ?? {}) };
      if (e.block === "script_gen" && lenSec) params.maxSeconds = lenSec;
      // Niche preset sets the script tone unless the archetype already pinned one.
      if (e.block === "script_gen" && preset?.scriptStyle && params.style === undefined) params.style = preset.scriptStyle;
      if (e.block === "length_check" && lenSec) {
        params.minSeconds = Math.round(lenSec * 0.6);
        params.maxSeconds = Math.round(lenSec * 1.8);
      }
      if (documentaryShortTargetSec !== undefined) {
        if (e.block === "topic_select" || e.block === "short_strategy" || e.block === "documotion_short") {
          params.targetSeconds = documentaryShortTargetSec;
        }
        if (e.block === "script_gen") params.maxSeconds = documentaryShortTargetSec;
        if (e.block === "length_check") {
          params.minSeconds = 20;
          params.maxSeconds = 60;
        }
      }
      if (e.block === "short_strategy" && documentaryShortSources !== undefined) {
        params.sourceReferences = documentaryShortSources;
      }
      if (e.block === "short_strategy" && documentaryShortClaimEvidence !== undefined) {
        params.claimEvidence = documentaryShortClaimEvidence;
      }
      if (e.block === "stock_footage") {
        if (opts.footageTheme) params.footageTheme = opts.footageTheme;
        else if (preset?.footageTheme) params.footageTheme = preset.footageTheme;
      }
      if (e.block === "topic_select" && opts.seriesTitle) {
        params.seriesTitle = opts.seriesTitle;
        if (opts.seriesCount) params.seriesCount = opts.seriesCount;
      }
      // Topic SCOPE guard: topicraft must know the video length — probes picked
      // "the complete history of the Roman Empire" for an 8-panel 3-min comic.
      if (e.block === "topic_select" && lenSec) {
        // Preserve the native-Short clamp above. Topic research needs the same
        // story scope as the renderer; otherwise a five-minute channel preset
        // quietly restores a five-minute topic brief after we pinned a 60s Short.
        params.targetSeconds = documentaryShortTargetSec ?? lenSec;
      }
      if (e.block === "script_gen" && opts.locale) params.language = opts.locale;
      if (e.block === "narration_tts") {
        if (opts.voiceFx) params.voiceFx = opts.voiceFx;
        if (opts.locale) params.language = opts.locale;
        if (t.chapters === false) params.chapterCards = false;
      }
      if (e.block === "metadata") {
        if (opts.locale) params.language = opts.locale;
        // Seed SEO tags from the chosen subcategory (v1 catalog defaults); the
        // metadata block expands them with AI at publish time.
        const seed = subcategoryTags(opts.nicheKey, opts.subcategory);
        if (seed.length) params.baseTags = seed;
      }
      if (e.block === "upload_draft" && opts.publishMode) {
        params.publishMode = opts.publishMode;
        if (
          (opts.publishMode === "public" || opts.publishMode === "scheduled") &&
          opts.approvedForPublish === true
        ) {
          params.approvedForPublish = true;
        }
      }
      // MUSIC-LOOP LENGTH actually honored: the wizard length used to reach only
      // script_gen/length_check (narrated-only blocks), so every lofi channel
      // shipped the archetype's hardcoded 3-min test render.
      if (e.block === "assemble" && opts.family === "music_loop" && lenSec) {
        params.durationSec = lenSec;
      }
      // Audio is audience-facing in every family: voice, score, ambience, or
      // game/quiz sound. The final-master aesthetics review is therefore part
      // of the production compiler rather than an optional music-only extra.
      if (e.block === "qa_visual" && params.audioQa === undefined) {
        params.audioQa = true;
      }
      if (e.block === "qa_visual" && params.qaProfile === undefined) {
        params.qaProfile = "production";
      }
      if (e.block === "music" && opts.family === "music_loop") {
        // V5 = highest-quality Suno tier; trackCount sizes the crossfaded mix to
        // the video length (~1 distinct track per 7 min, 2 clips per generation).
        // Lossless WAV matters when music IS the product — lofi opts in.
        if (params.model === undefined) params.model = "V5";
        if (params.preferWav === undefined) params.preferWav = true;
        if (params.trackCount === undefined && lenSec) {
          params.trackCount = Math.max(2, Math.min(8, Math.ceil(lenSec / 420)));
        }
      }
      // Advanced editor: per-block param overrides win over every derived value.
      // Only whitelisted keys from MODULE_CATALOG are accepted (sanitized upstream).
      const ov = opts.paramOverrides?.[e.block];
      if (ov) for (const [k, v] of Object.entries(ov)) {
        if (v !== undefined && v !== null && v !== "") params[k] = v;
      }
      return { block: e.block, params: Object.keys(params).length ? params : undefined };
    });

  // A child-directed pipeline may render an original private review candidate,
  // but it is never a generic publishing variant. Apply this after advanced
  // overrides so a UI/API caller cannot bypass the safety module or change its
  // audience/release semantics through parameter precedence.
  if (opts.family === "children_learning") {
    if (opts.publishMode && opts.publishMode !== "draft") {
      warnings.push("Children-learning ignores public/scheduled publish overrides; it can create a private review draft only.");
    }
    pipeline = pipeline.map((entry) => {
      const params = { ...(entry.params ?? {}) };
      if (entry.block === "script_gen") params.style = "children_learning";
      if (entry.block === "episode_graph") params.audience = "children";
      if (entry.block === "scene_compiler") {
        params.audience = "children";
        params.aspect = "16:9";
      }
      if (entry.block === "upload_draft") {
        params.publishMode = "draft";
        params.madeForKids = true;
      }
      return { block: entry.block, params: Object.keys(params).length ? params : undefined };
    });
  }

  // The quiz is the first independently production-admitted no-Gemini family.
  // Its planning, safety classification, metadata, critic receipt and thumbnail
  // are all deterministic modules with durable source/provenance receipts. Do
  // this as a pipeline rewrite rather than a conditional inside Topicraft: the
  // compiled graph itself makes the non-Gemini route inspectable and reusable.
  if (opts.family === "quizyear") {
    const pinnedTopic = opts.paramOverrides?.["quiz_year"]?.["topic"];
    const planner = familyAutonomousPlanningCapability("quizyear");
    const forbiddenPlannerBlocks = new Set(
      planner.mode === "registered_non_gemini" ? planner.forbiddenGeminiBlocks : [],
    );
    const safeDefaultCategories =
      "guess_year,capital_city,country_currency,element_symbol,element_atomic_number";
    pipeline = pipeline.flatMap((entry): PipelineEntry[] => {
      if (entry.block === "topic_select") {
        return [{
          block: "quiz_topic_plan",
          params: {
            ...(typeof pinnedTopic === "string" && pinnedTopic.trim()
              ? { pinnedTopic: pinnedTopic.trim() }
              : {}),
          },
        }];
      }
      if (entry.block === "compliance_check") return [{ block: "quiz_topic_safety" }];
      if (entry.block === "quiz_year") {
        const params = { ...(entry.params ?? {}) };
        // The archetype's former static topic is superseded by the planner's
        // topic-memory-backed selection. An explicit editor pin travels to the
        // planner above, never around it directly into the renderer.
        delete params.topic;
        if (params.categories === undefined) params.categories = safeDefaultCategories;
        params.noGemini = true;
        return [
          {
            block: "music",
            params: {
              provider: "mureka",
              trackCount: 1,
              prompt:
                "bright modern game-show instrumental, warm marimba and light percussion, playful but not childish, no vocals, no lyrics, clean loopable 100 BPM",
              ...(opts.paramOverrides?.["music"] ?? {}),
            },
          },
          { block: "quiz_year", params },
        ];
      }
      if (entry.block === "metadata") {
        return [{ block: "quiz_critic_spec" }, { block: "quiz_metadata" }];
      }
      if (entry.block === "thumbnail_gen") return [{ block: "quiz_thumbnail" }];
      // Every legacy crew/research entry has a Gemini-backed planner. Keep the
      // authoritative list on the family capability, so later crew changes
      // cannot silently reintroduce a provider call into this certified route.
      if (forbiddenPlannerBlocks.has(entry.block)) return [];
      return [entry];
    });
  }

  // GENERATED-VISUALS families use the complete authored-shot chain. Each shot
  // gets a pinned keyframe render, required asset selection, pinned I2V render,
  // and required shot QA before timeline assembly. Entity photos are excluded:
  // they would bypass the continuity ledger and exact editor timecodes.
  if (fam.visualEngine === "gen_footage" || fam.visualEngine === "ai_scenes") {
    pipeline = pipeline
      .filter((e) => e.block !== "entity_imagery")
      .flatMap((e) => (
        e.block === "stock_footage" || e.block === "gen_footage"
          ? [
              { block: "novita_render_images", params: { generationProfile: "production" } },
              { block: "qa_assets" },
              { block: "novita_render_video", params: { generationProfile: "production" } },
              { block: "qa_shots" },
            ]
          : [e]
      ));
  }

  // SIGNATURE CLIPS as an explicit block: if the architect set signatureGenClips
  // on stock_footage, run a dedicated signature_clips block BEFORE it — footage
  // SELECTION and signature GENERATION are separate concerns. The count moves to
  // the new block; stock_footage just prepends what it produced. (After the
  // gen_footage swap above, so gen-visual families never trigger this.)
  {
    const sf = pipeline.findIndex((e) => e.block === "stock_footage");
    const sfParams = sf >= 0 ? (pipeline[sf].params as Record<string, unknown> | undefined) : undefined;
    const k = Number(sfParams?.["signatureGenClips"] ?? 0);
    if (sf >= 0 && k > 0) {
      const stripped = { ...sfParams };
      delete stripped.signatureGenClips;
      pipeline[sf] = { block: "stock_footage", params: Object.keys(stripped).length ? stripped : undefined };
      pipeline.splice(sf, 0, { block: "signature_clips", params: { count: k } });
    }
  }

  // SELF-CONTAINED visual engines (whiteboard_scribe drawn-cinema, motion_comic
  // 3D comic page): each writes its own storyboard + narration and renders the
  // whole video itself, so it REPLACES the script -> narration -> footage ->
  // assemble chain with one visual-engine block placed right after the
  // topic/crew briefs. whiteboard KEEPS the music block (the scribe now beds
  // the produced track under the narration); comic REPLACES music too (the
  // engine scores itself with its own Suno bed).
  if (fam.visualEngine === "whiteboard_scribe" || fam.visualEngine === "motion_comic" || fam.visualEngine === "lore_short") {
    // POLICY GATES ARE NOT REPLACED: the old set stripped compliance_check +
    // originality_gate wholesale, so self-scripting engines shipped with ZERO
    // policy gate while topic intel could pick advertiser-hostile war topics.
    // compliance_check consumes `topic` (stays BEFORE the engine, in place);
    // originality_gate consumes `narrationText` (re-inserted AFTER the engine).
    const replaced = new Set([
      "script_gen", "hook_craft", "qa_script", "originality_gate",
      "narration_tts", "stock_footage", "gen_footage", "entity_imagery", "intro_card",
      "visual_inserts", "quote_overlays", "captions", "length_check", "timeline_assemble",
      // comic scores itself (its own Suno bed); lore_short muxes narration only
      // and reads no music key at all — leaving `music` in would buy a track
      // that plays in zero published videos.
      ...(fam.visualEngine === "motion_comic" || fam.visualEngine === "lore_short" ? ["music", "composer_brief"] : []),
    ]);
    pipeline = pipeline.filter((e) => !replaced.has(e.block));
    const briefBlocks = ["director_brief", "dp_brief", "editor_brief", "composer_brief", "critic_spec"];
    const anchor = Math.max(
      pipeline.findIndex((e) => e.block === "topic_select"),
      ...briefBlocks.map((b) => pipeline.findIndex((e) => e.block === b)),
    );
    const engineParams: Record<string, unknown> = {};
    if (fam.visualEngine === "motion_comic" && lenSec) {
      // ~22s of story per panel — a 3-min video plans ~8 panels (clamped 4-12
      // by the block). targetSeconds ALSO rides along: the engine budgets
      // spoken words per panel from it (first live comic ran 75s for a 180s
      // target because panels averaged ~9 spoken seconds).
      engineParams.panels = Math.max(4, Math.min(12, Math.round(lenSec / 22)));
      engineParams.targetSeconds = lenSec;
    }
    if (fam.visualEngine === "whiteboard_scribe" && lenSec) {
      // The scribe sized itself from its own defaults (6 panels / 150 words ≈
      // one minute) no matter what length the operator chose — the wizard's
      // lengthMinutes never reached the engine. The block converts this into
      // panels + word budget.
      engineParams.targetSeconds = lenSec;
    }
    if (fam.visualEngine === "lore_short" && lenSec) {
      // The block converts this into a beat count (~6s of screen time per beat,
      // clamped 6..16). Without it the engine falls back to its own 9-beat
      // default no matter what length the operator chose.
      engineParams.targetSeconds = lenSec;
    }
    // IDEMPOTENT: whiteboard/comic ride the generic `narrated-essay` archetype
    // (which does NOT name their engine, so it must be spliced in), whereas a
    // family whose archetype already declares its own engine must not get a
    // SECOND copy — two producers of `videoKey` fail pipeline validation.
    if (!pipeline.some((e) => e.block === fam.visualEngine)) {
      pipeline.splice(anchor + 1, 0, { block: fam.visualEngine, params: engineParams });
    } else if (Object.keys(engineParams).length) {
      // engineParams carry the OPERATOR's chosen length; the archetype's baked
      // defaults (art style, etc.) are kept but must not outrank it. Note
      // enforceLengthContract runs separately and does not cover this path.
      const existing = pipeline.find((e) => e.block === fam.visualEngine)!;
      existing.params = { ...(existing.params ?? {}), ...engineParams };
    }
    // originality_gate re-enters AFTER the engine (it judges the narration the
    // engine wrote); compliance_check must sit BEFORE it (gate the topic before
    // the paid art/voice spend, not after).
    {
      const ei = pipeline.findIndex((e) => e.block === fam.visualEngine);
      pipeline.splice(ei + 1, 0, { block: "originality_gate" });
      const ci = pipeline.findIndex((e) => e.block === "compliance_check");
      if (ci > ei && ei >= 0) {
        const [cc] = pipeline.splice(ci, 1);
        pipeline.splice(ei, 0, cc);
      }
    }
    // Whiteboard beds the produced music under its narration — the track must
    // exist BEFORE the engine runs, so move `music` ahead of it (it sat after,
    // where the archetype's footage stage used to be).
    if (fam.visualEngine === "whiteboard_scribe") {
      const ei = pipeline.findIndex((e) => e.block === "whiteboard_scribe");
      const mi = pipeline.findIndex((e) => e.block === "music");
      if (mi > ei && ei >= 0) {
        const [m] = pipeline.splice(mi, 1);
        pipeline.splice(ei, 0, m);
      }
    }
  }

  // Mirror the narration pacing into script_gen so the word budget accounts for
  // the real inter-sentence pauses AND voice speed (length math in scriptGen).
  const narrParams = pipeline.find((e) => e.block === "narration_tts")?.params;
  const sgEntry = pipeline.find((e) => e.block === "script_gen");
  if (sgEntry && narrParams) {
    if (typeof narrParams["sentenceGapSec"] === "number") {
      sgEntry.params = { ...(sgEntry.params ?? {}), sentenceGapSec: narrParams["sentenceGapSec"] };
    }
    if (typeof narrParams["ttsSpeed"] === "number") {
      sgEntry.params = { ...(sgEntry.params ?? {}), ttsSpeed: narrParams["ttsSpeed"] };
    }
    // ElevenLabs v3 voice → the writer places performable [audio tags].
    if (narrParams["ttsProvider"] === "elevenlabs") {
      sgEntry.params = { ...(sgEntry.params ?? {}), voiceTags: true };
    }
  }

  // Film crew (creative-direction layer, default ON): insert the family's crew
  // brief blocks right after topic_select, before the producers. They write the
  // VideoBrief slices the producers + QA consume. Each carries family +
  // targetSeconds so the agents size their briefs correctly.
  if (t.crew !== false) {
    // A certified autonomous planner owns its own deterministic editorial
    // receipt. A niche preset must not be able to reintroduce Gemini crew
    // briefs after the family has selected that route.
    const roles = opts.family === "quizyear"
      ? []
      : preset?.crew ?? FAMILY_CREW[opts.family] ?? [];
    const crewEntries: PipelineEntry[] = roles
      .map((r) => CREW_ROLE_BLOCK[r])
      .filter(Boolean)
      .map((block) => ({
        block,
        params: {
          family: opts.family,
          ...(lenSec ? { targetSeconds: lenSec } : {}),
        },
      }));
    if (crewEntries.length) {
      const after = pipeline.findIndex((e) => e.block === "topic_select");
      const at = after >= 0 ? after + 1 : 0;
      pipeline.splice(at, 0, ...crewEntries);
    }
  }

  // Every externally narrated family gets the versioned story artifact spine.
  // Self-contained comic/whiteboard engines own equivalent internal timing.
  if (
    pipeline.some((entry) => entry.block === "narration_tts") &&
    !pipeline.some((entry) => entry.block === "story_spine")
  ) {
    const narrationIndex = pipeline.findIndex((entry) => entry.block === "narration_tts");
    pipeline.splice(narrationIndex + 1, 0, {
      block: "story_spine",
      params: { generationProfile: "production", targetShotSec: opts.family === "shorts" ? 4 : 6 },
    });
  }

  // Visual Matter is a portable creative-development module, not a music-video
  // family. Cinematic is the first consumer: it turns the timed story spine
  // into mood, cast, setting, and per-shot storyboard locks before any paid
  // keyframe/video render. A disabled setting still emits a typed no-op
  // handoff, keeping downstream contracts deterministic.
  if (opts.family === "cinematic" && !pipeline.some((entry) => entry.block === "visual_matter")) {
    const storyIndex = pipeline.findIndex((entry) => entry.block === "story_spine");
    if (storyIndex < 0) throw new Error("cinematic Visual Matter requires the timed story spine");
    pipeline.splice(storyIndex + 1, 0, {
      block: "visual_matter",
      params: {
        enabled: t.visualMatter !== false,
        renderReferenceAssets: false,
        maxReferenceImages: 8,
        maxCharacters: 3,
        maxSettings: 3,
      },
    });
  }

  // Script-synced DATA-VIZ inserts (visual_inserts): existing niche presets
  // may opt into general number-driven inserts. The source-attributed data
  // story profile is stricter and requires an explicit typed contract; loose
  // advanced overrides cannot weaken its source or spoken-anchor safeguards.
  const insertParams: Record<string, unknown> | undefined = opts.dataStory
    ? dataStoryInsertParams(opts.dataStory)
    : preset?.insertTypes?.length
      ? { insertTypes: preset.insertTypes }
      : undefined;
  if (fam.narrated && insertParams && pipeline.some((entry) => entry.block === "timeline_assemble")) {
    const visualInsertOverrides = opts.paramOverrides?.visual_inserts ?? {};
    const maxInserts = Number(visualInsertOverrides.maxInserts);
    const minGapSec = Number(visualInsertOverrides.minGapSec);
    if (Number.isFinite(maxInserts) && maxInserts >= 1 && maxInserts <= 8) {
      insertParams.maxInserts = Math.round(maxInserts);
    }
    if (Number.isFinite(minGapSec) && minGapSec >= 0 && minGapSec <= 120) {
      insertParams.minGapSec = minGapSec;
    }
    if (!pipeline.some((entry) => entry.block === "visual_inserts")) {
      const entry: PipelineEntry = { block: "visual_inserts", params: insertParams };
      const anchors = ["quote_overlays", "intro_card", "narration_tts"];
      let at = -1;
      for (const a of anchors) {
        const i = pipeline.findIndex((e) => e.block === a);
        if (i >= 0) { at = i + 1; break; }
      }
      if (at > 0) pipeline.splice(at, 0, entry);
    }
    // CLOSED LOOP: the script must speak the numbers the insert layer renders.
    const sg = pipeline.find((e) => e.block === "script_gen");
    if (sg) {
      sg.params = {
        ...(sg.params ?? {}),
        dataRich: true,
        ...(opts.dataStory ? { sourceAttributionRequired: true } : {}),
      };
    }
    if (opts.dataStory) {
      const qa = pipeline.find((e) => e.block === "qa_script");
      if (qa) {
        qa.params = {
          ...(qa.params ?? {}),
          dataStoryContract: opts.dataStory.version,
          requireNamedSource: true,
          requireSpokenNumericAnchor: true,
        };
      }
    }
  } else if (opts.dataStory) {
    throw new Error("source-attributed data story requires a narrated timeline assembly pipeline");
  }

  // crosspost is opt-in — append before notify/cleanup if requested.
  if (t.crosspost) {
    const idx = pipeline.findIndex((e) => e.block === "notify" || e.block === "cleanup");
    const entry: PipelineEntry = {
      block: "crosspost",
      params: opts.approvedForPublish === true ? { approvedForPublish: true } : undefined,
    };
    if (idx >= 0) pipeline.splice(idx, 0, entry);
    else pipeline.push(entry);
  }

  // shorts spinoff is opt-in — append AFTER upload_draft (needs watchUrl) but
  // before notify/cleanup (cleanup deletes intermediates). Only when the family
  // produces a narration timeline (skip music-loop/lofi where there's no speech).
  if (t.shorts && opts.family !== "music_loop") {
    const hasUpload = pipeline.some((e) => e.block === "upload_draft");
    const hasTimings = pipeline.some((e) => e.block === "narration_tts");
    if (hasUpload && hasTimings) {
      const idx = pipeline.findIndex((e) => e.block === "notify" || e.block === "cleanup");
      const entry: PipelineEntry = { block: "shorts_spinoff" };
      if (idx >= 0) pipeline.splice(idx, 0, entry);
      else pipeline.push(entry);
    } else {
      warnings.push("shorts spinoff skipped: family has no narration upload to clip from.");
    }
  }

  // Documentary candidate mining is intentionally planning-only. It scans the
  // finished long-form's full narration timeline for diverse 35–60s windows,
  // but never crops/reuploads the parent master or silently launches a child
  // Short without a fresh source/evidence-backed strategy lock.
  if (t.documentaryCandidates) {
    const hasUpload = pipeline.some((e) => e.block === "upload_draft");
    const hasTimings = pipeline.some((e) => e.block === "narration_tts");
    const hasMetadata = pipeline.some((e) => e.block === "metadata");
    if (hasUpload && hasTimings && hasMetadata) {
      const idx = pipeline.findIndex((e) => e.block === "notify" || e.block === "cleanup");
      const entry: PipelineEntry = {
        block: "documentary_short_candidates",
        params: { targetSeconds: 52, maxCandidates: 6 },
      };
      if (idx >= 0) pipeline.splice(idx, 0, entry);
      else pipeline.push(entry);
    } else {
      warnings.push("documentary Short candidate mining skipped: a narrated draft with metadata is required.");
    }
  }

  const runtimeReadiness = familyProductionReadiness(opts.family);
  const dataStoryReadiness = opts.dataStory ? dataStoryProductionReadiness() : undefined;
  if (!fam.available) {
    warnings.push(
      `${fam.label}: the "${fam.visualEngine}" visual engine isn't built yet — channel will be created as a DRAFT and become runnable when that module ships.`,
    );
  }
  if (!runtimeReadiness.productionReady) {
    warnings.push(
      `${fam.label}: production rendering is blocked — ${runtimeReadiness.blockers.join(" ")}`,
    );
    if (runtimeReadiness.remediation) warnings.push(runtimeReadiness.remediation);
  }
  if (dataStoryReadiness && !dataStoryReadiness.autonomous) {
    warnings.push(
      `Source-attributed Data Story: automatic production is blocked — ${dataStoryReadiness.blockers.join(" ")}`,
    );
    warnings.push(dataStoryReadiness.remediation);
  }

  // Resolve uniquely identifiable policy/crew capability gaps from certified
  // manifests. Creative engine choices remain the designer's responsibility.
  const completed = completePipelineForPolicy(pipeline);
  pipeline = completed.entries;
  if (completed.inserted.length) {
    warnings.push(`Production compiler added required modules: ${completed.inserted.join(", ")}.`);
  }
  // Policy completion is shared with legacy families and may re-add a generic
  // research/crew module. A registered autonomous route is stricter: its
  // capability is the final authority over provider-backed planning entries.
  // Apply this *after* completion so the executable graph, not an earlier
  // intermediate, is what the admission assertion certifies.
  if (opts.family === "quizyear") {
    const planner = familyAutonomousPlanningCapability("quizyear");
    if (planner.mode === "registered_non_gemini") {
      pipeline = pipeline.filter((entry) => !planner.forbiddenGeminiBlocks.includes(entry.block));
    }
  }

  const contentLane = contentLaneForFamily(opts.family);
  if (!contentLane) throw new Error(`family ${opts.family} has no content lane policy`);
  assertPipelineMatchesContentLane(contentLane, pipeline);
  pipeline = injectContentLaneIntoPipeline(pipeline, contentLane);
  assertFamilyAutonomousPlanningPipeline(opts.family, pipeline);

  // Never persist an invalid graph.
  let compilation: PipelineCompilation | undefined;
  try {
    // contentLane is immutable channel configuration injected into the runtime
    // seed store by runPipeline.ts, not an executable block artifact. Seed it
    // here as well so creator-time validation verifies the same graph that the
    // runner will execute.
    const resolved = validatePipeline(pipeline, ["contentLane"]);
    if (fam.available) compilation = compilePipeline(resolved);
  } catch (e) {
    throw new Error(`designed pipeline invalid: ${e instanceof Error ? e.message : e}`);
  }

  const runtimeBlockers = [
    ...runtimeReadiness.blockers,
    ...(dataStoryReadiness?.blockers ?? []),
  ];
  return {
    pipeline,
    episodeLengthSeconds: lenSec,
    contentLane,
    available: fam.available,
    productionReady: fam.available && runtimeReadiness.productionReady && dataStoryReadiness?.autonomous !== false,
    runtimeBlockers,
    warnings,
    compilation,
  };
}

/**
 * OPERATOR LENGTH CONTRACT — the wizard's lengthMinutes is LAW, not a hint.
 * Live probes showed the architect escalating a requested 3-minute channel to
 * 540s, then its own probe-FIX pass to 720s (with a [432,1152] gate), while a
 * lofi pass silently reset assemble to the archetype's 3600s. Applied after
 * EVERY architect pass: the length-bearing knobs are pinned back to canon.
 */
export function enforceLengthContract(
  pipeline: PipelineEntry[],
  lenSec: number,
  family: FamilyKey,
): { pipeline: PipelineEntry[]; changed: string[] } {
  const changed: string[] = [];
  const out = pipeline.map((e) => {
    const p: Record<string, unknown> = { ...(e.params ?? {}) };
    const pin = (k: string, v: unknown) => {
      if (p[k] !== v) {
        changed.push(`${e.block}.${k}: ${String(p[k] ?? "unset")}→${String(v)}`);
        p[k] = v;
      }
    };
    if (e.block === "topic_select") pin("targetSeconds", lenSec);
    if (
      e.block === "director_brief" ||
      e.block === "dp_brief" ||
      e.block === "editor_brief" ||
      e.block === "composer_brief" ||
      e.block === "critic_spec"
    ) pin("targetSeconds", lenSec);
    if (e.block === "script_gen") pin("maxSeconds", lenSec);
    if (e.block === "length_check") {
      if (family === "documentary_collage_short") {
        pin("minSeconds", 20);
        pin("maxSeconds", 60);
      } else {
        pin("minSeconds", Math.round(lenSec * 0.6));
        pin("maxSeconds", Math.round(lenSec * 1.8));
      }
    }
    if (e.block === "assemble" && family === "music_loop") pin("durationSec", lenSec);
    if (e.block === "music" && family === "music_loop") {
      const want = Math.max(2, Math.min(8, Math.ceil(lenSec / 420)));
      if (Number(p["trackCount"] ?? 0) > want) pin("trackCount", want);
    }
    if (e.block === "whiteboard_scribe") pin("targetSeconds", lenSec);
    if (e.block === "lore_short") pin("targetSeconds", lenSec);
    if (e.block === "motion_comic") {
      pin("targetSeconds", lenSec);
      pin("panels", Math.max(4, Math.min(12, Math.round(lenSec / 22))));
    }
    if (e.block === "quiz_year") pin("targetSeconds", lenSec);
    if (family === "documentary_collage_short") {
      if (e.block === "short_strategy" || e.block === "documotion_short") {
        pin("targetSeconds", lenSec);
      }
    }
    return { block: e.block, params: Object.keys(p).length ? p : undefined };
  });
  return { pipeline: out, changed };
}

export { OPTIONAL_BLOCKS };
