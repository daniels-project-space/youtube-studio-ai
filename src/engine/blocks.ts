/**
 * Central block registration. Importing this module registers every known
 * block exactly once into the engine registry. Both the Trigger task and the
 * local test harness import this so they share one source of truth.
 */
import { register, _clear } from "./registry";
import { lofiBlocks } from "@/trigger/blocks/lofiBlocks";
import { intelligenceBlocks } from "@/trigger/blocks/intelligenceBlocks";
import { narratedBlocks } from "@/trigger/blocks/narratedBlocks";
import { complianceBlocks } from "@/trigger/blocks/complianceBlocks";
import { growthBlocks } from "@/trigger/blocks/growthBlocks";
import { CREW_BLOCKS } from "@/trigger/blocks/crewBlocks";
import { insertBlocks } from "@/trigger/blocks/insertBlocks";
import { genFootageBlocks } from "@/trigger/blocks/genFootageBlocks";
import { novitaRenderBlocks } from "@/trigger/blocks/novitaRenderBlocks";
import { STORY_SPINE_BLOCKS } from "@/trigger/blocks/storySpineBlocks";
import { whiteboardScribeBlocks } from "@/trigger/blocks/whiteboardScribeBlocks";
import { motionComicBlocks } from "@/trigger/blocks/motionComicBlocks";
import { loreShortBlocks } from "@/trigger/blocks/loreShortBlocks";
import { quizYearBlocks } from "@/trigger/blocks/quizYearBlocks";
import { quizPlanningBlocks } from "@/trigger/blocks/quizPlanningBlocks";
import { documentaryCollageShortBlocks } from "@/trigger/blocks/documentaryCollageShortBlocks";
import { VISUAL_MATTER_BLOCKS } from "@/trigger/blocks/visualMatterBlocks";
import { episodeGraphBlocks } from "@/trigger/blocks/episodeGraphBlocks";
import { learningContractBlocks } from "@/trigger/blocks/learningContractBlocks";
import { curriculumEpisodeSeedBlocks } from "@/trigger/blocks/curriculumEpisodeSeedBlocks";
import { childrenShowBibleBlocks } from "@/trigger/blocks/childrenShowBibleBlocks";
import { childContentSafetyBlocks } from "@/trigger/blocks/childrenSafetyBlocks";
import { casefileSourcePacketBlocks } from "@/trigger/blocks/casefileSourcePacketBlocks";
import { casefileEvidenceShotMapBlocks } from "@/trigger/blocks/casefileEvidenceShotMapBlocks";
import { sourceBoundStorySpineBlocks } from "@/trigger/blocks/sourceBoundStorySpineBlocks";
import { cinematicCaseSequenceBlocks } from "@/trigger/blocks/cinematicCaseSequenceBlocks";
import { sceneCompilerBlocks } from "@/trigger/blocks/sceneCompilerBlocks";
import { syntheticScenarioBlocks } from "@/trigger/blocks/syntheticScenarioBlocks";
import { emitBundle } from "@/trigger/blocks/bundleBlocks";

let registered = false;

/** Idempotently register all blocks. Safe to call multiple times. */
export function registerAllBlocks(): void {
  if (registered) return;
  // Template C (Lofi) blocks. metadata + thumbnail_gen come from the
  // competitor-intelligence engine below, NOT from lofiBlocks.
  for (const b of lofiBlocks) register(b);
  // Competitor-intelligence engine: competitor_research, metadata (optimised),
  // thumbnail_gen (banana engine).
  for (const b of intelligenceBlocks) register(b);
  // Narrated archetypes (essay/crime/shorts/meditation) — text "brain" (3a).
  for (const b of narratedBlocks) register(b);
  // Compliance gates (Phase 4): originality_gate + compliance_check.
  for (const b of complianceBlocks) register(b);
  // Growth blocks (Phase 8, opt-in): crosspost.
  for (const b of growthBlocks) register(b);
  // Film-crew brief blocks (creative-direction layer): director_brief, dp_brief,
  // editor_brief, composer_brief, critic_spec.
  for (const b of CREW_BLOCKS) register(b);
  // Versioned TimedScript → beats → ShotPlan → DP spec → exact EDL spine.
  for (const b of STORY_SPINE_BLOCKS) register(b);
  // Provider-free Story Spine → causal Episode Graph → Scene Manifest bridge.
  for (const b of episodeGraphBlocks) register(b);
  // Renderer-neutral learning objective / retrieval-practice handoff.
  for (const b of learningContractBlocks) register(b);
  // Pre-Story-Spine, operator-authored curriculum intent for supervised
  // children episodes. It emits a private child-editor receipt only.
  for (const b of curriculumEpisodeSeedBlocks) register(b);
  // Operator-authored children show/curriculum/identity admission. It has no
  // provider path and remains a private child-editor-review receipt, not a
  // switch that admits the children family to autonomous publishing.
  for (const b of childrenShowBibleBlocks) register(b);
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
  // Evidence-led cinematic coverage comes after the claim map. It creates the
  // exact multi-shot/mannequin/cut handoff used by generated footage, but is
  // still private-review-only and cannot self-admit a crime channel.
  for (const b of cinematicCaseSequenceBlocks) register(b);
  // Local Scene Manifest → 16:9 master renderer; owns pixels, never story.
  for (const b of sceneCompilerBlocks) register(b);
  // Explicitly fictional scenario admission + opening disclosure. The scene
  // compiler consumes the resulting profile to render town, decision, and POV
  // grammars without representing them as a real simulation.
  for (const b of syntheticScenarioBlocks) register(b);
  // Reusable visual-development contract: mood, character, setting and
  // storyboard locks. Cinematic is its first integrated consumer; the block
  // remains renderer-neutral for future generated-visual lanes.
  for (const b of VISUAL_MATTER_BLOCKS) register(b);
  // Script-synced motion-graphics inserts (visual_inserts): Remotion data viz
  // planned from the numbers the narration actually speaks.
  for (const b of insertBlocks) register(b);
  // Generated b-roll (gen_footage): DNA-locked flux stills → i2v, producer-
  // compatible with stock_footage (whiteboard/painted/signature-scene worlds).
  for (const b of genFootageBlocks) register(b);
  // Novita RTX 4090-only render chain (novita_render_images /
  // novita_render_video): cloud Trigger child tasks own the short-lived spot
  // worker lifecycle; drop-in producer-compatible with gen_footage.
  for (const b of novitaRenderBlocks) register(b);
  // DRAWN-CINEMA self-contained engine (whiteboard_scribe): narration-synced
  // whiteboard explainer (src/lib/whiteboardSync.ts) — produces the final video.
  for (const b of whiteboardScribeBlocks) register(b);
  // DRAWN-COMIC self-contained engine (motion_comic): narrated comic page that
  // draws itself in (src/lib/motionComic.ts) — produces the final video.
  for (const b of motionComicBlocks) register(b);
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
