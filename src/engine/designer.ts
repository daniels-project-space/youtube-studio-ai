/**
 * Pipeline designer — derives a concrete, VALIDATED channel pipeline from a
 * family + niche + operator options. This is the deterministic backbone of the
 * channel builder: family → base archetype pipeline → apply length / footage
 * theme / locale / optional-module toggles → validatePipeline. (A Claude
 * "architect" + clip analysis layer on top later only adjusts these inputs.)
 */
import { ARCHETYPES } from "./archetypes";
import { FAMILIES, FAMILY_CREW, CREW_ROLE_BLOCK, type FamilyKey } from "./families";
import { subcategoryTags } from "@/lib/nicheCatalog";
import { nichePreset } from "./golden";
import { registerAllBlocks } from "./blocks";
import { validatePipeline } from "./validate";
import type { PipelineEntry } from "./types";
import {
  assertPipelineMatchesContentLane,
  contentLaneForFamily,
  injectContentLaneIntoPipeline,
  CONTENT_LANE_BY_FAMILY,
  CONTENT_LANE_POLICIES,
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
  /** Immutable production lane persisted with the channel at creation. */
  contentLane: ContentLane;
  available: boolean; // false → family's visual engine not built yet (save as draft)
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

  const t = opts.toggles ?? {};
  const warnings: string[] = [];
  // Per-niche reference preset auto-populates length + script style on channel
  // inception when the operator/AI didn't specify them (so every niche launches
  // with its research-tuned defaults — covers wizard, API, and autopilot creation).
  const preset = nichePreset(opts.nicheKey);
  const lenSec = opts.lengthMinutes ? Math.round(opts.lengthMinutes * 60) : preset?.targetSeconds;
  // Documentary collage Shorts are a distinct native-vertical product, not a
  // cropped long-form output. Keep every upstream sizing knob inside the
  // renderer's validated 5-7 beat window even when a channel preset is long.
  const documentaryShortTargetSec = opts.family === "documentary_collage_short"
    ? Math.max(35, Math.min(60, Number(lenSec ?? 52)))
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
      // Music channels: the audio IS the product — score it (audiobox advisory).
      if (e.block === "qa_visual" && opts.family === "music_loop" && params.audioQa === undefined) {
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
    // Niche preset roster wins over the family default when present.
    const roles = preset?.crew ?? FAMILY_CREW[opts.family] ?? [];
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
  //
  // ...UNLESS the family's own content lane explicitly forbids it. The lane is
  // already the authority on which blocks may appear (assertPipelineMatchesContentLane
  // rejects a forbidden block), so auto-inserting one here would have designed a
  // pipeline that its own contract immediately invalidates. Today only the
  // chart lanes forbid `story_spine` — a shot-planning artifact that a
  // typography-and-data renderer has no shots to plan and never reads — so this
  // is a no-op for every pre-existing family.
  const laneForbiddenBlocks = new Set(
    CONTENT_LANE_POLICIES[CONTENT_LANE_BY_FAMILY[opts.family]]?.forbiddenBlocks ?? [],
  );
  if (
    pipeline.some((entry) => entry.block === "narration_tts") &&
    !pipeline.some((entry) => entry.block === "story_spine") &&
    !laneForbiddenBlocks.has("story_spine")
  ) {
    const narrationIndex = pipeline.findIndex((entry) => entry.block === "narration_tts");
    pipeline.splice(narrationIndex + 1, 0, {
      block: "story_spine",
      params: {
        generationProfile: "production",
        // 10s for the POV vlog, not 6. This is a format fact before it is a
        // cost fact: a person talking to a camera they are holding is a
        // CONTINUOUS TAKE, and cutting them every six seconds is what makes an
        // AI vlog read as an AI vlog. It also halves the shot count, which is
        // what keeps an 8-minute episode inside the same per-block spend
        // ceilings the cinematic family already lives under.
        targetShotSec: opts.family === "shorts" ? 4 : opts.family === "povvlog" ? 10 : 6,
        // WHICH CAMERA GRAMMAR the shots are planned in (src/lib/shotComposition.ts).
        // Only the POV family departs from the third-person cinematic default,
        // and the default is the planner's pre-existing behaviour byte-for-byte,
        // so this changes nothing for any other family. It is a param rather
        // than a family lookup inside the planner because an operator may
        // legitimately want handheld framing on a channel that is not this
        // family, and a hardcoded family check would forbid that.
        ...(opts.family === "povvlog" ? { shotComposition: "pov_handheld_vlog" } : {}),
      },
    });
  }

  // Visual Matter is a portable creative-development module, not a music-video
  // family. Cinematic is the first consumer: it turns the timed story spine
  // into mood, cast, setting, and per-shot storyboard locks before any paid
  // keyframe/video render. A disabled setting still emits a typed no-op
  // handoff, keeping downstream contracts deterministic.
  // `povvlog` is the second consumer for the same structural reason: it runs
  // the identical Novita chain, and every block in that chain HARD-requires
  // `visualMatterManifest` (requireVisualMatter throws without it). Omitting it
  // here would design a pipeline that cannot execute.
  if (
    (opts.family === "cinematic" || opts.family === "povvlog") &&
    !pipeline.some((entry) => entry.block === "visual_matter")
  ) {
    const storyIndex = pipeline.findIndex((entry) => entry.block === "story_spine");
    if (storyIndex < 0) throw new Error("generated-scene Visual Matter requires the timed story spine");
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

  // Script-synced DATA-VIZ inserts (visual_inserts): identity-driven module
  // selection — niches that speak numbers (finance/health/tech/history…) get
  // the Remotion motion-graphics layer; others skip it entirely. Placed after
  // quote_overlays (shares its compositing pass + avoids window clashes).
  // ...unless the lane forbids it. `visual_inserts` writes `insertOverlays` for
  // timeline_assemble to composite; a lane with no assembler never reads them,
  // so on the chart lanes this was an LLM call per run producing dead work — on
  // top of being a second data-viz layer inside a video that IS one.
  if (fam.narrated && preset?.insertTypes?.length && !laneForbiddenBlocks.has("visual_inserts")) {
    const entry: PipelineEntry = {
      block: "visual_inserts",
      params: { insertTypes: preset.insertTypes },
    };
    const anchors = ["quote_overlays", "intro_card", "narration_tts"];
    let at = -1;
    for (const a of anchors) {
      const i = pipeline.findIndex((e) => e.block === a);
      if (i >= 0) { at = i + 1; break; }
    }
    if (at > 0) {
      pipeline.splice(at, 0, entry);
      // CLOSED LOOP: the script must SPEAK the numbers the inserts render —
      // without this, a "cinematic" script hedges qualitatively and the
      // Insert Director has nothing legitimate to visualize.
      const sg = pipeline.find((e) => e.block === "script_gen");
      if (sg) sg.params = { ...(sg.params ?? {}), dataRich: true };
    }
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

  if (!fam.available) {
    warnings.push(
      `${fam.label}: the "${fam.visualEngine}" visual engine isn't built yet — channel will be created as a DRAFT and become runnable when that module ships.`,
    );
  }

  // Resolve uniquely identifiable policy/crew capability gaps from certified
  // manifests. Creative engine choices remain the designer's responsibility.
  const completed = completePipelineForPolicy(pipeline);
  pipeline = completed.entries;
  if (completed.inserted.length) {
    warnings.push(`Production compiler added required modules: ${completed.inserted.join(", ")}.`);
  }

  const contentLane = contentLaneForFamily(opts.family);
  if (!contentLane) throw new Error(`family ${opts.family} has no content lane policy`);
  assertPipelineMatchesContentLane(contentLane, pipeline);
  pipeline = injectContentLaneIntoPipeline(pipeline, contentLane);

  // Never persist an invalid graph.
  let compilation: PipelineCompilation | undefined;
  try {
    const resolved = validatePipeline(pipeline);
    if (fam.available) compilation = compilePipeline(resolved);
  } catch (e) {
    throw new Error(`designed pipeline invalid: ${e instanceof Error ? e.message : e}`);
  }

  return { pipeline, contentLane, available: fam.available, warnings, compilation };
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
    if (e.block === "script_gen") pin("maxSeconds", lenSec);
    if (e.block === "length_check") {
      pin("minSeconds", Math.round(lenSec * 0.6));
      pin("maxSeconds", Math.round(lenSec * 1.8));
    }
    if (e.block === "assemble" && family === "music_loop") pin("durationSec", lenSec);
    if (e.block === "music" && family === "music_loop") {
      const want = Math.max(2, Math.min(8, Math.ceil(lenSec / 420)));
      if (Number(p["trackCount"] ?? 0) > want) pin("trackCount", want);
    }
    if (e.block === "whiteboard_scribe") pin("targetSeconds", lenSec);
    if (e.block === "lore_short") pin("targetSeconds", lenSec);
    if (e.block === "motion_comic") pin("panels", Math.max(4, Math.min(12, Math.round(lenSec / 22))));
    return { block: e.block, params: Object.keys(p).length ? p : undefined };
  });
  return { pipeline: out, changed };
}

export { OPTIONAL_BLOCKS };
