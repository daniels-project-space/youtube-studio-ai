import assert from "node:assert/strict";

import {
  inspectShowBibleQuality,
  reconcileShowBibleCrew,
  resolveShowBibleReview,
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
assert.deepEqual(inspectShowBibleQuality({
  ...bible,
  positioning: "Astronomy for curious beginners.",
  vibe: "Quietly curious and exacting.",
  iconicMotif: "A brass telescope.",
}, "narrated_stock"), [], "concise but concrete channel identities remain admissible");
assert.deepEqual(resolveShowBibleReview({ deterministicIssues: [], criticScore: 0.92, criticIssues: [] }), {
  score: 0.92, pass: true, issues: [],
});
assert.equal(resolveShowBibleReview({ deterministicIssues: [], criticScore: Number.NaN }).pass, false,
  "an unavailable or invalid independent verdict cannot establish channel identity");
assert.equal(resolveShowBibleReview({ deterministicIssues: ["vibe is generic"], criticScore: 1 }).pass, false,
  "a generous critic cannot override deterministic identity defects");
const contradictoryCritic = resolveShowBibleReview({
  deterministicIssues: [],
  criticScore: 0.94,
  criticIssues: ["The motif is generic and could describe any astronomy channel."],
});
assert.equal(contradictoryCritic.pass, false,
  "a passing score cannot override a concrete repair issue from the independent critic");
assert.ok(contradictoryCritic.issues.some((issue) => issue.includes("identified repair issues")));

const cases: Array<{ candidate: ShowBible; issue: string }> = [
  { candidate: { ...bible, positioning: " " }, issue: "positioning is empty" },
  { candidate: { ...bible, positioning: "A channel for people." }, issue: "positioning lacks channel-specific substance" },
  { candidate: { ...bible, vibe: "calm, consistent, on-brand" }, issue: "vibe contains generic identity boilerplate" },
  { candidate: { ...bible, iconicMotif: "a single bold, recurring central subject" }, issue: "iconicMotif contains generic identity boilerplate" },
  { candidate: { ...bible, worksInSpace: ["same", "same", "same", "same", "same"] }, issue: "worksInSpace has fewer than five distinct entries" },
  { candidate: { ...bible, avoidInSpace: [" ", "bad", "bad", "worse", "worse"] }, issue: "avoidInSpace has fewer than five distinct entries" },
  { candidate: { ...bible, activeCrew: ["critic"] }, issue: "activeCrew is missing required director" },
  { candidate: { ...bible, directorDoctrine: " " }, issue: "director doctrine is empty" },
  {
    candidate: {
      ...bible,
      worksInSpace: [
        "Use high-quality content", "Make engaging videos", "Create compelling content",
        "Provide valuable videos", "Make great content",
      ],
    },
    issue: "worksInSpace entry 1 lacks niche-specific substance",
  },
  {
    candidate: {
      ...bible,
      worksInSpace: [
        "Open each episode with a question about star color",
        "Open every episode with a question about star color",
        ...bible.worksInSpace.slice(2),
      ],
    },
    issue: "worksInSpace entries 1 and 2 repeat the same guidance",
  },
];

for (const { candidate, issue } of cases) {
  assert.ok(inspectShowBibleQuality(candidate, "narrated_stock").some((actual) => actual.includes(issue)), issue);
}

const lofiBible: ShowBible = {
  ...bible,
  worksInSpace: [
    "Anchor each loop in a single muted instrument motif",
    "Leave harmonic space for uninterrupted study blocks",
    "Introduce vinyl texture only between phrase boundaries",
    "Keep percussion soft enough to recede beneath reading",
    "Resolve chord motion slowly without dramatic lifts",
  ],
  avoidInSpace: [
    "Bright lead synths that distract from written work",
    "Sudden fills that interrupt long concentration sessions",
    "Rapid chord changes that compete with quiet tasks",
    "Loud transient samples at repeating loop boundaries",
    "Melodic hooks that demand active listener attention",
  ],
};
assert.deepEqual(
  inspectShowBibleQuality(lofiBible, "music_loop"),
  [],
  "specific loop-production guidance should qualify for a different channel format",
);

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
