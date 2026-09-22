/**
 * Central block registration. Importing this module registers every known
 * block exactly once into the engine registry. Both the Trigger task and the
 * local test harness import this so they share one source of truth.
 */
import { register, registerManifestVersion, getManifest, _clear } from "./registry";
import { createComposerAwareAssemblyManifest } from "@/trigger/blocks/composerAwareAssembly";
import { createArrangementComposerManifest, musicArrangementPlan } from "@/trigger/blocks/musicArrangementBlocks";
import { lofiBlocks } from "@/trigger/blocks/lofiBlocks";
import { createGroundedScenePlannerManifest } from "@/trigger/blocks/groundedScenePlanner";
import { createBoundScenePlannerManifest, createBoundKeyframesManifest } from "@/trigger/blocks/boundLoopVisuals";
import { createYuE2ProgramManifest, createYuE2LoopVisualManifest, createYuE2KeyframesManifest } from "@/trigger/blocks/yue2LoopVisuals";
import { createReviewedMotionKeyframesManifest, createReviewedMotionClipsManifest } from "@/trigger/blocks/reviewedLoopMotion";
import { createDeliveryAwareMetadataManifest } from "@/trigger/blocks/deliveryAwareMetadata";
import { music } from "@/trigger/blocks/musicBlocks";
import { createProviderAwareMusicManifest } from "@/trigger/blocks/providerAwareMusic";
import { createYuE2MusicManifest } from "@/trigger/blocks/yue2Music";
import { createYuE2AssemblyManifest } from "@/trigger/blocks/yue2Assembly";
import { serializedProgramEpisodeContextBlocks } from "@/trigger/blocks/serializedProgramEpisodeContextBlocks";
import { narrativeSeriesVisualControlsBlocks } from "@/trigger/blocks/narrativeSeriesVisualControlsBlocks";
import { intelligenceBlocks } from "@/trigger/blocks/intelligenceBlocks";
import { narratedBlocks } from "@/trigger/blocks/narratedBlocks";
import { createChannelAwareScriptQaManifest } from "@/trigger/blocks/channelAwareScriptQa";
import { complianceBlocks } from "@/trigger/blocks/complianceBlocks";
import { growthBlocks } from "@/trigger/blocks/growthBlocks";
import { CREW_BLOCKS } from "@/trigger/blocks/crewBlocks";
import { insertBlocks } from "@/trigger/blocks/insertBlocks";
import { genFootageBlocks } from "@/trigger/blocks/genFootageBlocks";
import { novitaRenderBlocks } from "@/trigger/blocks/novitaRenderBlocks";
import { STORY_SPINE_BLOCKS } from "@/trigger/blocks/storySpineBlocks";
import { whiteboardScribeBlocks } from "@/trigger/blocks/whiteboardScribeBlocks";
import { motionComicBlocks } from "@/trigger/blocks/motionComicBlocks";
import { createSharedScoreMotionComicManifest } from "@/trigger/blocks/sharedScoreMotionComic";
import { loreShortBlocks } from "@/trigger/blocks/loreShortBlocks";
import { selfContainedStoryBlocks } from "@/trigger/blocks/selfContainedStoryBlocks";
import { quizYearBlocks } from "@/trigger/blocks/quizYearBlocks";
import { quizPlanningBlocks } from "@/trigger/blocks/quizPlanningBlocks";
import { quizShortReleaseBlocks } from "@/trigger/blocks/quizShortReleaseBlocks";
import { documentaryCollageShortBlocks } from "@/trigger/blocks/documentaryCollageShortBlocks";
import { VISUAL_MATTER_BLOCKS } from "@/trigger/blocks/visualMatterBlocks";
import { STUDIO_ASSET_LIBRARY_BLOCKS } from "@/trigger/blocks/studioAssetLibraryBlocks";
import { STUDIO_REUSABLE_MEDIA_BLOCKS } from "@/trigger/blocks/studioReusableMediaBlocks";
import { episodeGraphBlocks } from "@/trigger/blocks/episodeGraphBlocks";
import { learningContractBlocks } from "@/trigger/blocks/learningContractBlocks";
import { curriculumEpisodeSeedBlocks } from "@/trigger/blocks/curriculumEpisodeSeedBlocks";
import { childrenShowBibleBlocks } from "@/trigger/blocks/childrenShowBibleBlocks";
import { childrenVideoTreatmentBlocks } from "@/trigger/blocks/childrenVideoTreatmentBlocks";
import { childContentSafetyBlocks } from "@/trigger/blocks/childrenSafetyBlocks";
import { casefileSourcePacketBlocks } from "@/trigger/blocks/casefileSourcePacketBlocks";
import { casefileEvidenceShotMapBlocks } from "@/trigger/blocks/casefileEvidenceShotMapBlocks";
import { sourceBoundStorySpineBlocks } from "@/trigger/blocks/sourceBoundStorySpineBlocks";
import { editorialEvidencePacketBlocks } from "@/trigger/blocks/editorialEvidencePacketBlocks";
import { cinematicCaseSequenceBlocks } from "@/trigger/blocks/cinematicCaseSequenceBlocks";
import { sceneCompilerBlocks } from "@/trigger/blocks/sceneCompilerBlocks";
import { chessReplayBlocks } from "@/trigger/blocks/chessReplayBlocks";
import { syntheticScenarioBlocks } from "@/trigger/blocks/syntheticScenarioBlocks";
import { emitBundle } from "@/trigger/blocks/bundleBlocks";

let registered = false;

/** Idempotently register all blocks. Safe to call multiple times. */
export function registerAllBlocks(): void {
  if (registered) return;
  // Template C (Lofi) blocks. metadata + thumbnail_gen come from the
  // competitor-intelligence engine below, NOT from lofiBlocks.
  for (const b of lofiBlocks) register(b);
  registerManifestVersion(createGroundedScenePlannerManifest(getManifest("scene_planner")!));
  const boundScenePlanner = createBoundScenePlannerManifest(getManifest("scene_planner")!);
  registerManifestVersion(boundScenePlanner);
  const boundKeyframes = createBoundKeyframesManifest(getManifest("keyframes")!, boundScenePlanner);
  registerManifestVersion(boundKeyframes);
  registerManifestVersion(createYuE2ProgramManifest(getManifest("music_program_plan")!));
  registerManifestVersion(createYuE2ProgramManifest(getManifest("music_program_plan")!, true));
  registerManifestVersion(createYuE2KeyframesManifest(getManifest("keyframes")!, boundScenePlanner));
  registerManifestVersion(createYuE2LoopVisualManifest(getManifest("loop_clips")!));
  registerManifestVersion(createReviewedMotionKeyframesManifest(getManifest("keyframes")!, boundScenePlanner));
  registerManifestVersion(createReviewedMotionClipsManifest(getManifest("loop_clips")!, boundScenePlanner));
  // Shared music generation and prepared-track reuse for all channel families.
  register(music);
  registerManifestVersion(createProviderAwareMusicManifest(getManifest("music")!));
  registerManifestVersion(createYuE2MusicManifest());
  // Route-owned, provider-free bridge from a completed serialized Topic Select
  // receipt to the shared script/crew/QA consumers. Registration alone cannot
  // admit a route; the designer only materializes it for serialized_program/v1.
  for (const b of serializedProgramEpisodeContextBlocks) register(b);
  // Competitor-intelligence engine: competitor_research, metadata (optimised),
  // thumbnail_gen (banana engine).
  for (const b of intelligenceBlocks) register(b);
  registerManifestVersion(createDeliveryAwareMetadataManifest(getManifest("metadata")!));
  // Narrated archetypes (essay/crime/shorts/meditation) — text "brain" (3a).
  for (const b of narratedBlocks) register(b);
  registerManifestVersion(createChannelAwareScriptQaManifest(getManifest("qa_script")!));
  registerManifestVersion(createComposerAwareAssemblyManifest(getManifest("timeline_assemble")!));
  registerManifestVersion(createYuE2AssemblyManifest(getManifest("assemble")!));
  registerManifestVersion(createYuE2AssemblyManifest(getManifest("timeline_assemble")!));
  registerManifestVersion(createYuE2AssemblyManifest(getManifest("timeline_assemble")!, "once"));
  // Compliance gates (Phase 4): originality_gate + compliance_check.
  for (const b of complianceBlocks) register(b);
  // Growth blocks (Phase 8, opt-in): crosspost.
  for (const b of growthBlocks) register(b);
  // Film-crew brief blocks (creative-direction layer): director_brief, dp_brief,
  // editor_brief, composer_brief, critic_spec.
  for (const b of CREW_BLOCKS) register(b);
  registerManifestVersion(createArrangementComposerManifest(getManifest("composer_brief")!));
  registerManifestVersion(createArrangementComposerManifest(getManifest("composer_brief")!, true));
  register(musicArrangementPlan);
  // Versioned TimedScript → beats → ShotPlan → DP spec → exact EDL spine.
  for (const b of STORY_SPINE_BLOCKS) register(b);
  // Provider-free Story Spine → causal Episode Graph → Scene Manifest bridge.
  for (const b of episodeGraphBlocks) register(b);
  // Latent serialized-cinematic continuity bridge. It persists only an
  // already-admitted plan/binding/control receipt; registration cannot create
  // a route, invoke an adapter, or start a character LoRA training job.
  for (const b of narrativeSeriesVisualControlsBlocks) register(b);
  // Renderer-neutral learning objective / retrieval-practice handoff.
  for (const b of learningContractBlocks) register(b);
  // Pre-Story-Spine, operator-authored curriculum intent for supervised
  // children episodes. It emits a private child-editor receipt only.
  for (const b of curriculumEpisodeSeedBlocks) register(b);
  // Operator-authored children show/curriculum/identity admission. It has no
  // provider path and remains a private child-editor-review receipt, not a
  // switch that admits the children family to autonomous publishing.
  for (const b of childrenShowBibleBlocks) register(b);
  // Renderer-neutral child-video direction. It only supplies typed handoffs to
  // specialist visual, motion, and thumbnail modules.
  for (const b of childrenVideoTreatmentBlocks) register(b);
  // Children can make a review candidate, never self-authorize publication.
  for (const b of childContentSafetyBlocks) register(b);
  // Source-first documentary admission is provider-free and only emits a
  // packet-bound private human-review draft receipt, never a channel planner.
  for (const b of casefileSourcePacketBlocks) register(b);
  // Provider-free factual-claim → reviewed scene/shot mapping. It remains a
  // private human-review handoff and does not admit any documentary family.
  for (const b of casefileEvidenceShotMapBlocks) register(b);
  // Reviewed Casefile evidence → the generic timed Story Spine. This carries
  // claims, citations, treatments, and exact cut IDs forward without planning
  // or admitting any source-led family.
  for (const b of sourceBoundStorySpineBlocks) register(b);
  // Shared factual-explainer source/claim/snapshot admission. This retains a
  // private human-editorial-review release rail and never replaces Casefile.
  for (const b of editorialEvidencePacketBlocks) register(b);
  // Evidence-led cinematic coverage comes after the claim map. It creates the
  // exact multi-shot/mannequin/cut handoff used by generated footage, but is
  // still private-review-only and cannot self-admit a crime channel.
  for (const b of cinematicCaseSequenceBlocks) register(b);
  // Local Scene Manifest → 16:9 master renderer; owns pixels, never story.
  for (const b of sceneCompilerBlocks) register(b);
  // Source-only legal chess replay → shared narration TTS → measured cue →
  // native board manifest. It is registered as a typed executable capability,
  // not advertised by channel creation until independent qualification passes.
  for (const b of chessReplayBlocks) register(b);
  // Explicitly fictional scenario admission + opening disclosure. The scene
  // compiler consumes the resulting profile to render town, decision, and POV
  // grammars without representing them as a real simulation.
  for (const b of syntheticScenarioBlocks) register(b);
  // Reusable visual-development contract: mood, character, setting and
  // storyboard locks. Cinematic is its first integrated consumer; the block
  // remains renderer-neutral for future generated-visual lanes.
  for (const b of VISUAL_MATTER_BLOCKS) register(b);
  // Owner-scoped approved recipe lookup. This remains provider-free and only
  // exposes recipe text to preproduction; adapters/guide bytes stay fenced.
  for (const b of STUDIO_ASSET_LIBRARY_BLOCKS) register(b);
  // Actual episode media has its own channel-scoped, cadence-bound resolver;
  // it never inherits the looser recipe/adapter compatibility surface above.
  for (const b of STUDIO_REUSABLE_MEDIA_BLOCKS) register(b);
  // Script-synced motion-graphics inserts (visual_inserts): Remotion data viz
  // planned from the numbers the narration actually speaks.
  for (const b of insertBlocks) register(b);
  // Generated b-roll (gen_footage): DNA-locked flux stills → i2v, producer-
  // compatible with stock_footage (whiteboard/painted/signature-scene worlds).
  for (const b of genFootageBlocks) register(b);
  // Direct Novita cinematic chain (novita_render_images /
  // novita_render_video): reviewed Z-Image stills feed the sealed MiniMax H3
  // route; Trigger child tasks own orchestration and byte-level QA.
  for (const b of novitaRenderBlocks) register(b);
  // Bounded native-story planner → provider-free route/lane/topic seal. This
  // pair is latent until a future admitted route explicitly places it before a
  // matching self-contained renderer; registration cannot authorize a route.
  for (const b of selfContainedStoryBlocks) register(b);
  // DRAWN-CINEMA self-contained engine (whiteboard_scribe): narration-synced
  // whiteboard explainer (src/lib/whiteboardSync.ts) — produces the final video.
  for (const b of whiteboardScribeBlocks) register(b);
  // DRAWN-COMIC self-contained engine (motion_comic): narrated comic page that
  // draws itself in (src/lib/motionComic.ts) — produces the final video.
  for (const b of motionComicBlocks) register(b);
  registerManifestVersion(createSharedScoreMotionComicManifest(getManifest("motion_comic")!));
  // LORE MICRO-DOC self-contained engine (lore_short): first-person history over
  // painted art with attested Novita depth camera moves (src/lib/loreshort.ts)
  // — produces the final video.
  for (const b of loreShortBlocks) register(b);
  // GUESS-THE-YEAR self-contained engine (quiz_year): CC0 Wikidata facts →
  // four-option rounds → isolated Remotion bundle (src/lib/quizYearFacts.ts +
  // src/lib/quizYearRender.ts) — produces the final video.
  // The separate planner owns the certified no-Gemini topic, safety, critic,
  // metadata and renderer-native thumbnail receipts used by QuizYear.
  for (const b of quizPlanningBlocks) register(b);
  for (const b of quizYearBlocks) register(b);
  // Post-QA, certificate-bound supervised private-review handoff for the
  // portrait QuizShort route. Registration alone never admits that route.
  for (const b of quizShortReleaseBlocks) register(b);
  // Native documentary-collage Shorts: source/claim/beat manifest → portrait
  // DocuMotion master → scene-level safe-area and provenance gate.
  for (const b of documentaryCollageShortBlocks) register(b);
  // Render-group reuse: emit_bundle (persist assets + fan out to language siblings).
  register(emitBundle);
  registered = true;
}

/** Test helper: clear + allow re-registration. */
export function _resetBlocks(): void {
  _clear();
  registered = false;
}
