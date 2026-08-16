/**
 * A provider-free contract for deterministic illustrated and instructional
 * episodes. It deliberately plans story state only: no model, media, storage,
 * or renderer is imported here.
 */
import { createHash } from "node:crypto";
import { z } from "zod";

import { StorySpineSchema, type StorySpine } from "./storySpine";
import {
  SyntheticScenarioProfileSchema,
  SyntheticScenarioVisualKindSchema,
} from "./syntheticScenario";

const EPSILON = 1e-6;

const stableId = (prefix: string) =>
  z.string().regex(
    new RegExp(`^${prefix}-[a-z0-9]+(?:-[a-z0-9]+)*$`),
    `id must use the stable ${prefix}-… form`,
  );

/**
 * Story Spine predates this public renderer ABI and calls people `entity-*`
 * and places `location-*`. Keep that internal vocabulary at the boundary, but
 * make the renderer's catalog IDs stable and semantically explicit.
 */
export function canonicalEpisodeCatalogId(
  rawId: string,
  prefix: "character" | "setting",
): string {
  const stem = rawId
    .trim()
    .toLowerCase()
    .replace(/^(?:character|entity|setting|location)-/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!stem) throw new Error(`Cannot derive ${prefix} catalog id from ${JSON.stringify(rawId)}`);
  return `${prefix}-${stem}`;
}

const nonEmptyText = (maximum: number) => z.string().trim().min(1).max(maximum);

export const EPISODE_GRAPH_VERSION = "episode-graph/v1" as const;
export const SCENE_MANIFEST_VERSION = "scene-manifest/v1" as const;
export const DETERMINISTIC_SCENE_RENDERER = "deterministic-scene/v1" as const;

export const EpisodeAudienceSchema = z.enum(["general", "children"]);
export type EpisodeAudience = z.infer<typeof EpisodeAudienceSchema>;

export const EpisodeSourceSchema = z.object({
  id: stableId("source"),
  kind: z.enum(["primary", "reference", "curriculum", "script"]),
  label: nonEmptyText(180),
  locator: nonEmptyText(2_048),
});
export type EpisodeSource = z.infer<typeof EpisodeSourceSchema>;

export const EpisodeCharacterSchema = z.object({
  id: stableId("character"),
  displayName: nonEmptyText(80),
  continuityLock: nonEmptyText(600),
});
export type EpisodeCharacter = z.infer<typeof EpisodeCharacterSchema>;

export const EpisodeSettingSchema = z.object({
  id: stableId("setting"),
  displayName: nonEmptyText(120),
  continuityLock: nonEmptyText(600),
});
export type EpisodeSetting = z.infer<typeof EpisodeSettingSchema>;

export const EpisodeCameraSchema = z.object({
  framing: z.enum(["wide", "medium", "close", "establishing"]),
  move: z.enum(["static", "push", "pull", "pan", "track", "orbit"]),
});
export type EpisodeCamera = z.infer<typeof EpisodeCameraSchema>;

export const EpisodeVisualStateSchema = z.object({
  action: nonEmptyText(600),
  mood: nonEmptyText(180).optional(),
  props: z.array(nonEmptyText(100)).max(12).default([]),
  /** Explicit fictional-scenario visual grammar. Omitted for factual/general episodes. */
  syntheticScenarioProfile: SyntheticScenarioProfileSchema.optional(),
  syntheticScenarioVisualKind: SyntheticScenarioVisualKindSchema.optional(),
});
export type EpisodeVisualState = z.infer<typeof EpisodeVisualStateSchema>;

export const EpisodeBeatKindSchema = z.enum([
  "opening",
  "question",
  "claim",
  "observation",
  "problem",
  "experiment",
  "choice",
  "result",
  "lesson",
  "resolution",
]);
export type EpisodeBeatKind = z.infer<typeof EpisodeBeatKindSchema>;

export const EpisodeGraphBeatSchema = z.object({
  id: stableId("beat"),
  kind: EpisodeBeatKindSchema,
  t0: z.number().finite().nonnegative(),
  t1: z.number().finite().positive(),
  claim: nonEmptyText(500).optional(),
  learningObjective: nonEmptyText(240).optional(),
  scenePurpose: nonEmptyText(240),
  sourceRefs: z.array(stableId("source")).min(1),
  characterIds: z.array(stableId("character")),
  settingId: stableId("setting").optional(),
  text: nonEmptyText(1_200),
  camera: EpisodeCameraSchema,
  visualState: EpisodeVisualStateSchema,
  transition: z.enum(["cut", "match_cut", "dissolve", "wipe"]),
  // Additive Story Spine bridge. Renderers do not need it, but the coordinator
  // can prove every graph beat came from existing timed story evidence.
  storySpineBeatIds: z.array(stableId("beat")).min(1),
  storySpineSentenceIds: z.array(stableId("sentence")).min(1),
}).refine((beat) => beat.t1 > beat.t0, "episode graph beat t1 must follow t0");
export type EpisodeGraphBeat = z.infer<typeof EpisodeGraphBeatSchema>;

export const CausalEdgeSchema = z.object({
  id: stableId("edge"),
  fromBeatId: stableId("beat"),
  toBeatId: stableId("beat"),
  relation: z.enum(["causes", "enables", "contrasts", "answers", "resolves", "teaches"]),
  rationale: nonEmptyText(500),
  sourceRefs: z.array(stableId("source")).min(1),
});
export type CausalEdge = z.infer<typeof CausalEdgeSchema>;

/** Stable public handoff for the renderer. Extra catalogs preserve continuity. */
export const EpisodeGraphSchema = z.object({
  version: z.literal(EPISODE_GRAPH_VERSION),
  seriesId: stableId("series"),
  episodeId: stableId("episode"),
  topic: nonEmptyText(300),
  audience: EpisodeAudienceSchema,
  durationSec: z.number().finite().positive(),
  beats: z.array(EpisodeGraphBeatSchema).min(2),
  causalEdges: z.array(CausalEdgeSchema).min(1),
  characterIds: z.array(stableId("character")),
  settingIds: z.array(stableId("setting")),
  sources: z.array(EpisodeSourceSchema).min(1),
  characters: z.array(EpisodeCharacterSchema),
  settings: z.array(EpisodeSettingSchema),
});
export type EpisodeGraph = z.infer<typeof EpisodeGraphSchema>;
export type EpisodeGraphInput = Omit<EpisodeGraph, "version"> & {
  version?: typeof EPISODE_GRAPH_VERSION;
};

export const DeterministicSceneSchema = z.object({
  id: stableId("scene"),
  beatId: stableId("beat"),
  t0: z.number().finite().nonnegative(),
  t1: z.number().finite().positive(),
  kind: EpisodeBeatKindSchema,
  label: nonEmptyText(240),
  characterIds: z.array(stableId("character")),
  settingId: stableId("setting").optional(),
  camera: EpisodeCameraSchema,
  visualState: EpisodeVisualStateSchema,
  text: nonEmptyText(1_200),
  causalInputBeatIds: z.array(stableId("beat")),
  sourceRefs: z.array(stableId("source")).min(1),
  learningObjective: nonEmptyText(240).optional(),
  transition: z.enum(["cut", "match_cut", "dissolve", "wipe"]),
}).refine((scene) => scene.t1 > scene.t0, "scene t1 must follow t0");
export type DeterministicScene = z.infer<typeof DeterministicSceneSchema>;

/** Stable public handoff for a local Remotion/HTML scene renderer. */
export const SceneManifestSchema = z.object({
  version: z.literal(SCENE_MANIFEST_VERSION),
  durationSec: z.number().finite().positive(),
  scenes: z.array(DeterministicSceneSchema).min(2),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  topic: nonEmptyText(300),
  audience: EpisodeAudienceSchema,
  seriesId: stableId("series"),
  episodeId: stableId("episode"),
  renderer: z.literal(DETERMINISTIC_SCENE_RENDERER),
  externalProviderCalls: z.literal(0),
});
export type SceneManifest = z.infer<typeof SceneManifestSchema>;

/** Conservative deterministic text rail for explicitly child-directed lanes. */
const CHILD_UNSAFE_TEXT = [
  /\b(?:kill|killing|murder|murdered|blood|gore|weapon|gun|knife|suicide|drugs?|alcohol|tobacco|sex|naked)\b/i,
  /\b(?:buy|purchase|subscribe|like and subscribe|click the link|give us money)\b/i,
  /(?:https?:\/\/|www\.)/i,
] as const;

export function childSafeTextDefects(text: string, label = "text"): string[] {
  const defects: string[] = [];
  const normalized = text.trim();
  if (!normalized) defects.push(`${label} is empty`);
  for (const pattern of CHILD_UNSAFE_TEXT) {
    if (pattern.test(normalized)) defects.push(`${label} contains child-unsafe or promotional language`);
  }
  return defects;
}

function sortedBeats(beats: readonly EpisodeGraphBeat[]): EpisodeGraphBeat[] {
  return [...beats].sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1 || a.id.localeCompare(b.id));
}

function uniqueIds(values: readonly { id: string }[], label: string): void {
  const ids = new Set<string>();
  for (const value of values) {
    if (ids.has(value.id)) throw new Error(`${label} contains duplicate id ${value.id}`);
    ids.add(value.id);
  }
}

function assertKnownIds(ids: readonly string[], known: ReadonlySet<string>, label: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (!known.has(id)) throw new Error(`${label} references unknown id ${id}`);
    if (seen.has(id)) throw new Error(`${label} repeats id ${id}`);
    seen.add(id);
  }
}

function assertExactCatalogIds(
  declared: readonly string[],
  catalog: readonly { id: string }[],
  label: string,
): void {
  const declaredSet = new Set(declared);
  if (declaredSet.size !== declared.length) throw new Error(`${label} contains duplicate stable ids`);
  const catalogSet = new Set(catalog.map((entry) => entry.id));
  for (const id of declaredSet) if (!catalogSet.has(id)) throw new Error(`${label} declares unknown id ${id}`);
  for (const id of catalogSet) if (!declaredSet.has(id)) throw new Error(`${label} catalog id ${id} is not declared`);
}

function assertFullCoverage(
  entries: readonly { id: string; t0: number; t1: number }[],
  durationSec: number,
  label: string,
): void {
  const ordered = [...entries].sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1 || a.id.localeCompare(b.id));
  let cursor = 0;
  for (const entry of ordered) {
    if (entry.t0 > cursor + EPSILON) {
      throw new Error(`${label} has uncovered interval ${cursor.toFixed(3)}–${entry.t0.toFixed(3)}`);
    }
    if (entry.t0 < cursor - EPSILON) {
      throw new Error(`${label} overlaps at ${entry.id}; timing must be deterministic`);
    }
    cursor = entry.t1;
  }
  if (Math.abs(cursor - durationSec) > EPSILON) {
    throw new Error(`${label} ends at ${cursor.toFixed(3)} but episode duration is ${durationSec.toFixed(3)}`);
  }
}

function assertCausalChain(beats: readonly EpisodeGraphBeat[], edges: readonly CausalEdge[]): void {
  const ordered = sortedBeats(beats);
  const beatById = new Map(ordered.map((beat) => [beat.id, beat]));
  const indexById = new Map(ordered.map((beat, index) => [beat.id, index]));
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.fromBeatId === edge.toBeatId) throw new Error(`causal edge ${edge.id} cannot point to itself`);
    if (!beatById.has(edge.fromBeatId) || !beatById.has(edge.toBeatId)) {
      throw new Error(`causal edge ${edge.id} references an unknown beat`);
    }
    if ((indexById.get(edge.fromBeatId) ?? -1) >= (indexById.get(edge.toBeatId) ?? -1)) {
      throw new Error(`causal edge ${edge.id} must advance forward through the episode`);
    }
    outgoing.set(edge.fromBeatId, [...(outgoing.get(edge.fromBeatId) ?? []), edge.toBeatId]);
  }
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (!edges.some((edge) => edge.fromBeatId === previous.id && edge.toBeatId === current.id)) {
      throw new Error(`episode graph lacks a causal edge from ${previous.id} to ${current.id}`);
    }
  }
  const reachable = new Set<string>();
  const pending = [ordered[0].id];
  while (pending.length) {
    const id = pending.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    pending.push(...(outgoing.get(id) ?? []));
  }
  if (reachable.size !== ordered.length) {
    throw new Error("episode graph has a causal island that is not reachable from its opening");
  }
}

function assertChildSafeGraph(graph: EpisodeGraph): void {
  if (graph.audience !== "children") return;
  if (!graph.sources.some((source) => source.kind === "curriculum")) {
    throw new Error("children episode graph requires at least one curriculum source");
  }
  if (!graph.beats.some((beat) => beat.kind === "lesson" || beat.kind === "resolution")) {
    throw new Error("children episode graph requires a clear lesson or resolution");
  }
  const graphDefects = [
    ...childSafeTextDefects(graph.topic, "children episode topic"),
    ...graph.characters.flatMap((character) => [
      ...childSafeTextDefects(character.displayName, `children character ${character.id} name`),
      ...childSafeTextDefects(character.continuityLock, `children character ${character.id} continuity lock`),
    ]),
    ...graph.settings.flatMap((setting) => [
      ...childSafeTextDefects(setting.displayName, `children setting ${setting.id} name`),
      ...childSafeTextDefects(setting.continuityLock, `children setting ${setting.id} continuity lock`),
    ]),
  ];
  if (graphDefects.length) throw new Error(graphDefects.join("; "));
  for (const beat of graph.beats) {
    if (!beat.learningObjective) {
      throw new Error(`children beat ${beat.id} must state a learning objective`);
    }
    if (!beat.sourceRefs.some((sourceRef) => {
      const source = graph.sources.find((candidate) => candidate.id === sourceRef);
      return source?.kind === "curriculum" || source?.kind === "primary";
    })) {
      throw new Error(`children beat ${beat.id} requires a curriculum or primary source reference`);
    }
    const defects = [
      ...childSafeTextDefects(beat.scenePurpose, `children beat ${beat.id} scene purpose`),
      ...childSafeTextDefects(beat.text, `children beat ${beat.id} text`),
      ...(beat.claim ? childSafeTextDefects(beat.claim, `children beat ${beat.id} claim`) : []),
      ...childSafeTextDefects(beat.learningObjective, `children beat ${beat.id} learning objective`),
      ...childSafeTextDefects(beat.visualState.action, `children beat ${beat.id} visual action`),
      ...(beat.visualState.mood
        ? childSafeTextDefects(beat.visualState.mood, `children beat ${beat.id} visual mood`)
        : []),
      ...beat.visualState.props.flatMap((prop) => childSafeTextDefects(prop, `children beat ${beat.id} prop`)),
    ];
    if (defects.length) throw new Error(defects.join("; "));
    const wordsPerSecond = beat.text.split(/\s+/).filter(Boolean).length / (beat.t1 - beat.t0);
    if (wordsPerSecond > 3) {
      throw new Error(`children beat ${beat.id} exceeds the 180 words-per-minute readability ceiling`);
    }
  }
}

/**
 * Validates the canonical graph before any renderer consumes it. The strict
 * checks are intentionally independent of a future renderer implementation.
 */
export function assertEpisodeGraph(value: unknown): EpisodeGraph {
  const graph = EpisodeGraphSchema.parse(value);
  uniqueIds(graph.sources, "episode sources");
  uniqueIds(graph.characters, "episode characters");
  uniqueIds(graph.settings, "episode settings");
  uniqueIds(graph.beats, "episode graph beats");
  uniqueIds(graph.causalEdges, "causal edges");
  assertExactCatalogIds(graph.characterIds, graph.characters, "episode characterIds");
  assertExactCatalogIds(graph.settingIds, graph.settings, "episode settingIds");

  const sourceIds = new Set(graph.sources.map((source) => source.id));
  const characterIds = new Set(graph.characterIds);
  const settingIds = new Set(graph.settingIds);
  for (const beat of graph.beats) {
    assertKnownIds(beat.sourceRefs, sourceIds, `episode beat ${beat.id}`);
    assertKnownIds(beat.characterIds, characterIds, `episode beat ${beat.id}`);
    if (beat.settingId) assertKnownIds([beat.settingId], settingIds, `episode beat ${beat.id}`);
  }
  for (const edge of graph.causalEdges) {
    assertKnownIds(edge.sourceRefs, sourceIds, `causal edge ${edge.id}`);
  }
  assertFullCoverage(graph.beats, graph.durationSec, "episode graph");
  assertCausalChain(graph.beats, graph.causalEdges);
  assertChildSafeGraph(graph);
  return graph;
}

/** Convenience builder that pins the current version and then fail-closes. */
export function buildEpisodeGraph(input: EpisodeGraphInput): EpisodeGraph {
  return assertEpisodeGraph({ ...input, version: EPISODE_GRAPH_VERSION });
}

/** Backwards-friendly verb for callers that prefer validate-style naming. */
export const validateEpisodeGraph = assertEpisodeGraph;

/**
 * Optional bridge to the existing Story Spine. It does not modify that schema;
 * it simply proves the graph's duration, timed evidence, characters, and
 * settings are all grounded in the upstream canonical artifact.
 */
export function assertEpisodeGraphAgainstStorySpine(value: unknown, storySpine: StorySpine): EpisodeGraph {
  const graph = assertEpisodeGraph(value);
  const spine = StorySpineSchema.parse(storySpine);
  if (Math.abs(graph.durationSec - spine.timedScript.narrationDurationSec) > EPSILON) {
    throw new Error(
      `episode graph duration ${graph.durationSec} does not match Story Spine duration ${spine.timedScript.narrationDurationSec}`,
    );
  }
  const storyBeatIds = new Set(spine.narrativeBeats.map((beat) => beat.id));
  const sentenceIds = new Set(spine.timedScript.sentences.map((sentence) => sentence.id));
  const characterIds = new Set(
    spine.continuityLedger.entities.map((entity) => canonicalEpisodeCatalogId(entity.id, "character")),
  );
  const settingIds = new Set(
    spine.continuityLedger.locations.map((location) => canonicalEpisodeCatalogId(location.id, "setting")),
  );
  if (characterIds.size !== spine.continuityLedger.entities.length) {
    throw new Error("Story Spine entity ids collapse to duplicate Episode Graph character ids");
  }
  if (settingIds.size !== spine.continuityLedger.locations.length) {
    throw new Error("Story Spine location ids collapse to duplicate Episode Graph setting ids");
  }
  assertKnownIds(graph.characterIds, characterIds, "episode graph characterIds");
  assertKnownIds(graph.settingIds, settingIds, "episode graph settingIds");
  for (const beat of graph.beats) {
    assertKnownIds(beat.storySpineBeatIds, storyBeatIds, `episode beat ${beat.id}`);
    assertKnownIds(beat.storySpineSentenceIds, sentenceIds, `episode beat ${beat.id}`);
    assertKnownIds(beat.characterIds, characterIds, `episode beat ${beat.id}`);
    if (beat.settingId) assertKnownIds([beat.settingId], settingIds, `episode beat ${beat.id}`);
  }
  return graph;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new Error(`cannot canonicalize ${typeof value}`);
}

function normalizedForFingerprint(graph: EpisodeGraph): EpisodeGraph {
  return {
    ...graph,
    sources: [...graph.sources].sort((a, b) => a.id.localeCompare(b.id)),
    characters: [...graph.characters].sort((a, b) => a.id.localeCompare(b.id)),
    settings: [...graph.settings].sort((a, b) => a.id.localeCompare(b.id)),
    characterIds: [...graph.characterIds].sort(),
    settingIds: [...graph.settingIds].sort(),
    beats: sortedBeats(graph.beats).map((beat) => ({
      ...beat,
      sourceRefs: [...beat.sourceRefs].sort(),
      characterIds: [...beat.characterIds].sort(),
      storySpineBeatIds: [...beat.storySpineBeatIds].sort(),
      storySpineSentenceIds: [...beat.storySpineSentenceIds].sort(),
      visualState: { ...beat.visualState, props: [...beat.visualState.props].sort() },
    })),
    causalEdges: [...graph.causalEdges]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((edge) => ({ ...edge, sourceRefs: [...edge.sourceRefs].sort() })),
  };
}

/** Stable content address for idempotent local scene compilation. */
export function episodeGraphFingerprint(value: unknown): string {
  const graph = assertEpisodeGraph(value);
  return createHash("sha256").update(canonicalJson(normalizedForFingerprint(graph))).digest("hex");
}

/** Validates the renderer handoff independently of the graph builder. */
export function assertSceneManifest(value: unknown): SceneManifest {
  const manifest = SceneManifestSchema.parse(value);
  uniqueIds(manifest.scenes, "scene manifest scenes");
  const beatIds = new Set<string>();
  for (const scene of manifest.scenes) {
    if (beatIds.has(scene.beatId)) throw new Error(`scene manifest repeats beat ${scene.beatId}`);
    beatIds.add(scene.beatId);
  }
  assertFullCoverage(manifest.scenes, manifest.durationSec, "scene manifest");
  if (manifest.audience === "children") {
    for (const scene of manifest.scenes) {
      const defects = [
        ...childSafeTextDefects(scene.label, `children scene ${scene.id} label`),
        ...childSafeTextDefects(scene.text, `children scene ${scene.id} text`),
        ...(scene.learningObjective
          ? childSafeTextDefects(scene.learningObjective, `children scene ${scene.id} learning objective`)
          : []),
      ];
      if (defects.length) throw new Error(defects.join("; "));
    }
  }
  return manifest;
}

/**
 * Deterministically compiles a graph into a local-only Scene Manifest. It does
 * not create pixels and it records zero external provider calls by contract.
 */
export function compileSceneManifest(value: unknown, storySpine?: StorySpine): SceneManifest {
  const graph = storySpine
    ? assertEpisodeGraphAgainstStorySpine(value, storySpine)
    : assertEpisodeGraph(value);
  const scenes = sortedBeats(graph.beats).map((beat) => ({
    id: `scene-${beat.id.slice("beat-".length)}`,
    beatId: beat.id,
    t0: beat.t0,
    t1: beat.t1,
    kind: beat.kind,
    // The renderer's on-screen label should express the actual claim, not an
    // internal production instruction such as "present the question". Keep it
    // bounded for safe-area typography while the full purpose remains in the
    // graph for editorial diagnostics.
    label: (() => {
      const presentationClaim = beat.claim?.trim() || beat.scenePurpose;
      return Array.from(presentationClaim).length <= 240
        ? presentationClaim
        : `${Array.from(presentationClaim).slice(0, 237).join("")}…`;
    })(),
    characterIds: [...beat.characterIds].sort(),
    ...(beat.settingId ? { settingId: beat.settingId } : {}),
    camera: beat.camera,
    visualState: { ...beat.visualState, props: [...beat.visualState.props].sort() },
    text: beat.text,
    causalInputBeatIds: graph.causalEdges
      .filter((edge) => edge.toBeatId === beat.id)
      .map((edge) => edge.fromBeatId)
      .sort(),
    sourceRefs: [...beat.sourceRefs].sort(),
    ...(beat.learningObjective ? { learningObjective: beat.learningObjective } : {}),
    transition: beat.transition,
  }));
  return assertSceneManifest({
    version: SCENE_MANIFEST_VERSION,
    durationSec: graph.durationSec,
    scenes,
    fingerprint: episodeGraphFingerprint(graph),
    topic: graph.topic,
    audience: graph.audience,
    seriesId: graph.seriesId,
    episodeId: graph.episodeId,
    renderer: DETERMINISTIC_SCENE_RENDERER,
    externalProviderCalls: 0,
  });
}

/** Compatibility alias for early callers; new code should use compileSceneManifest. */
export const compileEpisodeGraph = compileSceneManifest;
