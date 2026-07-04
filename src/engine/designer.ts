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

export interface DesignOptions {
  family: FamilyKey;
  nicheKey?: string;
  subcategory?: string;
  lengthMinutes?: number; // narrated target length
  locale?: string; // "en" | "es" | "de" …
  footageTheme?: string; // narrated-stock visual theme, e.g. "nature"
  voiceFx?: string; // narration filter, e.g. "radio"
  publishMode?: string; // draft | scheduled | public
  seriesTitle?: string; // ordered series mode, e.g. "7 Days of Stoic Calm"
  seriesCount?: number; // total episodes in the series (0/undefined = open-ended)
  /** Advanced editor: per-block param overrides, keyed by block id. */
  paramOverrides?: Record<string, Record<string, unknown>>;
  toggles?: {
    quotes?: boolean;
    captions?: boolean;
    chapters?: boolean;
    refine?: boolean;
    notify?: boolean;
    crosspost?: boolean;
    /** Auto-spin a 9:16 Short from each long-form (private-first). Default OFF. */
    shorts?: boolean;
    /** Film-crew creative-direction layer. Default ON. */
    crew?: boolean;
  };
}

export interface DesignResult {
  pipeline: PipelineEntry[];
  available: boolean; // false → family's visual engine not built yet (save as draft)
  warnings: string[];
}

const OPTIONAL_BLOCKS = new Set([
  "quote_overlays",
  "captions",
  "qa_refine",
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
  // Per-niche golden preset auto-populates length + script style on channel
  // inception when the operator/AI didn't specify them (so every niche launches
  // with its research-tuned defaults — covers wizard, API, and autopilot creation).
  const preset = nichePreset(opts.nicheKey);
  const lenSec = opts.lengthMinutes ? Math.round(opts.lengthMinutes * 60) : preset?.targetSeconds;

  let pipeline: PipelineEntry[] = base.pipeline
    .filter((e) => {
      // honor optional-module toggles (default ON for quotes/captions/refine/notify
      // when the base archetype includes them; crosspost default OFF).
      if (e.block === "quote_overlays" && t.quotes === false) return false;
      if (e.block === "captions" && t.captions === false) return false;
      if (e.block === "qa_refine" && t.refine === false) return false;
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
      if (e.block === "stock_footage") {
        if (opts.footageTheme) params.footageTheme = opts.footageTheme;
        else if (preset?.footageTheme) params.footageTheme = preset.footageTheme;
      }
      if (e.block === "topic_select" && opts.seriesTitle) {
        params.seriesTitle = opts.seriesTitle;
        if (opts.seriesCount) params.seriesCount = opts.seriesCount;
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
      if (e.block === "upload_draft" && opts.publishMode) params.publishMode = opts.publishMode;
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

  // GENERATED-VISUALS families (whiteboard, cinematic): the world cannot come
  // from a stock library — swap stock_footage for gen_footage IN PLACE (same
  // footageClips contract, timeline unchanged). entity_imagery (photoreal
  // portraits) is dropped too: real photographs break a drawn/painted world.
  if (fam.visualEngine === "gen_footage" || fam.visualEngine === "ai_scenes") {
    pipeline = pipeline
      .filter((e) => e.block !== "entity_imagery")
      .map((e) => (e.block === "stock_footage" ? { block: "gen_footage", params: e.params } : e));
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
  if (fam.visualEngine === "whiteboard_scribe" || fam.visualEngine === "motion_comic") {
    const replaced = new Set([
      "script_gen", "hook_craft", "qa_script", "originality_gate", "compliance_check",
      "narration_tts", "stock_footage", "gen_footage", "entity_imagery", "intro_card",
      "visual_inserts", "quote_overlays", "captions", "length_check", "timeline_assemble",
      ...(fam.visualEngine === "motion_comic" ? ["music", "composer_brief"] : []),
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
      // by the block). Keeps "lengthMinutes" meaningful for comic channels.
      engineParams.panels = Math.max(4, Math.min(12, Math.round(lenSec / 22)));
    }
    pipeline.splice(anchor + 1, 0, { block: fam.visualEngine, params: engineParams });
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

  // Script-synced DATA-VIZ inserts (visual_inserts): identity-driven module
  // selection — niches that speak numbers (finance/health/tech/history…) get
  // the Remotion motion-graphics layer; others skip it entirely. Placed after
  // quote_overlays (shares its compositing pass + avoids window clashes).
  if (fam.narrated && preset?.insertTypes?.length) {
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
    const entry: PipelineEntry = { block: "crosspost" };
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

  if (!fam.available) {
    warnings.push(
      `${fam.label}: the "${fam.visualEngine}" visual engine isn't built yet — channel will be created as a DRAFT and become runnable when that module ships.`,
    );
  }

  // Never persist an invalid graph.
  try {
    validatePipeline(pipeline);
  } catch (e) {
    throw new Error(`designed pipeline invalid: ${e instanceof Error ? e.message : e}`);
  }

  return { pipeline, available: fam.available, warnings };
}

export { OPTIONAL_BLOCKS };
