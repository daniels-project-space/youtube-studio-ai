import assert from "node:assert/strict";

import { buildQualityBar } from "@/engine/creative/styleDNA";
import { FAMILIES, type FamilyKey } from "@/engine/families";
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
  Extract<FamilyKey, "comic" | "documentary_collage_short" | "loreshort" | "quizyear" | "shorts" | "whiteboard">,
  readonly string[]
> = {
  comic: ["identity", "script", "voice", "footage", "motion", "thumbnail"],
  documentary_collage_short: ["identity", "script", "voice", "footage", "captions", "pacing", "thumbnail"],
  loreshort: ["identity", "script", "voice", "footage", "motion", "pacing", "thumbnail"],
  quizyear: ["identity", "hook", "captions", "pacing", "thumbnail", "music"],
  shorts: ["identity", "hook", "captions", "pacing", "thumbnail", "voice"],
  whiteboard: ["identity", "script", "footage", "motion", "thumbnail", "voice"],
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

for (const family of Object.keys(FAMILIES) as FamilyKey[]) {
  const bar = buildQualityBar(family, DNA, 123);
  assert.ok(bar.dimensions.length > 0, `${family} must define a reviewer scorecard`);
  assert.ok(
    bar.dimensions.every((dimension) => dimension.description.length > 24),
    `${family} must not fall back to generic dimension guidance`,
  );
}

const music = buildQualityBar("sleep", DNA, 123).dimensions.find(
  (dimension) => dimension.id === "music",
);
assert.match(music?.description ?? "", /emotional arc: unease to clarity/);

const voice = buildQualityBar("narrated_stock", DNA, 123).dimensions.find(
  (dimension) => dimension.id === "voice",
);
assert.match(voice?.description ?? "", /measured documentary narrator/);
assert.match(voice?.description ?? "", /delivery: calm and precise/);

const shortsIdentity = buildQualityBar("shorts", DNA, 123).dimensions.find(
  (dimension) => dimension.id === "identity",
);
assert.match(shortsIdentity?.description ?? "", /archivist at a brass desk/);
assert.match(shortsIdentity?.description ?? "", /rain-lit records room/);
assert.match(shortsIdentity?.description ?? "", /era\/weather/);

const whiteboardMotion = buildQualityBar("whiteboard", {
  ...DNA,
  motionVocabulary: ["hand reveals each diagram line", "labels appear with narration"],
  motionDiscipline: "keep the drawing hand visible and reveal legible marks in speech order",
}, 123).dimensions.find((dimension) => dimension.id === "motion");
assert.match(whiteboardMotion?.description ?? "", /hand reveals each diagram line/);
assert.match(whiteboardMotion?.description ?? "", /speech order/);

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
