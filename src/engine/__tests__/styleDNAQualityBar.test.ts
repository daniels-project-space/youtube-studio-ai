import assert from "node:assert/strict";

import { buildQualityBar } from "@/engine/creative/styleDNA";
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

console.log("style DNA quality-bar family coverage passed");
