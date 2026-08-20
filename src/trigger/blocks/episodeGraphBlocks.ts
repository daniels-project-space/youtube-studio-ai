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
import {
  assertEvidenceVisualManifest,
  assertEvidenceVisualManifestCollection,
  type EvidenceVisualManifest,
} from "@/engine/evidenceVisualManifest";
import {
  assertEditorialEvidencePacket,
  type EditorialEvidencePacket,
} from "@/engine/editorialEvidencePacket";
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

/**
 * A reviewed factual visual is an editorial input, never something the graph
 * planner invents. Bind it to its exact deterministic scene and the timed
 * sentences that scene already owns before it enters the renderer ABI.
 */
function sceneEvidenceVisualsForStorySpine(
  value: unknown,
  storySpine: StorySpine,
): Map<string, EvidenceVisualManifest> {
  if (value === undefined) return new Map();
  const manifests = assertEvidenceVisualManifestCollection(value);
  const sentencesBySceneId = new Map(
    storySpine.narrativeBeats.map((beat) => [
      `scene-${beat.id.slice("beat-".length)}`,
      beat.sourceSentenceIds,
    ]),
  );
  const bySceneId = new Map<string, EvidenceVisualManifest>();

  for (const manifest of manifests) {
    // A shared reviewed collection may also contain timeline data inserts. The
    // Episode Graph owns only Scene Compiler manifests; insertBlocks retains
    // ownership of the other surface.
    if (manifest.surface !== "scene_compiler") continue;
    const sceneId = manifest.targetSceneId;
    const narrationSentenceIds = sceneId ? sentencesBySceneId.get(sceneId) : undefined;
    if (!sceneId || !narrationSentenceIds) {
      throw new Error(`episode_graph: evidence visual ${manifest.id} targets a scene outside this Story Spine`);
    }
    if (bySceneId.has(sceneId)) {
      throw new Error(`episode_graph: multiple evidence visuals target ${sceneId}`);
    }
    assertEvidenceVisualManifest(manifest, { sceneId, narrationSentenceIds });
    bySceneId.set(sceneId, manifest);
  }
  return bySceneId;
}

function editorialEpisodeSourceId(sourceId: string): string {
  return `source-editorial-${stableFragment(sourceId, "evidence")}`;
}

/**
 * A factual scene may use an Evidence Visual Manifest only when every source
 * snapshot in that renderer-facing manifest matches the separately reviewed
 * shared editorial packet. The manifest remains the authority on factual
 * pixels; the packet remains the authority on approved claims/source review.
 */
function assertEditorialPacketBindsEvidenceVisuals(
  packet: EditorialEvidencePacket | undefined,
  visuals: Map<string, EvidenceVisualManifest>,
): Set<string> {
  if (!packet) return new Set();
  const packetSources = new Map(packet.sources.map((source) => [source.id, source]));
  const usedSourceIds = new Set<string>();
  for (const visual of visuals.values()) {
    for (const source of visual.sources) {
      const approved = packetSources.get(source.id);
      if (!approved) {
        throw new Error(
          `episode_graph: factual visual ${visual.id} references source ${source.id} outside the reviewed editorial evidence packet`,
        );
      }
      if (
        approved.name !== source.name ||
        approved.url !== source.url ||
        approved.snapshotSha256 !== source.snapshotSha256
      ) {
        throw new Error(
          `episode_graph: factual visual ${visual.id} source ${source.id} does not match the packet's reviewed immutable snapshot`,
        );
      }
      usedSourceIds.add(source.id);
    }
  }
  return usedSourceIds;
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
  /** Fresh reviewed factual visuals for this supervised episode only. */
  evidenceVisualManifests?: unknown;
  /** Shared reviewed factual source/claim packet; never required for original explainers. */
  editorialEvidencePacket?: unknown;
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
  const sceneEvidenceVisuals = sceneEvidenceVisualsForStorySpine(args.evidenceVisualManifests, storySpine);
  const editorialEvidencePacket = args.editorialEvidencePacket === undefined
    ? undefined
    : assertEditorialEvidencePacket(args.editorialEvidencePacket);
  if (syntheticScenario && sceneEvidenceVisuals.size > 0) {
    throw new Error("episode_graph: reviewed factual visuals cannot be combined with a fictional synthetic scenario");
  }
  if (syntheticScenario && editorialEvidencePacket) {
    throw new Error("episode_graph: a reviewed factual editorial packet cannot be combined with a fictional synthetic scenario");
  }
  const usedEditorialSourceIds = assertEditorialPacketBindsEvidenceVisuals(editorialEvidencePacket, sceneEvidenceVisuals);
  if (editorialEvidencePacket) {
    for (const source of editorialEvidencePacket.sources) {
      if (!usedEditorialSourceIds.has(source.id)) continue;
      sourceRefs.push({
        id: editorialEpisodeSourceId(source.id),
        kind: source.kind === "reference" ? "reference" : "primary",
        label: source.name,
        locator: source.url,
      });
    }
  }
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
    const evidenceVisualManifest = sceneEvidenceVisuals.get(`scene-${beat.id.slice("beat-".length)}`);
    const factualSourceRefs = evidenceVisualManifest && editorialEvidencePacket
      ? evidenceVisualManifest.sources.map((source) => editorialEpisodeSourceId(source.id))
      : [];
    return {
      id: beat.id,
      kind: kindForPurpose(beat.purpose, index, storySpine.narrativeBeats.length, audience),
      t0: beat.t0,
      t1: beat.t1,
      claim: text,
      ...(learningObjective ? { learningObjective } : {}),
      scenePurpose: beat.purpose,
      sourceRefs: [
        ...(audience === "children" ? [SCRIPT_SOURCE_ID, CURRICULUM_SOURCE_ID] : [SCRIPT_SOURCE_ID]),
        ...factualSourceRefs,
      ],
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
        ...(evidenceVisualManifest
          ? {
              evidenceVisualIntent: evidenceVisualManifest.visualKind === "chart" ? "factual_chart" as const : "factual_geo" as const,
              evidenceVisualManifest,
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
      evidenceVisualManifests: ctx.store["evidenceVisualManifests"],
      editorialEvidencePacket: ctx.store["editorialEvidencePacket"],
    });
    ctx.log(
      `episode_graph: ${episodeGraph.beats.length} source-grounded beats → ${sceneManifest.scenes.length} deterministic scenes (provider calls: 0)`,
    );
    return { episodeGraph, sceneManifest };
  },
};

export const episodeGraphBlocks: Block[] = [episodeGraph];
