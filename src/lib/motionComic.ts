/**
 * MOTIONCOMIC — a STANDALONE drawn-comic-page engine (NOT wired into the YSA
 * pipeline / golden modules; a sibling spike).
 *
 * Topic in → a narrated COMIC PAGE that draws itself out: the camera zooms into
 * an open comic page of empty panel boxes, and a HAND DRAWS each panel in (the
 * whiteboard scribe pixel-reveal, adapted to colour art) as a multi-voice
 * narration plays, with comic SPEECH BUBBLES popping at each spoken line, over a
 * music bed. Only spend is bounded per-panel attested image art + ElevenLabs
 * voices + one music track; the draw + camera are deterministic (no video-model
 * generation).
 *
 * Pipeline (one castMotionComic() call):
 *   1. STORYBOARD — Gemini-Pro writes a tight, coherent story as PANELS, casts a
 *                   narrator + characters to ElevenLabs voices, tags each panel's
 *                   ordered lines (narrator = VO, character = SPEECH BUBBLE).
 *   2. PANELS     — each panel is rendered through the pinned image route with
 *                   the closed character identity schema → continuity, NO text.
 *   3. VOICES     — each line synthesised in its speaker's voice (exact per-line
 *                   timing → precise bubble cues); concatenated per panel.
 *   4. MUSIC      — one Suno bed, ducked under the narration.
 *   5. RENDER     — scripts/mc_page_render.py draws the page panel-by-panel, hand
 *                   following the ink, bubbles on cue; ffmpeg muxes voice + music.
 */
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { geminiJsonPro } from "@/lib/gemini";
import { visionLocal, VISION_GATE_MAX_TOKENS } from "@/lib/vision";
import { generateMusic } from "@/lib/music";
import { ffprobeDuration } from "@/lib/ffmpeg";
import { preflightPythonRenderer } from "@/lib/pydeps";
import { hasNovitaRenderFarmConfig } from "@/lib/novitaRenderFarm";

type Logger = (msg: string) => void;

export interface MotionComicBrief {
  topic: string;
  facts?: string;
  panels?: number;
  /** Target spoken length (sec) — budgets per-panel words. The first live
   *  render ran 75s against a 180s target because panels averaged ~9 spoken
   *  seconds; the writer needs an explicit word budget, not vibes. */
  targetSeconds?: number;
  style?: string;
  width?: number;
  height?: number;
  musicPrompt?: string;
  music?: boolean;
  /** Layout-only repair instructions from the post-render visual reviewer. */
  layoutRepair?: Array<{
    action: "reflow_bubble";
    panelIndex?: number;
    targetId?: string;
    forbiddenRects?: Array<[number, number, number, number]>;
  }>;
}

/** Curated ElevenLabs cast (probed live). Model picks voiceIds from here. */
const ROSTER = [
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", g: "male", note: "warm, captivating storyteller — best NARRATOR" },
  { id: "CwhRBWXzGAHq8TQ4Fs17", name: "Roger", g: "male", note: "laid-back, casual, resonant" },
  { id: "IKne3meq5aSn9XLyUdCD", name: "Charlie", g: "male", note: "deep, confident, energetic" },
  { id: "N2lVS1w4EtoT3dr4eOWO", name: "Callum", g: "male", note: "husky trickster — villains/rogues" },
  { id: "SOYHLrjzK2X1ezoPC6cr", name: "Harry", g: "male", note: "fierce, intense — soldiers/tough men" },
  { id: "bIHbv24MWmeRgasZH58o", name: "Will", g: "male", note: "relaxed optimist — younger men" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", g: "female", note: "mature, reassuring, confident" },
  { id: "FGY2WhTYpPnrIDTdsKH5", name: "Laura", g: "female", note: "quirky, enthusiastic — younger women" },
  { id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice", g: "female", note: "clear, engaging" },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", g: "female", note: "knowledgeable, professional" },
];
const VALID_IDS = new Set(ROSTER.map((r) => r.id));
const DEFAULT_NARRATOR = "JBFqnCBsd6RMkjVDRZzb";

const DEFAULT_STYLE =
  "cinematic graphic-novel / comic-book art: bold confident ink line-art with strong black outlines, dramatic cel shading, " +
  "rich but moody colour, expressive faces, dynamic compositions, film-grain texture. ABSOLUTELY NO speech bubbles, NO " +
  "captions, NO lettering, NO text of ANY kind anywhere: no words, letters, numbers, signage, banners, book titles, " +
  "posters, screen text, tattoos-as-words, or gibberish glyphs. Every sign, banner, book and label must be BLANK.";

const ASSET_DIR = join(process.cwd(), "src", "assets", "whiteboard");
const PREROLL_MS = 1700; // must match EST in mc_page_render.py
const PER_PAGE = 6;      // panels per comic page (must match per_page in the renderer)
const TURN_SEC = 1.3;    // page-turn duration (must match turn in the renderer)

export function hasMotionComic(): boolean {
  return Boolean(
    process.env.GEMINI_API_KEY
    && process.env.ELEVENLABS_API_KEY
    && hasNovitaRenderFarmConfig(),
  );
}

/* ------------------------------- types --------------------------------- */

export type MotionComicEnvironment =
  | "atmospheric_exterior"
  | "urban_exterior"
  | "interior"
  | "forest"
  | "waterfront"
  | "mountain"
  | "industrial"
  | "ruined_landscape"
  | "laboratory"
  | "vehicle_interior"
  | "spacecraft_interior"
  | "lunar_module"
  | "lunar_surface"
  | "financial_district"
  | "bank_vault"
  | "temple"
  | "ancient_ruins"
  | "concert_stage"
  | "homestead"
  | "wilderness";
export type MotionComicEra = "ancient" | "medieval" | "industrial_era" | "modern" | "near_future" | "space_age" | "timeless";
export type MotionComicSubject = "reference_characters" | "astronaut" | "scientist" | "traveler" | "worker" | "soldier" | "detective" | "medic" | "pilot" | "sailor" | "civilian" | "child" | "elder" | "crowd" | "animal" | "robot" | "investor" | "executive" | "philosopher" | "family" | "musician" | "naturalist" | "historical_figure";
export type MotionComicObject = "oxygen_tank" | "tool_kit" | "lantern" | "rope" | "vehicle" | "machinery" | "medical_kit" | "weapon" | "package" | "furniture" | "vessel" | "spacecraft" | "coins" | "vault" | "hourglass" | "shield" | "artifact" | "instrument" | "bridge" | "building" | "statue" | "tree";
export type MotionComicAction =
  | "poised_action"
  | "urgent_movement"
  | "tense_confrontation"
  | "expressive_gesture"
  | "carrying_gear"
  | "reaching"
  | "repairing"
  | "operating_equipment"
  | "protecting"
  | "examining"
  | "discovering"
  | "building"
  | "exchanging"
  | "performing_music"
  | "contemplating"
  | "deliberate_work"
  | "watchful_pause"
  | "purposeful_travel";
export type MotionComicMood = "tense" | "urgent" | "somber" | "hopeful" | "mysterious" | "calm";
export type MotionComicLighting = "daylight" | "golden_hour" | "moonlight" | "firelight" | "interior_light";
export type MotionComicRelation = "subject_repairs_object" | "subject_operates_object" | "subject_carries_object" | "subject_reaches_for_object" | "subject_observes_object" | "subjects_face_each_other" | "subjects_travel_through_environment" | "subject_protects_object" | "subject_examines_object" | "subject_discovers_object" | "subject_builds_object" | "subjects_exchange_objects" | "subject_plays_instrument" | "subject_contemplates_object";

/** Closed scene vocabulary. No planner-controlled prose can be represented. */
export interface MotionComicVisualScene {
  environment: MotionComicEnvironment;
  era: MotionComicEra;
  subjects: MotionComicSubject[];
  objects: MotionComicObject[];
  action: MotionComicAction;
  relations: MotionComicRelation[];
  mood: MotionComicMood;
  lighting: MotionComicLighting;
}

export type MotionComicAge = "young" | "adult" | "older";
export type MotionComicBuild = "slender" | "average" | "sturdy" | "athletic";
export type MotionComicFace = "distinctive" | "weathered" | "angular" | "soft";
export type MotionComicHair = "dark_short" | "dark_long" | "light_short" | "light_long" | "grey" | "covered";
export type MotionComicWardrobe = "plain_shirt" | "coat" | "jacket" | "dress" | "uniform" | "suit" | "workwear" | "robes" | "layered_clothing";
export type MotionComicPalette = "neutral" | "red_accent" | "blue_accent" | "green_accent" | "gold_accent" | "monochrome";
export type MotionComicAccessory = "none" | "plain_scarf" | "plain_hat" | "glasses" | "lantern";

/** Closed character vocabulary. Wardrobe markings, tattoos and labels have no field. */
export interface MotionComicVisualCharacter {
  age: MotionComicAge;
  build: MotionComicBuild;
  face: MotionComicFace;
  hair: MotionComicHair;
  wardrobe: MotionComicWardrobe;
  palette: MotionComicPalette;
  accessory: MotionComicAccessory;
}

export interface MotionComicVisualStyle {
  linework: "bold_ink" | "clean_ink" | "noir_ink" | "watercolor_ink";
  palette: "moody" | "warm" | "cool" | "monochrome" | "vibrant";
  texture: "film_grain" | "paper_grain" | "smooth";
}

interface PlanChar { id: string; name: string; visual: MotionComicVisualCharacter; voiceId: string }
interface PlanLine { speaker: string; text: string }
interface PlanPanel { visual: MotionComicVisualScene; characters: string[]; shot: "wide" | "medium" | "close"; lines: PlanLine[] }
interface Plan { title: string; logline: string; narratorVoiceId: string; characters: PlanChar[]; panels: PlanPanel[] }
interface RawPlanChar { id?: string; name?: string; look?: unknown; visual?: unknown; voiceId?: string }
interface RawPlanPanel { scene?: unknown; visual?: unknown; characters?: string[]; shot?: string; lines?: PlanLine[] }
interface RawPlan { title?: string; logline?: string; narratorVoiceId?: string; characters?: RawPlanChar[]; panels?: RawPlanPanel[] }

/**
 * THE PLAN/RENDER SEAM (pattern: documotion's `CraftDocuArgs.plan`).
 *
 * `MotionComicStoryboard` is the CHEAP half of this engine: one Gemini text
 * call decides the whole story, cast, shot list and dialogue. Everything
 * downstream of it — per-panel Nano-Banana/Novita art, per-line ElevenLabs
 * voices, a Suno bed, the python page render — is PAID and irreversible.
 *
 * Exporting the storyboard as a first-class value is what lets a caller run a
 * produce→critique→regenerate loop at TEXT prices and then hand the ACCEPTED
 * storyboard to `castMotionComic({ plan })`, which spends exactly once.
 */
export type MotionComicStoryboard = Plan;
export type MotionComicStoryboardPanel = PlanPanel;
export type MotionComicStoryboardLine = PlanLine;
export type MotionComicStoryboardCharacter = PlanChar;

export interface MotionComicArtReference {
  data: string;
  mime: string;
}

export interface MotionComicPanelArtSource {
  visual: MotionComicVisualScene;
  shot: "wide" | "medium" | "close";
  characters: readonly string[];
}

const SCENE_ENVIRONMENTS: readonly MotionComicEnvironment[] = ["atmospheric_exterior", "urban_exterior", "interior", "forest", "waterfront", "mountain", "industrial", "ruined_landscape", "laboratory", "vehicle_interior", "spacecraft_interior", "lunar_module", "lunar_surface", "financial_district", "bank_vault", "temple", "ancient_ruins", "concert_stage", "homestead", "wilderness"];
const SCENE_ERAS: readonly MotionComicEra[] = ["ancient", "medieval", "industrial_era", "modern", "near_future", "space_age", "timeless"];
const SCENE_SUBJECTS: readonly MotionComicSubject[] = ["reference_characters", "astronaut", "scientist", "traveler", "worker", "soldier", "detective", "medic", "pilot", "sailor", "civilian", "child", "elder", "crowd", "animal", "robot", "investor", "executive", "philosopher", "family", "musician", "naturalist", "historical_figure"];
const SCENE_OBJECTS: readonly MotionComicObject[] = ["oxygen_tank", "tool_kit", "lantern", "rope", "vehicle", "machinery", "medical_kit", "weapon", "package", "furniture", "vessel", "spacecraft", "coins", "vault", "hourglass", "shield", "artifact", "instrument", "bridge", "building", "statue", "tree"];
const SCENE_ACTIONS: readonly MotionComicAction[] = ["poised_action", "urgent_movement", "tense_confrontation", "expressive_gesture", "carrying_gear", "reaching", "repairing", "operating_equipment", "protecting", "examining", "discovering", "building", "exchanging", "performing_music", "contemplating", "deliberate_work", "watchful_pause", "purposeful_travel"];
const SCENE_RELATIONS: readonly MotionComicRelation[] = ["subject_repairs_object", "subject_operates_object", "subject_carries_object", "subject_reaches_for_object", "subject_observes_object", "subjects_face_each_other", "subjects_travel_through_environment", "subject_protects_object", "subject_examines_object", "subject_discovers_object", "subject_builds_object", "subjects_exchange_objects", "subject_plays_instrument", "subject_contemplates_object"];
const SCENE_MOODS: readonly MotionComicMood[] = ["tense", "urgent", "somber", "hopeful", "mysterious", "calm"];
const SCENE_LIGHTING: readonly MotionComicLighting[] = ["daylight", "golden_hour", "moonlight", "firelight", "interior_light"];
const CHARACTER_AGES: readonly MotionComicAge[] = ["young", "adult", "older"];
const CHARACTER_BUILDS: readonly MotionComicBuild[] = ["slender", "average", "sturdy", "athletic"];
const CHARACTER_FACES: readonly MotionComicFace[] = ["distinctive", "weathered", "angular", "soft"];
const CHARACTER_HAIR: readonly MotionComicHair[] = ["dark_short", "dark_long", "light_short", "light_long", "grey", "covered"];
const CHARACTER_WARDROBE: readonly MotionComicWardrobe[] = ["plain_shirt", "coat", "jacket", "dress", "uniform", "suit", "workwear", "robes", "layered_clothing"];
const CHARACTER_PALETTES: readonly MotionComicPalette[] = ["neutral", "red_accent", "blue_accent", "green_accent", "gold_accent", "monochrome"];
const CHARACTER_ACCESSORIES: readonly MotionComicAccessory[] = ["none", "plain_scarf", "plain_hat", "glasses", "lantern"];

function closedValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;
}

function closedList<T extends string>(value: unknown, allowed: readonly T[], fallback: readonly T[], max: number): T[] {
  if (!Array.isArray(value)) return [...fallback];
  const values = value.filter((item): item is T => typeof item === "string" && allowed.includes(item as T));
  return [...new Set(values)].slice(0, max).length ? [...new Set(values)].slice(0, max) : [...fallback];
}

function sourceText(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

/** Classify arbitrary storyboard prose into a closed visual schema. The regexes
 * select enum values; they never edit or return source text. */
export function projectMotionComicVisualScene(value: unknown): MotionComicVisualScene {
  if (value && typeof value === "object") {
    const scene = value as Partial<MotionComicVisualScene>;
    return {
      environment: closedValue(scene.environment, SCENE_ENVIRONMENTS, "atmospheric_exterior"),
      era: closedValue(scene.era, SCENE_ERAS, "timeless"),
      subjects: closedList(scene.subjects, SCENE_SUBJECTS, [], 3),
      objects: closedList(scene.objects, SCENE_OBJECTS, [], 3),
      action: closedValue(scene.action, SCENE_ACTIONS, "poised_action"),
      relations: closedList(scene.relations, SCENE_RELATIONS, [], 3),
      mood: closedValue(scene.mood, SCENE_MOODS, "mysterious"),
      lighting: closedValue(scene.lighting, SCENE_LIGHTING, "daylight"),
    };
  }
  const text = sourceText(value);
  const environment: MotionComicEnvironment = /lunar module/.test(text) ? "lunar_module"
    : /moon|lunar surface/.test(text) ? "lunar_surface"
      : /spacecraft|spaceship|space station/.test(text) ? "spacecraft_interior"
        : /bank vault|inside (?:a |the )?vault/.test(text) ? "bank_vault"
          : /financial district|stock exchange|wall street/.test(text) ? "financial_district"
            : /concert|stage|orchestra hall/.test(text) ? "concert_stage"
              : /ancient ruins|archaeological site/.test(text) ? "ancient_ruins"
                : /temple|sanctuary/.test(text) ? "temple"
                  : /homestead|farmhouse|family home/.test(text) ? "homestead"
                    : /wilderness|meadow|savanna|tundra/.test(text) ? "wilderness"
        : /laboratory|lab\b/.test(text) ? "laboratory"
          : /car interior|cockpit|vehicle interior/.test(text) ? "vehicle_interior"
            : /rubble|ruin|battlefield|trench/.test(text) ? "ruined_landscape"
              : /factory|warehouse|machine|industrial|workshop/.test(text) ? "industrial"
                : /mountain|cliff|ridge|summit|canyon/.test(text) ? "mountain"
                  : /river|ocean|sea|coast|shore|harbou?r|dock|bridge/.test(text) ? "waterfront"
                    : /forest|woods|jungle|grove/.test(text) ? "forest"
                      : /room|office|home|house|kitchen|hall|interior/.test(text) ? "interior"
                        : /street|city|alley|graffiti|square|station/.test(text) ? "urban_exterior"
                          : "atmospheric_exterior";
  const era: MotionComicEra = /astronaut|lunar|spacecraft|spaceship|space station/.test(text) ? "space_age"
    : /near future|futuristic|robot/.test(text) ? "near_future"
      : /victorian|steam|nineteenth|industrial era/.test(text) ? "industrial_era"
        : /medieval|knight|castle/.test(text) ? "medieval"
          : /ancient|roman|greek|egypt/.test(text) ? "ancient"
            : /modern|contemporary|car|office|investor|executive|bank|financial/.test(text) ? "modern"
              : "timeless";
  const subjects = ([
    /astronaut/.test(text) && "astronaut",
    /scientist|researcher/.test(text) && "scientist",
    /travell?er|journey/.test(text) && "traveler",
    /worker|mechanic|engineer/.test(text) && "worker",
    /soldier|warrior|guard/.test(text) && "soldier",
    /detective|investigator/.test(text) && "detective",
    /medic|doctor|nurse/.test(text) && "medic",
    /pilot/.test(text) && "pilot",
    /sailor|captain/.test(text) && "sailor",
    /child|boy|girl/.test(text) && "child",
    /elder|old man|old woman/.test(text) && "elder",
    /crowd|people/.test(text) && "crowd",
    /animal|dog|cat|horse|bird/.test(text) && "animal",
    /robot|android/.test(text) && "robot",
    /investor|shareholder|trader/.test(text) && "investor",
    /executive|ceo|director|business leader/.test(text) && "executive",
    /philosopher|stoic|sage/.test(text) && "philosopher",
    /family|parents|mother|father|siblings/.test(text) && "family",
    /musician|pianist|violinist|guitarist|drummer/.test(text) && "musician",
    /naturalist|ranger|ecologist/.test(text) && "naturalist",
    /historical figure|statesman|emperor|queen|king/.test(text) && "historical_figure",
  ].filter(Boolean) as MotionComicSubject[]).slice(0, 3);
  if (!subjects.length) subjects.push("reference_characters");
  const objects = ([
    /oxygen tank/.test(text) && "oxygen_tank",
    /tool|wrench|spanner/.test(text) && "tool_kit",
    /lantern/.test(text) && "lantern",
    /rope|cable/.test(text) && "rope",
    /car|truck|vehicle/.test(text) && "vehicle",
    /machine|equipment|engine/.test(text) && "machinery",
    /medical kit|first aid/.test(text) && "medical_kit",
    /weapon|sword|gun|rifle/.test(text) && "weapon",
    /package|parcel|crate/.test(text) && "package",
    /table|chair|desk/.test(text) && "furniture",
    /boat|ship|vessel/.test(text) && "vessel",
    /spacecraft|spaceship/.test(text) && "spacecraft",
    /coin|money|currency/.test(text) && "coins",
    /vault|safe\b/.test(text) && "vault",
    /hourglass|sand timer/.test(text) && "hourglass",
    /shield/.test(text) && "shield",
    /artifact|relic/.test(text) && "artifact",
    /instrument|piano|violin|guitar|drum|cello/.test(text) && "instrument",
    /bridge/.test(text) && "bridge",
    /building|tower|skyscraper|house/.test(text) && "building",
    /statue|sculpture|bust/.test(text) && "statue",
    /tree|oak|pine/.test(text) && "tree",
  ].filter(Boolean) as MotionComicObject[]).slice(0, 3);
  const containsTextProp = /placard|sign|banner|poster|newspaper|letter|note|screen|label|caption|book|page|graffiti|shirt|t-?shirt|speech bubble|text|words?|reading|printed|says?/.test(text);
  const action: MotionComicAction = containsTextProp ? "expressive_gesture"
    : /repair|fix|mend/.test(text) ? "repairing"
      : /operate|control|pilot/.test(text) ? "operating_equipment"
        : /protect|guard|defend/.test(text) ? "protecting"
          : /examine|inspect|study/.test(text) ? "examining"
            : /discover|uncover|find/.test(text) ? "discovering"
              : /build|construct|assemble/.test(text) ? "building"
                : /exchange|trade|swap|hand over/.test(text) ? "exchanging"
                  : /play(?:s|ing)? (?:a |the )?(?:instrument|piano|violin|guitar|drum|cello)|perform(?:s|ing)? music/.test(text) ? "performing_music"
                    : /contemplate|meditate|reflect/.test(text) ? "contemplating"
        : /run|flee|rush|escape|sprint/.test(text) ? "urgent_movement"
      : /fight|confront|argue|standoff|threaten/.test(text) ? "tense_confrontation"
        : /point|gesture|signal|wave/.test(text) ? "expressive_gesture"
          : /hold|carry|lift|shield/.test(text) ? "carrying_gear"
            : /reach|grab|climb/.test(text) ? "reaching"
              : /work|build|repair|forge|write/.test(text) ? "deliberate_work"
                : /watch|look|observe|wait/.test(text) ? "watchful_pause"
                  : /walk|cross|travel|journey/.test(text) ? "purposeful_travel"
                    : "poised_action";
  const relations: MotionComicRelation[] = action === "repairing" && objects.length ? ["subject_repairs_object"]
    : action === "operating_equipment" && objects.length ? ["subject_operates_object"]
      : action === "protecting" && objects.length ? ["subject_protects_object"]
        : action === "examining" && objects.length ? ["subject_examines_object"]
          : action === "discovering" && objects.length ? ["subject_discovers_object"]
            : action === "building" && objects.length ? ["subject_builds_object"]
              : action === "exchanging" && objects.length ? ["subjects_exchange_objects"]
                : action === "performing_music" && objects.includes("instrument") ? ["subject_plays_instrument"]
                  : action === "contemplating" && objects.length ? ["subject_contemplates_object"]
      : action === "carrying_gear" && objects.length ? ["subject_carries_object"]
        : action === "reaching" && objects.length ? ["subject_reaches_for_object"]
          : action === "watchful_pause" && objects.length ? ["subject_observes_object"]
            : action === "tense_confrontation" ? ["subjects_face_each_other"]
              : action === "purposeful_travel" ? ["subjects_travel_through_environment"]
                : [];
  const mood: MotionComicMood = /urgent|panic|desperate|alarm/.test(text) ? "urgent"
    : /tense|fear|danger|threat/.test(text) ? "tense"
      : /sad|somber|grief|mourning/.test(text) ? "somber"
        : /hope|relief|triumph/.test(text) ? "hopeful"
          : /calm|peace|quiet/.test(text) ? "calm"
            : "mysterious";
  const lighting: MotionComicLighting = /moon|night|dusk/.test(text) ? "moonlight"
    : /fire|flame|lantern|candle/.test(text) ? "firelight"
      : /sunset|sunrise|golden/.test(text) ? "golden_hour"
        : ["interior", "laboratory", "vehicle_interior", "spacecraft_interior", "lunar_module"].includes(environment) ? "interior_light"
          : "daylight";
  return { environment, era, subjects, objects, action, relations, mood, lighting };
}

/** Classify arbitrary character prose into a closed, markings-free schema. */
export function projectMotionComicVisualCharacter(value: unknown): MotionComicVisualCharacter {
  if (value && typeof value === "object") {
    const character = value as Partial<MotionComicVisualCharacter>;
    return {
      age: closedValue(character.age, CHARACTER_AGES, "adult"),
      build: closedValue(character.build, CHARACTER_BUILDS, "average"),
      face: closedValue(character.face, CHARACTER_FACES, "distinctive"),
      hair: closedValue(character.hair, CHARACTER_HAIR, "dark_short"),
      wardrobe: closedValue(character.wardrobe, CHARACTER_WARDROBE, "layered_clothing"),
      palette: closedValue(character.palette, CHARACTER_PALETTES, "neutral"),
      accessory: closedValue(character.accessory, CHARACTER_ACCESSORIES, "none"),
    };
  }
  const text = sourceText(value);
  const age: MotionComicAge = /older|elder|aged|senior|grey-haired|gray-haired/.test(text) ? "older" : /young|teen/.test(text) ? "young" : "adult";
  const build: MotionComicBuild = /athletic|muscular|powerful/.test(text) ? "athletic" : /sturdy|stocky|broad/.test(text) ? "sturdy" : /slender|lean|thin/.test(text) ? "slender" : "average";
  const face: MotionComicFace = /weathered|scarred|lined/.test(text) ? "weathered" : /angular|sharp/.test(text) ? "angular" : /soft|round/.test(text) ? "soft" : "distinctive";
  const longHair = /long hair|braid|ponytail/.test(text);
  const hair: MotionComicHair = /hood|headscarf|covered hair/.test(text) ? "covered" : /grey hair|gray hair|silver hair/.test(text) ? "grey" : /blond|blonde|fair hair/.test(text) ? (longHair ? "light_long" : "light_short") : longHair ? "dark_long" : "dark_short";
  const wardrobe: MotionComicWardrobe = /t-?shirt|shirt|jersey/.test(text) ? "plain_shirt" : /coat|overcoat|trench/.test(text) ? "coat" : /jacket/.test(text) ? "jacket" : /dress|gown/.test(text) ? "dress" : /uniform|soldier|officer/.test(text) ? "uniform" : /suit|blazer/.test(text) ? "suit" : /workwear|overalls|apron/.test(text) ? "workwear" : /robe|tunic/.test(text) ? "robes" : "layered_clothing";
  const palette: MotionComicPalette = /red|crimson/.test(text) ? "red_accent" : /blue|navy/.test(text) ? "blue_accent" : /green|emerald/.test(text) ? "green_accent" : /gold|yellow|amber/.test(text) ? "gold_accent" : /black|white|monochrome/.test(text) ? "monochrome" : "neutral";
  const textBearingProp = /reading|printed|lettered|word|text|logo|label|tattoo/.test(text);
  const accessory: MotionComicAccessory = textBearingProp ? "none" : /lantern/.test(text) ? "lantern" : /glasses|spectacles/.test(text) ? "glasses" : /scarf/.test(text) ? "plain_scarf" : /hat|cap/.test(text) ? "plain_hat" : "none";
  return { age, build, face, hair, wardrobe, palette, accessory };
}

export function projectMotionComicVisualStyle(value: unknown): MotionComicVisualStyle {
  if (value && typeof value === "object") {
    const style = value as Partial<MotionComicVisualStyle>;
    return {
      linework: closedValue(style.linework, ["bold_ink", "clean_ink", "noir_ink", "watercolor_ink"] as const, "bold_ink"),
      palette: closedValue(style.palette, ["moody", "warm", "cool", "monochrome", "vibrant"] as const, "moody"),
      texture: closedValue(style.texture, ["film_grain", "paper_grain", "smooth"] as const, "film_grain"),
    };
  }
  const text = sourceText(value);
  return {
    linework: /watercolou?r/.test(text) ? "watercolor_ink" : /noir/.test(text) ? "noir_ink" : /clean|minimal/.test(text) ? "clean_ink" : "bold_ink",
    palette: /monochrome|black and white/.test(text) ? "monochrome" : /warm|sunset/.test(text) ? "warm" : /cool|moon|blue/.test(text) ? "cool" : /vibrant|bright/.test(text) ? "vibrant" : "moody",
    texture: /paper|print/.test(text) ? "paper_grain" : /smooth|clean/.test(text) ? "smooth" : "film_grain",
  };
}

/** The only request shape motion-comic art is allowed to send to an image provider. */
export interface MotionComicArtRequest {
  prompt: string;
  aspectRatio: "4:3";
  imageSize: "2K";
  images: { data: string; mimeType: string }[];
  allowText: false;
  tier: "flash";
}

export interface MotionComicImageRequest extends MotionComicArtRequest {
  id: string;
  negativePrompt: string;
  seed: number;
}

export type MotionComicImageGenerator = (request: MotionComicImageRequest) => Promise<Buffer>;

export const MOTION_COMIC_ART_CONTRACT_VERSION = "motion-comic-art-v5-text-native-identity";

interface MotionComicArtManifest {
  contractVersion: typeof MOTION_COMIC_ART_CONTRACT_VERSION;
  requestHash: string;
  imageSha256: string;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function motionComicArtManifestPath(imagePath: string): string {
  return imagePath.replace(/\.[^.]+$/, ".art.json");
}

async function removeMotionComicArtCache(imagePath: string): Promise<void> {
  await Promise.all([
    unlink(imagePath).catch(() => {}),
    unlink(motionComicArtManifestPath(imagePath)).catch(() => {}),
  ]);
}

/** Hash every provider-visible field plus reference-image content. */
export function motionComicArtRequestHash(request: MotionComicArtRequest): string {
  return sha256(JSON.stringify({
    contractVersion: MOTION_COMIC_ART_CONTRACT_VERSION,
    prompt: request.prompt,
    aspectRatio: request.aspectRatio,
    imageSize: request.imageSize,
    allowText: request.allowText,
    tier: request.tier,
    images: request.images.map((image) => ({ mimeType: image.mimeType, sha256: sha256(image.data) })),
  }));
}

/** Legacy/mismatched art is unsafe because it may predate the text-free schema.
 * Delete only this candidate; unaffected paid art keeps its matching manifest. */
export async function validateMotionComicArtCache(
  imagePath: string,
  acceptedRequestHashes: readonly string[],
): Promise<boolean> {
  const manifestPath = motionComicArtManifestPath(imagePath);
  if (!existsSync(imagePath) || !existsSync(manifestPath)) {
    await removeMotionComicArtCache(imagePath);
    return false;
  }
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Partial<MotionComicArtManifest>;
    const image = await readFile(imagePath);
    const valid = manifest.contractVersion === MOTION_COMIC_ART_CONTRACT_VERSION
      && typeof manifest.requestHash === "string"
      && acceptedRequestHashes.includes(manifest.requestHash)
      && manifest.imageSha256 === sha256(image);
    if (valid) return true;
  } catch {
    // Fall through to narrow invalidation.
  }
  await removeMotionComicArtCache(imagePath);
  return false;
}

export async function writeMotionComicArtCache(
  imagePath: string,
  image: Buffer,
  requestHash: string,
): Promise<void> {
  const manifestPath = motionComicArtManifestPath(imagePath);
  const suffix = `${process.pid}.${randomUUID()}.tmp`;
  const imageTmp = `${imagePath}.${suffix}`;
  const manifestTmp = `${manifestPath}.${suffix}`;
  const manifest: MotionComicArtManifest = {
    contractVersion: MOTION_COMIC_ART_CONTRACT_VERSION,
    requestHash,
    imageSha256: sha256(image),
  };
  try {
    await writeFile(imageTmp, image);
    await writeFile(manifestTmp, JSON.stringify(manifest));
    await rename(imageTmp, imagePath);
    await rename(manifestTmp, manifestPath);
  } finally {
    await Promise.all([unlink(imageTmp).catch(() => {}), unlink(manifestTmp).catch(() => {})]);
  }
}

export interface MotionComicTimelineBubble {
  id: string;
  text: string;
  at: number;
  mouth?: [number, number];
  anchor?: [number, number];
}

export interface MotionComicReviewBubble {
  id: string;
  panelIndex: number;
  startSec: number;
  endSec: number;
  /** Bubble rectangle normalized to the panel, after deterministic placement. */
  rect: [number, number, number, number];
  /** Face/hero-object safe zones normalized to the same panel. */
  keepClear: Array<[number, number, number, number]>;
}

export interface MotionComicReviewTimeline {
  version: "motion-comic-review/v1";
  bubbles: MotionComicReviewBubble[];
}

export interface MotionComicResult {
  outPath: string;
  title: string;
  panels: number;
  durationMs: number;
  runDir: string;
  /** Full spoken text (all lines, tags stripped, panel order) — downstream
   *  metadata/compliance blocks need a script-equivalent for the video. */
  narrationText: string;
  /** Characters sent to ElevenLabs during this invocation (zero on cache hit). */
  ttsCharactersGenerated: number;
  /** Successfully created music jobs during this invocation (zero on cache hit). */
  musicGenerations: number;
  /** Vision-letterer requests made during this invocation (zero on cache hit). */
  visionGraderCalls: number;
  /** Durable geometry used by post-render review and layout-only repair. */
  reviewTimeline: MotionComicReviewTimeline;
}

export const MOTION_COMIC_MIN_PANELS = 4;
export const MOTION_COMIC_MAX_PANELS = 12;
export const MOTION_COMIC_MAX_CHARACTERS = 4;
export const MOTION_COMIC_MAX_IMAGE_CALLS_PER_PANEL = 2;
export const MOTION_COMIC_MAX_IMAGE_CALLS_PER_CHARACTER = 2;
export const MOTION_COMIC_MAX_LINES_PER_PANEL = 3;
export const MOTION_COMIC_MAX_LINE_CHARS = 320;
export const MOTION_COMIC_MAX_WORD_CHARS = 48;
export const MOTION_COMIC_MIN_DIALOGUE_CHARS_PER_PANEL = 160;
/** 2.6 spoken words/sec × roughly 6 characters including spaces. */
export const MOTION_COMIC_DIALOGUE_CHARS_PER_SECOND = 16;
export const MOTION_COMIC_MAX_TTS_PROVIDER_RESPONSES_PER_LINE = 3;
export const MOTION_COMIC_MAX_VISION_CALLS_PER_PANEL = 2;
export const MOTION_COMIC_MAX_MUSIC_GENERATIONS = 1;

export function motionComicPanelCount(value: unknown): number {
  const parsed = Number(value ?? 8);
  return Number.isFinite(parsed)
    ? Math.max(MOTION_COMIC_MIN_PANELS, Math.min(MOTION_COMIC_MAX_PANELS, Math.floor(parsed)))
    : 8;
}

export function motionComicImageCallCeiling(panelCount: unknown, characterCount: unknown = 4): number {
  void characterCount;
  // Character model sheets were a provider-specific img2img workaround. The
  // live Novita route carries the closed character identity schema in every
  // panel prompt, so only primary + bounded recovery panels consume images.
  return motionComicPanelCount(panelCount) * MOTION_COMIC_MAX_IMAGE_CALLS_PER_PANEL;
}

export function motionComicTtsBillableCharacterCeiling(
  panelCount: unknown,
  targetSeconds: unknown = undefined,
): number {
  return (
    motionComicDialogueCharacterCeiling(panelCount, targetSeconds)
  );
}

export function motionComicVisionCallCeiling(panelCount: unknown): number {
  return motionComicPanelCount(panelCount) * MOTION_COMIC_MAX_VISION_CALLS_PER_PANEL;
}

export function motionComicTtsProviderCallCeiling(panelCount: unknown): number {
  return (
    motionComicPanelCount(panelCount) *
    MOTION_COMIC_MAX_LINES_PER_PANEL *
    MOTION_COMIC_MAX_TTS_PROVIDER_RESPONSES_PER_LINE
  );
}

export function boundMotionComicLine(text: unknown): string {
  const value = String(text ?? "").trim();
  return clipMotionComicWords(value, MOTION_COMIC_MAX_LINE_CHARS);
}

function clipMotionComicWords(text: string, maxChars: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const oversized = words.find((word) => word.length > MOTION_COMIC_MAX_WORD_CHARS);
  if (oversized) {
    throw new Error(
      `motionComic: dialogue contains an invalid ${oversized.length}-character token (max ${MOTION_COMIC_MAX_WORD_CHARS})`,
    );
  }
  const kept: string[] = [];
  let length = 0;
  for (const word of words) {
    const next = length + (kept.length ? 1 : 0) + word.length;
    if (next > maxChars) break;
    kept.push(word);
    length = next;
  }
  if (!kept.length && words.length) {
    throw new Error(`motionComic: dialogue budget ${maxChars} cannot preserve a complete word`);
  }
  return kept.join(" ");
}

export function motionComicDialogueCharacterCeiling(
  panelCount: unknown,
  targetSeconds: unknown = undefined,
): number {
  const panels = motionComicPanelCount(panelCount);
  const seconds = Number(targetSeconds);
  const requested = Number.isFinite(seconds) && seconds > 0
    ? Math.ceil(seconds * MOTION_COMIC_DIALOGUE_CHARS_PER_SECOND)
    : panels * 22 * MOTION_COMIC_DIALOGUE_CHARS_PER_SECOND;
  return Math.max(
    panels * MOTION_COMIC_MIN_DIALOGUE_CHARS_PER_PANEL,
    Math.min(panels * MOTION_COMIC_MAX_LINES_PER_PANEL * MOTION_COMIC_MAX_LINE_CHARS, requested),
  );
}

export function boundMotionComicDialogueLines(
  linesByPanel: readonly (readonly string[])[],
  targetSeconds: unknown,
): string[][] {
  if (!linesByPanel.length) return [];
  const totalBudget = motionComicDialogueCharacterCeiling(linesByPanel.length, targetSeconds);
  const baseBudget = Math.floor(totalBudget / linesByPanel.length);
  const remainder = totalBudget % linesByPanel.length;

  return linesByPanel.map((panelLines, panelIndex) => {
    const panelBudget = baseBudget + (panelIndex < remainder ? 1 : 0);
    let remaining = panelBudget;
    return panelLines.map((line, lineIndex) => {
      const linesLeft = panelLines.length - lineIndex - 1;
      const reserved = linesLeft * MOTION_COMIC_MAX_WORD_CHARS;
      const allowance = Math.max(MOTION_COMIC_MAX_WORD_CHARS, remaining - reserved);
      const text = clipMotionComicWords(line, allowance);
      remaining -= text.length;
      return text;
    });
  });
}

function boundMotionComicDialogue(panels: PlanPanel[], targetSeconds: unknown): PlanPanel[] {
  const bounded = boundMotionComicDialogueLines(
    panels.map((panel) => panel.lines.map((line) => line.text)),
    targetSeconds,
  );
  return panels.map((panel, panelIndex) => ({
    ...panel,
    lines: panel.lines.map((line, lineIndex) => ({
      ...line,
      text: bounded[panelIndex][lineIndex],
    })),
  }));
}

/* ------------------------------ helpers -------------------------------- */

const stripTags = (s: string) => s.replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();

const safeJson = <T,>(s: string, fb: T): T => {
  try { return JSON.parse(s.replace(/```json|```/g, "").trim()); } catch { return fb; }
};
const n01 = (v: number) => Math.max(0, Math.min(1, v > 1.5 ? v / 1000 : v)); // accept and clamp 0..1 or Gemini's 0..1000

interface BubbleAnchor { mouth?: [number, number]; anchor?: [number, number] }
interface PanelVision { anchors: Record<string, BubbleAnchor>; keepClear: number[][] }

function panelVisionReady(vision: PanelVision, lines: readonly PlanLine[]): boolean {
  const speakers = [...new Set(lines.filter((line) => line.speaker !== "narrator").map((line) => line.speaker))];
  const pointReady = (point: unknown): point is [number, number] => Array.isArray(point)
    && point.length === 2
    && point.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1);
  const boxReady = (box: unknown): boolean => Array.isArray(box)
    && box.length === 4
    && box.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1)
    && box[2] > 0
    && box[3] > 0;
  return speakers.length > 0
    && vision.keepClear.some(boxReady)
    && speakers.every((speaker) => {
      const placement = vision.anchors[speaker];
      return pointReady(placement?.mouth) && pointReady(placement?.anchor);
    });
}

/**
 * Documotion-style letterer pass: the model SEES the finished panel and chooses,
 * per speaker, a CLEAR-SPACE anchor for the bubble + the exact mouth point for the
 * tail, plus every face/hero-object box the text must not cover. Text is never
 * baked into the art — placement is an engine overlay, validated by vision.
 */
async function locatePanelText(imgPath: string, lines: PlanLine[], chars: PlanChar[], log: Logger): Promise<PanelVision> {
  const items = lines.filter((l) => l.speaker !== "narrator")
    .map((l) => `- ${chars.find((c) => c.id === l.speaker)?.name ?? l.speaker}: "${stripTags(l.text)}"`).join("\n");
  const prompt =
    `You are a COMIC LETTERER placing speech bubbles on ONE finished comic panel (shown).\n` +
    `These characters speak (each needs a bubble):\n${items}\n\n` +
    `For EACH, choose where the bubble goes so it is LEGIBLE and covers NO face and NO important/hero object ` +
    `(weapons, hands, key props): put it in EMPTY space (sky, wall, ground, fog) NEAR and preferably ABOVE the speaker, ` +
    `with its tail able to reach that speaker's mouth.\n` +
    `Return STRICT JSON, ALL coordinates NORMALIZED 0..1 (origin top-left, x→right, y→down):\n` +
    `{"bubbles":[{"name":"<character>","mouth":[x,y] (exact lips point),"anchor":[x,y] (centre of the empty area for the bubble)}],` +
    `"keepClear":[[x,y,w,h], ...]}\n` +
    `keepClear = a TIGHT box around EVERY face AND every important/hero object the text must not cover. No prose.`;
  try {
    const raw = await visionLocal({ prompt, imagePaths: [imgPath], json: true, maxTokens: VISION_GATE_MAX_TOKENS });
    const j = safeJson<{ bubbles?: { name?: string; mouth?: number[]; anchor?: number[] }[]; keepClear?: number[][] }>(raw, {});
    const anchors: Record<string, BubbleAnchor> = {};
    const point = (value: unknown): [number, number] | undefined => {
      if (!Array.isArray(value) || value.length < 2) return undefined;
      const x = Number(value[0]), y = Number(value[1]);
      return Number.isFinite(x) && Number.isFinite(y) ? [n01(x), n01(y)] : undefined;
    };
    for (const bb of j.bubbles ?? []) {
      const nm = (bb.name ?? "").trim().toLowerCase();
      if (!nm) continue;
      const id = chars.find((c) => nm.includes(c.name.toLowerCase().split(" ")[0]) || c.name.toLowerCase().includes(nm))?.id;
      if (!id) continue;
      anchors[id] = {
        mouth: point(bb.mouth),
        anchor: point(bb.anchor),
      };
    }
    const keepClear = (j.keepClear ?? []).flatMap((box) => {
      if (!Array.isArray(box) || box.length < 4) return [];
      const values = box.slice(0, 4).map(Number);
      return values.every(Number.isFinite) ? [[n01(values[0]), n01(values[1]), n01(values[2]), n01(values[3])]] : [];
    });
    return { anchors, keepClear };
  } catch (e) { log(`vision FAILED: ${e instanceof Error ? e.message : e}`); return { anchors: {}, keepClear: [] }; }
}

async function pool<T>(items: T[], n: number, fn: (item: T, i: number) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) || 1 }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  }));
}

function run(cmd: string, args: string[], log: Logger, capture = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    c.stdout.on("data", (d) => { if (capture) out += d.toString(); else log(`${cmd}: ${d.toString().trim()}`); });
    c.stderr.on("data", (d) => (err += d.toString()));
    c.on("error", reject);
    c.on("close", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(`${cmd} ${args[0]} exited ${code}: ${err.slice(-400)}`))));
  });
}

async function probeDur(file: string): Promise<number> {
  return Math.max(0.4, (await ffprobeDuration(file)) || 1);
}

/** Mean luma (0-255) of an image — near-black art gate. */
async function meanLuma(png: string): Promise<number> {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const ex = promisify(execFile);
    const { stderr } = await ex(process.env.FFMPEG_BIN ?? "ffmpeg", ["-i", png, "-vf", "signalstats,metadata=print", "-f", "null", "-"]);
    // metadata=print emits "lavfi.signalstats.YAVG=12.3" (EQUALS, not colon) —
    // the colon-only regex never matched, the gate silently never fired, and
    // two pure-black panels shipped. Accept both separators; scan all frames
    // and take the mean of the per-frame values.
    const vals = [...String(stderr).matchAll(/YAVG[=:](\d+(?:\.\d+)?)/g)].map((x) => Number(x[1]));
    const m = vals.length ? [null, String(vals.reduce((a, b) => a + b, 0) / vals.length)] : null;
    return m ? Number(m[1]) : 128;
  } catch { return 128; }
}

const MOTION_COMIC_PICTURE_ONLY_DIRECTION =
  "PICTURE-ONLY ART CONTRACT: render illustration pixels only. Do not render dialogue or any readable text, " +
  "letters, words, numbers, captions, subtitles, labels, signs, logos, watermarks, or pseudo-lettering. " +
  "Do not draw speech bubbles, thought bubbles, caption boxes, placards, banners, or blank text containers. " +
  "All lettering is added later by the deterministic renderer.";

function motionComicArtRequest(
  prompt: string,
  refs: readonly MotionComicArtReference[],
): MotionComicArtRequest {
  return {
    prompt: `${prompt}\n${MOTION_COMIC_PICTURE_ONLY_DIRECTION}`,
    aspectRatio: "4:3",
    imageSize: "2K",
    images: refs.map((ref) => ({ data: ref.data, mimeType: ref.mime })),
    allowText: false,
    tier: "flash",
  };
}

const STYLE_LINEWORK: Record<MotionComicVisualStyle["linework"], string> = {
  bold_ink: "bold confident graphic-novel ink with strong contour lines and cel shading",
  clean_ink: "clean controlled comic ink with precise silhouettes and restrained cel shading",
  noir_ink: "high-contrast noir comic ink with deep shadows and sharp rim light",
  watercolor_ink: "expressive comic ink with restrained watercolor washes",
};
const STYLE_PALETTE: Record<MotionComicVisualStyle["palette"], string> = {
  moody: "a rich moody color palette",
  warm: "a warm amber and earth-tone palette",
  cool: "a cool blue and slate palette",
  monochrome: "a monochrome charcoal palette",
  vibrant: "a vivid but controlled color palette",
};
const STYLE_TEXTURE: Record<MotionComicVisualStyle["texture"], string> = {
  film_grain: "subtle film-grain texture",
  paper_grain: "subtle printed-paper grain",
  smooth: "smooth polished finish",
};
const SCENE_ENVIRONMENT_PROMPT: Record<MotionComicEnvironment, string> = {
  atmospheric_exterior: "an atmospheric outdoor environment with layered depth",
  urban_exterior: "an urban exterior with streets and architecture",
  interior: "a believable interior with useful environmental depth",
  forest: "a dense natural forest environment",
  waterfront: "a waterfront environment with stone, water and open sky",
  mountain: "a rugged mountain environment with dramatic depth",
  industrial: "an industrial environment with machinery and structural detail",
  ruined_landscape: "a weathered landscape with rubble and damaged structures",
  laboratory: "a functional laboratory with scientific equipment",
  vehicle_interior: "the believable interior of a moving vehicle",
  spacecraft_interior: "a functional spacecraft interior with restrained controls",
  lunar_module: "the cramped functional interior of a lunar module",
  lunar_surface: "the lunar surface with regolith, deep space and hard shadows",
  financial_district: "a modern financial district with monumental architecture",
  bank_vault: "a secure bank-vault interior with heavy physical doors and shelves",
  temple: "a temple interior with stone columns and ceremonial space",
  ancient_ruins: "an archaeological ruin with weathered stone and layered depth",
  concert_stage: "a concert stage with instruments and dramatic practical light",
  homestead: "a lived-in homestead with domestic depth and natural materials",
  wilderness: "an open wilderness landscape with rich natural depth",
};
const SCENE_ERA_PROMPT: Record<MotionComicEra, string> = {
  ancient: "ancient-era material culture",
  medieval: "medieval material culture",
  industrial_era: "industrial-era material culture",
  modern: "modern material culture",
  near_future: "grounded near-future material culture",
  space_age: "grounded space-age engineering",
  timeless: "timeless, internally consistent material culture",
};
const SCENE_SUBJECT_PROMPT: Record<MotionComicSubject, string> = {
  reference_characters: "the supplied reference subjects",
  astronaut: "an astronaut",
  scientist: "a scientist",
  traveler: "a traveler",
  worker: "a skilled worker",
  soldier: "a soldier",
  detective: "a detective",
  medic: "a medic",
  pilot: "a pilot",
  sailor: "a sailor",
  civilian: "a civilian",
  child: "a child",
  elder: "an elder",
  crowd: "a crowd",
  animal: "an animal",
  robot: "a robot",
  investor: "an investor",
  executive: "an executive",
  philosopher: "a philosopher",
  family: "a family",
  musician: "a musician",
  naturalist: "a naturalist",
  historical_figure: "a historical figure",
};
const SCENE_OBJECT_PROMPT: Record<MotionComicObject, string> = {
  oxygen_tank: "an oxygen tank",
  tool_kit: "an unmarked tool kit",
  lantern: "an unmarked lantern",
  rope: "a rope or cable",
  vehicle: "a vehicle",
  machinery: "functional machinery",
  medical_kit: "an unmarked medical kit",
  weapon: "a weapon",
  package: "an unmarked package",
  furniture: "functional furniture",
  vessel: "a water vessel",
  spacecraft: "a spacecraft",
  coins: "a small collection of unmarked coins",
  vault: "a heavy physical vault",
  hourglass: "an hourglass",
  shield: "a shield without heraldic lettering",
  artifact: "an unmarked historical artifact",
  instrument: "a musical instrument without logos",
  bridge: "a bridge",
  building: "a building",
  statue: "a stone statue without inscriptions",
  tree: "a mature tree",
};
const SCENE_ACTION_PROMPT: Record<MotionComicAction, string> = {
  poised_action: "the figures hold a clear, readable dramatic pose",
  urgent_movement: "the figures move urgently through the frame",
  tense_confrontation: "the figures face each other in a tense confrontation",
  expressive_gesture: "the figures communicate through expressive physical gestures",
  carrying_gear: "the figures carry plain, unmarked functional gear",
  reaching: "a figure reaches decisively toward a physical objective",
  repairing: "a figure visibly repairs the physical object",
  operating_equipment: "a figure visibly operates the equipment",
  protecting: "a figure physically protects the important object",
  examining: "a figure carefully examines the physical object",
  discovering: "a figure visibly uncovers the physical object",
  building: "the figures actively construct the physical object",
  exchanging: "two figures physically exchange the objects",
  performing_music: "a figure performs music on the instrument",
  contemplating: "a figure quietly contemplates the physical object",
  deliberate_work: "the figures perform deliberate physical work",
  watchful_pause: "the figures pause and watch their surroundings",
  purposeful_travel: "the figures travel purposefully through the environment",
};
const SCENE_RELATION_PROMPT: Record<MotionComicRelation, string> = {
  subject_repairs_object: "the primary subject is physically repairing the primary object",
  subject_operates_object: "the primary subject is physically operating the primary object",
  subject_carries_object: "the primary subject carries the primary object",
  subject_reaches_for_object: "the primary subject reaches toward the primary object",
  subject_observes_object: "the primary subject watches the primary object",
  subjects_face_each_other: "the primary subjects face one another",
  subjects_travel_through_environment: "the primary subjects travel through the environment",
  subject_protects_object: "the primary subject protects the primary object",
  subject_examines_object: "the primary subject examines the primary object",
  subject_discovers_object: "the primary subject discovers the primary object",
  subject_builds_object: "the primary subject builds the primary object",
  subjects_exchange_objects: "the primary subjects exchange the primary objects",
  subject_plays_instrument: "the primary subject plays the instrument",
  subject_contemplates_object: "the primary subject contemplates the primary object",
};
const SCENE_MOOD_PROMPT: Record<MotionComicMood, string> = {
  tense: "tense atmosphere",
  urgent: "urgent atmosphere",
  somber: "somber atmosphere",
  hopeful: "hopeful atmosphere",
  mysterious: "mysterious atmosphere",
  calm: "calm atmosphere",
};
const SCENE_LIGHTING_PROMPT: Record<MotionComicLighting, string> = {
  daylight: "clear directional daylight",
  golden_hour: "warm golden-hour light",
  moonlight: "readable blue moonlight with visible shadow detail",
  firelight: "readable warm firelight with visible shadow detail",
  interior_light: "cinematic practical interior light",
};
const CHARACTER_PROMPT = {
  age: { young: "young", adult: "adult", older: "older" },
  build: { slender: "slender", average: "average-build", sturdy: "sturdy", athletic: "athletic" },
  face: { distinctive: "distinctive face", weathered: "weathered face", angular: "angular face", soft: "soft-featured face" },
  hair: { dark_short: "short dark hair", dark_long: "long dark hair", light_short: "short light hair", light_long: "long light hair", grey: "grey hair", covered: "hair fully covered by a plain hood" },
  wardrobe: { plain_shirt: "plain unmarked shirt", coat: "plain unmarked coat", jacket: "plain unmarked jacket", dress: "plain unmarked dress", uniform: "plain unmarked uniform", suit: "plain unmarked suit", workwear: "plain unmarked workwear", robes: "plain unmarked robes", layered_clothing: "plain layered practical clothing" },
  palette: { neutral: "neutral palette", red_accent: "restrained red accent", blue_accent: "restrained blue accent", green_accent: "restrained green accent", gold_accent: "restrained gold accent", monochrome: "monochrome palette" },
  accessory: { none: "no accessory", plain_scarf: "plain unmarked scarf", plain_hat: "plain unmarked hat", glasses: "glasses", lantern: "unmarked lantern" },
} as const;

function renderMotionComicStyle(value: unknown): string {
  const style = projectMotionComicVisualStyle(value);
  return `${STYLE_LINEWORK[style.linework]}, ${STYLE_PALETTE[style.palette]}, ${STYLE_TEXTURE[style.texture]}`;
}

function renderMotionComicScene(value: unknown): string {
  const scene = projectMotionComicVisualScene(value);
  const subjects = scene.subjects.map((subject) => SCENE_SUBJECT_PROMPT[subject]).join(" and ");
  const objects = scene.objects.map((object) => SCENE_OBJECT_PROMPT[object]).join(", ");
  const relations = scene.relations.map((relation) => SCENE_RELATION_PROMPT[relation]).join("; ");
  return [
    SCENE_ENVIRONMENT_PROMPT[scene.environment],
    SCENE_ERA_PROMPT[scene.era],
    subjects ? `VISIBLE SUBJECTS: ${subjects}` : "VISIBLE SUBJECTS: no foreground figure",
    objects ? `VISIBLE OBJECTS: ${objects}` : "VISIBLE OBJECTS: only non-textual environmental details",
    SCENE_ACTION_PROMPT[scene.action],
    relations,
    SCENE_MOOD_PROMPT[scene.mood],
    SCENE_LIGHTING_PROMPT[scene.lighting],
  ].filter(Boolean).join("; ");
}

function renderMotionComicCharacter(value: unknown): string {
  const character = projectMotionComicVisualCharacter(value);
  return [
    CHARACTER_PROMPT.age[character.age],
    CHARACTER_PROMPT.build[character.build],
    CHARACTER_PROMPT.face[character.face],
    CHARACTER_PROMPT.hair[character.hair],
    CHARACTER_PROMPT.wardrobe[character.wardrobe],
    CHARACTER_PROMPT.palette[character.palette],
    CHARACTER_PROMPT.accessory[character.accessory],
  ].join(", ");
}

/**
 * Pure boundary between storyboard data and the paid panel-art provider.
 * `PlanPanel.lines` is deliberately absent: dialogue can reach the visual output
 * only through the deterministic timeline/letterer, never through image gen.
 */
export function buildMotionComicPanelArtRequest(args: {
  style: MotionComicVisualStyle;
  panel: MotionComicPanelArtSource;
  refs?: readonly MotionComicArtReference[];
  /** Closed, repeatable identities used by the text-native Novita route. */
  characterIdentities?: readonly { id: string; visual: MotionComicVisualCharacter }[];
  recovery?: boolean;
}): MotionComicArtRequest {
  const visualScene = renderMotionComicScene(args.panel.visual);
  const style = renderMotionComicStyle(args.style);
  const shot = closedValue(args.panel.shot, ["wide", "medium", "close"] as const, "medium");
  const describedIdentities = (args.characterIdentities ?? [])
    .map((character) =>
      `Recurring subject ${character.id}: ${renderMotionComicCharacter(character.visual)}`,
    )
    .join(". ");
  const identity = describedIdentities
    ? `IDENTITY LOCK — repeat these exact visual traits in every panel: ${describedIdentities}. No substitutions or drift.`
    : (args.refs?.length ?? 0) > 0
      ? "Keep every depicted reference subject identical to the supplied model-sheet imagery: same face, hair, wardrobe silhouette and non-textual marks."
      : "";
  const lighting = args.recovery
    ? "Use clearly visible moonlight or firelight for a night scene; never produce a near-black image."
    : "";
  const prompt = [
    `A single ${shot.toUpperCase()} comic panel in this visual style: ${style}`,
    identity,
    "LETTERING-SAFE COMPOSITION: reserve a broad, clean, uncluttered area beside or above the main figure using environmental negative space such as open sky, a plain wall, fog, or empty ground. Keep faces away from the extreme corners. The reserved area must remain natural scenery, never a drawn bubble, box, sign, banner, or placeholder glyph.",
    `VISUAL SCENE ONLY (never dialogue or quoted words): ${visualScene}`,
    lighting,
  ].filter(Boolean).join("\n");
  return motionComicArtRequest(prompt, args.refs ?? []);
}

export function buildMotionComicCharacterArtRequest(args: {
  style: MotionComicVisualStyle;
  character: MotionComicVisualCharacter;
  simplified?: boolean;
}): MotionComicArtRequest {
  const composition = args.simplified
    ? "A single full-body character illustration on a plain light-grey background, one person only."
    : "A character model sheet on a plain light-grey background: several views of one character — full body, two face close-ups, and a hand detail — all depicting the same person for reuse across comic panels.";
  return motionComicArtRequest(
    `${composition}\nVISUAL STYLE: ${renderMotionComicStyle(args.style)}\nCHARACTER IDENTITY: ${renderMotionComicCharacter(args.character)}. No names, labels, lettering, logos, tattoos, or garment markings.`,
    [],
  );
}

export function buildMotionComicTimelineBubble(
  line: Pick<PlanLine, "speaker" | "text">,
  at: number,
  placement?: BubbleAnchor,
  id = "bubble",
): MotionComicTimelineBubble | null {
  if (line.speaker === "narrator") return null;
  return {
    id,
    text: stripTags(line.text),
    at,
    mouth: placement?.mouth,
    anchor: placement?.anchor,
  };
}

export function motionComicImageRecoveryAllowed(error: unknown): boolean {
  return !(error && typeof error === "object" && (error as { retryable?: unknown }).retryable === false);
}

/** ElevenLabs v3 Text-to-Dialogue — one or more (text, voice) lines → one mp3. */
class TerminalDialogueResponseError extends Error {
  readonly retryable = false;

  constructor(
    message: string,
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "TerminalDialogueResponseError";
  }
}

export async function elevenDialogue(
  inputs: { text: string; voice_id: string }[],
  onBillableCharacters?: (characters: number) => void,
): Promise<Buffer> {
  const key = process.env.ELEVENLABS_API_KEY;
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await fetch("https://api.elevenlabs.io/v1/text-to-dialogue", {
        method: "POST", headers: { "xi-api-key": key as string, "content-type": "application/json" },
        body: JSON.stringify({ model_id: "eleven_v3", inputs }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (e) {
      // POST transport failures are outcome-ambiguous: the dialogue may have
      // been accepted and billed. Retrying would risk buying it twice.
      throw new TerminalDialogueResponseError(
        `ElevenLabs dialogue outcome is unknown after transport failure; not retrying: ${e instanceof Error ? e.message : String(e)}`,
        undefined,
        { cause: e },
      );
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 160);
      if (res.status === 429 && attempt < 2) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      throw new TerminalDialogueResponseError(`ElevenLabs dialogue HTTP ${res.status}: ${detail}`, res.status);
    }
    onBillableCharacters?.(inputs.reduce((sum, input) => sum + input.text.length, 0));
    let b: Buffer;
    try {
      b = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      throw new TerminalDialogueResponseError(
        `ElevenLabs dialogue returned success but its audio could not be read; not retrying: ${e instanceof Error ? e.message : String(e)}`,
        res.status,
        { cause: e },
      );
    }
    if (b.length > 800) return b;
    throw new TerminalDialogueResponseError(
      "ElevenLabs dialogue returned tiny audio after a successful response",
      res.status,
    );
  }
  throw new TerminalDialogueResponseError("ElevenLabs dialogue retry budget exhausted", 429);
}

/* ------------------------------ storyboard ----------------------------- */

function storyPrompt(brief: MotionComicBrief, nPanels: number): string {
  const facts = brief.facts ? `\nSOURCE MATERIAL (stay accurate; this is a REAL story):\n${brief.facts}\n` : "";
  // Spoken-word budget per panel (~2.6 w/s incl. bubble beats + tail gaps);
  // without it the first live render spoke 75s against a 180s target.
  const perPanelWords = brief.targetSeconds
    ? Math.max(18, Math.round((brief.targetSeconds * 2.6) / Math.max(1, nPanels)))
    : 0;
  const lengthClause = perPanelWords
    ? `LENGTH (hard requirement): each panel's lines must total ~${perPanelWords} spoken words: the narrator carries 2-4 vivid, flowing sentences per panel (never one clipped line); character bubbles stay short. Read aloud, the whole piece must run ~${brief.targetSeconds} seconds.

`
    : "";
  const cast = ROSTER.map((r) => `  ${r.id}  — ${r.name} (${r.g}): ${r.note}`).join("\n");
  return (
    `You are the writer + director of a COMIC-BOOK short. Topic: ${brief.topic}${facts}\n` +
    `Write a genuinely GOOD, COHERENT story across exactly ${nPanels} panels with a real dramatic arc: a strong hook, ` +
    `rising tension, a turn, and a resonant ending. It is narrated: a NARRATOR carries the through-line in vivid prose, and ` +
    `CHARACTERS speak short, in-scene lines that will appear as comic SPEECH BUBBLES. Make every panel advance the story.\n\n` +
    lengthClause +
    `Cast the narrator + each character to ONE voice from this ElevenLabs roster (return the ID string):\n${cast}\n\n` +
    `Output STRICT JSON only:\n{\n` +
    `  "title":"...", "logline":"one line",\n` +
    `  "narratorVoiceId":"<roster id — the storyteller unless a better fit>",\n` +
    `  "characters":[ { "id":"<short_slug>", "name":"...", "voiceId":"<roster id>",\n` +
    `     "visual":{"age":"young|adult|older","build":"slender|average|sturdy|athletic","face":"distinctive|weathered|angular|soft","hair":"dark_short|dark_long|light_short|light_long|grey|covered","wardrobe":"plain_shirt|coat|jacket|dress|uniform|suit|workwear|robes|layered_clothing","palette":"neutral|red_accent|blue_accent|green_accent|gold_accent|monochrome","accessory":"none|plain_scarf|plain_hat|glasses|lantern"} } ],\n` +
    `  "panels":[ {\n` +
    `     "visual":{"environment":"atmospheric_exterior|urban_exterior|interior|forest|waterfront|mountain|industrial|ruined_landscape|laboratory|vehicle_interior|spacecraft_interior|lunar_module|lunar_surface|financial_district|bank_vault|temple|ancient_ruins|concert_stage|homestead|wilderness","era":"ancient|medieval|industrial_era|modern|near_future|space_age|timeless","subjects":["reference_characters|astronaut|scientist|traveler|worker|soldier|detective|medic|pilot|sailor|civilian|child|elder|crowd|animal|robot|investor|executive|philosopher|family|musician|naturalist|historical_figure"],"objects":["oxygen_tank|tool_kit|lantern|rope|vehicle|machinery|medical_kit|weapon|package|furniture|vessel|spacecraft|coins|vault|hourglass|shield|artifact|instrument|bridge|building|statue|tree"],"action":"poised_action|urgent_movement|tense_confrontation|expressive_gesture|carrying_gear|reaching|repairing|operating_equipment|protecting|examining|discovering|building|exchanging|performing_music|contemplating|deliberate_work|watchful_pause|purposeful_travel","relations":["subject_repairs_object|subject_operates_object|subject_carries_object|subject_reaches_for_object|subject_observes_object|subjects_face_each_other|subjects_travel_through_environment|subject_protects_object|subject_examines_object|subject_discovers_object|subject_builds_object|subjects_exchange_objects|subject_plays_instrument|subject_contemplates_object"],"mood":"tense|urgent|somber|hopeful|mysterious|calm","lighting":"daylight|golden_hour|moonlight|firelight|interior_light"},\n` +
    `     "characters":["<ids visible in THIS panel; [] for an establishing/object panel>"],\n` +
    `     "shot":"wide|medium|close",\n` +
    `     "lines":[ {"speaker":"narrator | <character id>","text":"<the spoken line. Character lines MUST be short (<=12 words) — they become speech bubbles. You MAY prepend ONE ElevenLabs v3 emotion tag in brackets, e.g. [tense], [whispers], [grim], for the VOICE only.>"} ]\n` +
    `  } ]\n}\n` +
    `Rules: 2-4 named characters. The | character separates alternatives in this schema; output exactly ONE listed token per scalar/array item, never the combined alternative string. subjects/objects/relations may be empty arrays when absent. Visual objects MUST use only the exact enum values shown; there is intentionally no field for printed words, signs, garment markings, dialogue, captions, or free-form art prompts. Each panel has 1-3 lines, usually a narrator beat plus at most one or two short character bubbles. Vary shots. Return ONLY the JSON.`
  );
}

function castVoice(id: string | undefined, fallbackGender: string): string {
  if (id && VALID_IDS.has(id)) return id;
  return ROSTER.find((r) => r.g === fallbackGender)?.id ?? DEFAULT_NARRATOR;
}

function normalizePlan(raw: RawPlan | Plan, log: Logger, maxPanels: number, targetSeconds: unknown): Plan {
  const narratorVoiceId = castVoice(raw.narratorVoiceId, "male");
  const characters = (raw.characters ?? []).slice(0, MOTION_COMIC_MAX_CHARACTERS).map((c, i) => ({
    id: c.id || `char${i}`,
    name: c.name || `Character ${i + 1}`,
    visual: projectMotionComicVisualCharacter(c.visual ?? ("look" in c ? c.look : undefined)),
    voiceId: castVoice(c.voiceId, i % 2 ? "female" : "male"),
  }));
  const ids = new Set(characters.map((c) => c.id));
  const panels = (raw.panels ?? []).slice(0, maxPanels).map((p) => ({
    visual: projectMotionComicVisualScene(p.visual ?? ("scene" in p ? p.scene : undefined)),
    characters: (p.characters ?? []).filter((id) => ids.has(id)),
    shot: closedValue(p.shot, ["wide", "medium", "close"] as const, "medium"),
    lines: (p.lines ?? [])
      .filter((l) => l.text?.trim())
      .slice(0, MOTION_COMIC_MAX_LINES_PER_PANEL)
      .map((line) => ({ ...line, text: boundMotionComicLine(line.text) })),
  })).filter((p) => p.lines.length);
  const boundedPanels = boundMotionComicDialogue(panels, targetSeconds);
  log(`plan: "${raw.title}" — ${characters.length} chars, ${boundedPanels.length} panels`);
  return {
    title: raw.title || "Untitled",
    logline: raw.logline || "",
    narratorVoiceId,
    characters,
    panels: boundedPanels,
  };
}

/**
 * A rejected storyboard's issues, folded back into the writer's prompt. Empty
 * notes render "" so an un-critiqued call sends the byte-identical old prompt.
 */
function revisionClause(revisionNotes: readonly string[]): string {
  const notes = revisionNotes.map((note) => String(note ?? "").trim()).filter(Boolean).slice(0, 8);
  if (!notes.length) return "";
  return (
    `\n\nREVISION — a director REJECTED your previous storyboard before any art, voice or music was bought. ` +
    `Rewrite the whole story so that EVERY issue below is fixed; do not simply repeat the rejected draft:\n` +
    notes.map((note, index) => `${index + 1}. ${note}`).join("\n")
  );
}

/**
 * Write the storyboard and NOTHING else — the CHEAP half of the engine.
 *
 * This makes ONLY a Gemini text call: no image generator is touched, no
 * ElevenLabs line is voiced, no music is generated, no python renderer runs.
 * It is therefore safe to call repeatedly inside a produce→critique→regenerate
 * loop; the ACCEPTED result is then passed to `castMotionComic({ plan })`,
 * which spends exactly once. `revisionNotes` are a critic's prior issues; omit
 * them and the prompt is byte-identical to the storyboard `castMotionComic`
 * writes for itself.
 */
export async function planMotionComicStoryboard(
  brief: MotionComicBrief,
  log: Logger = () => {},
  revisionNotes: readonly string[] = [],
): Promise<MotionComicStoryboard> {
  const nPanels = motionComicPanelCount(brief.panels);
  const raw = await geminiJsonPro<RawPlan>({
    prompt: storyPrompt(brief, nPanels) + revisionClause(revisionNotes),
    maxTokens: 14000,
    temperature: 0.85,
    log,
  });
  return normalizePlan(raw, log, nPanels, brief.targetSeconds);
}

/* -------------------------------- main --------------------------------- */

export async function castMotionComic(args: {
  brief: MotionComicBrief;
  runDir: string;
  outPath: string;
  generateImage: MotionComicImageGenerator;
  log?: Logger;
  /**
   * A caller-approved storyboard from `planMotionComicStoryboard` (typically
   * the winner of a produce→critique loop). When supplied the engine makes ZERO
   * planning calls and renders exactly this story; omit it and the engine plans
   * for itself exactly as it always has.
   */
  plan?: MotionComicStoryboard;
}): Promise<MotionComicResult> {
  const log = args.log ?? (() => {});
  const brief = args.brief;
  if (!hasMotionComic() || typeof args.generateImage !== "function") {
    throw new Error("motionComic: storyboard, voice, and an explicit attested image generator must all be ready before any generation");
  }
  const W = brief.width ?? 1920, H = brief.height ?? Math.round((brief.width ?? 1920) * 9 / 16);
  const style = projectMotionComicVisualStyle(brief.style ?? DEFAULT_STYLE);
  const nPanels = motionComicPanelCount(brief.panels);
  // $0-spend gate: the page renderer is the LAST step — verify python3 + the
  // baked scripts + pip deps BEFORE the storyboard/art/voice/music spend so a
  // broken worker fails immediately instead of after the whole art budget.
  await preflightPythonRenderer({
    scripts: [join("scripts", "mc_page_render.py"), join("scripts", "mc_textplace.py"), join("scripts", "mc_font.py")],
    packages: ["numpy", "pillow", "scikit-image", "scipy"],
    marker: ".ysa_mc_pydeps_ready",
    log,
    // At least one comic font must exist BEFORE any paid art/voice spend —
    // the renderer resolves the same candidates (env MC_FONT wins).
    fontsAnyOf: [[
      process.env.MC_FONT ?? "",
      join(process.cwd(), "src", "assets", "fonts", "ComicNeue-Bold.otf"),
      "/usr/share/fonts/opentype/comic-neue/ComicNeue-Bold.otf",
      "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ].filter(Boolean)],
  });
  await mkdir(args.runDir, { recursive: true });
  const rd = (f: string) => join(args.runDir, f);

  // A bounded/normalized line must never reuse audio or letter-placement
  // produced for the old text. Keeps paid ART/music caches (those are content-
  // hash validated in step 2); invalidates only text-dependent derived files.
  const invalidateTextDerived = async (): Promise<number> => {
    const stale = (await readdir(args.runDir)).filter((name) =>
      /^(?:line_\d+_\d+\.mp3|panel_\d+\.mp3|alist_\d+\.txt|vision_\d+\.json|narration\.mp3|narr_list\.txt)$/.test(name),
    );
    await Promise.all(stale.map((name) => unlink(rd(name)).catch(() => {})));
    return stale.length;
  };

  // 1. STORYBOARD — SUPPLIED (already critiqued) → cached → planned here.
  let plan: Plan;
  if (args.plan) {
    // normalizePlan rebuilds the whole object graph, so the caller's frozen
    // storyboard is never mutated by the render, AND every spend bound (panel
    // cap, line cap, dialogue budget) is re-applied to a supplied plan exactly
    // as it is to a model-written one — a caller cannot widen spend by handing
    // in an oversized story.
    plan = normalizePlan(args.plan, log, nPanels, brief.targetSeconds);
    const serialized = JSON.stringify(plan, null, 2);
    const onDisk = existsSync(rd("plan.json")) ? await readFile(rd("plan.json"), "utf8") : null;
    if (onDisk !== serialized) {
      await writeFile(rd("plan.json"), serialized);
      const dropped = onDisk === null ? 0 : await invalidateTextDerived();
      log(`plan: supplied (critique-approved) — ${plan.panels.length} panels, zero planning calls${dropped ? `; invalidated ${dropped} stale text-dependent cache file(s)` : ""}`);
    } else {
      log(`plan: supplied (critique-approved) — ${plan.panels.length} panels, matches this runDir's frozen plan`);
    }
  } else if (existsSync(rd("plan.json"))) {
    const cached = JSON.parse(await readFile(rd("plan.json"), "utf8")) as RawPlan | Plan;
    plan = normalizePlan(cached, log, nPanels, brief.targetSeconds);
    if (JSON.stringify(plan) !== JSON.stringify(cached)) {
      await writeFile(rd("plan.json"), JSON.stringify(plan, null, 2));
      const dropped = await invalidateTextDerived();
      log(`plan: cached plan normalized/capped to ${nPanels}; invalidated ${dropped} text-dependent cache file(s)`);
    } else {
      log("plan: cached");
    }
  }
  else {
    plan = await planMotionComicStoryboard(brief, log);
    await writeFile(rd("plan.json"), JSON.stringify(plan, null, 2));
  }
  const voiceOf = (s: string) => s === "narrator" ? plan.narratorVoiceId : (plan.characters.find((c) => c.id === s)?.voiceId ?? plan.narratorVoiceId);

  // 2. PANELS (cached) — the closed identity schema is repeated in every
  // prompt. This replaces provider-specific img2img model sheets, removes an
  // entire paid generation phase, and keeps the live route Z-Image-native.
  await pool(plan.panels, 3, async (p, i) => {
    const file = rd(`panel_${i}.png`);
    const characterIdentities = p.characters
      .map((id) => plan.characters.find((character) => character.id === id))
      .filter((character): character is PlanChar => Boolean(character))
      .map((character) => ({ id: character.id, visual: character.visual }));
    const request = buildMotionComicPanelArtRequest({
      style,
      panel: p,
      characterIdentities,
    });
    const simple = buildMotionComicPanelArtRequest({
      style,
      panel: p,
      characterIdentities,
      recovery: true,
    });
    const requestHash = motionComicArtRequestHash(request);
    const simpleHash = motionComicArtRequestHash(simple);
    if (await validateMotionComicArtCache(file, [requestHash, simpleHash])) return;
    await unlink(rd(`vision_${i}.json`)).catch(() => {});
    // Exactly two provider submissions maximum: one primary and one bounded
    // simplified/well-lit recovery. The adapter itself has no fallback route.
    const identitySeed = Number.parseInt(
      sha256(JSON.stringify({ style, characterIdentities })).slice(0, 8),
      16,
    ) & 0x7fffffff;
    const providerRequest = (
      art: MotionComicArtRequest,
      variant: "primary" | "recovery",
    ): MotionComicImageRequest => ({
      ...art,
      id: `panel-${i}-${variant}`,
      seed: identitySeed,
      negativePrompt:
        "text, letters, numbers, captions, speech bubbles, logos, watermark, UI, near-black exposure, distorted face, duplicate person",
    });
    const cacheVisible = async (image: Buffer, hash: string) => {
      await writeMotionComicArtCache(file, image, hash);
      if ((await meanLuma(file)) >= 14) return true;
      await removeMotionComicArtCache(file);
      throw new Error("panel art near-black");
    };
    let primary: Buffer | null = null;
    try { primary = await args.generateImage(providerRequest(request, "primary")); }
    catch (e) {
      if (!motionComicImageRecoveryAllowed(e)) throw e;
      log(`panel ${i} art failed (${e instanceof Error ? e.message : e}) — one simplified/well-lit retry`);
      try { await cacheVisible(await args.generateImage(providerRequest(simple, "recovery")), simpleHash); log(`panel ${i} ✓ (retry)`); }
      catch (e2) { log(`panel ${i} art FAILED twice: ${e2 instanceof Error ? e2.message : e2}`); }
    }
    if (primary) {
      try { await cacheVisible(primary, requestHash); log(`panel ${i} ✓ (${p.shot})`); }
      catch (e) {
        if (!(e instanceof Error && e.message === "panel art near-black")) throw e;
        log(`panel ${i} art failed (near-black) — one simplified/well-lit retry`);
        try { await cacheVisible(await args.generateImage(providerRequest(simple, "recovery")), simpleHash); log(`panel ${i} ✓ (retry)`); }
        catch (e2) { log(`panel ${i} art FAILED twice: ${e2 instanceof Error ? e2.message : e2}`); }
      }
    }
  });

  // COVERAGE FLOOR: a couple of lost panels degrade gracefully, but below 90%
  // the story has holes. Throw NOW — before the voice/music/render spend —
  // rather than publish a broken video (the cached art survives for a retry).
  const artOk = plan.panels.filter((_, i) => existsSync(rd(`panel_${i}.png`))).length;
  if (artOk < plan.panels.length * 0.9) {
    throw new Error(`motionComic: only ${artOk}/${plan.panels.length} panels have art (<90% coverage) — aborting before voice/render spend`);
  }

  // 3b. VISION letterer — clear-space anchor + mouth per bubble + keep-clear boxes (cached)
  const vision: PanelVision[] = [];
  let visionGraderCalls = 0;
  await pool(plan.panels, 3, async (p, i) => {
    const hasBubble = p.lines.some((l) => l.speaker !== "narrator");
    const img = rd(`panel_${i}.png`);
    if (!hasBubble || !existsSync(img)) { vision[i] = { anchors: {}, keepClear: [] }; return; }
    const vf = rd(`vision_${i}.json`);
    if (existsSync(vf)) {
      try {
        vision[i] = JSON.parse(await readFile(vf, "utf8"));
        if (panelVisionReady(vision[i], p.lines)) return;
      } catch {
        // Rebuild invalid legacy/corrupt placement below.
      }
      await unlink(vf).catch(() => {});
    }
    visionGraderCalls += 1;
    vision[i] = await locatePanelText(img, p.lines, plan.characters, log);
    // Incomplete geometry would make deterministic placement blind. Retry once;
    // then fail before voice/music; paid art remains hash-bound and reusable.
    if (!panelVisionReady(vision[i], p.lines)) {
      visionGraderCalls += 1;
      vision[i] = await locatePanelText(img, p.lines, plan.characters, log);
    }
    if (!panelVisionReady(vision[i], p.lines)) {
      throw new Error(`motionComic: vision letterer could not prove complete mouth/anchor/keep-clear geometry for panel ${i}`);
    }
    await writeFile(vf, JSON.stringify(vision[i]));
    log(`vision ${i} ✓ (${Object.keys(vision[i].anchors).length} bubbles, ${vision[i].keepClear.length} keepClear)`);
  });

  // 4. VOICES — per-line (exact timing) + per-panel padded audio + bubble cues
  const TAIL_GAP = 0.6;
  let ttsCharactersGenerated = 0;
  const panelDur: number[] = [], panelBubbles: MotionComicTimelineBubble[][] = [], panelAvoid: number[][][] = [], panelHasAudio: boolean[] = [];
  const repairAvoidForPanel = (panelIndex: number): number[][] =>
    (brief.layoutRepair ?? [])
      .filter((repair) => repair.action === "reflow_bubble" && repair.panelIndex === panelIndex)
      .flatMap((repair) => repair.forbiddenRects ?? [])
      .map((rect) => rect.map(n01));
  for (let i = 0; i < plan.panels.length; i++) {
    const lines = plan.panels[i].lines;
    let off = 0; const bubbles: MotionComicTimelineBubble[] = []; const lineFiles: string[] = [];
    for (let k = 0; k < lines.length; k++) {
      const lf = rd(`line_${i}_${k}.mp3`);
      if (!existsSync(lf)) {
        // elevenDialogue owns the complete bounded provider retry cycle; cache
        // writes are handled separately below so they never repurchase audio.
        const input = [{ text: lines[k].text.trim(), voice_id: voiceOf(lines[k].speaker) }];
        let audio: Buffer;
        try {
          audio = await elevenDialogue(
            input,
            (characters) => { ttsCharactersGenerated += characters; },
          );
        } catch (e) {
          // elevenDialogue already exhausted its three bounded transport
          // attempts. Never start a second synthesis cycle here.
          log(`voice ${i}.${k} FAILED after provider retries: ${e instanceof Error ? e.message : e}`);
          continue;
        }
        try {
          await writeFile(lf, audio);
        } catch (e) {
          // Retry only the local cache write with the exact same bytes. A disk
          // hiccup must never repurchase speech.
          log(`voice ${i}.${k} cache write failed (${e instanceof Error ? e.message : e}) — retrying local write`);
          try { await writeFile(lf, audio); }
          catch (e2) { log(`voice ${i}.${k} cache write FAILED twice: ${e2 instanceof Error ? e2.message : e2}`); continue; }
        }
      }
      const d = await probeDur(lf);
      const bubble = buildMotionComicTimelineBubble(
        lines[k],
        off,
        vision[i]?.anchors[lines[k].speaker],
        `p${i}-b${k}`,
      );
      if (bubble) bubbles.push(bubble);
      lineFiles.push(`line_${i}_${k}.mp3`);
      off += d;
    }
    // A panel that lost EVERY line has no audio → the renderer drops it AND
    // its story beat. That is a coverage hole, not graceful degradation —
    // fail loud before the music/render spend (line mp3s are cached for retry).
    if (lines.length && !lineFiles.length) {
      throw new Error(`motionComic: panel ${i} lost ALL ${lines.length} voice line(s) — aborting before render spend`);
    }
    // A post-render overlay defect must change the local layout inputs, not
    // replay the exact same cached bubble placement.  Keep art, voice and
    // music intact; only the forbidden geometry changes before page render.
    panelAvoid[i] = [...(vision[i]?.keepClear ?? []), ...repairAvoidForPanel(i)];
    const dur = off + TAIL_GAP;
    panelBubbles[i] = bubbles; panelDur[i] = dur; panelHasAudio[i] = lineFiles.length > 0;
    // build padded per-panel audio = concat lines, padded with silence to `dur`
    if (lineFiles.length) {
      await writeFile(rd(`alist_${i}.txt`), lineFiles.map((f) => `file '${f}'`).join("\n"));
      await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", rd(`alist_${i}.txt`), "-af", "apad", "-t", dur.toFixed(3), "-c:a", "libmp3lame", rd(`panel_${i}.mp3`)], log);
      log(`voice ${i} ✓ (${lineFiles.length} lines, ${dur.toFixed(1)}s, ${bubbles.length} bubble)`);
    }
  }

  // 5. MUSIC (cached, optional)
  let musicPath = "";
  let musicGenerations = 0;
  if (brief.music !== false) {
    const file = rd("music.mp3");
    if (existsSync(file)) musicPath = file;
    else {
      try {
        const m = await generateMusic({ provider: "suno", prompt: brief.musicPrompt ?? `Cinematic emotional underscore for "${brief.topic}": orchestral, restrained strings + piano, building, instrumental, no vocals`, title: plan.title, timeoutMs: 240_000 });
        musicGenerations += 1;
        const url = m.url || "";
        if (url) { await run("ffmpeg", ["-y", "-i", url, "-c:a", "libmp3lame", file], log); musicPath = file; log("music ✓"); }
        else log("music: no url in result");
      } catch (e) { log(`music skipped: ${e instanceof Error ? e.message : e}`); }
    }
  }

  // 6. TIMELINE + page render
  const tlPanels = plan.panels.map((p, i) => existsSync(rd(`panel_${i}.png`)) && panelHasAudio[i]
    ? { panelIndex: i, img: `panel_${i}.png`, dur: panelDur[i], bubbles: panelBubbles[i], avoid: panelAvoid[i] } : null).filter(Boolean);
  await writeFile(rd("timeline.json"), JSON.stringify({ out_w: W, out_h: H, fps: 30, est: PREROLL_MS / 1000, per_page: PER_PAGE, turn: TURN_SEC, title: plan.title, panels: tlPanels }, null, 2));
  const silent = rd("silent.mp4");
  await run("python3", [join("scripts", "mc_page_render.py"), rd("timeline.json"), args.runDir, silent, join(ASSET_DIR, "hand.png")], log);
  const reviewLayoutPath = rd("motion_comic_review_timeline.json");
  let reviewTimeline: MotionComicReviewTimeline;
  try {
    const raw = JSON.parse(await readFile(reviewLayoutPath, "utf8")) as Partial<MotionComicReviewTimeline>;
    const bubbles = Array.isArray(raw.bubbles)
      ? raw.bubbles.flatMap((bubble): MotionComicReviewBubble[] => {
          const rect = Array.isArray(bubble?.rect) ? bubble.rect.slice(0, 4).map(Number) : [];
          const keepClear = Array.isArray(bubble?.keepClear)
            ? bubble.keepClear.flatMap((box) => Array.isArray(box) && box.length >= 4
              ? [box.slice(0, 4).map(Number) as [number, number, number, number]]
              : [])
            : [];
          if (
            typeof bubble?.id !== "string" ||
            !Number.isFinite(Number(bubble?.panelIndex)) ||
            !Number.isFinite(Number(bubble?.startSec)) ||
            !Number.isFinite(Number(bubble?.endSec)) ||
            rect.length !== 4 ||
            !rect.every(Number.isFinite)
          ) return [];
          return [{
            id: bubble.id,
            panelIndex: Number(bubble.panelIndex),
            startSec: Number(bubble.startSec),
            endSec: Number(bubble.endSec),
            rect: rect as [number, number, number, number],
            keepClear,
          }];
        })
      : [];
    reviewTimeline = { version: "motion-comic-review/v1", bubbles };
  } catch (error) {
    throw new Error(`motionComic: page renderer did not emit review geometry: ${error instanceof Error ? error.message : error}`);
  }

  // 7. NARRATION = concat per-panel audios, with TURN_SEC of silence at each page
  //    break so the narration stays in sync with the page-turn pauses.
  const present = plan.panels.map((_, i) => i).filter((i) => existsSync(rd(`panel_${i}.png`)) && existsSync(rd(`panel_${i}.mp3`)));
  const nPages = Math.max(1, Math.ceil(present.length / PER_PAGE));
  const pageBase = Math.max(1, Math.ceil(present.length / nPages));   // mirrors the renderer split
  await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", String(TURN_SEC), "-c:a", "libmp3lame", rd("turn_sil.mp3")], log);
  const narrParts: string[] = [];
  present.forEach((i, k) => {
    narrParts.push(`file 'panel_${i}.mp3'`);
    if ((k + 1) % pageBase === 0 && k < present.length - 1) narrParts.push(`file 'turn_sil.mp3'`);
  });
  await writeFile(rd("narr_list.txt"), narrParts.join("\n"));
  const narration = rd("narration.mp3");
  await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", rd("narr_list.txt"), "-c:a", "libmp3lame", narration], log);

  // 8. MUX narration (delayed by preroll) + ducked music → final
  const pre = `${PREROLL_MS}|${PREROLL_MS}`;
  if (musicPath) {
    // normalize=0: amix's default 1/n scaling buried BOTH voice and bed (the
    // first live render metered -25.3 LUFS integrated, music inaudible).
    await run("ffmpeg", ["-y", "-i", silent, "-i", narration, "-stream_loop", "-1", "-i", musicPath,
      "-filter_complex", `[1:a]adelay=${pre}[n];[2:a]volume=0.20[m];[n][m]amix=inputs=2:duration=longest:dropout_transition=2:normalize=0[a]`,
      "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-shortest", args.outPath], log);
  } else {
    await run("ffmpeg", ["-y", "-i", silent, "-i", narration, "-filter_complex", `[1:a]adelay=${pre}[a]`,
      "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-shortest", args.outPath], log);
  }
  // Final measured loudnorm to -14 LUFS (audio-only, video copied).
  try {
    const { normalizeAudioOnly } = await import("@/lib/ffmpeg");
    const norm = rd("final_norm.mp4");
    await normalizeAudioOnly(args.outPath, norm, -14);
    await run("ffmpeg", ["-y", "-i", norm, "-c", "copy", args.outPath], log);
    log("mix loudness-normalized to -14 LUFS");
  } catch (e) { log(`loudnorm skipped: ${e instanceof Error ? e.message : e}`); }

  const durationMs = Math.round((PREROLL_MS / 1000 + panelDur.reduce((a, b) => a + b, 0)) * 1000);
  // Script-equivalent for downstream blocks (metadata/compliance): every line
  // in panel order with the ElevenLabs emotion tags stripped.
  const narrationText = plan.panels.flatMap((p) => p.lines.map((l) => stripTags(l.text))).join(" ");
  log(`DONE: ${args.outPath} (${tlPanels.length} panels, ${(durationMs / 1000).toFixed(1)}s)`);
  return {
    outPath: args.outPath,
    title: plan.title,
    panels: tlPanels.length,
    durationMs,
    runDir: args.runDir,
    narrationText,
    ttsCharactersGenerated,
    musicGenerations,
    visionGraderCalls,
    reviewTimeline,
  };
}
