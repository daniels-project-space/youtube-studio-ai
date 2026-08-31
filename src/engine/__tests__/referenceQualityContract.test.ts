import assert from "node:assert/strict";

import { buildQualityBar } from "@/engine/creative/styleDNA";
import { FAMILY_KEYS } from "@/engine/families";
import {
  assertReferenceQualityContracts,
  referenceQualityContractFor,
} from "@/engine/creative/referenceQuality";
import type { StyleDNA } from "@/engine/creative/types";

const DNA: StyleDNA = {
  source: "research+vision",
  confidence: 0.9,
  groundingGaps: [],
  palette: ["#181818", "#d6a84b"],
  recurringSubject: "archivist at a brass desk",
  setting: "a rain-lit records room",
  composition: "foreground evidence against deep practical light",
  colorGrade: "warm archival noir",
  motifs: ["case file", "brass lamp"],
  variationAxes: ["era", "weather"],
  motionVocabulary: ["page turns", "slow dolly", "rain"],
  motionDiscipline: "moves follow the beat and never become decorative",
  visualAvoid: ["generic b-roll", "frozen frames"],
  thumbnail: {
    composition: "one evidence object in the lower third",
    textRule: "two words maximum",
    palette: ["#181818", "#d6a84b"],
    subject: "the revealing evidence object",
  },
  audio: {
    genre: "restrained documentary score",
    bpmRange: [68, 82],
    instrumentation: ["piano"],
    textures: ["room tone"],
    moodArc: "unease to clarity",
    loudnessLufs: -14,
    loopable: false,
  },
  narrative: {
    scriptStyle: "evidence-led, concrete sentences",
    hookStyle: "open with the consequential fact",
    pacing: "each beat earns the next reveal",
    voiceProfile: "measured documentary narrator",
    delivery: "calm and precise",
  },
  seo: {
    titleFormula: "The evidence that changed [case]",
    descriptionStructure: "claim, source, takeaway",
    playlistStrategy: "case files by era",
  },
  refreshedAt: 100,
};

assert.doesNotThrow(assertReferenceQualityContracts);
assert.deepEqual(
  FAMILY_KEYS.filter((family) => referenceQualityContractFor(family).calibration !== "calibrated"),
  [],
  "every current creator family must carry a source-bound quality standard rather than silently fall back to generic QA",
);

const casefile = referenceQualityContractFor("documentary_collage_short");
assert.equal(casefile.calibration, "calibrated");
assert.equal(casefile.comparisonPolicy, "mechanics-only-no-automatic-comparison");
assert.ok(casefile.sources.some((source) => source.id === "fern"));
assert.ok(
  casefile.sources.some((source) => source.id === "wendover"),
  "documentary calibration must include a systems-explainer standard without permitting imitation",
);
assert.match(
  casefile.sources.find((source) => source.id === "wendover")?.prohibitedImitation ?? "",
  /Do not copy topics, scripts, maps, visual identity, sourcing, narration, or packaging/,
);
assert.deepEqual(
  new Set(casefile.requirements.map((requirement) => requirement.area)),
  new Set(["story", "pacing", "presentation", "audio"]),
  "a calibrated narrative family must specify all four quality areas",
);
assert.ok(
  casefile.requirements.some((requirement) => requirement.evidence.includes("claim-to-source-to-shot-coverage")),
  "casefile standards must name claim-to-source-to-shot evidence rather than claim an automatic comparison",
);

const casefileBar = buildQualityBar("documentary_collage_short", DNA, 123);
assert.deepEqual(casefileBar.referenceQuality, casefile, "creator quality bars must persist the exact reference contract");
assert.match(
  casefileBar.dimensions.find((dimension) => dimension.id === "script")?.description ?? "",
  /Reference-quality story.*mechanics only, no automatic comparison/,
  "the reviewer-facing rubric must carry the honest reference boundary",
);
for (const requirement of casefile.requirements) {
  assert.ok(
    casefileBar.dimensions.some((dimension) => requirement.dimensionIds.includes(dimension.id)),
    `${requirement.id} must bind to a real quality-bar dimension`,
  );
}

const child = referenceQualityContractFor("children_learning");
assert.deepEqual(
  child.sources.map((source) => source.id).sort(),
  ["pinkfong", "ted-ed"],
  "children learning must use source-bound explanatory and participatory references",
);
assert.ok(child.requirements.some((requirement) => requirement.evidence.includes("learning-contract-evidence")));

const whiteboardBar = buildQualityBar("whiteboard", DNA, 123);
const whiteboardVoice = whiteboardBar.dimensions.find((dimension) => dimension.id === "voice");
assert.ok(whiteboardVoice, "a reference audio standard must not be orphaned when the legacy family rubric omitted voice");
assert.equal(whiteboardVoice?.metric, undefined, "the contract must not invent a deterministic audio evaluator");

const ambient = referenceQualityContractFor("music_loop");
assert.ok(ambient.sources.some((source) => source.id === "soothing-relaxation"));
assert.ok(ambient.requirements.some((requirement) => requirement.id === "audio-continuity"));

const shorts = referenceQualityContractFor("shorts");
assert.equal(shorts.calibration, "calibrated");
assert.deepEqual(shorts.sources.map((source) => source.id), ["zack-d-films"]);
assert.ok(shorts.requirements.some((requirement) => requirement.id === "truthful-immediate-payoff"));
assert.ok(
  buildQualityBar("shorts", DNA, 123).dimensions.some((dimension) => dimension.id === "voice"),
  "the short-form audio quality requirement must become a real rubric dimension",
);

const quiz = referenceQualityContractFor("quizyear");
assert.equal(quiz.calibration, "calibrated");
assert.deepEqual(quiz.sources.map((source) => source.id), ["bright-side"]);
assert.ok(quiz.requirements.some((requirement) => requirement.evidence.includes("question-answer-source-evidence")));
assert.ok(
  buildQualityBar("quizyear", DNA, 123).dimensions.some((dimension) => dimension.id === "music"),
  "the quiz audio quality requirement must become a real rubric dimension",
);

// The caller receives a clone, so one review/session cannot mutate another
// channel's static calibration source of truth.
casefile.sources[0]!.label = "mutated locally";
assert.equal(referenceQualityContractFor("documentary_collage_short").sources[0]?.label, "Fern");

console.log("reference-quality creator contract passed");
