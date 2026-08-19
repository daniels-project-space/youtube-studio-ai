import assert from "node:assert/strict";
import type { SceneManifest } from "@/engine/episodeGraph";
import {
  SCENE_COMPILER_FPS,
  safeSceneLabel,
  sceneKindFor,
  sceneLabelFor,
  sceneManifestDurationInFrames,
} from "@/remotion/sceneCompiler/SceneCompiler";

const scene = {
  id: "scene-brief",
  t0: 0,
  t1: 2.01,
  kind: "chart",
  label: "A short, readable label",
  copy: {
    narration: "This deliberately very long narration must never be used as a visual scene label.",
  },
} as unknown as SceneManifest["scenes"][number];

const manifest = {
  durationSec: 2.01,
  scenes: [scene],
} as unknown as SceneManifest;

assert.equal(sceneKindFor(scene), "chart");
assert.equal(sceneLabelFor(scene), "A short, readable label");
assert.equal(sceneManifestDurationInFrames(manifest), Math.ceil(2.01 * SCENE_COMPILER_FPS));
assert.equal(safeSceneLabel("x".repeat(100)).length, 70);

for (const kind of ["map", "chart", "diagram", "panel", "puppet", "screen"] as const) {
  assert.equal(sceneKindFor({ ...scene, kind } as unknown as SceneManifest["scenes"][number]), kind);
}
assert.equal(
  sceneKindFor({ ...scene, kind: "question", characterIds: ["character-mira"] } as unknown as SceneManifest["scenes"][number]),
  "puppet",
  "narrative question beats with a character must use the story-puppet grammar, not a random widget",
);
assert.equal(
  sceneKindFor({ ...scene, kind: "evidence" } as unknown as SceneManifest["scenes"][number]),
  "diagram",
  "evidence beats must be rendered as an explanatory visual grammar",
);

assert.equal(
  sceneLabelFor({
    ...scene,
    label: undefined,
    copy: { narration: "Narration is never a presentation-label fallback." },
  } as unknown as SceneManifest["scenes"][number]),
  "Scene",
);

console.log("scene compiler renderer tests passed");
