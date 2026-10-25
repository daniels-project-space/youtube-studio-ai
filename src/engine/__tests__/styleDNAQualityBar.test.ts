import assert from "node:assert/strict";

import {
  buildQualityBar,
  buildStyleDnaCriticPrompt,
  scoreStyleDnaCritique,
} from "@/engine/creative/styleDNA";
import type { FamilyKey } from "@/engine/families";
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

const SPECIALIST_EXPECTED: Record<
  Extract<FamilyKey, "comic" | "documentary_collage_short" | "loreshort" | "quizyear" | "shorts">,
  readonly string[]
> = {
  comic: ["identity", "script", "voice", "footage", "motion", "thumbnail"],
  documentary_collage_short: ["identity", "script", "voice", "footage", "captions", "pacing", "thumbnail"],
  loreshort: ["identity", "script", "voice", "footage", "motion", "pacing", "thumbnail"],
  quizyear: ["identity", "hook", "captions", "pacing", "thumbnail", "music"],
  shorts: ["hook", "captions", "pacing", "thumbnail", "voice"],
};

for (const [family, expectedIds] of Object.entries(SPECIALIST_EXPECTED) as Array<
  [keyof typeof SPECIALIST_EXPECTED, readonly string[]]
>) {
  const bar = buildQualityBar(family, DNA, 123);
  assert.deepEqual(
    bar.dimensions.map((dimension) => dimension.id),
    expectedIds,
    `${family} must have a family-specific quality contract rather than the generic fallback`,
  );
  assert.ok(
    bar.dimensions.every((dimension) => dimension.description.length > 24),
    `${family} dimensions must give the reviewer usable guidance`,
  );
  assert.ok(
    bar.dimensions.every((dimension) => dimension.metric === undefined),
    `${family} must not invent deterministic floors without a matching evaluator`,
  );
}

const loreMotion = buildQualityBar("loreshort", DNA, 123).dimensions.find(
  (dimension) => dimension.id === "motion",
);
assert.match(loreMotion?.description ?? "", /page turns, slow dolly, rain/);
assert.match(loreMotion?.description ?? "", /moves follow the beat/);

const quizCaptions = buildQualityBar("quizyear", DNA, 123).dimensions.find(
  (dimension) => dimension.id === "captions",
);
assert.match(quizCaptions?.description ?? "", /prompts, options, timer, and reveal text/);

const unavailableCritic = scoreStyleDnaCritique([], null);
assert.equal(unavailableCritic.pass, false, "missing independent critique must never accept a style draft");
assert.equal(unavailableCritic.score, 0);
assert.match(unavailableCritic.issues.join(" "), /specificity critic unavailable/);

const reviewedDraft = scoreStyleDnaCritique([], { score: 0.92, issues: [] });
assert.equal(reviewedDraft.pass, true, "a clear independent review above the bar may accept a grounded draft");

const deterministicFailure = scoreStyleDnaCritique(["channel identity is too generic"], {
  score: 1,
  issues: [],
});
assert.equal(deterministicFailure.pass, false, "the model critic cannot override deterministic identity failures");
assert.equal(deterministicFailure.score, 0.6);

const criticPrompt = buildStyleDnaCriticPrompt({
  name: "Neon Archive",
  programBriefText: "Concept: a research-led series about private archives in imagined cities.",
  persona: "A precise archivist working from a neon penthouse, never a cozy cafe.",
  styleGrammar: "Hard-edged glass reflections, restrained magenta, no rustic props.",
  exampleClipNotes: "Keep the camera above the city and let evidence drive each reveal.",
  researchText: "Competitors favor warm desk lamps and parchment textures.",
  draft: DNA,
});
assert.match(criticPrompt, /Declared channel program: Concept: a research-led series/);
assert.match(criticPrompt, /Operator persona \(canonical\): A precise archivist/);
assert.match(criticPrompt, /research may inform execution and packaging, but it must not replace or relocate the channel's canon/i);
assert.match(criticPrompt, /Competitors favor warm desk lamps/);

console.log("style DNA quality-bar family coverage passed");
