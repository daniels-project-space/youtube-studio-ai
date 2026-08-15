import { generationProfile } from "./generationProfiles";
import {
  NOVITA_CINEMATIC_QA_REPAIR_CAP,
  PRICE,
  bananaUnitRate,
  qaVisualCost,
} from "./pricing";
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
  whiteboardPanelCount,
} from "../lib/whiteboardSync";
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

function bananaImageUnitCeiling(tier: "flash" | "pro"): number {
  return Math.max(
    bananaUnitRate(tier),
    bananaUnitRate(tier, process.env, { hasReferences: true }),
  );
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
  // Keep this contract on the same bounded worker and narration helpers as
  // whiteboardScribe. The live art route is direct Novita, not Nano Banana:
  // charging it at a cheap planning rate lets the compiler admit runs that
  // cannot fund their actual teardown-verified workers.
  const panels = whiteboardPanelCount(Math.max(4, Math.round(seconds / 22)));
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
    whiteboardImageCallCeiling(panels) * PRICE.novitaImageMaxUsd +
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
    optionalConsumes: ["plannedTopic", "reuseTopic", "channelName", "persona", "niche", "styleGrammar", "topicPool"],
    optionalProduces: ["topicBet"],
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
    providerProfiles: [local],
    qualityRequired: true,
  }),
  quiz_topic_safety: contract(["final.compliance_passed"], {
    requiredConsumes: ["topic", "quizPlan"],
    providerProfiles: [local],
    qualityRequired: true,
  }),
  quiz_critic_spec: contract(["crew.critic_validation_spec"], {
    requiredConsumes: ["quizPlan"],
    providerProfiles: [local],
    qualityRequired: true,
  }),
  quiz_metadata: contract(["package.metadata"], {
    requiredConsumes: ["topic", "quizPlan"],
    providerProfiles: [local],
    qualityRequired: true,
  }),
  quiz_thumbnail: contract(["package.thumbnail"], {
    requiredConsumes: ["quizRounds", "title"],
    optionalConsumes: ["palette"],
    providerProfiles: [local],
    qualityRequired: true,
  }),
  competitor_research: contract(["topic.researched"], { optionalConsumes: ["niche"] }),
  scene_planner: contract(["visuals.planned"], {
    optionalConsumes: ["styleGrammar", "visualStyle", "visualBrief", "niche", "styleDNA", "sceneLibrary"],
  }),
  keyframes: contract(["visuals.keyframe_generated", "render.profile_pinned", "render.spot_only"], {
    optionalConsumes: ["styleGrammar", "visualStyle", "styleDNA"],
    providerProfiles: [{ id: "novita-zimage-local-production", provider: "novita", quality: "production", allowFallback: false }],
    maxCostUsd: 1,
    // The art-director loop performs at most two still generations.
    maxCostUsdFor: () => 2 * PRICE.novitaImageMaxUsd,
  }),
  loop_clips: contract(["visuals.motion_generated", "render.profile_pinned", "render.spot_only"], {
    optionalConsumes: ["scenes", "motionPrompt", "styleGrammar", "visualStyle"],
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
    optionalConsumes: ["reuseMusicKey", "musicBrief", "styleDNA", "channelName", "sceneMusicPrompt"],
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
      optionalConsumes: ["chapterPlan", "scheduledPublishAt", "contentLane", "childContentSafety", "sceneCompilerReceipt"],
      sideEffects: ["publish_media"],
      qualityRequired: true,
    },
  ),
  notify: contract(["notify.operator"], { sideEffects: ["external_message"] }),
  cleanup: contract(["storage.scoped_cleanup"], { sideEffects: ["delete_scoped_artifacts"] }),
  shorts_spinoff: contract(["master.short_created", "publish.connector_bound", "publish.resumable", "publish.synthetic_disclosed"], {
    optionalConsumes: ["description", "tags"],
    sideEffects: ["publish_media"],
  }),

  metadata: contract(["package.metadata"], {
    optionalConsumes: [
      "bannedWords", "chaptersText", "videoDurationSec", "attributions", "channelName", "niche", "persona",
      "nicheIntel", "seoDatabank", "competitors", "narrationText", "script", "styleDNA", "topicBet", "plannedTitle",
    ],
  }),
  thumbnail_gen: contract(["package.thumbnail"], {
    optionalConsumes: [
      "channelName", "topic", "f1Url", "f1Key", "f1ThumbnailBaseProvenance", "styleGrammar", "styleDNA", "family", "persona",
      "thumbnailIdentity", "nicheIntel", "thumbnailer", "niche", "seoDatabank", "competitors", "healHints", "plannedThumbnailKey",
      "narrationText",
      // Per-channel critique grounding for the produce→critique→regenerate loop.
      "criticDoctrine", "contentLane",
    ],
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
      "criticDoctrine", "contentLane", "dataStorySourceLedger", "casefileSourcePacket",
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
    optionalConsumes: ["script", "styleDNA", "persona", "dataStorySourceLedger"],
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
      "reuseFootageKeys", "narrationDurationSec", "narrationText", "cutSheet", "styleDNA", "healHints",
      "visualBrief", "signatureClips", "niche",
    ],
  }),
  entity_imagery: contract(["visuals.entities"], {
    optionalConsumes: [
      "styleDNA", "visualBrief",
      // Per-channel grounding for the entity-selection produce→critique loop (P1-4).
      "channelName", "persona", "styleGrammar", "criticDoctrine", "contentLane",
    ],
  }),
  intro_card: contract(["graphics.intro"], { optionalConsumes: ["palette", "channelAvatarKey", "channelName"] }),
  quote_overlays: contract(["graphics.quotes"], { optionalConsumes: ["introSec", "chapterPlan"] }),
  visual_inserts: contract(["graphics.data"], {
    optionalConsumes: ["topic", "niche", "styleDNA", "palette", "introSec", "quoteOverlays", "chapterPlan", "dataStorySourceLedger"],
  }),
  timeline_assemble: contract(["master.assembled"], {
    requiredConsumes: ["footageClips", "narrationLocalPath", "narrationDurationSec", "musicUrl"],
    optionalConsumes: [
      "entityClips", "introCardPath", "introApplied", "introCardKey", "introSec", "healHints", "healClasses", "sentenceTimings", "cutSheet",
      "chapterPlan", "channelAvatarKey", "script", "channelName", "quoteOverlays", "insertOverlays",
      "cinematicGeneratedScenePlan", "cinematicEditDecisionList", "generatedFootageSceneManifest",
      "extraOverlays", "musicKey", "styleDNA", "shotRenderManifest", "shotQaReport", "visualCoverage",
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
      "overlaysDropped", "qualityBar", "description", "musicKey", "channelName", "niche", "persona", "styleGrammar", "topic",
      // Grounds the mandatory holistic visual gate in this channel's doctrine.
      "criticDoctrine", "contentLane",
      "narrativeBeats", "shotList", "storyCoverage", "assetQaReport", "shotQaReport", "healAttempt",
      // Durable provenance from story_spine / short_strategy is reused when it
      // matches the active lane; final QA must declare that cross-block input.
      "episodeSpec",
      "motionComicTimeline", "visualRepair", "visualMatterManifest",
      "cinematicGeneratedScenePlan", "cinematicCreativeLocks", "cinematicEditDecisionList", "generatedFootageSceneManifest",
      // Standard Novita Story-Spine renders use this exact LTX cut plan; it is
      // optional because non-LTX lanes do not produce a shot-render manifest.
      "shotRenderManifest",
      "shortStrategyBrief", "beatManifest", "shortRetentionManifest", "shortSceneQa", "documotionVerdict", "documotionRender",
      // Final QA conditionally rehydrates narration, validates admitted
      // Casefile provenance, and now verifies renderer-declared readable text.
      // These remain optional because each is specific to a different lane.
      "narrationKey", "narrationLocalPath", "narrationTranscriptText", "onScreenTextCues",
      "casefileEvidenceShotMapAdmission", "casefileSourceAdmission",
    ],
    providerProfiles: [managed, local],
    maxCostUsd: 5,
    maxCostUsdFor: (params) => qaVisualCost(params),
    qualityRequired: true,
  }),
  originality_gate: contract(["final.originality_passed"], { optionalConsumes: ["topic"], qualityRequired: true }),
  compliance_check: contract(["final.compliance_passed"], { optionalConsumes: ["niche"], qualityRequired: true }),

  director_brief: contract(["crew.director_treatment"], { optionalConsumes: ["styleDNA", "niche", "channelName"] }),
  dp_brief: contract(["crew.dp_visual_spec"], { optionalConsumes: ["styleDNA", "niche", "channelName"] }),
  editor_brief: contract(["crew.editor_edl"], { optionalConsumes: ["styleDNA", "niche", "channelName"] }),
  composer_brief: contract(["crew.composer_cue_sheet"], { optionalConsumes: ["styleDNA", "niche", "channelName"] }),
  critic_spec: contract(["crew.critic_validation_spec"], { optionalConsumes: ["styleDNA", "niche", "channelName"] }),

  story_spine: contract(["story.timed", "visuals.story_planned"], {
    optionalConsumes: ["structure", "visualBrief", "cutSheet", "styleDNA", "contentLane"],
    qualityRequired: true,
  }),

  episode_graph: contract(["story.episode_graph_locked", "visuals.scene_manifest"], {
    requiredConsumes: [
      "topic", "timedScript", "narrativeBeats", "continuityLedger", "shotList", "dpVisualSpecs", "editorEdl", "storyCoverage",
    ],
    providerProfiles: [local],
    qualityRequired: true,
  }),

  learning_contract: contract(["learning.contract_locked", "learning.retrieval_practice_locked"], {
    requiredConsumes: ["episodeGraph", "contentLane"],
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
    requiredConsumes: ["childrenShowBibleInput", "episodeGraph", "lessonContract", "contentLane"],
    providerProfiles: [local],
    qualityRequired: true,
  }),

  child_content_safety: contract(["safety.child_content_review_required", "publish.private_only"], {
    requiredConsumes: ["episodeGraph", "sceneManifest", "lessonContract", "contentLane"],
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

  // The actual cinematic documentary handoff is intentionally three stages:
  // deterministic source-bound draft, real human signature, then strict
  // admission. It is a private human-review artifact, not a generic prompt
  // generator or a family admission switch.
  cinematic_case_sequence_draft: contract([
    "documentary.cinematic_sequence_drafted",
    "documentary.non_likeness_cast_locked",
    "publish.private_only",
  ], {
    requiredConsumes: ["cinematicCaseDirection", "casefileEvidenceShotMap", "sceneManifest", "shotList"],
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
      "casefileSourceAdmission",
      "casefileEvidenceShotMap",
      "casefileEvidenceShotMapAdmission",
      "cinematicCaseSequenceInput",
      "sceneManifest",
      "shotList",
    ],
    providerProfiles: [local],
    qualityRequired: true,
  }),

  scene_compiler: contract(["visuals.scene_compiled", "master.assembled"], {
    requiredConsumes: ["sceneManifest", "narrationLocalPath", "narrationDurationSec", "musicUrl"],
    optionalConsumes: ["musicKey", "episodeGraph", "contentLane"],
    providerProfiles: [local],
    maxCostUsd: 0,
    qualityRequired: true,
  }),

  visual_matter: contract(["visuals.visual_matter_planned", "visuals.visual_lock"], {
    requiredConsumes: ["topic", "narrativeBeats", "continuityLedger", "shotList", "dpVisualSpecs"],
    optionalConsumes: ["channelName", "styleDNA", "visualBrief"],
    providerProfiles: [{ id: "fal-nano-banana-2-visual-matter", provider: "fal", quality: "hero", allowFallback: false }],
    maxCostUsd: 12 * PRICE.falNanoBanana2Usd,
    maxCostUsdFor: (params) => {
      if (params["enabled"] === false || params["renderReferenceAssets"] !== true) return 0;
      const images = Math.ceil(boundedNumber(params["maxReferenceImages"], 8, 1, 12));
      return images * PRICE.falNanoBanana2Usd;
    },
    qualityRequired: true,
  }),

  gen_footage: contract(["visuals.generated", "render.profile_pinned", "render.spot_only"], {
    // The renderer accepts only reusable, validated scene-plan handoffs:
    // an admitted Cinematic Case Sequence, Story Spine's shot/DP artifacts,
    // or Episode Graph's sceneManifest. The legacy free-form planning path is
    // intentionally unavailable at runtime.
    optionalConsumes: [
      "styleDNA",
      "visualBrief",
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
      "channelName",
      "persona",
      "styleGrammar",
      "criticDoctrine",
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
    optionalConsumes: ["visualBrief"],
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
    ],
    providerProfiles: [managed],
    // Initial grading plus at most two one-candidate, quality-directed repairs
    // per shot. The recovery path is intentionally budget-reserved instead of
    // being an unaccounted side effect of QA.
    maxCostUsd: 36,
    maxCostUsdFor: (params, context) => shotCount(params, context) * (
      PRICE.visionGraderUsd +
      NOVITA_CINEMATIC_QA_REPAIR_CAP * (PRICE.novitaImageMaxUsd + PRICE.visionGraderUsd)
    ),
    qualityRequired: true,
  }),
  novita_render_video: contract(["visuals.shots_rendered", "render.profile_pinned", "render.spot_only"], {
    requiredConsumes: ["shotList", "dpVisualSpecs", "selectedStillManifest", "visualMatterManifest"],
    optionalConsumes: ["visualBrief"],
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
    ],
    providerProfiles: [managed, local],
    // See qa_assets: one selected still is held fixed while LTX may receive a
    // small, deterministic number of targeted motion repairs.
    maxCostUsd: 36,
    maxCostUsdFor: (params, context) => shotCount(params, context) * (
      PRICE.visionGraderUsd +
      NOVITA_CINEMATIC_QA_REPAIR_CAP * (PRICE.novitaVideoMaxUsd + PRICE.visionGraderUsd)
    ),
    qualityRequired: true,
  }),
  whiteboard_scribe: contract(
    ["script.generated", "script.qa_passed", "narration.timed", "visuals.generated", "visuals.story_aligned", "master.assembled"],
    {
      optionalConsumes: ["researchNotes", "factSheet", "visualBrief", "voiceId", "ttsProvider", "palette", "musicKey", "musicUrl"],
      providerProfiles: [managed, local],
      // 16 panels × five teardown-verified Novita image workers ($28), plus
      // the full premium TTS ceiling. Upstream music is charged by its own
      // block. This must stay above the actual maximum, not an optimistic
      // image planning rate.
      maxCostUsd: 31,
      // Cold-run bound mirrors the engine's exact art-worker and narration
      // ceilings. Upstream music is charged by its own block.
      maxCostUsdFor: (params, context) => whiteboardCostCeiling(params, context),
      qualityRequired: true,
    },
  ),
  lore_short: contract(
    ["script.generated", "script.qa_passed", "narration.timed", "visuals.generated", "visuals.story_aligned", "master.assembled"],
    {
      optionalConsumes: ["visualBrief", "persona", "channelName", "title", "voiceId", "ttsProvider", "criticDoctrine", "styleGrammar", "contentLane"],
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
      // `quizCategories` lets a channel pin the mix (e.g. capitals + currencies
      // only); omitted, the block draws from every category. Declared here
      // because the contract test enforces that a module cannot read a store key
      // it never announced.
      // The certified family registry requires an upstream `music` entry and
      // the block rejects an invocation that is not explicitly noGemini.
      optionalConsumes: ["musicKey", "channelName", "palette", "criticDoctrine", "styleGrammar", "contentLane", "quizTopic", "quizCategories"],
      providerProfiles: [local],
      maxCostUsd: 0,
      maxCostUsdFor: (params, context) => quizYearCostCeiling(params, context),
      qualityRequired: true,
    },
  ),
  motion_comic: contract(
    ["script.generated", "script.qa_passed", "narration.timed", "visuals.generated", "visuals.story_aligned", "master.assembled"],
    {
      optionalConsumes: ["researchNotes", "factSheet", "visualBrief", "visualRepair", "healHints", "healAttempt"],
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
    optionalConsumes: ["topic", "script", "narrationText", "musicKey", "footageClips"],
  }),
};
