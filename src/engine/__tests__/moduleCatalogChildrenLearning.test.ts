import assert from "node:assert/strict";
import { getModuleSpec, sanitizeParamOverrides } from "../moduleCatalog";
import { registerAllBlocks } from "../blocks";
import { getManifest } from "../registry";

const curriculum = getModuleSpec("curriculum_episode_seed");
assert.deepEqual(curriculum, {
  block: "curriculum_episode_seed",
  label: "Children · Curriculum Seed",
  description: "Accepts one child-editor-approved, age-banded lesson intent. It does not write, render, or publish an episode.",
  optional: false,
  params: [],
});

const showBible = getModuleSpec("children_show_bible");
assert.deepEqual(showBible, {
  block: "children_show_bible",
  label: "Children · Show Bible",
  description: "Checks the reviewed series identity and participation pattern against an already-approved lesson. It does not choose curriculum, write, render, or publish.",
  optional: false,
  params: [],
});

const videoTreatment = getModuleSpec("children_video_treatment");
assert.deepEqual(videoTreatment, {
  block: "children_video_treatment",
  label: "Children · Video Treatment",
  description: "Sends the approved guide, world, learning action, and calm-motion rules to visual and thumbnail modules. It does not render, assess safety, or publish.",
  optional: false,
  params: [],
});

assert.deepEqual(
  sanitizeParamOverrides({
    curriculum_episode_seed: { learningObjective: "Ignore the approved curriculum" },
    children_show_bible: { recurringGuide: "Replace the reviewed identity" },
  }),
  {},
  "children-learning identity and curriculum must remain owned by the reviewed private packet",
);

/**
 * A children *lane* composes these modules. These assertions protect the
 * boundary: each block can only receive the artifacts it needs and can only
 * hand off artifacts that it owns. No block is allowed to silently become a
 * curriculum planner, renderer, or publisher for another module.
 */
registerAllBlocks();
const curriculumManifest = getManifest("curriculum_episode_seed");
const showBibleManifest = getManifest("children_show_bible");
const safetyManifest = getManifest("child_content_safety");
const treatmentManifest = getManifest("children_video_treatment");
assert(curriculumManifest && showBibleManifest && treatmentManifest && safetyManifest);

assert.deepEqual(Object.keys(curriculumManifest.produces).sort(), [
  "curriculumEpisodeSeed",
  "curriculumEpisodeSeedApproval",
]);
assert.deepEqual(Object.keys(showBibleManifest.produces).sort(), [
  "childrenShowBible",
  "childrenShowBibleApproval",
]);
assert.deepEqual(Object.keys(treatmentManifest.produces).sort(), ["childrenVideoTreatment"]);
assert.deepEqual(Object.keys(safetyManifest.produces).sort(), ["childContentSafety"]);

assert.equal(
  Object.keys(showBibleManifest.consumes).includes("sceneManifest"),
  false,
  "show bible validates identity/participation before render planning; it must not own scenes",
);
assert.equal(
  Object.keys(treatmentManifest.consumes).includes("childrenShowBible"),
  true,
  "video direction must consume the approved identity handoff rather than re-owning identity input",
);
assert.equal(
  Object.keys(showBibleManifest.consumes).includes("childContentSafety"),
  false,
  "show bible must not depend on, alter, or bypass the independent safety gate",
);
assert.equal(
  Object.keys(safetyManifest.consumes).includes("childrenShowBibleInput"),
  false,
  "safety consumes the show bible artifact, never the identity module's raw operator input",
);
assert.equal(
  Object.keys(safetyManifest.consumes).includes("curriculumEpisodeSeedInput"),
  false,
  "safety consumes the curriculum artifact, never the curriculum module's raw operator input",
);

console.log("Children-learning module catalog contracts passed");
