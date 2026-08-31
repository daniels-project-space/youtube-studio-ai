/**
 * Pipeline designer — derives a concrete, VALIDATED channel pipeline from a
 * family + niche + operator options. This is the deterministic backbone of the
 * channel builder: family → base archetype pipeline → apply length / footage
 * theme / locale / optional-module toggles → validatePipeline. (A Claude
 * "architect" + clip analysis layer on top later only adjusts these inputs.)
 */
import {
  FAMILY_CREW,
  CREW_ROLE_BLOCK,
  assertFamilyAutonomousPlanningPipeline,
  familyAutonomousPlanningCapability,
  familyDurationContract,
  resolveFamilyEpisodeLengthSeconds,
  familyProductionReadiness,
  type FamilyKey,
} from "./families";
import { resolveChannelFamilyManifest } from "./channelFamilyManifest";
import { certifiedFamilyAdmission } from "./certifiedFamilyAdmission";
import type { NovitaVideoRuntimeTarget } from "./runtimeCapability";
import { subcategoryTags } from "@/lib/nicheCatalog";
import { nichePreset } from "./golden";
import {
  briefToCreativeCapabilityIntent,
  type ChannelProgramBrief,
} from "./channelProgramBrief";
import {
  assertChannelProgramRouteBinding,
  assertChannelProgramRoutePipelineCompatibility,
  type ChannelProgramRoute,
} from "./channelProgramRoute";
import {
  assertCreatorIntentDiagnosisBinding,
  type CreatorIntentDiagnosis,
} from "./creatorIntentDiagnosis";
import { compileCertifiedChannelComposition } from "./channelCompositionCompiler";
import { visualTreatmentKeyFromUnknown, type VisualTreatmentKey } from "./visualTreatmentCatalog";
import { findCertifiedChannelComposition } from "./channelCompositionCatalog";
import {
  dataStoryInsertParams,
  dataStoryProductionReadiness,
  isDataStoryContract,
  supportsDataStoryFamily,
  type DataStoryContract,
} from "./dataStory";
import {
  assertCreativeCapabilityPipelineObligations,
  selectedDataStoryContract,
  validateCreativeCapabilitySelections,
  type CreativeCapabilitySelection,
} from "./creative/creativeCapabilityCatalog";
import {
  isSyntheticScenarioContract,
  syntheticScenarioContract,
  type SyntheticScenarioContract,
} from "./syntheticScenario";
import {
  certifiedQuizProfileCategories,
  resolveCertifiedQuizProfile,
  type CertifiedQuizProfileKey,
} from "./certifiedQuizProfile";
import { registerAllBlocks } from "./blocks";
import { validatePipeline } from "./validate";
import { childrenShowBibleSeedKeys } from "./childrenShowBible";
import { materializeSelfContainedStoryPlanningHandoff } from "./selfContainedStoryPlanning";
import { sanitizeParamOverrides } from "./moduleCatalog";
import type { PipelineEntry } from "./types";
import {
  assertPipelineMatchesContentLane,
  injectContentLaneIntoPipeline,
  type ContentLane,
} from "./contentLane";
import {
  assertMinimumVideoFoundation,
  assertMinimumVideoFoundationForAutomaticFamily,
  pipelineSupportsNarrationAlignedShorts,
} from "./minimumVideoFoundation";
import {
  compilePipeline,
  completePipelineForPolicy,
  DEFAULT_GENERATION_PROFILE,
  type PipelineCompilation,
} from "./pipelineCompiler";
import type { GenerationProfileId } from "./runtimeCapability";

export interface DesignOptions {
  family: FamilyKey;
  nicheKey?: string;
  subcategory?: string;
  /** Immutable creator intent, required by the channel-inception executor. */
  programBrief?: ChannelProgramBrief;
  /** Server-derived, brief-bound episode grammar. Never accepted as a raw UI choice. */
  programRoute?: ChannelProgramRoute;
  /**
   * Sealed explanation of the brief/route's reusable editorial consequences.
   * It is optional only so historical callers remain readable; when present,
   * the designer verifies it before using the route-owned grammar.
   */
  creatorIntentDiagnosis?: CreatorIntentDiagnosis;
  /**
   * Internal-only owner-reviewed runtime target. The Trigger authority derives
   * this from the service registry; browser input is never trusted for it.
   */
  runtimeTarget?: NovitaVideoRuntimeTarget;
  lengthMinutes?: number; // narrated target length
  locale?: string; // "en" | "es" | "de" …
  footageTheme?: string; // narrated-stock visual theme, e.g. "nature"
  voiceFx?: string; // narration filter, e.g. "radio"
  publishMode?: string; // draft | scheduled | public
  /** Set only at an authenticated operator boundary after explicit confirmation. */
  approvedForPublish?: boolean;
  /**
   * Legacy route-less snapshot compatibility only. New or route-bearing
   * admissions must derive series semantics from ProgramBrief.serializedProgram.
   */
  seriesTitle?: string;
  seriesCount?: number;
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
   * Render tier for this channel's generated visuals: "draft" (cheap preview),
   * "production" (what every existing channel resolves to), or "hero".
   *
   * This is the only way to select a tier at DESIGN time, because the render
   * blocks below are spliced/swapped in AFTER `paramOverrides` has already been
   * applied — a per-block override on novita_render_images / novita_render_video
   * / story_spine is therefore discarded and can never reach them. Leave unset
   * to keep the historical hardcoded "production" tier.
   *
   * `draft` is deliberately preview-only. It may produce a design/preview
   * graph, but that graph is not production-ready and the execution and
   * channel-certification boundaries reject it before provider work. Only the
   * standard `production` or higher-quality `hero` profiles are runnable.
   * Renderer profile selection is route-owned and cannot be overridden through
   * per-channel runtime module configuration.
   */
  generationProfile?: GenerationProfileId;
  /** Server-owned QuizYear identity; category/topic combinations are profile-owned. */
  quizProfile?: CertifiedQuizProfileKey;
  /**
   * Explicit opt-in for source-attributed chart-led narration. This is a
   * contract over the existing Data Inserts module, not a cosmetic toggle.
   */
  dataStory?: DataStoryContract;
  /**
   * Fingerprint-bound creator opt-ins resolved from the declarative capability
   * catalog. This is the preferred path; `dataStory` remains a legacy bridge
   * for existing stored channel drafts.
   */
  capabilitySelections?: readonly CreativeCapabilitySelection[];
  /**
   * Explicit fictional AI thought-experiment profile for the deterministic
   * illustrated renderer. It adds a visible disclosure and the matching town,
   * decision, or POV visual grammar; it never claims a real simulation ran.
   */
  syntheticScenario?: SyntheticScenarioContract;
  toggles?: {
    quotes?: boolean;
    captions?: boolean;
    chapters?: boolean;
    notify?: boolean;
    crosspost?: boolean;
    /** Auto-spin a 9:16 Short from each eligible long-form (private-first). The automatic creator enables this by default; API callers opt in explicitly. */
    shorts?: boolean;
    /** Mine source-windowed documentary Short candidates after a long-form draft. */
    documentaryCandidates?: boolean;
    /** Reusable visual-development contract for cinematic story renders. Default ON for cinematic. */
    visualMatter?: boolean;
    /**
     * A catalog-backed visual treatment applied to the cinematic Visual Matter
     * plan and existing QA locks. It selects no renderer and grants no
     * automatic-admission authority.
     */
    visualTreatment?: VisualTreatmentKey;
    /**
     * Server-side opt-in for a bounded direct-Novita text-to-image Visual
     * Matter reference pack. Its actual R2 pixels are QA comparison input only;
     * it does not claim image conditioning of primary keyframes. Default OFF.
     */
    visualMatterReferenceAssets?: boolean;
    /** Reuse approved owner-scoped Studio recipes before fresh visual planning. Default ON for cinematic. */
    studioAssetLibrary?: boolean;
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

/**
 * QuizYear's supervised portrait derivative is a distinct, human-reviewed
 * Short product. Keep this envelope shared by design and later architectural
 * length re-pinning so the parent family's fixed 80-second cadence cannot
 * silently overwrite the route's 35–60 second release contract.
 */
export const QUIZ_SHORT_PORTRAIT_LENGTH_ENVELOPE = Object.freeze({
  minSeconds: 35,
  maxSeconds: 60,
});

const OPTIONAL_BLOCKS = new Set([
  "quote_overlays",
  "captions",
  "notify",
  "crosspost",
]);

/**
 * A render may tolerate a little natural timing variance, but that variance
 * may never cross the family capability boundary advertised by the creator.
 * Keep this in one helper because the initial design and the post-architect
 * repair pass must enforce exactly the same duration law.
 */
function lengthCheckEnvelope(
  family: FamilyKey,
  targetSeconds: number,
): Readonly<{ minSeconds: number; maxSeconds: number }> {
  if (family === "documentary_collage_short") {
    // The renderer's native five-to-seven-beat QA envelope is deliberately a
    // little wider than the channel's preferred 35–60s editorial target.
    return { minSeconds: 20, maxSeconds: 60 };
  }
  const contract = familyDurationContract(family);
  if (contract.inputUnit === "fixed") {
    return { minSeconds: contract.defaultSeconds, maxSeconds: contract.defaultSeconds };
  }
  return {
    minSeconds: Math.max(contract.minimumSeconds, Math.round(targetSeconds * 0.6)),
    maxSeconds: Math.min(contract.maximumSeconds, Math.round(targetSeconds * 1.8)),
  };
}

/** Build a validated pipeline for a channel from the wizard's choices. */
export function designPipeline(opts: DesignOptions): DesignResult {
  // `designPipeline` is used by the API, inception, and engine-level callers.
  // The API already sanitizes editor input, but this shared compiler is the
  // actual trust boundary: direct callers must not gain a second path to
  // inject arbitrary block parameters or compete with route-owned settings.
  const rawParamOverrides = opts.paramOverrides;
  const paramOverrides = sanitizeParamOverrides(rawParamOverrides);
  // Resolve before block registration or compilation. The same composed
  // contract powers creator admission, so a catalog drift cannot yield a
  // pipeline with a different lane, cadence, or visual archetype.
  const manifest = resolveChannelFamilyManifest(opts.family);
  // Resolve the render tier ONCE, here, so every block this function emits
  // agrees. An unset field is the only state any existing channel has, and it
  // resolves to exactly the literal these call sites used to hardcode.
  const generationProfileId: GenerationProfileId =
    opts.generationProfile ?? DEFAULT_GENERATION_PROFILE;
  const previewOnlyGenerationProfile = generationProfileId === "draft";
  registerAllBlocks();
  const fam = manifest.family;
  const base = manifest.archetype;
  if (opts.programRoute && !opts.programBrief) {
    throw new Error("channel program route requires its canonical channel program brief");
  }
  const programRoute = opts.programRoute && opts.programBrief
    ? assertChannelProgramRouteBinding({ route: opts.programRoute, programBrief: opts.programBrief, expectedFamily: opts.family })
    : undefined;
  // Whiteboard and motion-comic automatic production is route-owned: their
  // shared plan/seal pair needs the frozen route at runtime. Keep old
  // route-less design previews compilable for inspection, but never label one
  // production-ready or run its automatic-plan invariant as though the seal
  // existed.
  const requiresSealedSelfContainedRoute = opts.family === "whiteboard" || opts.family === "comic" || opts.family === "loreshort";
  const hasRequiredSelfContainedRoute = !requiresSealedSelfContainedRoute || programRoute !== undefined;
  const isSupervisedQuizShort = programRoute?.routeKey === "quizyear/portrait-supervised/v1";
  if (opts.programBrief?.serializedProgram && !programRoute) {
    throw new Error("serialized_program/v1 requires its sealed channel program route");
  }
  const routeSerializedProgram = programRoute?.serializedProgram;
  const rawSeriesOptions = opts as unknown as {
    seriesTitle?: unknown;
    seriesCount?: unknown;
  };
  if (
    programRoute &&
    (rawSeriesOptions.seriesTitle !== undefined || rawSeriesOptions.seriesCount !== undefined) &&
    (
      rawSeriesOptions.seriesTitle !== routeSerializedProgram?.seriesTitle ||
      rawSeriesOptions.seriesCount !== routeSerializedProgram?.seriesCount
    )
  ) {
    throw new Error("serialized_program/v1 values must be derived from the sealed channel program route");
  }
  const topicSelectOverrides = rawParamOverrides?.["topic_select"];
  if (
    programRoute &&
    topicSelectOverrides &&
    ("seriesTitle" in topicSelectOverrides || "seriesCount" in topicSelectOverrides)
  ) {
    throw new Error("serialized_program/v1 values are route-owned and cannot be supplied through topic_select overrides");
  }
  if (opts.creatorIntentDiagnosis !== undefined) {
    if (!programRoute || !opts.programBrief) {
      throw new Error("creator intent diagnosis requires a canonical channel program brief and route");
    }
    assertCreatorIntentDiagnosisBinding({
      diagnosis: opts.creatorIntentDiagnosis,
      programBrief: opts.programBrief,
      programRoute,
    });
  }
  const routeQuizProfile = programRoute?.quizProfile;
  const routeSyntheticScenario = programRoute?.syntheticScenarioProfile
    ? syntheticScenarioContract(programRoute.syntheticScenarioProfile)
    : undefined;
  if (programRoute && opts.quizProfile !== undefined && opts.quizProfile !== routeQuizProfile) {
    throw new Error("QuizYear profile must match the sealed channel program route");
  }
  if (programRoute && opts.syntheticScenario !== undefined && opts.syntheticScenario.profile !== routeSyntheticScenario?.profile) {
    throw new Error("fictional scenario must match the sealed channel program route");
  }
  if (programRoute && !routeSyntheticScenario && opts.syntheticScenario !== undefined) {
    throw new Error("a baseline channel program route cannot accept a mutable fictional scenario");
  }
  if (opts.capabilitySelections?.length && !opts.programBrief) {
    throw new Error("creative capability selections require a canonical channel program brief");
  }
  const resolvedCapabilitySelections = validateCreativeCapabilitySelections({
    family: opts.family,
    selections: opts.capabilitySelections,
    ...(opts.programBrief
      ? { intent: briefToCreativeCapabilityIntent(opts.programBrief) }
      : {}),
  });
  const selectedCapabilities = resolvedCapabilitySelections.map(({ selection }) => selection);
  const selectedDataStory = selectedDataStoryContract(selectedCapabilities);
  if (opts.dataStory !== undefined && !isDataStoryContract(opts.dataStory)) {
    throw new Error("source-attributed data story must use the current typed evidence contract");
  }
  if (opts.dataStory && selectedDataStory && opts.dataStory.version !== selectedDataStory.version) {
    throw new Error("legacy data-story contract does not match the selected creative capability");
  }
  const effectiveDataStory = selectedDataStory ?? opts.dataStory;
  if (routeSerializedProgram && effectiveDataStory) {
    throw new Error("serialized_program/v1 cannot combine with source-attributed data story admission");
  }
  if (effectiveDataStory && !supportsDataStoryFamily(opts.family)) {
    throw new Error("source-attributed data story is currently supported only by Narrated + Stock Footage");
  }
  const effectiveSyntheticScenario = routeSyntheticScenario ?? opts.syntheticScenario;
  const effectiveQuizProfile = routeQuizProfile ?? opts.quizProfile;
  if (effectiveSyntheticScenario !== undefined && !isSyntheticScenarioContract(effectiveSyntheticScenario)) {
    throw new Error("synthetic scenario must use the current typed fictional-scenario contract");
  }
  if (effectiveSyntheticScenario && opts.family !== "illustrated_explainer") {
    throw new Error("synthetic AI scenario stories are currently supported only by Illustrated Explainer");
  }
  if (effectiveQuizProfile !== undefined && opts.family !== "quizyear") {
    throw new Error("certified QuizYear profiles are currently supported only by QuizYear");
  }

  const t = opts.toggles ?? {};
  const selectedVisualTreatment = t.visualTreatment === undefined
    ? undefined
    : visualTreatmentKeyFromUnknown(t.visualTreatment);
  if (t.visualTreatment !== undefined && !selectedVisualTreatment) {
    throw new Error("visual treatment must be a known catalog key");
  }
  if (selectedVisualTreatment && opts.family !== "cinematic") {
    throw new Error("visual treatments currently require the cinematic Visual Matter pipeline");
  }
  const warnings: string[] = [];
  // Per-niche reference preset auto-populates length + script style on channel
  // inception when the operator/AI didn't specify them (so every niche launches
  // with its research-tuned defaults — covers wizard, API, and autopilot creation).
  const preset = nichePreset(opts.nicheKey);
  const duration = manifest.duration;
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
  // The parent QuizYear family remains a fixed long-form channel contract.
  // Its supervised portrait derivative has its own preflighted 35–60s
  // envelope and is never surfaced as an automatic family-length choice.
  if (isSupervisedQuizShort) lenSec = 40;
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
        const envelope = lengthCheckEnvelope(opts.family, lenSec);
        params.minSeconds = envelope.minSeconds;
        params.maxSeconds = envelope.maxSeconds;
      }
      // QuizYear's ordinary family contract is long-form. The sealed portrait
      // derivative is independently preflighted at 35–60 seconds, so keeping
      // the parent 80-second check here would make every truthful Short fail
      // before final QA despite a valid portrait render.
      if (isSupervisedQuizShort && e.block === "length_check") {
        params.minSeconds = QUIZ_SHORT_PORTRAIT_LENGTH_ENVELOPE.minSeconds;
        params.maxSeconds = QUIZ_SHORT_PORTRAIT_LENGTH_ENVELOPE.maxSeconds;
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
      if (e.block === "topic_select" && !programRoute && opts.seriesTitle) {
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
      const ov = paramOverrides[e.block];
      if (ov) for (const [k, v] of Object.entries(ov)) {
        if (v !== undefined && v !== null && v !== "") params[k] = v;
      }
      if (e.block === "topic_select" && routeSerializedProgram) {
        params.seriesTitle = routeSerializedProgram.seriesTitle;
        if (routeSerializedProgram.seriesCount !== undefined) {
          params.seriesCount = routeSerializedProgram.seriesCount;
        } else {
          delete params.seriesCount;
        }
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
  // Its planning, safety classification, metadata and critic receipt are
  // deterministic modules with durable source/provenance receipts. The final
  // thumbnail intentionally remains on the universal sealed Nano Banana path.
  // Keep this as a pipeline rewrite rather than a conditional inside Topicraft: the
  // compiled graph itself makes the non-Gemini route inspectable and reusable.
  if (opts.family === "quizyear") {
    const quizOverrides = rawParamOverrides?.["quiz_year"];
    if (quizOverrides?.["categories"] !== undefined || quizOverrides?.["topic"] !== undefined) {
      throw new Error(
        "quiz: categories and topics are owned by the certified QuizYear profile; remove raw quiz_year overrides",
      );
    }
    const quizProfile = resolveCertifiedQuizProfile(effectiveQuizProfile);
    const planner = familyAutonomousPlanningCapability("quizyear");
    const forbiddenPlannerBlocks = new Set(
      planner.mode === "registered_non_gemini" ? planner.forbiddenGeminiBlocks : [],
    );
    pipeline = pipeline.flatMap((entry): PipelineEntry[] => {
      if (entry.block === "topic_select") {
        return [{
          block: "quiz_topic_plan",
          params: {
            ...(effectiveQuizProfile ? { quizProfile: quizProfile.key } : {}),
          },
        }];
      }
      if (entry.block === "compliance_check") return [{ block: "quiz_topic_safety" }];
      if (entry.block === "quiz_year") {
        const params = { ...(entry.params ?? {}) };
        // The archetype's former static topic is superseded by the planner's
        // topic-memory-backed selection. Profiles own the topic/category
        // mapping as a server-side contract.
        delete params.topic;
        params.categories = certifiedQuizProfileCategories(quizProfile);
        if (effectiveQuizProfile) params.quizProfile = quizProfile.key;
        params.noGemini = true;
        if (isSupervisedQuizShort) {
          params.presentation = "portrait_supervised";
          params.targetSeconds = 40;
        }
        return [
          {
            block: "music",
            params: {
              provider: "mureka",
              trackCount: 1,
              prompt:
                "bright modern game-show instrumental, warm marimba and light percussion, playful but not childish, no vocals, no lyrics, clean loopable 100 BPM",
              ...(paramOverrides["music"] ?? {}),
            },
          },
          { block: "quiz_year", params },
        ];
      }
      if (entry.block === "metadata") {
        return [{ block: "quiz_critic_spec" }, { block: "quiz_metadata" }];
      }
      if (isSupervisedQuizShort && entry.block === "qa_visual") {
        return [{
          block: "qa_visual",
          params: {
            ...(entry.params ?? {}),
            qaProfile: "production",
            audioQa: true,
          },
        }];
      }
      if (isSupervisedQuizShort && entry.block === "upload_draft") {
        return [{
          block: "upload_draft",
          params: {
            ...(entry.params ?? {}),
            // A supervised QuizShort can only make a private draft.  The
            // compiler and runtime release gate independently repeat this.
            publishMode: "draft",
          },
        }];
      }
      // Every legacy crew/research entry has a Gemini-backed planner. Keep the
      // authoritative list on the family capability, so later crew changes
      // cannot silently reintroduce a provider call into this certified route.
      if (forbiddenPlannerBlocks.has(entry.block)) return [];
      return [entry];
    });
    if (isSupervisedQuizShort) {
      const qaIndex = pipeline.findIndex((entry) => entry.block === "qa_visual");
      if (qaIndex < 0) throw new Error("quiz_short: shared final QA block is missing from the portrait route");
      pipeline.splice(qaIndex + 1, 0, { block: "quiz_short_release" });
    }
  }

  // GENERATED-VISUALS families use the complete authored-shot chain. Each shot
  // gets a pinned keyframe render, required asset selection, pinned I2V render,
  // and required shot QA before timeline assembly. Entity photos are excluded:
  // they would bypass the continuity ledger and exact editor timecodes.
  if (fam.visualEngine === "gen_footage" || fam.visualEngine === "ai_scenes") {
    const directCinematicChain = [
      "novita_render_images",
      "qa_assets",
      "novita_render_video",
      "qa_shots",
    ];
    const hasCompleteDirectCinematicChain = directCinematicChain
      .every((block) => pipeline.some((entry) => entry.block === block));
    pipeline = pipeline
      // A legacy cinematic template once contained only novita_render_video.
      // Treat that as an incomplete shorthand, never as a complete direct
      // renderer: replace it below with the full keyframe → asset QA → I2V →
      // shot QA chain. A supplied complete chain is preserved verbatim.
      .filter((e) => e.block !== "entity_imagery" && (
        hasCompleteDirectCinematicChain ||
        !["novita_render_images", "qa_assets", "qa_shots"].includes(e.block)
      ))
      .flatMap((e) => (
        e.block === "stock_footage" ||
        e.block === "gen_footage" ||
        (fam.visualEngine === "ai_scenes" && !hasCompleteDirectCinematicChain && e.block === "novita_render_video")
          ? [
              { block: "novita_render_images", params: { generationProfile: generationProfileId } },
              { block: "qa_assets" },
              { block: "novita_render_video", params: { generationProfile: generationProfileId } },
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
    // Current route-less/manual self-contained work keeps the renderer-owned
    // planner. A future certified route that declares the shared handoff must
    // instead compose its bounded native plan and route seal immediately before
    // the renderer, never as an optional afterthought.
    if (programRoute) {
      pipeline = materializeSelfContainedStoryPlanningHandoff({
        route: programRoute,
        visualEngine: fam.visualEngine,
        pipeline,
      });
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

  // A sealed serialized-program route owns one provider-free bridge from
  // Topic Select's atomic episode completion into all later consumers. Insert
  // it after topic_select *after* crew entries have been placed: splicing at
  // the same anchor makes the immutable receipt precede every crew brief.
  // This is not a capability or family toggle — route binding below rejects it
  // on non-serialized routes and no operator parameter can add it.
  if (routeSerializedProgram) {
    const topicIndex = pipeline.findIndex((entry) => entry.block === "topic_select");
    if (topicIndex < 0) {
      throw new Error("serialized_program/v1 requires topic_select before its episode context bridge");
    }
    const existingContexts = pipeline.filter(
      (entry) => entry.block === "serialized_program_episode_context",
    );
    if (existingContexts.length > 1) {
      throw new Error("serialized_program/v1 permits exactly one route-owned episode context bridge");
    }
    if (existingContexts.length === 0) {
      pipeline.splice(topicIndex + 1, 0, { block: "serialized_program_episode_context" });
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
      params: { generationProfile: generationProfileId, targetShotSec: opts.family === "shorts" ? 4 : 6 },
    });
  }

  // Fictional AI scenario stories reuse the zero-provider illustrated lane,
  // but their disclosure and visual treatment must be real pipeline artifacts
  // rather than title/prompt conventions. The first module gives script/hook
  // generation the contract; the route-derived treatment prevents a generic
  // real-world visual source from silently depicting it; the gate rejects a
  // script if it does not say the disclosure in the opening.
  if (effectiveSyntheticScenario) {
    const contract = syntheticScenarioContract(effectiveSyntheticScenario.profile);
    const scriptIndex = pipeline.findIndex((entry) => entry.block === "script_gen");
    if (scriptIndex < 0) throw new Error("synthetic AI scenario requires a script_gen block");
    if (!pipeline.some((entry) => entry.block === "synthetic_scenario")) {
      pipeline.splice(scriptIndex, 0, {
        block: "synthetic_scenario",
        params: contract,
      });
    }
    const syntheticScenarioIndex = pipeline.findIndex((entry) => entry.block === "synthetic_scenario");
    // The receipt is intentionally route-derived. A route-less invocation can
    // still replay historical synthetic work, but cannot manufacture the new
    // sealed treatment from mutable design parameters.
    if (programRoute && !pipeline.some((entry) => entry.block === "scenario_visual_treatment")) {
      pipeline.splice(syntheticScenarioIndex + 1, 0, { block: "scenario_visual_treatment" });
    }
    const resolvedScriptIndex = pipeline.findIndex((entry) => entry.block === "script_gen");
    if (!pipeline.some((entry) => entry.block === "scenario_disclosure_gate")) {
      pipeline.splice(resolvedScriptIndex + 1, 0, { block: "scenario_disclosure_gate" });
    }
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
      block: "studio_asset_resolve",
      params: {
        enabled: t.studioAssetLibrary !== false,
        family: "cinematic",
        contentLane: "cinematic_ai",
        moduleId: "visual_matter",
        ...(selectedVisualTreatment ? { treatment: selectedVisualTreatment } : {}),
      },
    }, {
      block: "visual_matter",
      params: {
        enabled: t.visualMatter !== false,
        maxCharacters: 3,
        maxSettings: 3,
        ...(selectedVisualTreatment ? { visualTreatment: selectedVisualTreatment } : {}),
      },
    });
  }
  // The paid bridge remains strictly conditional: it follows the resolved
  // script/story-spine Visual Matter plan, exists only for the cinematic
  // family, and is never materialized merely because Visual Matter planning is
  // available. Its R2 outputs are fed to QA—not back into direct Z-Image as
  // unsupported image-to-image/reference conditioning.
  if (
    opts.family === "cinematic" &&
    t.visualMatter !== false &&
    t.visualMatterReferenceAssets === true &&
    !pipeline.some((entry) => entry.block === "visual_matter_references")
  ) {
    const storyIndex = pipeline.findIndex((entry) => entry.block === "story_spine");
    const visualMatterIndex = pipeline.findIndex((entry) => entry.block === "visual_matter");
    if (storyIndex < 0 || visualMatterIndex <= storyIndex) {
      throw new Error("cinematic Visual Matter reference assets require the post-story-spine Visual Matter plan");
    }
    pipeline.splice(visualMatterIndex + 1, 0, {
      block: "visual_matter_references",
      params: {
        enabled: true,
        maxImages: 8,
        generationProfile: generationProfileId,
      },
    });
  }
  // Resolve at most one approved direct-LTX standard LoRA after selected stills
  // have passed visual QA, but before the paid video worker is admitted. A
  // no-match is typed and preserves the sealed base runtime. IC-LoRAs stay out
  // of this path because the current worker cannot consume Comfy guide inputs.
  if (opts.family === "cinematic" && !pipeline.some((entry) => entry.block === "studio_ltx_adapter_resolve")) {
    const assetQaIndex = pipeline.findIndex((entry) => entry.block === "qa_assets");
    const videoIndex = pipeline.findIndex((entry) => entry.block === "novita_render_video");
    if (assetQaIndex < 0 || videoIndex <= assetQaIndex) {
      throw new Error("cinematic Studio LTX adapter resolution requires keyframe QA before direct video rendering");
    }
    pipeline.splice(assetQaIndex + 1, 0, {
      block: "studio_ltx_adapter_resolve",
      params: {
        enabled: t.studioAssetLibrary !== false,
        family: "cinematic",
        contentLane: "cinematic_ai",
        // The adapter resolver must see the same sealed treatment as Visual
        // Matter. Otherwise an approved clay/brick/anime/drawn LoRA could
        // never match the exact run it was benchmarked for.
        ...(selectedVisualTreatment ? { treatment: selectedVisualTreatment } : {}),
      },
    });
  }

  // Reuse approved presentation language only at the explicit blocks that can
  // consume it: music direction, quote cards, data graphics, and the bounded
  // title→body transition. The resolver
  // is intentionally placed before the first such block, while the concrete
  // asset's compatibility still names its exact consumer. It is never a
  // generic creative override for cuts, factual visuals, or timing.
  if (!pipeline.some((entry) => entry.block === "studio_postproduction_asset_resolve")) {
    const postproductionIndices = ["music", "quote_overlays", "visual_inserts", "timeline_assemble"]
      .map((block) => pipeline.findIndex((entry) => entry.block === block))
      .filter((index) => index >= 0);
    if (postproductionIndices.length) {
      pipeline.splice(Math.min(...postproductionIndices), 0, {
        block: "studio_postproduction_asset_resolve",
        params: {
          // Keep a typed resolver in every route-owned post-production chain.
          // A caller may disable reuse, but must not remove the artifacts that
          // downstream assembly modules and the sealed route expect. The block
          // emits explicit no-match/no-op projections without any provider
          // call when reuse is disabled.
          enabled: t.studioAssetLibrary !== false,
          family: opts.family,
          contentLane: manifest.contentLane,
        },
      });
    }
  }

  // A selected certified composition owns the strict source-attributed
  // data-story rewrite. It is deliberately materialized before the existing
  // policy/capability/validation gates below; this layer only applies sealed
  // block and parameter operations and cannot introduce a new renderer.
  const selectedCapabilityKeys = selectedCapabilities.map((selection) => selection.capability);
  const shouldCompileCertifiedComposition = selectedCapabilityKeys.length > 0 || Boolean(
    findCertifiedChannelComposition({ family: opts.family, selectedCapabilityKeys }),
  );
  if (shouldCompileCertifiedComposition) {
    const compositionCompilation = compileCertifiedChannelComposition({
      family: opts.family,
      capabilitySelections: selectedCapabilities,
      ...(opts.programBrief ? { intent: briefToCreativeCapabilityIntent(opts.programBrief) } : {}),
      parameterOverrides: paramOverrides,
      pipeline,
    });
    pipeline = compositionCompilation.pipeline;
  }

  // Script-synced DATA-VIZ inserts (visual_inserts): existing niche presets
  // may opt into general number-driven inserts. Legacy data-story contracts
  // retain their compatibility bridge; selected source-attributed channels are
  // now materialized exclusively by their sealed composition definition above.
  const insertParams: Record<string, unknown> | undefined = selectedDataStory
    ? undefined
    : effectiveDataStory
      ? dataStoryInsertParams(effectiveDataStory)
      : preset?.insertTypes?.length
        ? { insertTypes: preset.insertTypes }
        : undefined;
  if (fam.narrated && insertParams && pipeline.some((entry) => entry.block === "timeline_assemble")) {
    const visualInsertOverrides = paramOverrides.visual_inserts ?? {};
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
        ...(effectiveDataStory ? { sourceAttributionRequired: true } : {}),
      };
    }
    if (effectiveDataStory) {
      const qa = pipeline.find((e) => e.block === "qa_script");
      if (qa) {
        qa.params = {
          ...(qa.params ?? {}),
          dataStoryContract: effectiveDataStory.version,
          requireNamedSource: true,
          requireSpokenNumericAnchor: true,
        };
      }
    }
  } else if (effectiveDataStory && !selectedDataStory) {
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

  // A requested companion Short appends AFTER upload_draft (needs watchUrl) but
  // before notify/cleanup (cleanup deletes intermediates). It is only available
  // for a narration timeline; non-narrated formats are skipped rather than
  // receiving an invented voice-based derivative.
  if (t.shorts && opts.family !== "music_loop") {
    const hasUpload = pipeline.some((e) => e.block === "upload_draft");
    const hasTimings = pipelineSupportsNarrationAlignedShorts(pipeline);
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

  const runtimeReadiness = familyProductionReadiness(opts.family, opts.runtimeTarget);
  const certifiedAdmission = certifiedFamilyAdmission(opts.family, opts.runtimeTarget);
  const dataStoryReadiness = effectiveDataStory ? dataStoryProductionReadiness() : undefined;
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
  if (!certifiedAdmission.automatic) {
    warnings.push(
      `${fam.label}: CertifiedFamilyAdmission blocks automatic production — ${certifiedAdmission.blockers.join(" ")}`,
    );
    if (certifiedAdmission.remediation) warnings.push(certifiedAdmission.remediation);
  }
  if (!hasRequiredSelfContainedRoute) {
    warnings.push(
      `${fam.label}: automatic production requires its sealed channel program route; this route-less design is preview-only.`,
    );
  }
  if (dataStoryReadiness && !dataStoryReadiness.autonomous) {
    warnings.push(
      `Source-attributed Data Story: automatic production is blocked — ${dataStoryReadiness.blockers.join(" ")}`,
    );
    warnings.push(dataStoryReadiness.remediation);
  }

  // Resolve uniquely identifiable policy/crew capability gaps from certified
  // manifests. Creative engine choices remain the designer's responsibility.
  const completed = completePipelineForPolicy(pipeline, {
    generationProfile: generationProfileId,
  });
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

  // The selected family/route owns episode duration. Advanced controls may
  // shape style inside that envelope, but may not quietly make narration,
  // loop assembly, or family-specific renderers disagree about how long the
  // episode is. This is deliberately after every designer rewrite and policy
  // completion, so no later template step can reintroduce a competing value.
  const enforcedLength = enforceLengthContract(
    pipeline,
    lenSec,
    opts.family,
    isSupervisedQuizShort
      ? { lengthEnvelope: QUIZ_SHORT_PORTRAIT_LENGTH_ENVELOPE }
      : undefined,
  );
  pipeline = enforcedLength.pipeline;
  if (enforcedLength.changed.length) {
    warnings.push(`Length contract pinned: ${enforcedLength.changed.join(", ")}.`);
  }

  const contentLane = manifest.contentLane;
  assertPipelineMatchesContentLane(contentLane, pipeline);
  pipeline = injectContentLaneIntoPipeline(pipeline, contentLane);
  assertMinimumVideoFoundation({ family: opts.family, contentLane, pipeline });
  // Keep creator previews and API-facing designs on the exact same automatic
  // baseline as channel persistence and run admission.  The generic
  // foundation deliberately works for supervised and blocked preview lanes;
  // this companion assertion adds cross-episode differentiation only when
  // the family is actually certified for autonomous production.
  assertMinimumVideoFoundationForAutomaticFamily({
    family: opts.family,
    contentLane,
    pipeline,
  });
  if (programRoute && opts.programBrief) {
    assertChannelProgramRoutePipelineCompatibility({
      route: programRoute,
      programBrief: opts.programBrief,
      pipeline,
    });
  }
  if (hasRequiredSelfContainedRoute) {
    assertFamilyAutonomousPlanningPipeline(opts.family, pipeline, {
      allowPreviewGenerationProfile: previewOnlyGenerationProfile,
    });
  }
  // A selected creative capability must leave exact, inspectable evidence in
  // the effective graph. This is deliberately after every family rewrite and
  // policy completion so a UI recommendation can never survive as a no-op.
  assertCreativeCapabilityPipelineObligations(opts.family, selectedCapabilities, pipeline);

  // Never persist an invalid graph.
  let compilation: PipelineCompilation | undefined;
  try {
    // contentLane is immutable channel configuration injected into the runtime
    // seed store by runPipeline.ts, not an executable block artifact. Seed it
    // here as well so creator-time validation verifies the same graph that the
    // runner will execute.
    // A certified route is likewise injected by runPipeline for route-bearing
    // executions. Seed it during creator-time validation so route-owned local
    // blocks (for example scenario_visual_treatment) validate the same graph
    // they will receive at runtime.
    const resolved = validatePipeline(pipeline, [
      "contentLane",
      ...childrenShowBibleSeedKeys(contentLane),
      ...(programRoute ? ["channelProgramRoute"] : []),
    ]);
    if (fam.available) compilation = compilePipeline(resolved);
  } catch (e) {
    throw new Error(`designed pipeline invalid: ${e instanceof Error ? e.message : e}`);
  }

  const runtimeBlockers = [
    ...runtimeReadiness.blockers,
    ...certifiedAdmission.blockers,
    ...(!hasRequiredSelfContainedRoute
      ? ["Automatic self-contained production requires a sealed channel program route."]
      : []),
    ...(dataStoryReadiness?.blockers ?? []),
    ...(isSupervisedQuizShort
      ? ["QuizShort is an explicitly supervised private-draft route; automatic creation and public/scheduled release remain disabled."]
      : []),
    ...(previewOnlyGenerationProfile
      ? ["The draft generation profile is preview-only and cannot create, schedule, or publish a production channel."]
      : []),
  ];
  return {
    pipeline,
    episodeLengthSeconds: lenSec,
    contentLane,
    available: fam.available,
    productionReady: fam.available
      && runtimeReadiness.productionReady
      && certifiedAdmission.automatic
      && hasRequiredSelfContainedRoute
      && dataStoryReadiness?.autonomous !== false
      && !isSupervisedQuizShort
      && !previewOnlyGenerationProfile,
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
  options?: Readonly<{
    /** A sealed route may narrow a parent family's generic envelope. */
    lengthEnvelope?: Readonly<{ minSeconds: number; maxSeconds: number }>;
  }>,
): { pipeline: PipelineEntry[]; changed: string[] } {
  const overrideEnvelope = options?.lengthEnvelope;
  if (
    overrideEnvelope &&
    (!Number.isFinite(overrideEnvelope.minSeconds) ||
      !Number.isFinite(overrideEnvelope.maxSeconds) ||
      overrideEnvelope.minSeconds <= 0 ||
      overrideEnvelope.minSeconds > overrideEnvelope.maxSeconds)
  ) {
    throw new Error("length contract override must be a finite positive min/max envelope");
  }
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
      const envelope = overrideEnvelope ?? lengthCheckEnvelope(family, lenSec);
      pin("minSeconds", envelope.minSeconds);
      pin("maxSeconds", envelope.maxSeconds);
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
