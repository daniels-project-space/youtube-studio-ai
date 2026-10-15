import assert from "node:assert/strict";

import {
  inspectShowBibleQuality,
  reconcileShowBibleCrew,
} from "@/engine/creative/showBible";
import type { ShowBible } from "@/engine/creative/types";

const bible: ShowBible = {
  positioning: "A practical field guide to overlooked astronomy for curious beginners.",
  vibe: "Quietly wondrous, precise, and welcoming.",
  iconicMotif: "A brass telescope framed by a hand-drawn orbit.",
  worksInSpace: [
    "Open with a visible sky observation",
    "Use one celestial object per chapter",
    "Pair scale comparisons with familiar distances",
    "Explain uncertainty when measurements vary",
    "Return to the opening observation at the end",
  ],
  avoidInSpace: [
    "Unexplained strings of technical terms",
    "Sensational claims about ordinary events",
    "Decorative star fields behind every shot",
    "Mixing incompatible distance scales",
    "Promising discoveries the episode does not explain",
  ],
  activeCrew: ["director", "cinematographer", "editor", "composer", "critic"],
  directorDoctrine: "Build each episode around one question and resolve it plainly.",
  dpDoctrine: "Use restrained diagrams that clarify the current physical scale.",
  editorDoctrine: "Let each cut follow a change in the explanation, not a music accent.",
  composerDoctrine: "Keep the score low and spacious beneath the spoken explanation.",
  criticDoctrine: "Flag unsupported claims and imagery that obscures the explanation.",
  refreshedAt: 1,
};

assert.deepEqual(inspectShowBibleQuality(bible, "narrated_stock"), []);

const cases: Array<{ candidate: ShowBible; issue: string }> = [
  { candidate: { ...bible, positioning: " " }, issue: "positioning is empty" },
  { candidate: { ...bible, worksInSpace: ["same", "same", "same", "same", "same"] }, issue: "worksInSpace has fewer than five distinct entries" },
  { candidate: { ...bible, avoidInSpace: [" ", "bad", "bad", "worse", "worse"] }, issue: "avoidInSpace has fewer than five distinct entries" },
  { candidate: { ...bible, activeCrew: ["critic"] }, issue: "activeCrew is missing required director" },
  { candidate: { ...bible, directorDoctrine: " " }, issue: "director doctrine is empty" },
];

for (const { candidate, issue } of cases) {
  assert.ok(inspectShowBibleQuality(candidate, "narrated_stock").includes(issue), issue);
}

assert.deepEqual(
  reconcileShowBibleCrew("narrated_stock", ["critic"]),
  ["critic", "director"],
  "a critic-only proposal must retain the family's primary creator",
);
assert.deepEqual(
  reconcileShowBibleCrew("quizyear", []),
  [],
  "families with no crew modules must not gain synthetic crew roles",
);

console.log("show bible quality admission: ok");
