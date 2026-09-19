import assert from "node:assert/strict";
import { buildEpisodeGraph, compileSceneManifest, EpisodeVisualStateSchema } from "@/engine/episodeGraph";
import { buildLearningContract, assertLearningContract } from "@/engine/learningContract";
import { contentLaneForFamily } from "@/engine/contentLane";
import { artifactContract, validateArtifact } from "@/engine/artifactSchemas";

// Retained real-caller counterexample, not a regression demand on LearningContract:
// that contract promises objective/source/graph binding, NOT mathematical proof.
const source = { id: "source-script-math", kind: "script" as const, label: "Approved arithmetic script", locator: "script://audit/math" };
const beat = (id: string, t0: number, t1: number, text: string) => ({
  id, kind: "lesson" as const, t0, t1, claim: text,
  learningObjective: "Add two whole numbers accurately.",
  scenePurpose: "Demonstrate addition of two whole numbers.",
  sourceRefs: [source.id], characterIds: [], text,
  camera: { framing: "wide" as const, move: "static" as const },
  visualState: { action: "Display the addition equation clearly.", props: [] },
  transition: "cut" as const, storySpineBeatIds: [id],
  storySpineSentenceIds: [id.replace("beat-", "sentence-")],
});
const graph = buildEpisodeGraph({
  seriesId: "series-math-audit", episodeId: "episode-math-audit",
  topic: "Whole number addition", audience: "general", durationSec: 12,
  sources: [source], characterIds: [], settingIds: [], characters: [], settings: [],
  beats: [beat("beat-question", 0, 6, "Add two and two."), beat("beat-answer", 6, 12, "Two plus two equals five.")],
  causalEdges: [{ id: "edge-math-answer", fromBeatId: "beat-question", toBeatId: "beat-answer", relation: "answers", rationale: "The second beat answers the first beat.", sourceRefs: [source.id] }],
});
const contract = buildLearningContract(graph, contentLaneForFamily("illustrated_explainer"));
assertLearningContract(contract, graph);
const scenes = compileSceneManifest(graph);
assert.equal(scenes.scenes[1].text, "Two plus two equals five.");
const parsed = EpisodeVisualStateSchema.parse({ action: "Display two plus two equals five.", props: [], workedExample: { answer: "5", verified: true } });
assert.equal(Object.hasOwn(parsed, "workedExample"), false);
const unknown = artifactContract("workedExample");
assert.equal(unknown.opaque, true);
validateArtifact(unknown, { answer: "5", verified: true });
console.log(JSON.stringify({
  falseArithmeticAcceptedThrough: ["buildEpisodeGraph", "buildLearningContract", "assertLearningContract", "compileSceneManifest"],
  answerScene: scenes.scenes[1].text,
  unknownMathPayloadStripped: true,
  unregisteredMathArtifactOpaque: unknown.opaque,
  providerCalls: 0,
}, null, 2));
