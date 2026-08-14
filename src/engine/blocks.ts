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
import { rankChartBlocks } from "@/trigger/blocks/rankChartBlocks";
import { simNarrativeBlocks } from "@/trigger/blocks/simNarrativeBlocks";
import { povVlogBlocks } from "@/trigger/blocks/povVlogBlocks";
import { documentaryCollageShortBlocks } from "@/trigger/blocks/documentaryCollageShortBlocks";
import { VISUAL_MATTER_BLOCKS } from "@/trigger/blocks/visualMatterBlocks";
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
  for (const b of quizYearBlocks) register(b);
  // CHART lane — deliberately TWO single-purpose blocks, not one engine:
  // rank_data sources cited figures (src/lib/rankFacts.ts) and chart_render
  // draws whatever ChartSpec it is handed (src/remotion/chart/ +
  // src/lib/rankChartRender.ts) and muxes narration someone else synthesized.
  for (const b of rankChartBlocks) register(b);
  // The chart lane's SECOND producer: one bounded call authors a declared-
  // illustrative "simulation run" whose beats key the same chart_render curve.
  // It adds no renderer of its own — that is the point.
  for (const b of simNarrativeBlocks) register(b);
  // POV CHARACTER VLOG lane — three single-purpose TEXT blocks and no renderer
  // of its own: pov_vlog_script writes the episode (src/lib/povVlogScript.ts),
  // dialogue_scene writes the encounters (src/lib/dialogueScene.ts) and
  // fact_check proves the fun facts against Wikidata
  // (src/lib/historicalFactCheck.ts). The picture is the SAME Z-Image -> LTX
  // chain the cinematic family already runs, framed by a composition profile
  // (src/lib/shotComposition.ts) and starring a locked character
  // (src/lib/channelCharacter.ts).
  for (const b of povVlogBlocks) register(b);
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
