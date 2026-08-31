import assert from "node:assert/strict";

import {
  assertWhiteboardGoldenStyle,
  whiteboardGoldenStyleDefects,
} from "@/lib/whiteboardSync";

const narration =
  "A small fee leaves an account at every year marker. Across the years it reduces the balance that can keep compounding. A worried saver sees the gap widen. The final balance shows the full compounding gap before the board holds. The calm final pause gives the viewer time to connect the annual fee, the calendar, the human reaction, and the separated future account values into one clear explanation rather than a rushed sequence of icons.";

const densePlan = {
  panels: [{
    narration,
    layers: [
      { kind: "art", role: "hero", draw: "an account balance passing yearly fee toll marks before its next annual growth step", cue: "small fee leaves", box: [0.34, 0.20, 0.46, 0.48] },
      { kind: "art", role: "evidence", draw: "a calendar with recurring red fee marks", cue: "Across the years", box: [0.10, 0.22, 0.20, 0.18] },
      { kind: "label", text: "COMPOUNDING GAP", cue: "reduces the balance", box: [0.16, 0.84, 0.62, 0.07] },
      { kind: "art", role: "reaction", draw: "a worried saver holding one account statement and looking at one red fee coin", cue: "worried saver", box: [0.10, 0.50, 0.20, 0.24] },
      { kind: "art", role: "evidence", draw: "two future account values separated by a red gap arrow", cue: "human reaction", box: [0.80, 0.48, 0.16, 0.20] },
    ],
  }],
};

assert.deepEqual(
  whiteboardGoldenStyleDefects(densePlan),
  [],
  "a hero, two evidence drawings, an expressive reaction, a native label, and spread cues preserve the Golden board grammar",
);

const metaphorPlan = {
  panels: [{
    ...densePlan.panels[0],
    layers: densePlan.panels[0].layers.map((layer) =>
      layer.role === "evidence" && layer.box[0] === 0.80
        ? { ...layer, draw: "a decorative compass standing in for a future account value", cue: "human reaction" }
        : layer,
    ),
  }],
};
assert.ok(
  whiteboardGoldenStyleDefects(metaphorPlan).some((defect) => defect.includes("ungrounded visual metaphor")),
  "a generic compass/tree/seed-style shorthand must fail before paid art when the spoken cue does not name it",
);

const literalCompassPlan = {
  panels: [{
    ...densePlan.panels[0],
    narration: narration.replace("The final balance", "The compass"),
    layers: densePlan.panels[0].layers.map((layer) =>
      layer.role === "evidence" && layer.box[0] === 0.80
        ? { ...layer, draw: "a compass beside the mapped historical route", cue: "compass" }
        : layer,
    ),
  }],
};
assert.deepEqual(
  whiteboardGoldenStyleDefects(literalCompassPlan),
  [],
  "a compass remains permissible when the exact spoken cue is actually about a compass",
);

const unreadableSupportPlan = {
  panels: [{
    ...densePlan.panels[0],
    layers: densePlan.panels[0].layers.map((layer) =>
      layer.role === "evidence" && layer.box[0] === 0.80
        ? { ...layer, box: [0.84, 0.54, 0.10, 0.12] }
        : layer,
    ),
  }],
};
assert.ok(
  whiteboardGoldenStyleDefects(unreadableSupportPlan).some((defect) => defect.includes("unreadable")),
  "a tiny supporting slot must fail instead of shrinking a meaningful drawing into an illegible thumbnail",
);

const overloadedSupportPlan = {
  panels: [{
    ...densePlan.panels[0],
    layers: densePlan.panels[0].layers.map((layer) =>
      layer.role === "evidence" && layer.box[0] === 0.80
        ? {
            ...layer,
            draw: "a crowded miniature comparison of a blank headline card, fee receipt, tax form, risk warning, calendar, calculator, disclosure stack, account statement, coin pile, service checklist, and several arrows",
          }
        : layer,
    ),
  }],
};
assert.ok(
  whiteboardGoldenStyleDefects(overloadedSupportPlan).some((defect) => defect.includes("overloads a small supporting drawing")),
  "a small slot may explain one relationship, never an unreadable miniature dashboard",
);

const sparsePlan = {
  panels: [{
    narration,
    layers: [
      { kind: "art", role: "hero", draw: "a generic dollar icon", cue: "small fee starts", box: [0.20, 0.22, 0.44, 0.46] },
      { kind: "label", text: "FEE", cue: "Across the years", box: [0.20, 0.84, 0.44, 0.07] },
    ],
  }],
};

assert.ok(
  whiteboardGoldenStyleDefects(sparsePlan).some((defect) => defect.includes("Golden whiteboard grammar")),
  "an isolated-icon board must be called out before paid art or narration begins",
);
assert.throws(
  () => assertWhiteboardGoldenStyle(sparsePlan),
  /Golden whiteboard style gate rejected/,
  "supplied, cached, and route-sealed plans all use the same fail-closed style gate",
);

const noReactionPlan = {
  panels: Array.from({ length: 2 }, () => ({
    ...densePlan.panels[0],
    layers: densePlan.panels[0].layers.map((layer) =>
      layer.role === "reaction" ? { ...layer, role: "evidence" } : layer,
    ),
  })),
};
assert.ok(
  whiteboardGoldenStyleDefects(noReactionPlan).some((defect) => defect.includes("expressive reaction character")),
  "multi-panel plans must carry contextual human reactions regularly instead of reverting to sterile icon-only boards",
);

const overlappingPlan = {
  panels: [{
    ...densePlan.panels[0],
    layers: densePlan.panels[0].layers.map((layer) =>
      layer.role === "evidence" && layer.box[0] === 0.80
        ? { ...layer, box: [0.16, 0.54, 0.16, 0.16] }
        : layer,
    ),
  }],
};
assert.ok(
  whiteboardGoldenStyleDefects(overlappingPlan).some((defect) => defect.includes("overlapping generated drawings")),
  "separate generated visual layers must not paint over a reaction character or another factual sketch",
);

console.log("whiteboard Golden style gate: PASS");
