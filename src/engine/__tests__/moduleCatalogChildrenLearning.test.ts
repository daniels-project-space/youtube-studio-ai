import assert from "node:assert/strict";
import { getModuleSpec, sanitizeParamOverrides } from "../moduleCatalog";

const curriculum = getModuleSpec("curriculum_episode_seed");
assert.deepEqual(curriculum, {
  block: "curriculum_episode_seed",
  label: "Children · Curriculum Seed",
  description: "Binds one age-banded, child-editor-approved learning objective and curriculum evidence before story planning.",
  optional: false,
  params: [],
});

const showBible = getModuleSpec("children_show_bible");
assert.deepEqual(showBible, {
  block: "children_show_bible",
  label: "Children · Show Bible",
  description: "Locks an original guide, world, participation pattern, and recall against the approved lesson before rendering.",
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

console.log("Children-learning module catalog contracts passed");
