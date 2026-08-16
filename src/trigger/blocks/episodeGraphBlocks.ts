/**
 * Bridge the existing, timed Story Spine into the provider-independent Episode
 * Graph ABI. This is deliberately a planner: it makes no model, media, or
 * network calls, and the Scene Compiler is the only pixel-producing consumer.
 */
import {
  assertEpisodeGraphAgainstStorySpine,
  canonicalEpisodeCatalogId,
  buildEpisodeGraph,
  compileSceneManifest,
  type EpisodeAudience,
  type EpisodeBeatKind,
  type EpisodeCamera,
  type EpisodeGraph,
  type EpisodeSource,
  type SceneManifest,
} from "@/engine/episodeGraph";
import {
  assertSyntheticScenarioContract,
  syntheticScenarioVisualKindFor,
  type SyntheticScenarioContract,
} from "@/engine/syntheticScenario";
import { resolveContentLane } from "@/engine/contentLane";
import { assertCurriculumEpisodeSeedForStoryInput } from "@/engine/curriculumEpisodeSeed";
import { StorySpineSchema, type StorySpine } from "@/engine/storySpine";
import type { Block } from "@/engine/types";

const SCRIPT_SOURCE_ID = "source-validated-story-spine";
const CURRICULUM_SOURCE_ID = "source-original-channel-curriculum";

function stableFragment(value: unknown, fallback: string): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function kindForPurpose(purpose: string, index: number, total: number, audience: EpisodeAudience): EpisodeBeatKind {
  const value = purpose.toLowerCase();
  if (index === 0) return value.includes("question") ? "question" : "opening";
  if (/question|ask/.test(value)) return "question";
  if (/problem|conflict|obstacle|risk/.test(value)) return "problem";
  if (/experiment|test|try/.test(value)) return "experiment";
  if (/choice|decision/.test(value)) return "choice";
  if (/observation|context|background/.test(value)) return "observation";
  if (/result|answer|evidence|aftermath/.test(value)) return "result";
  if (/lesson|learn|takeaway/.test(value)) return "lesson";
  if (/resolution|conclusion|ending/.test(value)) return "resolution";
  // A children episode must resolve in an explicit learning moment. The text
  // remains source-timed; only its visual grammar gets a deterministic role.
  if (audience === "children" && index === total - 1) return "lesson";
  return "claim";
}

function cameraForShot(shot: StorySpine["shotList"][number] | undefined): EpisodeCamera {
  const framing = shot?.shotScale === "extreme_close"
    ? "close"
    : shot?.shotScale ?? "wide";
  const move = shot?.cameraMove ?? "static";
  return {
    framing: framing === "wide" || framing === "medium" || framing === "close" || framing === "establishing"
      ? framing
      : "wide",
    move: move.includes("push") ? "push"
      : move.includes("pull") ? "pull"
        : move.includes("orbit") ? "orbit"
          : move.includes("truck") || move.includes("dolly") ? "track"
            : move.includes("crane") ? "pan"
              : "static",
  };
}

function storySpineFromStore(store: Record<string, unknown>): StorySpine {
  return StorySpineSchema.parse({
    version: "1.0.0",
    timedScript: store["timedScript"],
    narrativeBeats: store["narrativeBeats"],
    continuityLedger: store["continuityLedger"],
    shotList: store["shotList"],
    dpVisualSpecs: store["dpVisualSpecs"],
    editorEdl: store["editorEdl"],
    coverage: store["storyCoverage"],
  });
}

/** Pure bridge used by the runtime and test suite. */
export function buildEpisodeGraphFromStorySpine(args: {
  storySpine: StorySpine;
  topic: string;
  audience?: EpisodeAudience;
  seriesId: string;
  episodeId: string;
  curriculumLabel?: string;
  curriculumLocator?: string;
  syntheticScenario?: SyntheticScenarioContract;
}): { episodeGraph: EpisodeGraph; sceneManifest: SceneManifest } {
  const storySpine = StorySpineSchema.parse(args.storySpine);
  const audience = args.audience ?? "general";
  const sourceRefs: EpisodeSource[] = [{
    id: SCRIPT_SOURCE_ID,
    kind: "script",
    label: "Validated timed Story Spine",
    locator: "artifact://validated-story-spine/v1",
  }];
  if (audience === "children") {
    sourceRefs.push({
      id: CURRICULUM_SOURCE_ID,
      kind: "curriculum",
      label: args.curriculumLabel?.trim() || "Original channel learning curriculum",
      locator: args.curriculumLocator?.trim() || "channel://original-learning-curriculum/v1",
    });
  }

  const sentenceById = new Map(storySpine.timedScript.sentences.map((sentence) => [sentence.id, sentence]));
  const shotsByBeat = new Map<string, StorySpine["shotList"]>();
  for (const shot of storySpine.shotList) {
    const shots = shotsByBeat.get(shot.beatId) ?? [];
    shots.push(shot);
    shotsByBeat.set(shot.beatId, shots);
  }
  const characters = storySpine.continuityLedger.entities.map((entity) => ({
    id: canonicalEpisodeCatalogId(entity.id, "character"),
    displayName: entity.name,
    continuityLock: entity.look,
  }));
  const settings = storySpine.continuityLedger.locations.map((location) => ({
    id: canonicalEpisodeCatalogId(location.id, "setting"),
    displayName: location.name,
    continuityLock: location.look,
  }));

  const syntheticScenario = args.syntheticScenario
    ? assertSyntheticScenarioContract(args.syntheticScenario)
    : undefined;
  const beats = storySpine.narrativeBeats.map((beat, index) => {
    const shots = shotsByBeat.get(beat.id) ?? [];
    const leadShot = shots[0];
    const text = beat.sourceSentenceIds
      .map((id) => sentenceById.get(id)?.text.trim())
      .filter((value): value is string => Boolean(value))
      .join(" ");
    if (!text) throw new Error(`episode_graph: narrative beat ${beat.id} has no timed source text`);
    const learningObjective = audience === "children"
      ? `Practice one clear, kind idea about ${args.topic.trim()}.`
      : undefined;
    return {
      id: beat.id,
      kind: kindForPurpose(beat.purpose, index, storySpine.narrativeBeats.length, audience),
      t0: beat.t0,
      t1: beat.t1,
      claim: text,
      ...(learningObjective ? { learningObjective } : {}),
      scenePurpose: beat.purpose,
      sourceRefs: audience === "children" ? [SCRIPT_SOURCE_ID, CURRICULUM_SOURCE_ID] : [SCRIPT_SOURCE_ID],
      characterIds: (leadShot?.entities ?? []).map((id) => canonicalEpisodeCatalogId(id, "character")),
      ...(leadShot?.locationId
        ? { settingId: canonicalEpisodeCatalogId(leadShot.locationId, "setting") }
        : {}),
      text,
      camera: cameraForShot(leadShot),
      visualState: {
        action: leadShot?.literalContent || beat.purpose,
        mood: leadShot?.lighting,
        props: [...new Set(shots.flatMap((shot) => shot.props))].slice(0, 12),
        ...(syntheticScenario
          ? {
              syntheticScenarioProfile: syntheticScenario.profile,
              syntheticScenarioVisualKind: syntheticScenarioVisualKindFor(
                syntheticScenario.profile,
                index,
                storySpine.narrativeBeats.length,
                beat.purpose,
              ),
            }
          : {}),
      },
      transition: index === 0 ? "cut" as const : "match_cut" as const,
      storySpineBeatIds: [beat.id],
      storySpineSentenceIds: beat.sourceSentenceIds,
    };
  });
  if (beats.length < 2) throw new Error("episode_graph: Story Spine must contain at least two narrative beats");

  const episodeGraph = buildEpisodeGraph({
    seriesId: args.seriesId,
    episodeId: args.episodeId,
    topic: args.topic,
    audience,
    durationSec: storySpine.timedScript.narrationDurationSec,
    beats,
    causalEdges: beats.slice(1).map((beat, index) => ({
      id: `edge-${index + 1}-${index + 2}`,
      fromBeatId: beats[index].id,
      toBeatId: beat.id,
      relation: audience === "children" ? "teaches" as const : beat.kind === "resolution" ? "resolves" as const : "enables" as const,
      rationale: `${beats[index].scenePurpose} leads into ${beat.scenePurpose}.`,
      sourceRefs: audience === "children" ? [SCRIPT_SOURCE_ID, CURRICULUM_SOURCE_ID] : [SCRIPT_SOURCE_ID],
    })),
    characterIds: characters.map((character) => character.id),
    settingIds: settings.map((setting) => setting.id),
    sources: sourceRefs,
    characters,
    settings,
  });
  const grounded = assertEpisodeGraphAgainstStorySpine(episodeGraph, storySpine);
  return { episodeGraph: grounded, sceneManifest: compileSceneManifest(grounded, storySpine) };
}

const episodeGraph: Block = {
  id: "episode_graph",
  consumes: [
    "topic",
    "timedScript",
    "narrativeBeats",
    "continuityLedger",
    "shotList",
    "dpVisualSpecs",
    "editorEdl",
    "storyCoverage",
  ],
  produces: ["episodeGraph", "sceneManifest"],
  run: async (ctx) => {
    const lane = resolveContentLane({ stored: ctx.store["contentLane"], pipeline: [] });
    const childrenSeed = lane.key === "children_learning_supervised"
      ? assertCurriculumEpisodeSeedForStoryInput({
        curriculumEpisodeSeed: ctx.store["curriculumEpisodeSeed"],
        curriculumEpisodeSeedApproval: ctx.store["curriculumEpisodeSeedApproval"],
        contentLane: lane,
        topic: ctx.store["topic"],
      })
      : undefined;
    const audience = childrenSeed ? "children" : ctx.params["audience"] === "children" ? "children" : "general";
    const { episodeGraph, sceneManifest } = buildEpisodeGraphFromStorySpine({
      storySpine: storySpineFromStore(ctx.store),
      topic: String(ctx.store["topic"] ?? "").trim(),
      audience,
      seriesId: childrenSeed?.seriesId ?? `series-${stableFragment(ctx.channelId, "channel")}`,
      episodeId: childrenSeed?.episodeId ?? `episode-${stableFragment(ctx.runId, "run")}`,
      curriculumLabel: childrenSeed?.measurableObjective.statement ??
        (typeof ctx.params["curriculumLabel"] === "string" ? ctx.params["curriculumLabel"] : undefined),
      curriculumLocator: childrenSeed
        ? `curriculum://reviewed/${childrenSeed.seriesId}/${childrenSeed.episodeId}`
        : typeof ctx.params["curriculumLocator"] === "string" ? ctx.params["curriculumLocator"] : undefined,
      syntheticScenario: ctx.store["syntheticScenario"] !== undefined
        ? assertSyntheticScenarioContract(ctx.store["syntheticScenario"])
        : undefined,
    });
    ctx.log(
      `episode_graph: ${episodeGraph.beats.length} source-grounded beats → ${sceneManifest.scenes.length} deterministic scenes (provider calls: 0)`,
    );
    return { episodeGraph, sceneManifest };
  },
};

export const episodeGraphBlocks: Block[] = [episodeGraph];
