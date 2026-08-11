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
  const panels = Math.max(4, Math.min(16, Math.round(seconds / 22)));
  const requestedWords = Math.ceil(Math.round(seconds * 3.1));
  const words = Math.max(panels * 8, Math.min(panels * 120, requestedWords));
  const characters = words * 12;
  const usesEleven =
    String(params["ttsProvider"] ?? "fish").toLowerCase() === "elevenlabs" &&
    typeof params["elevenVoiceId"] === "string" &&
    params["elevenVoiceId"].trim().length > 0;
  const ttsRate = usesEleven ? PRICE.ttsElevenPerKCharUsd : PRICE.ttsPerKCharUsd;
  return (
    panels * 5 * bananaImageUnitCeiling("flash") +
    (characters / 1_000) * ttsRate
  );
}

function motionComicCostCeiling(params: Readonly<Record<string, unknown>>): number {
  const panels = Math.floor(boundedNumber(params["panels"], 8, 4, 12));
  const parsedSeconds = finiteNumber(params["targetSeconds"]);
  const requestedCharacters =
    parsedSeconds !== undefined && parsedSeconds > 0
      ? Math.ceil(parsedSeconds * 16)
      : panels * 22 * 16;
  const characters = Math.max(
    panels * 160,
    Math.min(panels * 3 * 320, requestedCharacters),
  );
  return (
    (2 * panels + 8) * bananaImageUnitCeiling("flash") +
    (characters / 1_000) * PRICE.ttsElevenPerKCharUsd +
    PRICE.musicTrackUsd +
    2 * panels * PRICE.visionGraderUsd
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
    providerProfiles: [{ id: "novita-ltx23-hq-production", provider: "novita", quality: "production", allowFallback: false }],
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
    { optionalConsumes: ["chapterPlan", "scheduledPublishAt", "contentLane"], sideEffects: ["publish_media"], qualityRequired: true },
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
      "criticDoctrine", "contentLane",
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
    optionalConsumes: ["script", "styleDNA", "persona"],
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
    optionalConsumes: ["topic", "niche", "styleDNA", "palette", "introSec", "quoteOverlays", "chapterPlan"],
  }),
  timeline_assemble: contract(["master.assembled"], {
    requiredConsumes: ["footageClips", "narrationLocalPath", "narrationDurationSec", "musicUrl"],
    optionalConsumes: [
      "entityClips", "introCardPath", "introApplied", "introCardKey", "introSec", "healHints", "healClasses", "sentenceTimings", "cutSheet",
      "chapterPlan", "channelAvatarKey", "script", "channelName", "quoteOverlays", "insertOverlays",
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
      "narrationDurationSec", "script", "sentenceTimings", "styleDNA", "introApplied", "healHints", "palette",
      "tags", "strategy", "thumbnailer", "introSec", "quoteOverlays", "quotesApplied", "insertOverlays",
      "insertsApplied", "captionCues", "captionsApplied", "outroApplied", "validationSpec", "quoteOverlapSec",
      "overlaysDropped", "qualityBar", "description", "musicKey", "channelName", "niche", "persona", "styleGrammar", "topic",
      // Grounds the mandatory holistic visual gate in this channel's doctrine.
      "criticDoctrine", "contentLane",
      "narrativeBeats", "shotList", "storyCoverage", "assetQaReport", "shotQaReport", "healAttempt",
      "motionComicTimeline", "visualRepair", "visualMatterManifest",
      "shortStrategyBrief", "beatManifest", "shortRetentionManifest", "shortSceneQa", "documotionVerdict", "documotionRender",
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
    // channelName/persona/styleGrammar/criticDoctrine/contentLane ground the
    // pre-spend shot-plan critique loop; all are frozen into the run seed store.
    optionalConsumes: [
      "styleDNA",
      "visualBrief",
      "narrationDurationSec",
      "channelName",
      "persona",
      "styleGrammar",
      "criticDoctrine",
      "contentLane",
    ],
    providerProfiles: [{ id: "novita-zimage-ltx23-production", provider: "novita", quality: "production", allowFallback: false }],
    maxCostUsd: 132,
    maxCostUsdFor: (params, context) => {
      const seconds = targetSeconds(params, context, 300);
      const clips = Math.ceil(
        boundedNumber(params["maxClips"], Math.ceil(seconds / 22), 6, 24),
      );
      return clips * (PRICE.novitaImageMaxUsd + PRICE.novitaVideoMaxUsd);
    },
  }),
  signature_clips: contract(["visuals.signature_generated", "render.profile_pinned", "render.spot_only"], {
    // See gen_footage: the same pre-spend shot-plan critique loop runs here.
    optionalConsumes: [
      "styleDNA",
      "visualBrief",
      "channelName",
      "persona",
      "styleGrammar",
      "criticDoctrine",
      "contentLane",
    ],
    providerProfiles: [{ id: "novita-zimage-ltx23-production", provider: "novita", quality: "production", allowFallback: false }],
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
      maxCostUsd: 30,
      // Cold-run bound mirrors the engine's 5 art layers per panel and bounded
      // narration character budget. Upstream music is charged by its own block.
      maxCostUsdFor: (params, context) => whiteboardCostCeiling(params, context),
      qualityRequired: true,
    },
  ),
  motion_comic: contract(
    ["script.generated", "script.qa_passed", "narration.timed", "visuals.generated", "visuals.story_aligned", "master.assembled"],
    {
      optionalConsumes: ["researchNotes", "factSheet", "visualBrief", "visualRepair", "healHints", "healAttempt"],
      providerProfiles: [managed, local],
      maxCostUsd: 40,
      // Cold-run bound includes character sheets/panels, bounded ElevenLabs
      // dialogue, one music job, and two vision-letterer calls per panel.
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
