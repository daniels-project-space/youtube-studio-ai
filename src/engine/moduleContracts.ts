import { generationProfile } from "./generationProfiles";
import {
  VISUAL_MATTER_REFERENCE_QA_CONSUMERS,
} from "./contentLane";
import {
  NOVITA_CINEMATIC_QA_REPAIR_CAP,
  PRICE,
  bananaUnitRate,
  qaVisualCost,
  shortsSpinoffReleaseEvidenceCost,
} from "./pricing";
import { novitaCinematicQaMaxGraderCallsPerShot } from "./novitaVisualQaBudget";
import { cinematicFinalMasterQaVisualReviewPlanFromStore } from "./cinematicFinalMasterQaAdmission";
import {
  NARRATION_COLD_OPEN_MAX_CHARS,
  narrationChapterHeadingCharacterCeiling,
} from "../lib/narrationBounds";
import {
  motionComicImageCallCeiling,
  motionComicPanelCount,
  motionComicTtsBillableCharacterCeiling,
  motionComicVisionCallCeiling,
} from "../lib/motionComic";
import {
  whiteboardImageCallCeiling,
  whiteboardNarrationCharacterCeiling,
  whiteboardPanelsForTargetSeconds,
} from "../lib/whiteboardSync";
import { NANO_BANANA_PRO_WHITEBOARD_ART_PROFILE } from "../lib/nanoBananaWhiteboardArtContract";
import type {
  ModuleContractOverride,
  ModuleCostContext,
  ProviderProfile,
} from "./moduleManifest";

function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function boundedNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const number = finiteNumber(value) ?? fallback;
  return Math.min(max, Math.max(min, number));
}

function upstreamParam(
  context: Readonly<ModuleCostContext> | undefined,
  blockIds: readonly string[],
  keys: readonly string[],
): unknown {
  if (!context) return undefined;
  for (let index = context.index - 1; index >= 0; index--) {
    const entry = context.entries[index];
    if (!blockIds.includes(entry.block)) continue;
    for (const key of keys) {
      if (entry.params?.[key] !== undefined) return entry.params[key];
    }
  }
  return undefined;
}

function targetSeconds(
  params: Readonly<Record<string, unknown>>,
  context: Readonly<ModuleCostContext> | undefined,
  fallback: number,
): number {
  const direct = params["maxSeconds"] ?? params["targetSeconds"];
  const upstream = upstreamParam(
    context,
    ["script_gen", "story_spine", "director_brief", "dp_brief", "topic_select"],
    ["maxSeconds", "targetSeconds"],
  );
  return boundedNumber(direct ?? upstream, fallback, 30, 36_000);
}

function shotCount(
  params: Readonly<Record<string, unknown>>,
  context: Readonly<ModuleCostContext> | undefined,
): number {
  const explicit = finiteNumber(params["shotCount"] ?? params["maxShots"]);
  if (explicit !== undefined) return Math.ceil(boundedNumber(explicit, 1, 1, 1_000));
  const seconds = targetSeconds(params, context, 300);
  const targetShotSec = boundedNumber(
    upstreamParam(context, ["story_spine"], ["targetShotSec"]),
    6,
    2,
    30,
  );
  return Math.ceil(seconds / targetShotSec);
}

function generationProfileId(
  params: Readonly<Record<string, unknown>>,
  context: Readonly<ModuleCostContext> | undefined,
): unknown {
  return (
    params["generationProfile"] ??
    upstreamParam(context, ["story_spine"], ["generationProfile"])
  );
}

function whiteboardCostCeiling(
  params: Readonly<Record<string, unknown>>,
  context: Readonly<ModuleCostContext> | undefined,
): number {
  const seconds = targetSeconds(params, context, 132);
  // Keep this contract on the same bounded Pro-art and narration helpers as
  // whiteboardScribe. The live art route is sealed Nano Banana Pro; charging
  // it at a lower-tier planning rate would admit a run that cannot fund its
  // actual provider-bound art sequence.
  const panels = whiteboardPanelsForTargetSeconds(seconds);
  const characters = whiteboardNarrationCharacterCeiling(
    panels,
    Math.round(seconds * 3.1),
  );
  const usesEleven =
    String(params["ttsProvider"] ?? "fish").toLowerCase() === "elevenlabs" &&
    typeof params["elevenVoiceId"] === "string" &&
    params["elevenVoiceId"].trim().length > 0;
  const ttsRate = usesEleven ? PRICE.ttsElevenPerKCharUsd : PRICE.ttsPerKCharUsd;
  return (
    whiteboardImageCallCeiling(panels) * NANO_BANANA_PRO_WHITEBOARD_ART_PROFILE.admissionCeilingUsd +
    (characters / 1_000) * ttsRate
  );
}

/**
 * lore_short cold-run bound. The engine renders EXACTLY one attested Novita
 * still and EXACTLY one attested Novita i2v clip per beat — no repair loop, no
 * upscale purchase (the free ffmpeg 2K lane is pinned by the block) — so the
 * ceiling is a bounded beat count times the per-beat still+clip max, plus the
 * narration character budget. Kept in lockstep with loreBeatCount() in
 * src/trigger/blocks/loreShortBlocks.ts.
 */
function loreShortCostCeiling(
  params: Readonly<Record<string, unknown>>,
  context: Readonly<ModuleCostContext> | undefined,
): number {
  const seconds = targetSeconds(params, context, 54);
  const beats = Math.max(6, Math.min(16, Math.round(seconds / 6)));
  // ~16 spoken characters per second is the same budget motion_comic uses.
  const characters = Math.max(beats * 40, Math.ceil(seconds * 16));
  const usesEleven =
    String(params["ttsProvider"] ?? "fish").toLowerCase() === "elevenlabs" &&
    typeof params["elevenVoiceId"] === "string" &&
    params["elevenVoiceId"].trim().length > 0;
  const ttsRate = usesEleven ? PRICE.ttsElevenPerKCharUsd : PRICE.ttsPerKCharUsd;
  return (
    beats * (PRICE.novitaImageMaxUsd + PRICE.novitaVideoMaxUsd) +
    // one vision motion-analysis call per beat (cfg.analyzeMotion)
    beats * PRICE.visionGraderUsd +
    (characters / 1_000) * ttsRate
  );
}

/**
 * quiz_year cold-run bound. This is the CHEAPEST engine in the catalog and the
 * ceiling reflects a genuinely different cost shape rather than a discounted
 * version of the others: facts come from Wikidata (free, CC0, unauthenticated)
 * and the video is rendered locally by Remotion. The certified no-Gemini route
 * has no text-model spend; its upstream original music and downstream visual
 * QA have their own independently reserved module envelopes.
 *
 * The only spend is bounded text: at most `maxCritiqueIters` passes over
 * `rounds` phrasing calls, plus one critic call per pass. Kept in lockstep with
 * quizRoundCount() in src/trigger/blocks/quizYearBlocks.ts.
 */
function quizYearCostCeiling(
  _params: Readonly<Record<string, unknown>>,
  _context: Readonly<ModuleCostContext> | undefined,
): number {
  void _params;
  void _context;
  // The QuizYear engine is fully deterministic: source statements, question
  // wording, render props, and integrity checks are local. Its preceding music
  // block independently reserves/attests the only external creative cost.
  return 0;
}

function motionComicCostCeiling(params: Readonly<Record<string, unknown>>): number {
  const panels = motionComicPanelCount(params["panels"]);
  const characters = motionComicTtsBillableCharacterCeiling(
    panels,
    params["targetSeconds"],
  );
  return (
    motionComicImageCallCeiling(panels) * PRICE.novitaImageMaxUsd +
    (characters / 1_000) * PRICE.ttsElevenPerKCharUsd +
    PRICE.musicTrackUsd +
    motionComicVisionCallCeiling(panels) * PRICE.visionGraderUsd
  );
}

const local: ProviderProfile = {
  id: "local-production",
  provider: "local",
  quality: "production",
  allowFallback: false,
};
const managed: ProviderProfile = {
  id: "managed-production",
  provider: "configured-provider",
  quality: "production",
  allowFallback: false,
};

const contract = (
  capabilities: string[],
  options: Omit<ModuleContractOverride, "capabilities" | "certification" | "certificationEvidence"> = {},
): ModuleContractOverride => ({
  version: "1.0.0",
  capabilities,
  certification: "contract",
  certificationEvidence: "module ABI contract suite v1",
  ...options,
});

/**
 * Explicit migration contracts for every currently registered production
 * block. Optional reads are declarations, not a global allow-list: the runner
 * denies every store read outside `consumes` + this exact list.
 */
export const MODULE_CONTRACTS: Readonly<Record<string, ModuleContractOverride>> = {
  topic_select: contract(["topic.selected"], {
    optionalConsumes: [
      "plannedTopic", "reuseTopic", "channelName", "persona", "niche", "styleGrammar", "topicPool",
      // A sealed program route constrains every selection path, including
      // planned and render-group-reused topics.
      "channelProgramRoute",
    ],
    optionalProduces: ["topicBet"],
  }),
  // Route-owned read of the row atomically completed by Topic Select. It is
  // local/DB-only and cannot select a route or call a model/provider itself.
  serialized_program_episode_context: contract(["series.episode_context"], {
    requiredConsumes: ["topic"],
    optionalConsumes: ["channelProgramRoute"],
    providerProfiles: [local],
    maxCostUsd: 0,
  }),
  // Provider-free serialized-cinematic continuity bridge. It reloads and
  // persists immutable receipts only; character LoRA training remains outside
  // the run and an accepted adapter is represented by an opaque selector.
  narrative_series_visual_controls: contract([
    "series.narrative_episode_binding",
    "visuals.narrative_shot_controls",
  ], {
    requiredConsumes: [
      "serializedProgramEpisodeContext",
      "timedScript",
      "narrativeBeats",
      "continuityLedger",
      "shotList",
      "dpVisualSpecs",
      "editorEdl",
      "storyCoverage",
      "episodeGraph",
    ],
    optionalConsumes: ["channelProgramRoute", "narrativeSeriesRunSelector"],
    providerProfiles: [local],
    maxCostUsd: 0,
    qualityRequired: true,
  }),
  // The certified QuizYear planner is intentionally independent of Topicraft:
  // its source-reviewed topic registry and stable topic-memory receipt are a
  // reusable non-Gemini planning capability, not a degraded generic fallback.
  // The curated registry plus independently sourceable Wikidata answers are
  // the QuizYear route's research evidence. Advertising only `topic.selected`
  // made shared policy completion reinsert Gemini-backed competitor research.
  quiz_topic_plan: contract([
    "topic.researched",
    "topic.selected",
    "quiz.plan_provenanced",
    "crew.composer_cue_sheet",
  ], {
    optionalConsumes: ["channelProgramRoute"],
    providerProfiles: [local],
    qualityRequired: true,
  }),
  quiz_topic_safety: contract(["final.compliance_passed"], {
    requiredConsumes: ["topic", "quizPlan"],
    optionalConsumes: ["channelProgramRoute"],
    providerProfiles: [local],
    qualityRequired: true,
  }),
  quiz_critic_spec: contract(["crew.critic_validation_spec"], {
    requiredConsumes: ["quizPlan"],
    optionalConsumes: ["channelProgramRoute"],
    providerProfiles: [local],
    qualityRequired: true,
  }),
  quiz_metadata: contract(["package.metadata"], {
    requiredConsumes: ["topic", "quizPlan"],
    providerProfiles: [local],
    qualityRequired: true,
  }),
  competitor_research: contract(["topic.researched"], {
    optionalConsumes: ["niche", "persona", "thumbnailIdentity", "thumbnailer"],
  }),
  // Provider-free route/topic binding used by the automatic music-loop
  // foundation. Paid scene/music stages re-check this exact plan.
  music_program_plan: contract(["music.program.sealed"], {
    requiredConsumes: ["topic"],
    // Historical/manual music-loop designs can still compile for migration,
    // but the runtime block itself refuses to mint a plan without these two
    // route-owned seeds.  The automatic route requires both blocks.
    optionalConsumes: ["channelProgramRoute", "contentLane", "styleDNA", "visualBrief", "musicBrief", "niche"],
    providerProfiles: [local],
    qualityRequired: true,
  }),
  scene_planner: contract(["visuals.planned"], {
    optionalConsumes: ["styleGrammar", "visualStyle", "visualBrief", "niche", "styleDNA", "sceneLibrary", "musicProgramPlan"],
  }),
  keyframes: contract(["visuals.keyframe_generated", "render.profile_pinned", "render.spot_only"], {
    optionalConsumes: ["styleGrammar", "visualStyle", "styleDNA"],
    providerProfiles: [{ id: "novita-zimage-local-production", provider: "novita", quality: "production", allowFallback: false }],
    maxCostUsd: 1,
    // The art-director loop performs at most two still generations.
    maxCostUsdFor: () => 2 * PRICE.novitaImageMaxUsd,
  }),
  loop_clips: contract(["visuals.motion_generated", "render.profile_pinned", "render.spot_only"], {
    // The mastered original track is a required, route-sealed input. Current
    // distilled I2V records it as provenance only; the future dedicated
    // open-weight A2V worker may condition on it after its own benchmark.
    // Kept optional in the generic contract so historical/manual designs can
    // still be inspected or migrated. The registered music-loop route makes
    // it mandatory through its sealed order and the runtime re-check below.
    optionalConsumes: ["topic", "musicKey", "scenes", "motionPrompt", "musicProgramMotionIntent", "styleGrammar", "visualStyle"],
    providerProfiles: [{ id: "novita-ltx-production", provider: "novita", quality: "production", allowFallback: false }],
    maxCostUsd: 5,
    maxCostUsdFor: () => PRICE.novitaVideoMaxUsd,
  }),
  upscale: contract(["visuals.upscaled"], {
    optionalConsumes: ["loopRawKey"],
    providerProfiles: [managed],
    maxCostUsd: 5,
    maxCostUsdFor: () => PRICE.topazUpscaleUsd,
  }),
  music: contract(["audio.music_generated"], {
    optionalConsumes: ["reuseMusicKey", "musicBrief", "styleDNA", "channelName", "sceneMusicPrompt", "studioAudioRecipeProjection", "musicProgramPlan"],
    providerProfiles: [managed],
    maxCostUsd: 10,
    // Reserve both the requested generation count and one alternate-provider
    // failover. A partially completed primary attempt must never be invisible.
    maxCostUsdFor: (params) => {
      const tracks = Math.ceil(boundedNumber(params["trackCount"], 2, 1, 8));
      const sunoGenerations = Math.ceil(tracks / 2);
      return (sunoGenerations + 1) * PRICE.musicTrackUsd;
    },
  }),
  assemble: contract(["master.assembled"], {
    optionalConsumes: ["loopUnitUrl", "musicKey", "title", "channelName", "introCardPath", "introSec", "loopUnitResolution"],
    providerProfiles: [local],
    qualityRequired: true,
  }),
  upload_draft: contract(
    ["publish.connector_bound", "publish.resumable", "publish.synthetic_disclosed", "publish.private_first"],
    {
      optionalConsumes: [
        "chapterPlan", "scheduledPublishAt", "contentLane", "childContentSafety", "sceneCompilerReceipt", "quizShortRelease",
        // Last-hop package-art verification for a current fictional scenario.
        "topic", "channelProgramRoute", "syntheticScenario", "syntheticScenarioDisclosure",
        "scenarioVisualTreatment", "thumbnailScenarioVisualTreatmentProvenance",
      ],
      sideEffects: ["publish_media"],
      qualityRequired: true,
    },
  ),
  notify: contract(["notify.operator"], { sideEffects: ["external_message"] }),
  cleanup: contract(["storage.scoped_cleanup"], {
    // Shorts are optional, but a successfully uploaded derivative carries a
    // separate release certificate that cleanup must retain with its proof.
    optionalConsumes: ["shortKey", "shortReleaseCertificateKey"],
    sideEffects: ["delete_scoped_artifacts"],
  }),
  shorts_spinoff: contract([
    "master.short_created",
    "master.short_release_evidence_passed",
    "publish.connector_bound",
    "publish.resumable",
    "publish.synthetic_disclosed",
  ], {
    // The derivative is created from a passing, certificate-bound parent, but
    // it earns its own final-master certificate after the 9:16 crop/caption
    // transform. These contextual inputs make the post-transform reviewer
    // channel-aware without treating them as an inherited pass.
    optionalConsumes: [
      "description", "tags", "qualityBar", "contentLane", "channelName", "persona",
      "styleGrammar", "criticDoctrine", "topic", "niche",
      // Present only for sealed serialized narrative routes. A derivative
      // Short reads the complete Story Spine/Graph to select one bound beat;
      // ordinary channels retain their established opening-window behavior.
      "channelProgramRoute", "narrativeSeriesRunSelector", "serializedProgramEpisodeContext",
      "timedScript", "narrativeBeats", "continuityLedger", "shotList", "dpVisualSpecs",
      "editorEdl", "storyCoverage", "episodeGraph",
    ],
    optionalProduces: [
      "shortKey",
      "shortVideoId",
      "shortReleaseCertificateReference",
      "shortReleaseCertificateKey",
    ],
    providerProfiles: [managed, local],
    // The post-transform Short receives its own complete final review. At the
    // accepted 72 broad + 36 focus frames and the operational two-frame final
    // review cap, the exact envelope is $2.16; keep a small visible ceiling
    // above it rather than silently reducing Short evidence coverage.
    maxCostUsd: 2.2,
    maxCostUsdFor: (params) => shortsSpinoffReleaseEvidenceCost(params),
    sideEffects: ["publish_media"],
    qualityRequired: true,
  }),

  metadata: contract(["package.metadata"], {
    optionalConsumes: [
      "bannedWords", "chaptersText", "videoDurationSec", "attributions", "channelName", "niche", "persona",
      "nicheIntel", "seoDatabank", "competitors", "narrationText", "script", "styleDNA", "topicBet", "plannedTitle",
      "serializedProgramEpisodeContext",
    ],
  }),
  package_to_opening_plan: contract(["package.opening_bound"], {
    requiredConsumes: ["title", "thumbnailDescription", "topic"],
    optionalConsumes: [
      "channelProgramRoute", "script", "quizPlan", "family", "contentLane",
    ],
    optionalProduces: ["packageToOpeningPlan"],
  }),
  thumbnail_gen: contract(["package.thumbnail"], {
    requiredConsumes: ["title", "thumbnailDescription", "topic", "packageToOpeningPlan"],
    optionalConsumes: [
      "channelName", "topic", "f1Url", "f1Key", "f1ThumbnailBaseProvenance", "styleGrammar", "styleDNA", "family", "persona",
      "thumbnailIdentity", "nicheIntel", "niche", "seoDatabank", "competitors", "healHints", "plannedThumbnailKey",
      "narrationText", "thumbnailPlaybook", "script", "quizPlan",
      "serializedProgramEpisodeContext",
      // A route-bearing fictional scenario must bind package art before a
      // checkpoint claim/provider call. Route-less and non-fictional runs keep
      // the historic thumbnail ABI.
      "channelProgramRoute", "syntheticScenario", "syntheticScenarioDisclosure", "scenarioVisualTreatment",
      // Per-channel critique grounding for the produce→critique→regenerate loop.
      "criticDoctrine", "contentLane",
    ],
    optionalProduces: ["thumbnailScenarioVisualTreatmentProvenance"],
    providerProfiles: [managed],
    maxCostUsd: 2,
    // One bounded concept pass + one text-free Flash scene + one
    // post-composite mobile/reference alarm. Spelling can never trigger another
    // paid render because type is local.
    maxCostUsdFor: () =>
      PRICE.thumbnailConceptUsd + bananaUnitRate("flash") + PRICE.visionGraderUsd,
    qualityRequired: true,
  }),
  script_gen: contract(["script.generated"], {
    optionalConsumes: [
      "reuseScript", "structure", "styleDNA", "scriptPlaybook", "topicBet",
      "channelName", "niche", "persona", "styleGrammar",
      // Per-channel critique grounding for the shared script critique loop.
      "criticDoctrine", "contentLane", "dataStorySourceLedger", "casefileSourcePacket", "syntheticScenario",
      "channelProgramRoute", "serializedProgramEpisodeContext",
    ],
  }),
  hook_craft: contract(["script.hook_refined"], {
    optionalConsumes: [
      "script",
      // Per-channel grounding for the hook produce→critique loop (P1-4).
      "channelName", "persona", "styleGrammar", "criticDoctrine", "contentLane",
    ],
  }),
  qa_script: contract(["script.qa_passed"], {
    optionalConsumes: ["script", "styleDNA", "persona", "dataStorySourceLedger", "channelProgramRoute", "serializedProgramEpisodeContext"],
    qualityRequired: true,
  }),
  narration_tts: contract(["narration.timed"], {
    optionalConsumes: [
      "styleDNA", "musicBrief", "script", "voiceId", "reuseLanguage", "niche",
      // Grounds the cold-open take judge in this channel's own voice standard.
      "channelName", "persona", "styleGrammar", "criticDoctrine", "contentLane",
    ],
    providerProfiles: [managed],
    maxCostUsd: 10,
    maxCostUsdFor: (params, context) => {
      const seconds = targetSeconds(params, context, 300);
      // 20 chars/sec covers the current script pacing plus punctuation and
      // optional voice tags. Add both bounded cold-open purchases/judges and
      // the exact maximum spoken chapter-heading overhead when enabled.
      const maxCharacters =
        Math.ceil(seconds * 20) +
        2 * NARRATION_COLD_OPEN_MAX_CHARS +
        (params["chapterCards"] === true
          ? narrationChapterHeadingCharacterCeiling()
          : 0);
      const provider = String(params["ttsProvider"] ?? "fish").toLowerCase();
      const rate = provider === "elevenlabs" ? PRICE.ttsElevenPerKCharUsd : PRICE.ttsPerKCharUsd;
      return (
        (maxCharacters * rate) / 1_000 +
        2 * PRICE.visionGraderUsd
      );
    },
    qualityRequired: true,
  }),
  short_strategy: contract(["shorts.strategy_locked", "shorts.source_traceable", "shorts.retention_mapped"], {
    requiredConsumes: ["topic", "narrationText"],
    qualityRequired: true,
  }),
  documentary_short_candidates: contract(["shorts.candidates_mined", "shorts.source_windowed"], {
    requiredConsumes: ["sentenceTimings", "title"],
    optionalConsumes: ["youtubeVideoId"],
  }),
  documotion_short: contract(["narration.timed", "visuals.documentary_collage", "master.native_vertical", "master.assembled"], {
    requiredConsumes: ["topic", "beatManifest"],
    // The lane can only LOWER the engine's verifier refine-round cap; it is read
    // for spend tuning, never as an ambient content input.
    optionalConsumes: ["contentLane"],
    providerProfiles: [managed, local],
    maxCostUsd: 25,
    qualityRequired: true,
  }),
  short_scene_qa: contract(["qa.short_scene_required", "qa.short_safe_area", "qa.short_provenance"], {
    requiredConsumes: ["beatManifest", "documotionVerdict", "documotionRender"],
    qualityRequired: true,
  }),
  stock_footage: contract(["visuals.sourced"], {
    optionalConsumes: [
      "reuseFootageKeys", "reuseThirdPartyStockEvidence", "narrationDurationSec", "narrationText", "cutSheet", "styleDNA", "healHints",
      "visualBrief", "signatureClips", "niche", "channelProgramRoute", "syntheticScenario", "scenarioVisualTreatment",
    ],
  }),
  entity_imagery: contract(["visuals.entities"], {
    optionalConsumes: [
      "styleDNA", "visualBrief",
      // Per-channel grounding for the entity-selection produce→critique loop (P1-4).
      "channelName", "persona", "styleGrammar", "criticDoctrine", "contentLane", "topic", "channelProgramRoute", "syntheticScenario", "scenarioVisualTreatment",
    ],
  }),
  intro_card: contract(["graphics.intro"], { optionalConsumes: ["palette", "channelAvatarKey", "channelName"] }),
  quote_overlays: contract(["graphics.quotes"], { optionalConsumes: ["introSec", "chapterPlan", "studioOverlayRecipeProjection"] }),
  visual_inserts: contract(["graphics.data"], {
    optionalConsumes: ["topic", "niche", "styleDNA", "palette", "introSec", "quoteOverlays", "chapterPlan", "dataStorySourceLedger", "evidenceVisualManifests", "studioMotionGraphicsRecipeProjection"],
  }),
  timeline_assemble: contract(["master.assembled"], {
    requiredConsumes: ["footageClips", "narrationLocalPath", "narrationDurationSec", "musicUrl"],
    optionalConsumes: [
      "entityClips", "introCardPath", "introApplied", "introCardKey", "introSec", "healHints", "healClasses", "sentenceTimings", "cutSheet",
      "chapterPlan", "channelAvatarKey", "script", "channelName", "quoteOverlays", "insertOverlays",
      "cinematicGeneratedScenePlan", "cinematicEditDecisionList", "generatedFootageSceneManifest",
      "extraOverlays", "musicKey", "styleDNA", "shotRenderManifest", "shotQaReport", "visualCoverage", "studioOverlayRecipeProjection", "studioTransitionRecipeProjection", "channelModuleConfig",
      "topic", "channelProgramRoute", "syntheticScenario", "scenarioVisualTreatment",
      // Rights provenance is optional for historical runs, but when present
      // assembly verifies the selected staged input set before encoding.
      "footageKeys", "thirdPartyStockEvidence", "footageOnScreenTextCues",
    ],
    providerProfiles: [local],
    qualityRequired: true,
  }),
  length_check: contract(["master.length_passed"], { qualityRequired: true }),
  captions: contract(["master.captions_packaged"], {
    optionalConsumes: ["script", "sentenceTimings", "introSec", "chapterPlan"],
  }),
  qa_visual: contract(["master.quality_passed"], {
    optionalConsumes: [
      "narrationDurationSec", "narrationPerformanceEvidence", "script", "sentenceTimings", "styleDNA", "introApplied", "healHints", "palette",
      "tags", "strategy", "thumbnailer", "introSec", "quoteOverlays", "quotesApplied", "insertOverlays",
      "insertsApplied", "captionCues", "captionsApplied", "outroApplied", "validationSpec", "quoteOverlapSec", "loopSeamDiff",
      "overlaysDropped", "qualityBar", "description", "musicKey", "channelName", "niche", "persona", "styleGrammar", "topic", "family",
      // Grounds the mandatory holistic visual gate in this channel's doctrine.
      "criticDoctrine", "contentLane",
      // Optional plan-only inputs for the non-gating Viewer Promise Progression
      // observation. Final QA consumes these only after its normal review;
      // no route needs to produce all of them.
      "timedScript", "narrativeBeats", "continuityLedger", "shotList", "dpVisualSpecs", "editorEdl", "storyCoverage", "storySpineFingerprint", "episodeGraph",
      "assetQaReport", "shotQaReport", "healAttempt",
      // Durable provenance from story_spine / short_strategy is reused when it
      // matches the active lane; final QA must declare that cross-block input.
      "episodeSpec",
      "serializedProgramEpisodeContext",
      "motionComicTimeline", "visualRepair", "visualMatterManifest",
      "cinematicCaseSequenceInput", "cinematicCaseSequenceAdmission", "cinematicGeneratedScenePlan", "cinematicCreativeLocks", "cinematicEditDecisionList", "cinematicFinalMasterQaAdmission", "generatedFootageSceneManifest",
      // Standard Novita Story-Spine renders use this exact LTX cut plan; it is
      // optional because non-LTX lanes do not produce a shot-render manifest.
      // The paired byte manifest is emitted only after the accepted local QA
      // take is known; legacy key-only runs intentionally remain supported.
      "shotRenderManifest", "visualCoverage", "visualSequenceArtifactManifest",
      // Studio-library selections for the direct open-weight LTX 2.5 Novita
      // worker are rechecked against the exact persisted
      // shot manifest before the final-master certificate can expose them.
      "studioLtxCreativeAdapterSelection", "studioLtxCreativeAdapterSelectionsByShot",
      // Production QA records only recipe fingerprints that were actually
      // projected into the corresponding upstream module. These optional
      // inputs never create a new recipe or alter release eligibility.
      "studioAssetRecipeProjection", "studioAudioRecipeProjection",
      "studioOverlayRecipeProjection", "studioMotionGraphicsRecipeProjection",
      "studioTransitionRecipeProjection", "studioPostproductionDecision",
      "shortStrategyBrief", "beatManifest", "shortRetentionManifest", "shortSceneQa", "documotionVerdict", "documotionRender",
      // Final QA conditionally rehydrates narration, validates admitted
      // Casefile provenance, and now verifies renderer-declared readable text.
      // These remain optional because each is specific to a different lane.
      "narrationKey", "narrationLocalPath", "narrationTranscriptText", "narrationStartSec", "onScreenTextCues", "quizShortOpeningHook",
      "casefileEvidenceShotMapAdmission", "casefileSourceAdmission", "sourceBoundStorySpine",
      // New route-bearing runs seal this immutable identity into the generic
      // final-QA evidence binding. Route-less historical runs stay compatible.
      "channelProgramRoute", "channelSelectedCapabilityKeys",
      // Optional typed receipts are adapted only after the existing final QA
      // receipt has been persisted; absent inputs remain explicitly unmeasured.
      "narrationText", "dataStorySourceLedger", "syntheticScenario", "syntheticScenarioDisclosure", "scenarioVisualTreatment",
      "thumbnailScenarioVisualTreatmentProvenance",
      // Immutable title/thumbnail/opening binding created before thumbnail spend.
      "packageToOpeningPlan", "thumbnailDescription", "quizPlan",
      // Optional immutable provenance from stock_footage. Production final QA
      // re-checks it before binding it into the release certificate.
      "footageKeys", "thirdPartyStockEvidence",
      // Optional because legacy renderer paths plan internally. When present,
      // final QA rebinds this sealed plan to the active route/lane/topic as
      // plan-only provenance; it is never treated as final-master coverage.
      "selfContainedStoryReceipt",
    ],
    // Draft probes may return a non-passing/unran review. Production QA mints
    // these publish-grade artifacts; upload still consumes them as required.
    optionalProduces: [
      "finalMasterReleaseCertificate",
      "finalMasterReleaseCertificateReference",
      "finalMasterReleaseCertificateKey",
      "packageToOpening", "packageToOpeningOmission",
    ],
    providerProfiles: [managed, local],
    // The exact receipt narrows this before Novita starts. Preserve the normal
    // $5 QA ceiling: an oversized cinematic plan is rejected early rather than
    // silently expanding the channel's established QA authority.
    maxCostUsd: 5,
    maxCostUsdFor: (params, context) => {
      const cinematicPlan = cinematicFinalMasterQaVisualReviewPlanFromStore(context?.store);
      return qaVisualCost(
        params,
        cinematicPlan?.admission.reviewCostUsd,
        cinematicPlan?.completeFocusFrameCount,
      );
    },
    qualityRequired: true,
  }),
  originality_gate: contract(["final.lexical_script_self_dedup_passed"], { optionalConsumes: ["topic"], qualityRequired: true }),
  compliance_check: contract(["final.compliance_passed"], { optionalConsumes: ["niche"], qualityRequired: true }),

  director_brief: contract(["crew.director_treatment"], { optionalConsumes: ["styleDNA", "niche", "channelName", "serializedProgramEpisodeContext"] }),
  dp_brief: contract(["crew.dp_visual_spec"], { optionalConsumes: ["styleDNA", "niche", "channelName", "serializedProgramEpisodeContext"] }),
  editor_brief: contract(["crew.editor_edl"], { optionalConsumes: ["styleDNA", "niche", "channelName", "serializedProgramEpisodeContext"] }),
  composer_brief: contract(["crew.composer_cue_sheet"], { optionalConsumes: ["styleDNA", "niche", "channelName", "serializedProgramEpisodeContext"] }),
  critic_spec: contract(["crew.critic_validation_spec"], { optionalConsumes: ["styleDNA", "niche", "channelName", "serializedProgramEpisodeContext"] }),

  story_spine: contract(["story.timed", "visuals.story_planned"], {
    optionalConsumes: [
      "structure", "visualBrief", "cutSheet", "styleDNA", "contentLane",
      "curriculumEpisodeSeed", "curriculumEpisodeSeedApproval",
      "editorialEvidencePacket",
      "serializedProgramEpisodeContext",
    ],
    qualityRequired: true,
  }),

  synthetic_scenario: contract(["story.synthetic_scenario_contract"], {
    requiredConsumes: ["topic"],
    optionalConsumes: ["channelProgramRoute"],
    providerProfiles: [local],
    maxCostUsd: 0,
    qualityRequired: true,
  }),
  scenario_disclosure_gate: contract(["story.synthetic_scenario_disclosed"], {
    requiredConsumes: ["syntheticScenario", "narrationText"],
    optionalConsumes: ["channelProgramRoute"],
    providerProfiles: [local],
    maxCostUsd: 0,
    qualityRequired: true,
  }),
  // Route-derived, provider-free policy. It never admits a renderer by
  // itself; every visual adapter must bind it before selecting source media.
  scenario_visual_treatment: contract(["visuals.synthetic_scenario_treated"], {
    requiredConsumes: ["topic", "syntheticScenario", "channelProgramRoute"],
    providerProfiles: [local],
    maxCostUsd: 0,
    qualityRequired: true,
  }),

  episode_graph: contract(["story.episode_graph_locked", "visuals.scene_manifest"], {
    requiredConsumes: [
      "topic", "timedScript", "narrativeBeats", "continuityLedger", "shotList", "dpVisualSpecs", "editorEdl", "storyCoverage",
    ],
    optionalConsumes: [
      "syntheticScenario", "scenarioVisualTreatment", "channelProgramRoute", "contentLane", "curriculumEpisodeSeed", "curriculumEpisodeSeedApproval", "evidenceVisualManifests", "editorialEvidencePacket",
    ],
    providerProfiles: [local],
    qualityRequired: true,
  }),

  // Shared factual source/claim/snapshot admission. It is deliberately not a
  // Casefile replacement and can only emit a private editorial-review packet.
  editorial_evidence_packet: contract([
    "factual.editorial_evidence_locked",
    "publish.private_only",
  ], {
    requiredConsumes: ["editorialEvidencePacketInput"],
    providerProfiles: [local],
    maxCostUsd: 0,
    qualityRequired: true,
  }),

  learning_contract: contract(["learning.contract_locked", "learning.retrieval_practice_locked"], {
    requiredConsumes: ["episodeGraph", "contentLane"],
    providerProfiles: [local],
    qualityRequired: true,
  }),

  // An operator-supplied, child-editor-signed episode intent. This happens
  // before generic story planning, but emits only a private-review handoff.
  curriculum_episode_seed: contract([
    "children.curriculum_episode_seed_admitted",
    "children.curriculum_intent_locked",
    "publish.private_only",
  ], {
    requiredConsumes: ["curriculumEpisodeSeedInput", "contentLane"],
    providerProfiles: [local],
    qualityRequired: true,
  }),

  // Standalone, operator-supplied curriculum / recurring-identity admission.
  // It intentionally emits a private child-editor-review receipt only; no
  // children family or publishing policy reads this as automatic approval.
  children_show_bible: contract([
    "children.show_bible_admitted",
    "children.curriculum_continuity_locked",
    "publish.private_only",
  ], {
    requiredConsumes: [
      "childrenShowBibleInput", "curriculumEpisodeSeed", "curriculumEpisodeSeedApproval",
      "episodeGraph", "lessonContract", "contentLane",
    ],
    providerProfiles: [local],
    qualityRequired: true,
  }),

  child_content_safety: contract(["safety.child_content_review_required", "publish.private_only"], {
    requiredConsumes: [
      "episodeGraph", "sceneManifest", "lessonContract", "contentLane",
      "childrenShowBible", "childrenShowBibleApproval",
      "curriculumEpisodeSeed", "curriculumEpisodeSeedApproval",
    ],
    providerProfiles: [local],
    qualityRequired: true,
  }),

  // Operator-supplied source-first documentary evidence. This admission module
  // is intentionally not a story planner or renderer: it proves a Case Packet
  // has claim-level primary evidence, source-use rights boundaries, and a
  // fresh human review receipt before any future documentary lane may read it.
  casefile_source_packet: contract([
    "documentary.source_packet_admitted",
    "documentary.evidence_grammar_locked",
    "publish.private_only",
  ], {
    requiredConsumes: ["casefileSourcePacketInput"],
    providerProfiles: [local],
    qualityRequired: true,
  }),

  // A separate visual-editor handoff for source-admitted factual documentary
  // work. It binds every claim to real Scene Manifest / ShotPlan targets and
  // can only emit another private human-review receipt; no family consumes it.
  casefile_evidence_shot_map: contract([
    "documentary.claim_to_shot_mapping_locked",
    "documentary.visual_safety_policy_locked",
    "publish.private_only",
  ], {
    requiredConsumes: [
      "casefileSourcePacket",
      "casefileSourceAdmission",
      "casefileEvidenceShotMapInput",
      "sceneManifest",
      "shotList",
    ],
    providerProfiles: [local],
    qualityRequired: true,
  }),

  // A reusable post-review bridge: it carries the exact, already-admitted
  // Casefile claim/source/citation map into a timed Story Spine. It creates no
  // facts, render plan, family admission, or publication authority.
  source_bound_story_spine: contract([
    "documentary.source_bound_story_spine_locked",
    "publish.private_only",
  ], {
    requiredConsumes: [
      "casefileSourcePacket",
      "casefileSourceAdmission",
      "casefileEvidenceShotMap",
      "casefileEvidenceShotMapAdmission",
      "timedScript",
      "narrativeBeats",
      "continuityLedger",
      "shotList",
      "dpVisualSpecs",
      "editorEdl",
      "storyCoverage",
    ],
    providerProfiles: [local],
    qualityRequired: true,
  }),

  // The actual cinematic documentary handoff is intentionally three stages:
  // deterministic source-bound draft, real human signature, then strict
  // admission. It is a private human-review artifact, not a generic prompt
  // generator or a family admission switch.
  cinematic_case_sequence_draft: contract([
    "documentary.cinematic_sequence_drafted",
    "documentary.non_likeness_cast_locked",
    "publish.private_only",
  ], {
    requiredConsumes: [
      "cinematicCaseDirection",
      "casefileEvidenceShotMap",
      "sourceBoundStorySpine",
      "sceneManifest",
      "shotList",
    ],
    providerProfiles: [local],
    qualityRequired: true,
  }),
  cinematic_case_sequence_finalize: contract([
    "documentary.cinematic_sequence_human_signed",
    "publish.private_only",
  ], {
    requiredConsumes: ["cinematicCaseSequenceDraft", "cinematicSequenceEditorialReview"],
    providerProfiles: [local],
    qualityRequired: true,
  }),
  cinematic_case_sequence: contract([
    "documentary.cinematic_sequence_locked",
    "documentary.causal_cut_coverage_locked",
    "documentary.non_likeness_cast_locked",
    "publish.private_only",
  ], {
    requiredConsumes: [
      "casefileSourcePacket",
      "casefileSourceAdmission",
      "casefileEvidenceShotMap",
      "casefileEvidenceShotMapAdmission",
      "sourceBoundStorySpine",
      "cinematicCaseSequenceInput",
      "sceneManifest",
      "shotList",
    ],
    optionalConsumes: ["narrativeEvidenceLedger", "editorialEvidencePacket"],
    providerProfiles: [local],
    qualityRequired: true,
  }),

  scene_compiler: contract(["visuals.scene_compiled", "master.assembled"], {
    requiredConsumes: ["sceneManifest", "narrationLocalPath", "narrationDurationSec", "musicUrl"],
    optionalConsumes: ["musicKey", "episodeGraph", "contentLane", "channelProgramRoute", "syntheticScenario", "scenarioVisualTreatment"],
    providerProfiles: [local],
    maxCostUsd: 0,
    qualityRequired: true,
  }),
  visual_matter: contract(["visuals.visual_matter_planned", "visuals.visual_lock"], {
    requiredConsumes: ["topic", "narrativeBeats", "continuityLedger", "shotList", "dpVisualSpecs", "studioAssetRecipeProjection"],
    optionalConsumes: ["channelName", "styleDNA", "visualBrief"],
    // Planning remains local. The separate optional reference block is the
    // only admitted direct-Novita route; FAL/Nano Banana stays thumbnail-only.
    providerProfiles: [local],
    maxCostUsd: 0,
    qualityRequired: true,
  }),
  // Owner-scoped Studio recipe lookup before Visual Matter decides whether
  // fresh camera/motion/prompt material is necessary. It has no provider and
  // cannot expose raw assets, LoRA paths, or guide pixels to a planner.
  studio_asset_resolve: contract(["studio.asset_resolution"], {
    providerProfiles: [local],
    maxCostUsd: 0,
  }),
  // Per-consumer Studio templates for music direction, quote-card treatment,
  // and data-graphic presentation. This lookup is local and provenance-only:
  // it cannot change the edit decision list, timing, claims, or source facts.
  studio_postproduction_asset_resolve: contract(["studio.postproduction_asset_resolution"], {
    providerProfiles: [local],
    maxCostUsd: 0,
  }),
  // A second, post-keyframe-QA lookup for the only adapter type the current
  // direct LTX worker can execute. It resolves a selection proof, never a raw
  // file path; direct rendering independently verifies its worker-manifest
  // digest before paid GPU admission.
  studio_ltx_adapter_resolve: contract(["studio.ltx_adapter_resolution"], {
    requiredConsumes: ["assetQaReport"],
    // Present only on sealed serialized narrative routes. When it is present,
    // the resolver uses its episode-local accepted-character subset to keep a
    // persistent character LoRA out of episodes where that character is absent.
    optionalConsumes: ["narrativeAcceptedCharacterAdapters", "narrativeShotControl"],
    providerProfiles: [local],
    maxCostUsd: 0,
  }),
  // Server-only optional bridge from Visual Matter planning to actual direct
  // Z-Image R2 comparison assets. It has no image-to-image/reference-input
  // claim: the bounded outputs are consumed only by visual QA.
  visual_matter_references: contract(["visuals.visual_matter_reference_assets", "render.spot_only"], {
    // The runtime verifies this is the immutable cinematic lane before it can
    // reserve or admit a direct-Novita worker.
    requiredConsumes: ["contentLane", "visualMatterManifest"],
    providerProfiles: [{ id: "novita-zimage-production", provider: "novita", quality: "production", allowFallback: false }],
    maxCostUsd: 12 * PRICE.novitaImageMaxUsd,
    maxCostUsdFor: (params) =>
      Math.floor(boundedNumber(params["maxImages"], 8, 1, 12)) * PRICE.novitaImageMaxUsd,
  }),

  gen_footage: contract(["visuals.generated", "render.profile_pinned", "render.spot_only"], {
    // The renderer accepts only reusable, validated scene-plan handoffs:
    // an admitted Cinematic Case Sequence, Story Spine's shot/DP artifacts,
    // or Episode Graph's sceneManifest. The legacy free-form planning path is
    // intentionally unavailable at runtime.
    optionalConsumes: [
      "styleDNA",
      "visualBrief",
      // A persisted, previously selected LTX treatment wins on retry; fresh
      // runs deterministically derive one from the sealed channel identity.
      "ltxStyleId",
      "narrationDurationSec",
      "timedScript",
      "narrativeBeats",
      "continuityLedger",
      "shotList",
      "dpVisualSpecs",
      "editorEdl",
      "storyCoverage",
      "sceneManifest",
      "cinematicGeneratedScenePlan",
      "cinematicCreativeLocks",
      "cinematicEditDecisionList",
      "cinematicFinalMasterQaAdmission",
      "channelName",
      "persona",
      "styleGrammar",
      "criticDoctrine",
      // Present only on a route-owned serialized program. The planner verifies
      // its route/run/topic binding before it can influence a native comic
      // storyboard; ordinary self-contained stories remain independent.
      "serializedProgramEpisodeContext",
      "contentLane",
    ],
    providerProfiles: [{ id: "novita-zimage-ltx-production", provider: "novita", quality: "production", allowFallback: false }],
    // A cinematic sequence can deliberately contain up to 240 short,
    // source-bound coverage shots. It must name maxCinematicClips explicitly
    // so reservation and actual batch count cannot drift.
    // A source-bound cinematic shot reserves one initial still plus exactly
    // one independently reviewed replacement before its LTX render, followed
    // by one independently reviewed replacement LTX take. Generic generated
    // footage retains the one-still/one-video envelope.
    maxCostUsd: 1_980,
    maxCostUsdFor: (params, context) => {
      const seconds = targetSeconds(params, context, 300);
      const cinematicLimit = finiteNumber(params["maxCinematicClips"]);
      const clips = cinematicLimit === undefined
        ? Math.ceil(boundedNumber(params["maxClips"], Math.ceil(seconds / 22), 6, 24))
        : Math.ceil(boundedNumber(cinematicLimit, 2, 2, 240));
      const imageAttempts = cinematicLimit === undefined ? 1 : 2;
      const videoAttempts = cinematicLimit === undefined ? 1 : 2;
      return clips * (imageAttempts * PRICE.novitaImageMaxUsd + videoAttempts * PRICE.novitaVideoMaxUsd);
    },
  }),
  signature_clips: contract(["visuals.signature_generated", "render.profile_pinned", "render.spot_only"], {
    // See gen_footage: signature rendering consumes the same durable plan
    // rather than asking a second model to invent a disconnected scene list.
    optionalConsumes: [
      "styleDNA",
      "visualBrief",
      "timedScript",
      "narrativeBeats",
      "continuityLedger",
      "shotList",
      "dpVisualSpecs",
      "editorEdl",
      "storyCoverage",
      "sceneManifest",
      "channelName",
      "persona",
      "styleGrammar",
      "criticDoctrine",
      "contentLane",
    ],
    providerProfiles: [{ id: "novita-zimage-ltx-production", provider: "novita", quality: "production", allowFallback: false }],
    maxCostUsd: 33,
    maxCostUsdFor: (params) => {
      const count = Math.ceil(
        boundedNumber(params["count"] ?? params["signatureGenClips"], 0, 0, 6),
      );
      return count * (PRICE.novitaImageMaxUsd + PRICE.novitaVideoMaxUsd);
    },
  }),
  novita_render_images: contract(["visuals.keyframes_generated", "render.profile_pinned", "render.spot_only"], {
    requiredConsumes: ["shotList", "dpVisualSpecs", "visualMatterManifest"],
    optionalConsumes: ["visualBrief", "studioLtxCreativeAdapterSelection"],
    providerProfiles: [{ id: "novita-zimage-production", provider: "novita", quality: "production", allowFallback: false }],
    // 50 hero shots × two candidates × the single-4090 two-hour hard bound.
    // This is a reservation ceiling, not an instruction to spend it; runtime
    // still requires a stricter configured direct-fleet admission.
    maxCostUsd: 35,
    // The first shot and every named-entity shot are high risk and therefore
    // receive at least two candidates. Respect higher future profile fanout.
    maxCostUsdFor: (params, context) =>
      shotCount(params, context) *
      Math.max(2, generationProfile(generationProfileId(params, context)).image.candidates) *
      PRICE.novitaImageMaxUsd,
  }),
  qa_assets: contract(["qa.assets_required", "visuals.keyframes_selected"], {
    requiredConsumes: ["shotList", "dpVisualSpecs", "stillRenderManifest", "visualMatterManifest"],
    // Channel identity is frozen in the invocation seed store. It is optional
    // only for legacy channels; when present, the grader reads it as a strict
    // policy input rather than an ambient store escape hatch.
    optionalConsumes: [
      "qualityBar",
      "styleDNA",
      "styleGrammar",
      "palette",
      "persona",
      "niche",
      "validationSpec",
      // P1-1/P1-17: the operator's critic doctrine and the durable content lane
      // now ground this grader's prompt via the shared channelCritiqueBrief.
      "channelName",
      "criticDoctrine",
      "contentLane",
      // Actual byte/receipt-bound R2 comparison images from the optional
      // Visual Matter direct text-to-image bridge; never generator conditioning.
      ...VISUAL_MATTER_REFERENCE_QA_CONSUMERS.qa_assets,
    ],
    providerProfiles: [managed],
    // Reserve every required Visual Matter reference batch, plus the bounded
    // one-candidate repairs. A five-image vision request cannot carry more
    // than one four-candidate initial set or four anchors with a repair.
    // A default 300-second / 6-second-shot cinematic run has 50 shots; its
    // full-evidence image-QA ceiling is $37.40 at the configured rates.
    maxCostUsd: 38,
    maxCostUsdFor: (params, context) => shotCount(params, context) * (
      NOVITA_CINEMATIC_QA_REPAIR_CAP * PRICE.novitaImageMaxUsd +
      novitaCinematicQaMaxGraderCallsPerShot("image") * PRICE.visionGraderUsd
    ),
    qualityRequired: true,
  }),
  novita_render_video: contract(["visuals.shots_rendered", "render.profile_pinned", "render.spot_only"], {
    requiredConsumes: ["shotList", "dpVisualSpecs", "selectedStillManifest", "assetQaReport", "visualMatterManifest"],
    optionalConsumes: [
      "visualBrief",
      "studioLtxCreativeAdapterSelection",
      "studioLtxCreativeAdapterSelectionsByShot",
      "narrativeShotControl",
      "narrativeAcceptedCharacterAdapters",
    ],
    providerProfiles: [{ id: "novita-ltx-production", provider: "novita", quality: "production", allowFallback: false }],
    maxCostUsd: 35,
    maxCostUsdFor: (params, context) =>
      shotCount(params, context) *
      generationProfile(generationProfileId(params, context)).video.candidates *
      PRICE.novitaVideoMaxUsd,
  }),
  qa_shots: contract(["visuals.generated", "visuals.story_aligned", "qa.shots_required"], {
    requiredConsumes: ["shotList", "dpVisualSpecs", "selectedStillManifest", "shotRenderManifest", "visualMatterManifest"],
    optionalConsumes: [
      "qualityBar",
      "styleDNA",
      "styleGrammar",
      "palette",
      "persona",
      "niche",
      "validationSpec",
      // P1-1/P1-17: the operator's critic doctrine and the durable content lane
      // now ground this grader's prompt via the shared channelCritiqueBrief.
      "channelName",
      "criticDoctrine",
      "contentLane",
      ...VISUAL_MATTER_REFERENCE_QA_CONSUMERS.qa_shots,
    ],
    providerProfiles: [managed, local],
    // One selected still is held fixed while LTX may receive small,
    // deterministic motion repairs. Reserve all five reference batches and
    // the possible endpoint-continuity grade for every take.
    // The same default 50-shot run needs $37.70 when every take also receives
    // its possible endpoint-continuity grade.
    maxCostUsd: 38,
    maxCostUsdFor: (params, context) => shotCount(params, context) * (
      NOVITA_CINEMATIC_QA_REPAIR_CAP * PRICE.novitaVideoMaxUsd +
      novitaCinematicQaMaxGraderCallsPerShot("video") * PRICE.visionGraderUsd
    ),
    qualityRequired: true,
  }),
  // Shared bounded non-Google native-story planning. It must run before the
  // provider-free sealing boundary and still cannot select/admit a route or
  // start a renderer by registration alone.
  self_contained_story_plan: contract(["story.self_contained_plan_critic_approved"], {
    requiredConsumes: ["topic", "channelProgramRoute", "contentLane"],
    optionalConsumes: [
      "researchNotes",
      "factSheet",
      "visualBrief",
      "channelName",
      "persona",
      "styleGrammar",
      "criticDoctrine",
    ],
    providerProfiles: [managed],
    // Two planning candidates and two critic verdicts are the hard maximum.
    maxCostUsd: 4 * PRICE.boundedTextPassUsd,
    maxCostUsdFor: () => 4 * PRICE.boundedTextPassUsd,
    qualityRequired: true,
  }),
  // Shared provider-free plan → sealed native-story receipt boundary. It does
  // not select/admit a route or start a renderer; a future route must place
  // every input explicitly before this becomes executable.
  self_contained_story: contract(["story.self_contained_receipt_sealed"], {
    requiredConsumes: ["topic", "channelProgramRoute", "selfContainedStoryPlan"],
    providerProfiles: [local],
  }),
  whiteboard_scribe: contract(
    ["script.generated", "script.qa_passed", "narration.timed", "visuals.generated", "visuals.story_aligned", "master.assembled"],
    {
      optionalConsumes: ["researchNotes", "factSheet", "visualBrief", "voiceId", "ttsProvider", "palette", "musicKey", "musicUrl", "selfContainedStoryReceipt", "channelProgramRoute"],
      providerProfiles: [managed, local],
      // 16 panels × five sealed Nano Banana Pro images ($12.08 ceiling), plus
      // the full premium TTS ceiling. Upstream music is charged by its own
      // block. This must stay above the actual maximum, not a cheaper model.
      maxCostUsd: 15,
      // Cold-run bound mirrors the engine's exact Pro-art and narration
      // ceilings. Upstream music is charged by its own block.
      maxCostUsdFor: (params, context) => whiteboardCostCeiling(params, context),
      qualityRequired: true,
    },
  ),
  lore_short: contract(
    ["script.generated", "script.qa_passed", "narration.timed", "visuals.generated", "visuals.story_aligned", "master.assembled"],
    {
      optionalConsumes: ["visualBrief", "persona", "channelName", "title", "voiceId", "ttsProvider", "criticDoctrine", "styleGrammar", "contentLane", "selfContainedStoryReceipt", "channelProgramRoute"],
      providerProfiles: [managed, local],
      maxCostUsd: 30,
      maxCostUsdFor: (params, context) => loreShortCostCeiling(params, context),
      qualityRequired: true,
    },
  ),
  quiz_year: contract(
    // NO script.* and NO narration.* capabilities, deliberately. This format is
    // non-narrated on-screen typography — there is no spoken script to time, and the
    // production policy correctly rejects a pipeline that claims
    // "script.generated" without ever producing "narration.timed". Declaring a
    // script here to look complete would be exactly the kind of overclaim the
    // contract system exists to catch.
    ["visuals.generated", "visuals.story_aligned", "master.assembled"],
    {
      // `quizPlan` + `quizSafety` are the receipt-bound planner handoff. The
      // renderer repeats the topic comparison before sourcing any fact, so a
      // sequential pipeline position cannot masquerade as a safety boundary.
      // `quizCategories` lets a channel pin the mix (e.g. capitals + currencies
      // only); omitted, the block draws from every category. Declared here
      // because the contract test enforces that a module cannot read a store key
      // it never announced.
      // The certified family registry requires an upstream `music` entry and
      // the block rejects an invocation that is not explicitly noGemini.
      requiredConsumes: ["quizPlan", "quizSafety"],
      optionalConsumes: ["musicKey", "channelName", "palette", "criticDoctrine", "styleGrammar", "contentLane", "quizTopic", "topic", "quizCategories", "channelProgramRoute"],
      // Portrait QuizShort emits an opening authority only when its supervised
      // route is selected. Existing landscape QuizYear runs remain unchanged.
      optionalProduces: ["quizShortOpeningHook"],
      providerProfiles: [local],
      maxCostUsd: 0,
      maxCostUsdFor: (params, context) => quizYearCostCeiling(params, context),
      qualityRequired: true,
    },
  ),
  // A post-QA admission for the portrait certified-trivia derivative. It does
  // not plan, render, call a provider, or authorize publication: it only binds
  // certified facts, source OCR, opening evidence, final visual/audio QA, and
  // the sealed supervised route into a private human-review receipt.
  quiz_short_release: contract([
    "quiz.short_release_review_required",
    "publish.private_only",
  ], {
    requiredConsumes: [
      "quizPlan", "quizSafety", "quizRounds", "onScreenTextCues",
      "quizShortOpeningHook", "videoKey", "videoDurationSec", "qaReport",
      "contentLane", "channelProgramRoute", "finalMasterReleaseCertificateKey",
    ],
    providerProfiles: [local],
    maxCostUsd: 0,
    qualityRequired: true,
  }),
  motion_comic: contract(
    ["script.generated", "script.qa_passed", "narration.timed", "visuals.generated", "visuals.story_aligned", "master.assembled"],
    {
      optionalConsumes: ["researchNotes", "factSheet", "visualBrief", "visualRepair", "healHints", "healAttempt", "selfContainedStoryReceipt", "channelProgramRoute"],
      providerProfiles: [managed, local],
      maxCostUsd: 40,
      // Cold-run bound includes the live direct-Novita primary/recovery panel
      // workers, bounded ElevenLabs dialogue, one music job, and two
      // vision-letterer calls per panel.
      maxCostUsdFor: (params) => motionComicCostCeiling(params),
      qualityRequired: true,
    },
  ),
  crosspost: contract(["publish.crossposted"], {
    optionalConsumes: ["description"],
    sideEffects: ["publish_media"],
  }),
  emit_bundle: contract(["artifacts.bundle_emitted"], {
    optionalConsumes: [
      "topic",
      "script",
      "narrationText",
      "musicKey",
      "footageClips",
      "footageKeys",
      "thirdPartyStockEvidence",
    ],
  }),
};
